//! Remote providers, one schema repair, then deterministic zero-I/O fallback.
use crate::{game_provider::Failure, provider::Transport};
use serde_json::{json, Value};
use std::{future::Future, time::Instant};
pub trait RemoteGame: Sync {
    fn cooling(&self, _tier: &str) -> bool {
        false
    }
    fn record(&self, _tier: &str, _success: bool) {}
    fn available(&self, tier: &str) -> impl Future<Output = bool> + Send;
    fn generate(
        &self,
        tier: &str,
        input: &Value,
        repair: Option<&str>,
    ) -> impl Future<Output = Result<Value, Failure>> + Send;
}
pub struct Reserved<'a> {
    pub transport: &'a Transport,
    pub permit: Option<&'a tokio::sync::OwnedSemaphorePermit>,
}
impl RemoteGame for Reserved<'_> {
    fn cooling(&self, tier: &str) -> bool {
        self.transport.game_cooling(tier)
    }
    fn record(&self, tier: &str, success: bool) {
        self.transport.game_record(tier, success);
    }
    async fn available(&self, tier: &str) -> bool {
        self.transport.game_is_available(self.permit, tier).await
    }
    async fn generate(
        &self,
        tier: &str,
        input: &Value,
        repair: Option<&str>,
    ) -> Result<Value, Failure> {
        self.transport
            .game_reserved(
                self.permit.expect("admitted upstream operation"),
                tier,
                input,
                repair,
            )
            .await
    }
}
fn skipped(tier: &str) -> &'static str {
    match tier {
        "opencode-go"=>"OPENCODE_GO_API_KEY is empty and OPENCODE_API_KEY is unset (or OPENCODE_GO_ENABLED=0)",
        "opencode"=>"no opencode server on OPENCODE_BASE_URL and no `opencode` binary on PATH (or OPENCODE_ENABLED=0)",
        "openrouter"=>"OPENROUTER_API_KEY is empty",
        "local-llm"=>"no llama-server on LOCAL_LLM_BASE_URL (or LOCAL_LLM_ENABLED=0)",
        _=>"unreachable: the template tier is always available"
    }
}
fn error_text(error: &Failure) -> String {
    let value = error.as_json();
    let message = value["message"].as_str().unwrap();
    let message = if message.encode_utf16().count() > 300 {
        format!("{}…", crate::text::slice(message, 300))
    } else {
        message.to_owned()
    };
    format!("{}: {message}", value["name"].as_str().unwrap())
}
fn stamp(mut spec: Value, tier: &str, attempts: Vec<Value>, notes: Vec<String>) -> Value {
    spec["generatedBy"] = json!(tier);
    json!({"spec":spec,"tier":tier,"attempts":attempts,"notes":notes})
}
pub async fn generate<R: RemoteGame>(input: &Value, remote: &R) -> Result<Value, Failure> {
    let mut attempts = Vec::new();
    let mut notes = Vec::new();
    let forced = input["forceTemplate"] == true;
    for tier in [
        "opencode-go",
        "opencode",
        "openrouter",
        "local-llm",
        "template",
    ] {
        if tier != "template" && remote.cooling(tier) {
            continue;
        }
        if forced && tier != "template" {
            continue;
        }
        if tier != "template" && !remote.available(tier).await {
            attempts.push(
                json!({"tier":tier,"ok":false,"ms":0,"error":format!("skipped: {}",skipped(tier))}),
            );
            continue;
        }
        let start = Instant::now();
        let result = if tier == "template" {
            crate::template::build(
                &input["problem"],
                &input["instance"],
                input["seed"].as_f64().unwrap(),
                input["difficulty"].as_str().unwrap(),
                input["language"].as_str(),
            )
            .ok_or_else(|| Failure::plain("Template could not build a spec"))
        } else {
            remote.generate(tier, input, None).await
        };
        match result {
            Ok(spec) => {
                remote.record(tier, true);
                attempts
                    .push(json!({"tier":tier,"ok":true,"ms":start.elapsed().as_millis() as u64}));
                return Ok(stamp(spec, tier, attempts, notes));
            }
            Err(error) => {
                let message = error_text(&error);
                attempts.push(json!({"tier":tier,"ok":false,"ms":start.elapsed().as_millis() as u64,"error":message}));
                notes.push(format!("{tier} failed: {message}"));
                if error.schema && tier != "template" {
                    let start = Instant::now();
                    match remote.generate(tier, input, Some(&error.detail)).await {
                        Ok(spec) => {
                            remote.record(tier, true);
                            attempts.push(json!({"tier":tier,"ok":true,"ms":start.elapsed().as_millis() as u64,"error":"repaired after schema violation"}));
                            notes.push(format!("spec repaired by {tier}"));
                            return Ok(stamp(spec, tier, attempts, notes));
                        }
                        Err(error) => {
                            let message = error_text(&error);
                            let error = format!("repair failed: {message}");
                            attempts.push(json!({"tier":tier,"ok":false,"ms":start.elapsed().as_millis() as u64,"error":error}));
                            notes.push(format!("{tier} repair failed: {error}"));
                        }
                    }
                }
                remote.record(tier, false);
            }
        }
    }
    Err(Failure::plain("All provider tiers failed"))
}
