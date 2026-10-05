//! One reusable HTTP client, bounded response buffering, fail-fast AI admission.
//! Route-specific provider protocols are added separately; no local subprocesses.
use crate::error::ApiError;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct Transport {
    client: reqwest::Client,
    permits: Arc<Semaphore>,
    max_bytes: usize,
    chat: Option<Arc<ChatConfig>>,
    game_settings: Arc<GameSettings>,
    model: Arc<tokio::sync::OnceCell<String>>,
    secondary: Option<Box<Transport>>,
    cooldown: Arc<std::sync::Mutex<std::collections::HashMap<&'static str, std::time::Instant>>>,
    external_health:
        Arc<std::sync::Mutex<std::collections::HashMap<&'static str, (std::time::Instant, bool)>>>,
}
impl Transport {
    /// External Laya only: no subprocess, model loading, or JavaScript worker.
    pub async fn decision(&self, body: &Value) -> Value {
        let fallback = || crate::decisions::decide(body);
        if std::env::var("DECISION_BACKEND").is_ok_and(|v| v != "laya")
            || body["options"].as_object().is_none_or(|o| o.len() < 2)
            || !matches!(body["kind"].as_str(), Some("route-problem" | "pick-theme"))
        {
            return fallback();
        }
        let enabled = std::env::var("LAYA_ENABLED").is_ok_and(|v| {
            matches!(
                v.trim().to_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        });
        let base = std::env::var("LAYA_BASE_URL").unwrap_or_default();
        if !enabled || base.trim().is_empty() {
            return fallback();
        }
        let timeout = std::env::var("LAYA_TIMEOUT_MS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(1500)
            .clamp(1, 200000);
        if !self.external_available("laya", &base, timeout, false).await {
            return fallback();
        }
        let mut builder = self.client.post(format!("{}/v1/systemone", base.trim_end_matches('/')))
            .timeout(Duration::from_millis(timeout))
            .json(&json!({"state":body["stateText"],"model":std::env::var("LAYA_MODEL").unwrap_or_else(|_| "typed-decisions".into()),
                "questions":{body["kind"].as_str().unwrap_or("decision"):{"type":"choice","instructions":body["instructions"],"criteria":body["options"]}}}));
        if let Ok(key) = std::env::var("LAYA_API_KEY") {
            if !key.is_empty() {
                builder = builder.bearer_auth(key);
            }
        }
        let response = match builder.build() {
            Ok(request) => self.json(request).await.ok(),
            Err(_) => None,
        };
        response
            .and_then(|response| parse_laya(&response, body))
            .unwrap_or_else(fallback)
    }
    async fn external_available(
        &self,
        id: &'static str,
        base: &str,
        timeout_ms: u64,
        reserved: bool,
    ) -> bool {
        if let Some((at, available)) = self
            .external_health
            .lock()
            .ok()
            .and_then(|map| map.get(id).copied())
        {
            if at.elapsed() < Duration::from_secs(15) {
                return available;
            }
        }
        let _permit = if reserved {
            None
        } else {
            match self.reserve() {
                Ok(permit) => Some(permit),
                Err(_) => return false,
            }
        };
        let mut request = self
            .client
            .get(format!("{}/health", base.trim().trim_end_matches('/')))
            .timeout(Duration::from_millis(timeout_ms.clamp(1, 2500)));
        if id == "opencode" {
            let password = env("OPENCODE_PASSWORD");
            if !password.is_empty() {
                request = request.basic_auth("opencode", Some(password));
            }
        } else if id == "laya" {
            let key = env("LAYA_API_KEY");
            if !key.is_empty() {
                request = request.bearer_auth(key);
            }
        }
        let available = request.send().await.is_ok_and(|r| r.status().is_success());
        if let Ok(mut map) = self.external_health.lock() {
            map.insert(id, (std::time::Instant::now(), available));
        }
        available
    }

    pub async fn health_status(&self) -> (Value, Value, Value) {
        let mut tiers = Vec::new();
        for tier in [
            "opencode-go",
            "opencode",
            "openrouter",
            "local-llm",
            "template",
        ] {
            let available = if tier == "template" {
                true
            } else if let Some(settings) = external_game_settings(tier) {
                self.external_available(
                    if tier == "opencode" {
                        "opencode"
                    } else {
                        "local-llm"
                    },
                    &settings.base,
                    800,
                    false,
                )
                .await
            } else {
                self.game_transport(tier).is_some()
            };
            let mut item = json!({"tier":tier,"available":available});
            if !available {
                item["detail"] = json!("not reachable / not configured");
            }
            tiers.push(item);
        }
        let laya_enabled = matches!(
            env("LAYA_ENABLED").to_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ) && !std::env::var("DECISION_BACKEND").is_ok_and(|v| v != "laya");
        let base = env("LAYA_BASE_URL");
        let available = laya_enabled
            && !base.is_empty()
            && self
                .external_available("laya", &base, timeout("LAYA_TIMEOUT_MS", 1500), false)
                .await;
        let decision = if laya_enabled {
            json!({"backend":"laya","available":available})
        } else {
            json!({"backend":"heuristic","available":true})
        };
        let mut laya = json!({"enabled":laya_enabled,"available":available});
        if !available {
            laya["detail"] = json!("sidecar offline — heuristics in use");
        }
        (json!(tiers), decision, laya)
    }

    pub fn new(permits: Arc<Semaphore>, max_bytes: usize) -> Result<Self, ApiError> {
        let primary = ChatConfig::from_env();
        let secondary = if primary.as_ref().is_some_and(|c| c.id == "opencode-go") {
            ChatConfig::openrouter()
        } else {
            None
        };
        Self::with_candidates(permits, max_bytes, primary, secondary)
    }
    pub fn with_chat(
        permits: Arc<Semaphore>,
        max_bytes: usize,
        chat: Option<ChatConfig>,
    ) -> Result<Self, ApiError> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(200))
            .pool_max_idle_per_host(2)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(ApiError::internal)?;
        Ok(Self {
            client,
            permits,
            max_bytes,
            game_settings: Arc::new(GameSettings::from_env(chat.as_ref().map(|c| c.id))),
            chat: chat.map(Arc::new),
            model: Arc::new(tokio::sync::OnceCell::new()),
            secondary: None,
            cooldown: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            external_health: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        })
    }
    pub fn with_candidates(
        permits: Arc<Semaphore>,
        max_bytes: usize,
        primary: Option<ChatConfig>,
        secondary: Option<ChatConfig>,
    ) -> Result<Self, ApiError> {
        let mut transport = Self::with_chat(permits.clone(), max_bytes, primary)?;
        if let Some(secondary) = secondary {
            transport.secondary = Some(Box::new(Self {
                client: transport.client.clone(),
                permits,
                max_bytes,
                game_settings: Arc::new(GameSettings::from_env(Some(secondary.id))),
                chat: Some(Arc::new(secondary)),
                model: Arc::new(tokio::sync::OnceCell::new()),
                secondary: None,
                cooldown: transport.cooldown.clone(),
                external_health: transport.external_health.clone(),
            }));
        }
        Ok(transport)
    }
    fn cooling(&self, id: &'static str) -> bool {
        self.cooldown
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|until| *until > std::time::Instant::now())
    }
    fn record(&self, id: &'static str, success: bool) {
        let mut map = self.cooldown.lock().unwrap();
        if success {
            map.remove(id);
        } else {
            map.insert(id, std::time::Instant::now() + Duration::from_secs(15));
        }
    }
    pub async fn json(&self, request: reqwest::Request) -> Result<Value, ApiError> {
        let _permit = self
            .permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| ApiError::busy())?;
        // Dropping this future releases the permit and the upstream body stream.
        let response = self
            .client
            .execute(request)
            .await
            .map_err(ApiError::internal)?;
        if !response.status().is_success() {
            return Err(ApiError(
                axum::http::StatusCode::BAD_GATEWAY,
                "GENERATION_FAILED",
                "Provider request failed".into(),
            ));
        }
        if response
            .content_length()
            .is_some_and(|n| n > self.max_bytes as u64)
        {
            return Err(ApiError(
                axum::http::StatusCode::BAD_GATEWAY,
                "GENERATION_FAILED",
                "Provider response exceeded limit".into(),
            ));
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(ApiError::internal)?;
            if chunk.len() > self.max_bytes.saturating_sub(bytes.len()) {
                return Err(ApiError(
                    axum::http::StatusCode::BAD_GATEWAY,
                    "GENERATION_FAILED",
                    "Provider response exceeded limit".into(),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        if !crate::text::bounded_structure(&bytes, 4096) {
            return Err(ApiError(
                axum::http::StatusCode::BAD_GATEWAY,
                "GENERATION_FAILED",
                "Provider JSON exceeded complexity limit".into(),
            ));
        }
        serde_json::from_slice(&bytes).map_err(|_| {
            ApiError(
                axum::http::StatusCode::BAD_GATEWAY,
                "GENERATION_FAILED",
                "Invalid provider JSON".into(),
            )
        })
    }
}

fn parse_laya(response: &Value, body: &Value) -> Option<Value> {
    let answer = response.get("answers")?.get(body["kind"].as_str()?)?;
    let choice = answer["choice"].as_str()?;
    if !body["options"].as_object()?.contains_key(choice) {
        return None;
    }
    let distribution = ["probabilities", "distribution"]
        .into_iter()
        .find_map(|key| {
            let values: serde_json::Map<String, Value> = answer
                .get(key)?
                .as_object()?
                .iter()
                .filter(|(_, v)| v.as_f64().is_some_and(f64::is_finite))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            (!values.is_empty()).then_some(values)
        });
    let confidence = ["answer_confidence", "confidence"]
        .into_iter()
        .find_map(|key| answer[key].as_f64().filter(|v| v.is_finite()))
        .or_else(|| {
            distribution
                .as_ref()
                .map(|d| d.values().filter_map(Value::as_f64).fold(0.0, f64::max))
        })?
        .clamp(0.0, 1.0);
    if confidence < 0.35 {
        return None;
    }
    let mut result = json!({"choice":choice,"confidence":confidence,"source":"laya"});
    if let Some(distribution) = distribution {
        result["distribution"] = json!(distribution);
    }
    Some(result)
}

#[cfg(test)]
mod laya_tests {
    use super::*;
    #[test]
    fn calibrated_confidence_options_and_aliases_match_laya_contract() {
        let body = json!({"kind":"pick-theme","options":{"forest":"trees","space":"stars"}});
        let parse = |a| parse_laya(&json!({"answers":{"pick-theme":a}}), &body);
        assert_eq!(
            parse(json!({"choice":"space","answer_confidence":0.7,"confidence":0.99})).unwrap()
                ["confidence"],
            0.7
        );
        assert!(parse(json!({"choice":"missing","answer_confidence":1})).is_none());
        assert!(parse(json!({"choice":"space","answer_confidence":0.2,"confidence":1})).is_none());
        assert_eq!(
            parse(json!({"choice":"forest","distribution":{"forest":0.8,"space":0.2}})).unwrap()
                ["confidence"],
            0.8
        );
        assert_eq!(
            parse(json!({"choice":"forest","answer_confidence":2})).unwrap()["confidence"],
            1.0
        );
        assert!(parse(json!({"choice":"forest"})).is_none());
    }
    #[tokio::test]
    async fn external_game_adapters_use_only_http_and_stamp_authoritative_identity() {
        use axum::{routing::post, Json, Router};
        let problem = crate::reference()["problems"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "binary-search")
            .unwrap()
            .clone();
        let state = crate::runtime::init("binary-search", 7.0, "easy").unwrap();
        let input =
            json!({"problem":problem,"instance":state["instance"],"seed":7,"difficulty":"easy"});
        let spec = crate::template::build(&input["problem"], &input["instance"], 7.0, "easy", None)
            .unwrap();
        let spec_a = spec.to_string();
        let spec_b = spec_a.clone();
        let router = Router::new()
            .route(
                "/api/generate",
                post(move |Json(body): Json<Value>| {
                    let text = spec_a.clone();
                    async move {
                        assert_eq!(
                            body["model"],
                            json!({"providerID":"provider","id":"model","variant":"fast"})
                        );
                        assert!(body["prompt"].as_str().unwrap().contains("ACTUAL INSTANCE"));
                        Json(json!({"data":{"text":text}}))
                    }
                }),
            )
            .route(
                "/v1/chat/completions",
                post(move |Json(body): Json<Value>| {
                    let text = spec_b.clone();
                    async move {
                        assert_eq!(body["model"], "provider/model#fast");
                        assert_eq!(body["response_format"]["type"], "json_schema");
                        Json(json!({"choices":[{"message":{"content":text}}]}))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let transport =
            Transport::with_chat(Arc::new(Semaphore::new(2)), 2 * 1024 * 1024, None).unwrap();
        for tier in ["opencode", "local-llm"] {
            let settings = ExternalGame {
                base: base.clone(),
                model: "provider/model#fast".into(),
                timeout_ms: 1000,
                temperature: 0.7,
                max_tokens: 2000,
            };
            let result = transport
                .external_game(tier, &input, None, settings)
                .await
                .unwrap();
            assert_eq!(result["problemId"], "binary-search");
            assert_eq!(result["seed"], 7);
            assert_eq!(result["generatedBy"], tier);
        }
        server.abort();
    }
    #[tokio::test]
    async fn session_nested_prompt_and_newest_assistant_transcript_are_supported() {
        use axum::{
            http::StatusCode,
            routing::{get, post},
            Json, Router,
        };
        let prompts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = prompts.clone();
        let router = Router::new()
            .route("/api/session", post(|Json(body): Json<Value>| async move {
                assert_eq!(body["model"], json!({"providerID":"provider","id":"model","variant":"fast"}));
                Json(json!({"data":{"id":"test-session"}}))
            }))
            .route("/api/session/test-session/prompt", post(move |Json(body): Json<Value>| {
                let count = count.clone(); async move {
                    let n = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if n == 0 { assert_eq!(body["text"], "test prompt"); (StatusCode::BAD_REQUEST, Json(Value::Null)) }
                    else { assert_eq!(body["prompt"]["text"], "test prompt"); (StatusCode::OK, Json(Value::Null)) }
                }
            }))
            .route("/api/session/test-session/wait", post(|| async { StatusCode::NO_CONTENT }))
            .route("/api/session/test-session/message", get(|| async {
                Json(json!({"data":[{"type":"user","text":"ignore"},{"type":"assistant","parts":[{"type":"step-finish","text":"ignore"},{"type":"text","text":"{\"newest\":true}"}]},{"type":"assistant","text":"older"}]}))
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let settings = ExternalGame {
            base: format!("http://{}", listener.local_addr().unwrap()),
            model: "provider/model#fast".into(),
            timeout_ms: 1000,
            temperature: 0.7,
            max_tokens: 2000,
        };
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let transport =
            Transport::with_chat(Arc::new(Semaphore::new(2)), 2 * 1024 * 1024, None).unwrap();
        assert_eq!(
            transport
                .external_session(&settings, "test prompt")
                .await
                .unwrap(),
            "{\"newest\":true}"
        );
        assert_eq!(prompts.load(std::sync::atomic::Ordering::SeqCst), 2);
        server.abort();
    }
    #[tokio::test]
    async fn llama_rejects_modern_and_grammar_then_salvages_json_object() {
        use axum::{http::StatusCode, routing::post, Json, Router};
        let calls = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = calls.clone();
        let router = Router::new().route("/v1/chat/completions", post(move |Json(body): Json<Value>| {
            let seen = seen.clone(); async move {
                seen.lock().unwrap().push(body.clone());
                if body["response_format"]["type"] == "json_object" {
                    (StatusCode::OK, Json(json!({"choices":[{"message":{"content":"{\"theme\":{\"title\":\"Mock adventure\"}}"}}]})))
                } else { (StatusCode::UNPROCESSABLE_ENTITY, Json(Value::Null)) }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let settings = ExternalGame {
            base: format!("http://{}", listener.local_addr().unwrap()),
            model: "mock".into(),
            timeout_ms: 1000,
            temperature: 0.3,
            max_tokens: 1200,
        };
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let problem = crate::reference()["problems"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "binary-search")
            .unwrap()
            .clone();
        let state = crate::runtime::init("binary-search", 7.0, "easy").unwrap();
        let input =
            json!({"problem":problem,"instance":state["instance"],"seed":7,"difficulty":"easy"});
        let transport =
            Transport::with_chat(Arc::new(Semaphore::new(2)), 2 * 1024 * 1024, None).unwrap();
        let result = transport
            .external_llama(&input, None, settings)
            .await
            .unwrap();
        assert_eq!(result["theme"]["title"], "Mock adventure");
        assert_eq!(result["generatedBy"], "local-llm");
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert!(calls[1]["grammar"].is_string());
        assert!(calls
            .iter()
            .all(|b| b["temperature"] == 0.3 && b["max_tokens"] == 1200));
        server.abort();
    }
}

/// OpenAI-compatible remote adapters. Configuration is captured once at startup.
#[derive(Clone)]
pub struct ChatConfig {
    pub id: &'static str,
    pub key: String,
    pub base: String,
    pub model: String,
    pub session: String,
    pub timeout_ms: u64,
}
fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_default().trim().to_owned()
}
fn timeout(name: &str, default: u64) -> u64 {
    env(name)
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite() && *n > 0.0)
        .map(|n| n.min(200000.0) as u64)
        .unwrap_or(default)
}
impl ChatConfig {
    fn from_env() -> Option<Self> {
        let key = env("OPENCODE_GO_API_KEY");
        let key = if key.is_empty() {
            env("OPENCODE_API_KEY")
        } else {
            key
        };
        if !key.is_empty()
            && !["0", "false", "no", "off"]
                .contains(&env("OPENCODE_GO_ENABLED").to_lowercase().as_str())
        {
            let base = env("OPENCODE_GO_BASE_URL");
            return Some(Self {
                id: "opencode-go",
                key,
                base: if base.is_empty() {
                    "https://opencode.ai/zen/go/v1".into()
                } else {
                    base.trim_end_matches('/').into()
                },
                model: env("OPENCODE_GO_MODEL"),
                session: env("OPENCODE_GO_SESSION"),
                timeout_ms: timeout("OPENCODE_GO_TIMEOUT_MS", 180000),
            });
        }
        Self::openrouter()
    }
    fn openrouter() -> Option<Self> {
        let key = env("OPENROUTER_API_KEY");
        if key.is_empty() {
            return None;
        }
        let base = env("OPENROUTER_BASE_URL");
        let model = env("OPENROUTER_MODEL");
        Some(Self {
            id: "openrouter",
            key,
            base: if base.is_empty() {
                "https://openrouter.ai/api/v1".into()
            } else {
                base.trim_end_matches('/').into()
            },
            model: if model.is_empty() {
                "google/gemini-2.0-flash-001".into()
            } else {
                model
            },
            session: String::new(),
            timeout_ms: timeout("OPENROUTER_TIMEOUT_MS", 40000),
        })
    }
}
#[derive(Debug)]
pub enum ChatError {
    Busy,
    Failure(String),
}
impl std::fmt::Display for ChatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy => write!(f, "Server is busy. Try again shortly."),
            Self::Failure(s) => write!(f, "{s}"),
        }
    }
}
impl Transport {
    pub fn chat_id(&self) -> Option<&'static str> {
        self.chat.as_ref().map(|c| c.id)
    }
    async fn bounded_body(&self, response: reqwest::Response) -> Result<Vec<u8>, ChatError> {
        if response
            .content_length()
            .is_some_and(|n| n > self.max_bytes as u64)
        {
            return Err(ChatError::Failure(
                "Provider response exceeded limit".into(),
            ));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|_| ChatError::Failure("Provider response read failed".into()))?;
            if chunk.len() > self.max_bytes.saturating_sub(bytes.len()) {
                return Err(ChatError::Failure(
                    "Provider response exceeded limit".into(),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
    async fn chat_model(&self, cfg: &ChatConfig) -> String {
        if !cfg.model.is_empty() {
            return cfg.model.clone();
        }
        self.model
            .get_or_init(|| async {
                let fallback = "space-bunny-free".to_owned();
                let result =
                    tokio::time::timeout(Duration::from_millis(cfg.timeout_ms.min(4000)), async {
                        let response = self
                            .client
                            .get(format!("{}/models", cfg.base))
                            .send()
                            .await
                            .ok()?;
                        if !response.status().is_success() {
                            return None;
                        }
                        let bytes = self.bounded_body(response).await.ok()?;
                        if !crate::text::bounded_structure(&bytes, 4096) {
                            return None;
                        }
                        let body: Value = serde_json::from_slice(&bytes).ok()?;
                        let available = body["data"].as_array()?;
                        [
                            "longcat-2.5-preview-free",
                            "space-bunny-free",
                            "mimo-v2.6-flash",
                            "deepseek-flash",
                            "glm-5.3-flash",
                            "qwen3.8-flash",
                            "deepseek-v4.1-flash",
                            "deepseek-v4-flash",
                        ]
                        .into_iter()
                        .find(|id| available.iter().any(|v| v["id"] == *id))
                        .map(str::to_owned)
                    })
                    .await;
                result.ok().flatten().unwrap_or(fallback)
            })
            .await
            .clone()
    }
    /// A permit includes model discovery and response reads. Dropping the future
    /// aborts both upstream work and body buffering; no detached tasks survive.
    pub async fn chat(
        &self,
        messages: Value,
        max_tokens: u32,
        temperature: f64,
    ) -> Result<String, ChatError> {
        let permit = self.reserve()?;
        self.chat_reserved(&permit, messages, max_tokens, temperature)
            .await
    }
    async fn chat_reserved(
        &self,
        permit: &tokio::sync::OwnedSemaphorePermit,
        messages: Value,
        max_tokens: u32,
        temperature: f64,
    ) -> Result<String, ChatError> {
        Ok(self
            .chat_reply_reserved(permit, messages, max_tokens, temperature)
            .await?["text"]
            .as_str()
            .unwrap()
            .to_owned())
    }
    pub async fn coach_chat(
        &self,
        permit: &tokio::sync::OwnedSemaphorePermit,
        messages: Value,
    ) -> Result<Value, ChatError> {
        for transport in std::iter::once(self).chain(self.secondary.as_deref()) {
            let Some(id) = transport.chat_id() else {
                continue;
            };
            if self.cooling(id) {
                continue;
            }
            let result = transport
                .chat_reply_reserved(permit, messages.clone(), 800, 0.4)
                .await;
            self.record(id, result.is_ok());
            if result.is_ok() {
                return result;
            }
        }
        Err(ChatError::Failure("No chat provider succeeded".into()))
    }
    async fn chat_reply_reserved(
        &self,
        _permit: &tokio::sync::OwnedSemaphorePermit,
        messages: Value,
        max_tokens: u32,
        temperature: f64,
    ) -> Result<Value, ChatError> {
        let cfg = self
            .chat
            .as_ref()
            .ok_or_else(|| ChatError::Failure("No model transport configured".into()))?;
        let model = self.chat_model(cfg).await;
        tokio::time::timeout(Duration::from_millis(cfg.timeout_ms),async {
            let mut request=self.client.post(format!("{}/chat/completions",cfg.base)).bearer_auth(&cfg.key).json(&json!({"model":model,"temperature":temperature,"max_tokens":max_tokens,"messages":messages}));
            if cfg.id=="opencode-go" {
                use rand::RngCore;
                let session=if cfg.session.is_empty(){format!("chat-{:016x}",rand::rngs::OsRng.next_u64())}else{cfg.session.clone()};
                request=request.header("user-agent","dsa-game/0.1.0").header("x-opencode-session",session);
            }else {request=request.header("http-referer","https://github.com/dsa-game").header("x-title","dsa-game coach");}
            let response=request.send().await.map_err(|_|ChatError::Failure("fetch failed".into()))?;
            let status=response.status();
            let bytes=self.bounded_body(response).await?;
            if !status.is_success(){
                let detail=String::from_utf8_lossy(&bytes);let detail=crate::text::slice(&detail,400);
                if cfg.id=="opencode-go" && status.as_u16()==400 && detail.contains("x-opencode-session"){return Err(ChatError::Failure("opencode-go 400: request was rejected for routing (client user-agent + x-opencode-session header)".into()));}
                return Err(ChatError::Failure(format!("{} {}: {}",cfg.id,status.as_u16(),detail)));
            }
            if !crate::text::bounded_structure(&bytes,4096){return Err(ChatError::Failure("Provider JSON exceeded complexity limit".into()));}
            let body:Value=serde_json::from_slice(&bytes).map_err(|_|ChatError::Failure(format!("{} response was not JSON",cfg.id)))?;
            let first=&body["choices"][0];
            let content=first["message"]["content"].as_str().or_else(||first["text"].as_str()).unwrap_or("").trim();
            if content.is_empty(){return Err(ChatError::Failure(format!("{} returned no content",cfg.id)));}
            Ok(json!({"text":content,"model":body["model"].as_str().unwrap_or(&model)}))
        }).await.map_err(|_|ChatError::Failure("The operation was aborted due to timeout".into()))?
    }
}

/// Streaming frames are bounded independently of the total answer. Parsing raw
/// bytes keeps split UTF-8 characters and split CRLF pairs intact.
#[derive(Default)]
struct Frames {
    pending: Vec<u8>,
}
impl Frames {
    fn push(&mut self, byte: u8, limit: usize) -> Result<Option<Vec<u8>>, ChatError> {
        if self.pending.len() >= limit {
            return Err(ChatError::Failure(
                "Provider stream frame exceeded limit".into(),
            ));
        }
        self.pending.push(byte);
        let boundary = self.pending.ends_with(b"\n\n")
            || self.pending.ends_with(b"\r\n\r\n")
            || self.pending.ends_with(b"\n\r\n");
        if boundary {
            Ok(Some(std::mem::take(&mut self.pending)))
        } else {
            Ok(None)
        }
    }
}
impl Transport {
    /// Admission happens before creating a streaming response. The caller may
    /// retain this permit across context preparation and action proposals.
    pub fn reserve(&self) -> Result<tokio::sync::OwnedSemaphorePermit, ChatError> {
        self.permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| ChatError::Busy)
    }
    /// The borrowed permit covers discovery and the complete upstream stream.
    /// Dropping this future cancels the HTTP read immediately.
    pub async fn chat_policy_reserved(
        &self,
        permit: &tokio::sync::OwnedSemaphorePermit,
        messages: Value,
        max_tokens: u32,
        temperature: f64,
    ) -> Result<String, ChatError> {
        for transport in std::iter::once(self).chain(self.secondary.as_deref()) {
            let Some(id) = transport.chat_id() else {
                continue;
            };
            if self.cooling(id) {
                continue;
            }
            let result = transport
                .chat_reserved(permit, messages.clone(), max_tokens, temperature)
                .await;
            self.record(id, result.is_ok());
            if let Ok(text) = result {
                return Ok(text);
            }
        }
        Err(ChatError::Failure("No chat provider succeeded".into()))
    }
    pub async fn stream_reserved<F, Fut>(
        &self,
        permit: &tokio::sync::OwnedSemaphorePermit,
        messages: Value,
        session: &str,
        mut delta: F,
    ) -> Result<(), ChatError>
    where
        F: FnMut(String) -> Fut,
        Fut: std::future::Future<Output = Result<(), ChatError>>,
    {
        let mut last_error = ChatError::Failure("No streaming provider succeeded".into());
        for transport in std::iter::once(self).chain(self.secondary.as_deref()) {
            let Some(id) = transport.chat_id() else {
                continue;
            };
            if self.cooling(id) {
                continue;
            }
            let mut emitted = false;
            let result = transport
                .stream_single(permit, messages.clone(), session, |text| {
                    emitted = true;
                    delta(text)
                })
                .await;
            let success = result.is_ok() && emitted;
            self.record(id, success);
            if success {
                return Ok(());
            }
            if emitted {
                return result.and(Err(ChatError::Failure("Empty provider response".into())));
            }
            if let Err(error) = result {
                last_error = error;
            }
        }
        Err(last_error)
    }
    async fn stream_single<F, Fut>(
        &self,
        _permit: &tokio::sync::OwnedSemaphorePermit,
        messages: Value,
        session: &str,
        mut delta: F,
    ) -> Result<(), ChatError>
    where
        F: FnMut(String) -> Fut,
        Fut: std::future::Future<Output = Result<(), ChatError>>,
    {
        let cfg = self
            .chat
            .as_ref()
            .ok_or_else(|| ChatError::Failure("No model transport configured".into()))?;
        tokio::time::timeout(Duration::from_millis(cfg.timeout_ms), async {
            let model = self.chat_model(cfg).await;
            let mut request = self.client.post(format!("{}/chat/completions", cfg.base))
                .bearer_auth(&cfg.key)
                .json(&json!({"model":model,"messages":messages,"stream":true,"temperature":0.5,"max_tokens":16000}));
            if cfg.id == "opencode-go" {
                request = request.header("user-agent", "dsa-game/0.1.0").header("x-opencode-session", session);
            } else {
                request = request.header("http-referer", "https://github.com/dsa-game").header("x-title", "dsa-game coach");
            }
            let response = request.send().await.map_err(|_| ChatError::Failure("fetch failed".into()))?;
            if !response.status().is_success() {
                return Err(ChatError::Failure(format!("{} {}", cfg.id, response.status().as_u16())));
            }
            let mut stream = response.bytes_stream();
            let mut frames = Frames::default();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| ChatError::Failure("Provider stream read failed".into()))?;
                for byte in chunk {
                    let Some(frame) = frames.push(byte, self.max_bytes)? else { continue };
                    let frame = std::str::from_utf8(&frame).map_err(|_| ChatError::Failure("Invalid provider stream UTF-8".into()))?;
                    let mut data = String::new();
                    let mut first = true;
                    for line in frame.lines().filter_map(|line| line.strip_prefix("data:")) {
                        if !first { data.push('\n'); }
                        first = false;
                        data.push_str(line.trim_start());
                    }
                    if data.is_empty() { continue; }
                    if data == "[DONE]" { return Ok(()); }
                    if !crate::text::bounded_structure(data.as_bytes(), 4096) {
                        return Err(ChatError::Failure("Provider JSON exceeded complexity limit".into()));
                    }
                    let value: Value = serde_json::from_str(&data).map_err(|_| ChatError::Failure("Invalid provider stream JSON".into()))?;
                    if value.get("error").is_some() { return Err(ChatError::Failure("Chat provider stream failed".into())); }
                    if let Some(text) = value["choices"][0]["delta"]["content"].as_str().filter(|text| !text.is_empty()) {
                        delta(text.to_owned()).await?;
                    }
                }
            }
            Err(ChatError::Failure("Chat provider stream ended before completion".into()))
        }).await.map_err(|_| ChatError::Failure("The operation was aborted due to timeout".into()))?
    }
}

struct GameSettings {
    temperature: f64,
    max_tokens: u32,
    timeout_ms: u64,
    user_agent: String,
}
impl GameSettings {
    fn from_env(tier: Option<&str>) -> Self {
        let go = tier == Some("opencode-go");
        let prefix = if go { "OPENCODE_GO" } else { "OPENROUTER" };
        let positive = |key: &str, default: f64| {
            crate::compat::number(&env(&format!("{prefix}_{key}")))
                .is_finite()
                .then(|| crate::compat::number(&env(&format!("{prefix}_{key}"))))
                .filter(|v| *v > 0.0)
                .unwrap_or(default)
        };
        let user_agent = env("OPENCODE_GO_USER_AGENT");
        Self {
            temperature: positive("TEMPERATURE", if go { 0.9 } else { 0.85 }),
            max_tokens: positive("MAX_TOKENS", if go { 16000.0 } else { 2500.0 }).min(65536.0)
                as u32,
            timeout_ms: timeout("CHAIN_TIMEOUT_MS", 200000),
            user_agent: if user_agent.is_empty() {
                "dsa-game/0.1.0".into()
            } else {
                user_agent
            },
        }
    }
}
impl Transport {
    pub(crate) fn game_cooling(&self, tier: &str) -> bool {
        match tier {
            "opencode-go" => self.cooling("opencode-go"),
            "openrouter" => self.cooling("openrouter"),
            "opencode" => self.cooling("opencode"),
            "local-llm" => self.cooling("local-llm"),
            _ => false,
        }
    }
    pub(crate) fn game_record(&self, tier: &str, success: bool) {
        match tier {
            "opencode-go" => self.record("opencode-go", success),
            "openrouter" => self.record("openrouter", success),
            "opencode" => self.record("opencode", success),
            "local-llm" => self.record("local-llm", success),
            _ => {}
        }
    }
    fn game_transport(&self, tier: &str) -> Option<&Self> {
        std::iter::once(self)
            .chain(self.secondary.as_deref())
            .find(|t| t.chat_id() == Some(tier))
    }
    pub fn game_available(&self, tier: &str) -> bool {
        self.game_transport(tier).is_some() || external_game_settings(tier).is_some()
    }
    pub async fn game_is_available(
        &self,
        permit: Option<&tokio::sync::OwnedSemaphorePermit>,
        tier: &str,
    ) -> bool {
        if let Some(settings) = external_game_settings(tier) {
            return self
                .external_available(
                    if tier == "opencode" {
                        "opencode"
                    } else {
                        "local-llm"
                    },
                    &settings.base,
                    800,
                    permit.is_some(),
                )
                .await;
        }
        self.game_available(tier)
    }
    /// One borrowed permit covers discovery, a complete bounded response, and any repair.
    pub async fn game_reserved(
        &self,
        _permit: &tokio::sync::OwnedSemaphorePermit,
        tier: &str,
        input: &Value,
        repair: Option<&str>,
    ) -> Result<Value, crate::game_provider::Failure> {
        use crate::game_provider::{self, Failure};
        if let Some(settings) = external_game_settings(tier) {
            return self.external_game(tier, input, repair, settings).await;
        }
        let transport = self
            .game_transport(tier)
            .ok_or_else(|| Failure::plain("No game provider configured"))?;
        let cfg = transport.chat.as_ref().unwrap();
        let settings = &transport.game_settings;
        let model = transport.chat_model(cfg).await;
        let body = if let Some(issues) = repair {
            game_provider::repair_request(
                input,
                tier,
                &model,
                settings.temperature,
                settings.max_tokens,
                issues,
            )
        } else {
            game_provider::request(
                input,
                tier,
                &model,
                settings.temperature,
                settings.max_tokens,
            )
        };
        tokio::time::timeout(
            Duration::from_millis(cfg.timeout_ms.min(settings.timeout_ms)),
            async {
                let mut request = transport
                    .client
                    .post(format!("{}/chat/completions", cfg.base))
                    .bearer_auth(&cfg.key)
                    .json(&body);
                if cfg.id == "opencode-go" {
                    use rand::RngCore;
                    let session = if cfg.session.is_empty() {
                        format!("game-{:016x}", rand::rngs::OsRng.next_u64())
                    } else {
                        cfg.session.clone()
                    };
                    request = request
                        .header("user-agent", &settings.user_agent)
                        .header("x-opencode-session", session);
                } else {
                    request = request
                        .header("http-referer", "https://github.com/dsa-game")
                        .header("x-title", "dsa-game provider-chain");
                }
                let response = request
                    .send()
                    .await
                    .map_err(|_| Failure::plain("fetch failed"))?;
                let status = response.status().as_u16();
                let bytes = transport
                    .bounded_body(response)
                    .await
                    .map_err(|e| Failure::plain(e.to_string()))?;
                if !crate::text::bounded_structure(&bytes, 4096) {
                    return Err(Failure::plain("Provider JSON exceeded complexity limit"));
                }
                let value = match serde_json::from_slice::<Value>(&bytes) {
                    Ok(v) => v,
                    Err(_) => {
                        if tier == "openrouter" && (200..300).contains(&status) {
                            return Err(Failure::plain("openrouter response was not JSON"));
                        }
                        json!(String::from_utf8_lossy(&bytes))
                    }
                };
                game_provider::response(input, tier, status, &value, settings.max_tokens)
            },
        )
        .await
        .map_err(|_| Failure::plain("The operation was aborted due to timeout"))?
    }

    async fn external_game(
        &self,
        tier: &str,
        input: &Value,
        repair: Option<&str>,
        settings: ExternalGame,
    ) -> Result<Value, crate::game_provider::Failure> {
        use crate::game_provider::{self, Failure};
        if tier == "local-llm" {
            return self.external_llama(input, repair, settings).await;
        }
        let wire = if let Some(issues) = repair {
            game_provider::repair_request(
                input,
                tier,
                &settings.model,
                settings.temperature,
                settings.max_tokens,
                issues,
            )
        } else {
            game_provider::request(
                input,
                tier,
                &settings.model,
                settings.temperature,
                settings.max_tokens,
            )
        };
        let (path, body) = if tier == "opencode" {
            let messages = wire["messages"].as_array().unwrap();
            let prompt = messages
                .iter()
                .filter_map(|m| m["content"].as_str())
                .collect::<Vec<_>>()
                .join("\n\n---\n\n");
            (
                "/api/generate",
                json!({"prompt":prompt,"model":external_model_ref(&settings.model)}),
            )
        } else {
            ("/v1/chat/completions", wire)
        };
        tokio::time::timeout(Duration::from_millis(settings.timeout_ms), async {
            if tier == "opencode" {
                if let Ok(text) = self
                    .external_session(&settings, body["prompt"].as_str().unwrap())
                    .await
                {
                    if let Ok(spec) = game_provider::response(
                        input,
                        tier,
                        200,
                        &json!({"choices":[{"message":{"content":text}}]}),
                        2000,
                    ) {
                        return Ok(spec);
                    }
                }
            }
            let mut request = self
                .client
                .post(format!("{}{path}", settings.base))
                .json(&body);
            if tier == "opencode" {
                let password = env("OPENCODE_PASSWORD");
                if !password.is_empty() {
                    request = request.basic_auth("opencode", Some(password));
                }
            }
            let response = request
                .send()
                .await
                .map_err(|_| Failure::plain("fetch failed"))?;
            let status = response.status().as_u16();
            let bytes = self
                .bounded_body(response)
                .await
                .map_err(|e| Failure::plain(e.to_string()))?;
            if !crate::text::bounded_structure(&bytes, 4096) {
                return Err(Failure::plain("Provider JSON exceeded complexity limit"));
            }
            let mut value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| Failure::plain("External provider response was not JSON"))?;
            if tier == "opencode" {
                let text = value["data"]["text"].take();
                value = json!({"choices":[{"message":{"content":text}}]});
            }
            game_provider::response(input, tier, status, &value, 2000)
        })
        .await
        .map_err(|_| Failure::plain("The operation was aborted due to timeout"))?
    }

    async fn external_llama(
        &self,
        input: &Value,
        repair: Option<&str>,
        settings: ExternalGame,
    ) -> Result<Value, crate::game_provider::Failure> {
        use crate::game_provider::{self, Failure};
        tokio::time::timeout(Duration::from_millis(settings.timeout_ms), async {
            let mut partial = None;
            for mut body in game_provider::llama_modes(input, &settings.model, repair) {
                body["temperature"] = json!(settings.temperature);
                body["max_tokens"] = json!(settings.max_tokens);
                let response = match self
                    .client
                    .post(format!("{}/v1/chat/completions", settings.base))
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let status = response.status().as_u16();
                let bytes = match self.bounded_body(response).await {
                    Ok(bytes) => bytes,
                    Err(_) => break,
                };
                if status == 400 || status == 422 {
                    continue;
                }
                if !(200..300).contains(&status) || !crate::text::bounded_structure(&bytes, 4096) {
                    break;
                }
                let value: Value = match serde_json::from_slice(&bytes) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let Some(text) = value["choices"][0]["message"]["content"]
                    .as_str()
                    .filter(|s| !crate::compat::trim(s).is_empty())
                else {
                    continue;
                };
                if game_provider::parse_spec(text).is_ok() {
                    return game_provider::response(input, "local-llm", 200, &value, 2000);
                }
                if partial.is_none() {
                    partial = serde_json::from_str(text).ok();
                }
            }
            let spec = if repair.is_some() {
                crate::template::build(
                    &input["problem"],
                    &input["instance"],
                    input["seed"].as_f64().unwrap(),
                    input["difficulty"].as_str().unwrap(),
                    input["language"].as_str(),
                )
            } else {
                partial
                    .as_ref()
                    .and_then(|v| game_provider::salvage(input, v))
            };
            let spec = spec.ok_or_else(|| {
                Failure::schema("no external llama transport produced a valid GameSpec")
            })?;
            game_provider::response(
                input,
                "local-llm",
                200,
                &json!({"choices":[{"message":{"content":spec.to_string()}}]}),
                2000,
            )
        })
        .await
        .map_err(|_| Failure::schema("The operation was aborted due to timeout"))?
    }

    async fn external_session(
        &self,
        settings: &ExternalGame,
        prompt: &str,
    ) -> Result<String, crate::game_provider::Failure> {
        use crate::game_provider::Failure;
        let mut create = json!({"model":external_model_ref(&settings.model)});
        let agent = env("OPENCODE_AGENT");
        if !agent.is_empty() {
            if let Ok(registry) = self
                .external_session_request(settings, "GET", "/api/agent", None)
                .await
            {
                let list = registry.get("data").unwrap_or(&registry);
                if list
                    .as_array()
                    .is_some_and(|a| a.iter().any(|a| a["id"] == agent))
                {
                    create["agent"] = json!(agent);
                }
            }
        }
        let created = self
            .external_session_request(settings, "POST", "/api/session", Some(create))
            .await?;
        let id = created["data"]["id"]
            .as_str()
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 256
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            })
            .ok_or_else(|| Failure::plain("External session returned no usable data.id"))?;
        let path = format!("/api/session/{id}/prompt");
        if self
            .external_session_request(settings, "POST", &path, Some(json!({"text":prompt})))
            .await
            .is_err()
        {
            self.external_session_request(
                settings,
                "POST",
                &path,
                Some(json!({"prompt":{"text":prompt}})),
            )
            .await?;
        }
        self.external_session_request(settings, "POST", &format!("/api/session/{id}/wait"), None)
            .await?;
        let messages = self
            .external_session_request(settings, "GET", &format!("/api/session/{id}/message"), None)
            .await?;
        for message in messages["data"]
            .as_array()
            .ok_or_else(|| Failure::plain("External transcript returned no data array"))?
        {
            if message["type"] != "assistant" {
                continue;
            }
            let text = external_assistant_text(message);
            if !text.is_empty() {
                return Ok(text);
            }
        }
        Err(Failure::plain(
            "No assistant text in external session transcript",
        ))
    }

    async fn external_session_request(
        &self,
        settings: &ExternalGame,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, crate::game_provider::Failure> {
        use crate::game_provider::Failure;
        let mut request = self
            .client
            .request(method.parse().unwrap(), format!("{}{path}", settings.base));
        let password = env("OPENCODE_PASSWORD");
        if !password.is_empty() {
            request = request.basic_auth("opencode", Some(password));
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|_| Failure::plain("External session request failed"))?;
        let status = response.status();
        let bytes = self
            .bounded_body(response)
            .await
            .map_err(|e| Failure::plain(e.to_string()))?;
        if !status.is_success() {
            return Err(Failure::plain(format!(
                "External session HTTP {}",
                status.as_u16()
            )));
        }
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        if !crate::text::bounded_structure(&bytes, 4096) {
            return Err(Failure::plain(
                "External session JSON exceeded complexity limit",
            ));
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| Failure::plain("External session response was not JSON"))
    }
}

fn external_assistant_text(value: &Value) -> String {
    fn visit(value: &Value, depth: usize, text: &mut Vec<String>) {
        if depth > 6 {
            return;
        }
        if let Some(s) = value.as_str() {
            if s.contains('{') || s.contains("```") {
                text.push(s.into());
            }
            return;
        }
        if let Some(array) = value.as_array() {
            for item in array {
                visit(item, depth + 1, text);
            }
            return;
        }
        if value["type"] == "text" && value["part"].is_object() {
            if let Some(s) = value["part"]["text"].as_str() {
                text.push(s.into());
            }
            return;
        }
        if matches!(
            value["type"].as_str(),
            Some("step-finish" | "step_start" | "step-start")
        ) {
            return;
        }
        if let Some(s) = value["text"].as_str() {
            text.push(s.into());
        }
        for key in [
            "data", "message", "messages", "content", "parts", "part", "result", "output",
        ] {
            if let Some(v) = value.get(key) {
                visit(v, depth + 1, text);
            }
        }
    }
    let mut text = Vec::new();
    visit(value, 0, &mut text);
    crate::compat::trim(&text.join("\n")).to_owned()
}

fn external_model_ref(model: &str) -> Value {
    let mut parts = model.split('#');
    let head = parts.next().unwrap_or(model);
    if let Some((provider, id)) = head
        .split_once('/')
        .filter(|(provider, _)| !provider.is_empty())
    {
        let mut result = json!({"providerID":provider,"id":id});
        if let Some(variant) = parts.next().filter(|v| !v.is_empty()) {
            result["variant"] = json!(variant);
        }
        result
    } else {
        json!({"providerID":"opencode","id":model})
    }
}

struct ExternalGame {
    base: String,
    model: String,
    timeout_ms: u64,
    temperature: f64,
    max_tokens: u32,
}
fn external_game_settings(tier: &str) -> Option<ExternalGame> {
    let prefix = match tier {
        "opencode" => "OPENCODE",
        "local-llm" => "LOCAL_LLM",
        _ => return None,
    };
    // Explicit remote endpoint is required. Deployment never starts a local process.
    if !matches!(
        env(&format!("{prefix}_ENABLED")).to_lowercase().as_str(),
        "1" | "true" | "on" | "yes"
    ) {
        return None;
    }
    let base = env(&format!("{prefix}_BASE_URL"));
    if base.is_empty() {
        return None;
    }
    Some(ExternalGame {
        base: base.trim_end_matches('/').into(),
        model: {
            let model = env(&format!("{prefix}_MODEL"));
            if model.is_empty() {
                if tier == "opencode" {
                    "opencode/gemini-3.5-flash-lite".into()
                } else {
                    "local-model".into()
                }
            } else {
                model
            }
        },
        temperature: env(&format!("{prefix}_TEMPERATURE"))
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite() && *n >= 0.0)
            .unwrap_or(0.7),
        max_tokens: env(&format!("{prefix}_MAX_TOKENS"))
            .parse::<u32>()
            .ok()
            .filter(|n| *n > 0)
            .unwrap_or(2000)
            .min(65536),
        timeout_ms: timeout(
            &format!("{prefix}_TIMEOUT_MS"),
            if tier == "opencode" { 200000 } else { 60000 },
        )
        .min(200000),
    })
}

#[cfg(test)]
mod framing_tests {
    use super::*;
    #[test]
    fn mixed_line_endings_keep_frames_separate_with_bytewise_input() {
        for ending in ["\n\n", "\r\n\r\n", "\n\r\n", "\r\n\n"] {
            let wire = format!("data: α{ending}data: [DONE]{ending}");
            let mut parser = Frames::default();
            let mut frames = vec![];
            for byte in wire.bytes() {
                if let Some(frame) = parser.push(byte, 64).unwrap() {
                    frames.push(frame);
                }
            }
            assert_eq!(frames.len(), 2);
            assert!(parser.pending.is_empty());
            assert_eq!(
                std::str::from_utf8(&frames[0]).unwrap().lines().next(),
                Some("data: α")
            );
        }
    }
}
