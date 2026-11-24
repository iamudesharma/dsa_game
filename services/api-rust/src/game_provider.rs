//! Pure game-generation prompts and remote response protocol. HTTP policy is wired separately.
use serde_json::{json, Value};
use std::{collections::HashSet, sync::OnceLock};
pub fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/game-provider.json")).unwrap())
}
fn string(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn number(v: &Value) -> String {
    v.as_f64().map_or_else(|| v.to_string(), |n| n.to_string())
}
pub fn user_prompt(input: &Value) -> String {
    let p = &input["problem"];
    let instance = &input["instance"];
    let mut instance_lines = vec![
        format!(
            "instance.values (the primary data array, in order): {}",
            instance["values"]
        ),
        format!(
            "instance length: {}",
            instance["values"].as_array().unwrap().len()
        ),
    ];
    if let Some(target) = instance.get("target") {
        instance_lines.push(format!("instance.target: {}", number(target)))
    }
    if instance["tokens"].as_array().is_some_and(|a| !a.is_empty()) {
        instance_lines.push(format!(
            "instance.tokens (the actual sequence to play): {}",
            instance["tokens"]
        ))
    }
    if let Some(nodes) = instance["list"].as_array().filter(|a| !a.is_empty()) {
        instance_lines.push(format!(
            "instance.list (linked nodes in order): {}",
            nodes
                .iter()
                .map(|n| format!("{}({})", string(&n["id"]), number(&n["value"])))
                .collect::<Vec<_>>()
                .join(" -> ")
        ));
    }
    let difficulty = match string(&input["difficulty"]) {
        "easy" => "easy — short narration, gentle hints, 2-3 mechanics",
        "medium" => "medium — a real narrative hook, 3 mechanics, hints that name the operation",
        _ => {
            "hard — tense tone, 4 mechanics, hints that push the player to reason about invariants"
        }
    };
    let allowed = p["allowedMechanics"]
        .as_array()
        .unwrap()
        .iter()
        .map(string)
        .collect::<Vec<_>>()
        .join(", ");
    let mut parts = vec![
        "Generate one GameSpec for the problem below.".into(),
        "".into(),
        "PROBLEM".into(),
        format!("title: {}", string(&p["title"])),
        format!("topic: {}", string(&p["topic"])),
        format!("learningObjective: {}", string(&p["learningObjective"])),
        "canonicalAlgorithm (this is the ground truth your hints and debrief must stay true to):"
            .into(),
        format!("  {}", string(&p["canonicalAlgorithm"])),
        format!(
            "allowedMechanics (your mechanics[] must be a subset of exactly this list): {allowed}"
        ),
        format!(
            "complexity: time {}, space {}",
            string(&p["complexity"]["time"]),
            string(&p["complexity"]["space"])
        ),
        "".into(),
        "ACTUAL INSTANCE (use these real values so any position you refer to is real)".into(),
        instance_lines.join("\n"),
        "".into(),
        format!("seed: {}", number(&input["seed"])),
        format!("difficulty: {difficulty}"),
        "specVersion: 1".into(),
    ];
    let free = crate::compat::trim(string(&input["freeText"]));
    if !free.is_empty() {
        parts.extend([
            "".into(),
            "PLAYER REQUEST (steer the theme towards it; keep every hard rule above)".into(),
            free.into(),
        ]);
    }
    parts.extend([
        "".into(),
        "Set problemId, seed and generatedBy to exactly the values above; the server overwrites"
            .into(),
        "them anyway. Reply with the JSON object and nothing else.".into(),
    ]);
    parts.join("\n")
}
pub fn request(input: &Value, tier: &str, model: &str, temperature: f64, max_tokens: u32) -> Value {
    let key = string(&data()["byProblem"][string(&input["problem"]["id"])]);
    json!({"model":model,"temperature":temperature,"max_tokens":max_tokens,"messages":[{"role":"system","content":data()["system"]},{"role":"user","content":user_prompt(input)}],"response_format":{"type":"json_schema","json_schema":{"name":"game_spec","strict":true,"schema":data()["schemas"][key][if tier=="opencode-go"{"strict"}else{"normal"}]}}})
}
#[derive(Debug)]
pub struct Failure {
    pub schema: bool,
    pub detail: String,
}
impl Failure {
    pub(crate) fn plain(detail: impl Into<String>) -> Self {
        Self {
            schema: false,
            detail: detail.into(),
        }
    }
    pub(crate) fn schema(detail: impl Into<String>) -> Self {
        Self {
            schema: true,
            detail: detail.into(),
        }
    }
    pub fn as_json(&self) -> Value {
        json!({"name":if self.schema{"SpecValidationError"}else{"Error"},"message":if self.schema{format!("invalid GameSpec: {}",self.detail)}else{self.detail.clone()}})
    }
}
fn status_message(status: u16, detail: &str) -> String {
    let suffix = if detail.is_empty() {
        String::new()
    } else {
        format!(": {detail}")
    };
    let text=match status {401|403=>"opencode-go 401/403 — OPENCODE_GO_API_KEY is missing or invalid".into(),402=>"opencode-go 402 — the account has no funds (this is what an exhausted key looks like; top up the OpenCode account or set OPENCODE_GO_API_KEY)".into(),429=>"opencode-go 429 — rate limited; wait and retry, or lower the request rate".into(),500..=599=>format!("opencode-go {status} — upstream error on opencode.ai, not a problem with the request"),_=>format!("opencode-go {status}")};
    format!("{text}{suffix}")
}
fn usage(body: &Value) -> Option<Value> {
    let mut out = json!({});
    if body["usage"]["completion_tokens_details"]["reasoning_tokens"].is_number() {
        out["reasoning"] = body["usage"]["completion_tokens_details"]["reasoning_tokens"].clone()
    }
    if body["usage"]["completion_tokens"].is_number() {
        out["completion"] = body["usage"]["completion_tokens"].clone()
    }
    (!out.as_object().unwrap().is_empty()).then_some(out)
}
pub(crate) fn parse_spec(raw: &str) -> Result<Value, Failure> {
    let mut text = crate::compat::trim(raw);
    if let Some(fenced) = text.strip_prefix("```").and_then(|t| t.strip_suffix("```")) {
        text = fenced;
        if text
            .get(..4)
            .is_some_and(|s| s.eq_ignore_ascii_case("json"))
        {
            text = &text[4..]
        }
        text = crate::compat::trim(text);
    }
    let mut value: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    if value.is_object() {
        for key in ["spec", "game", "gameSpec"] {
            if value[key].is_object() || value[key].is_array() {
                value = value[key].take();
                break;
            }
        }
    }
    let mut spec = crate::contracts::parse("GameSpec", value).map_err(|issues| {
        Failure::schema(
            issues
                .iter()
                .take(12)
                .map(|i| {
                    let path = i["path"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|p| {
                            p.as_str()
                                .map(str::to_owned)
                                .unwrap_or_else(|| p.to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(".");
                    format!(
                        "{}: {}",
                        if path.is_empty() { "<root>" } else { &path },
                        string(&i["message"])
                    )
                })
                .collect::<Vec<_>>()
                .join("; "),
        )
    })?;
    let mut seen = HashSet::new();
    for mechanic in spec["mechanics"].as_array_mut().unwrap() {
        if !seen.insert(string(&mechanic["id"]).to_owned()) {
            return Err(Failure::schema(
                "mechanics: Duplicate mechanic ids in mechanics[]",
            ));
        }
    }
    Ok(spec)
}

pub fn llama_modes(input: &Value, model: &str, repair: Option<&str>) -> Vec<Value> {
    let key = data()["byProblem"][input["problem"]["id"].as_str().unwrap()]
        .as_str()
        .unwrap();
    let schema = &data()["schemas"][key];
    let request = if let Some(issues) = repair {
        repair_request(input, "local-llm", model, 0.7, 2000, issues)
    } else {
        request(input, "local-llm", model, 0.7, 2000)
    };
    let mut base = request;
    base.as_object_mut().unwrap().remove("response_format");
    let system = base["messages"][0]["content"].as_str().unwrap();
    let rules = system
        .split("JSON SCHEMA — your output must validate against this exactly")
        .next()
        .unwrap_or(system);
    base["messages"][0]["content"] = json!(format!(
        "{}\n\nOutput raw JSON only, no code fences.",
        crate::compat::trim(rules)
    ));
    let mut modes = Vec::new();
    let mut modern = base.clone();
    modern["response_format"] =
        json!({"type":"json_schema","json_schema":{"schema":schema["llama"]}});
    modes.push(modern);
    if let Some(grammar) = schema["grammar"].as_str() {
        let mut legacy = base.clone();
        legacy["grammar"] = json!(grammar);
        modes.push(legacy);
    }
    base["response_format"] = json!({"type":"json_object"});
    modes.push(base);
    modes
}

pub fn salvage(input: &Value, partial: &Value) -> Option<Value> {
    partial.as_object()?;
    let base = crate::template::build(
        &input["problem"],
        &input["instance"],
        input["seed"].as_f64()?,
        input["difficulty"].as_str()?,
        input["language"].as_str(),
    )?;
    let mut patch = serde_json::Map::new();
    if partial["objective"].is_string() {
        patch.insert("objective".into(), partial["objective"].clone());
    }
    for block in ["theme", "vocabulary", "visual", "narration", "debrief"] {
        let Some(fields) = partial[block].as_object() else {
            continue;
        };
        let mut merged = base[block].clone();
        merged.as_object_mut()?.extend(fields.clone());
        let strings: &[&str] = match block {
            "theme" => &["title", "story"],
            "narration" => &["intro", "win", "lose"],
            "debrief" => &["summary"],
            _ => &[],
        };
        for key in strings {
            if partial[block][key]
                .as_str()
                .is_none_or(|s| crate::compat::trim(s).is_empty())
            {
                merged[*key] = base[block][*key].clone();
            }
        }
        match block {
            "theme" => {
                for key in ["genre", "tone"] {
                    let allowed = &data()["schemas"]
                        [data()["byProblem"][input["problem"]["id"].as_str()?].as_str()?]["normal"]
                        ["properties"]["theme"]["properties"][key]["enum"];
                    if allowed
                        .as_array()
                        .is_some_and(|a| !a.contains(&partial[block][key]))
                    {
                        merged[key] = base[block][key].clone();
                    }
                }
            }
            "visual" => {
                merged["palette"] = base[block]["palette"].clone();
                merged["objectGlyphs"] = base[block]["objectGlyphs"].clone();
                if let Some(glyphs) = partial[block]["objectGlyphs"].as_object() {
                    let mut spread: serde_json::Map<String, Value> =
                        if let Some(o) = base[block]["objectGlyphs"].as_object() {
                            o.clone()
                        } else if let Some(a) = base[block]["objectGlyphs"].as_array() {
                            a.iter()
                                .enumerate()
                                .map(|(i, v)| (i.to_string(), v.clone()))
                                .collect()
                        } else {
                            serde_json::Map::new()
                        };
                    spread.extend(glyphs.clone());
                    merged["objectGlyphs"] = Value::Object(spread);
                }
            }
            "narration" => {
                if partial[block]["hintPool"]
                    .as_array()
                    .is_none_or(|a| a.len() < 2)
                {
                    merged["hintPool"] = base[block]["hintPool"].clone();
                }
            }
            "debrief" => {
                merged["actionMeaning"] = base[block]["actionMeaning"].clone();
                if let Some(meanings) = partial[block]["actionMeaning"].as_object() {
                    merged["actionMeaning"]
                        .as_object_mut()?
                        .extend(meanings.clone());
                }
                if partial[block]["mapping"]
                    .as_array()
                    .is_none_or(|a| a.is_empty())
                {
                    merged["mapping"] = base[block]["mapping"].clone();
                }
            }
            _ => {}
        }
        patch.insert(block.into(), merged);
    }
    let mut candidate = base.clone();
    candidate.as_object_mut()?.extend(patch.clone());
    if let Ok(spec) = parse_spec(&candidate.to_string()) {
        return Some(spec);
    }
    if patch.contains_key("theme") {
        for key in ["narration", "debrief", "visual", "vocabulary"] {
            patch.remove(key);
        }
        let mut candidate = base;
        candidate.as_object_mut()?.extend(patch);
        return parse_spec(&candidate.to_string()).ok();
    }
    None
}
pub fn response(
    input: &Value,
    tier: &str,
    status: u16,
    body: &Value,
    max_tokens: u32,
) -> Result<Value, Failure> {
    let error = body["error"].as_object();
    if tier == "opencode-go" {
        let message = string(&body["error"]["message"]);
        if !(200..300).contains(&status) {
            return Err(Failure::plain(status_message(
                status,
                &crate::text::slice(
                    if error.is_some() {
                        message
                    } else {
                        string(body)
                    },
                    300,
                ),
            )));
        }
        if error.is_some() {
            let typ = body["error"]["type"]
                .as_str()
                .or_else(|| body["type"].as_str())
                .unwrap_or("Error");
            let lower = typ.to_ascii_lowercase();
            let status = if ["auth", "permission", "forbidden", "unauthor"]
                .iter()
                .any(|s| lower.contains(s))
            {
                Some(401)
            } else if ["payment", "credit", "billing", "quota", "insufficient"]
                .iter()
                .any(|s| lower.contains(s))
            {
                Some(402)
            } else if ["rate", "too_many"].iter().any(|s| lower.contains(s)) {
                Some(429)
            } else {
                None
            };
            let message = crate::text::slice(message, 300);
            return Err(Failure::plain(status.map_or_else(
                || format!("opencode-go returned an error envelope: {typ}: {message}"),
                |status| status_message(status, &message),
            )));
        }
        if body["choices"][0]["finish_reason"] == "length" {
            let usage = usage(body).map_or(String::new(), |u| {
                format!(
                    " (reasoning_tokens={}, completion_tokens={})",
                    u.get("reasoning").map_or("?".into(), number),
                    u.get("completion").map_or("?".into(), number)
                )
            });
            return Err(Failure::schema(format!("response was truncated at max_tokens={max_tokens} before it became valid JSON{usage}; the models here are reasoning models, so the budget must cover their thinking as well as the reply — raise OPENCODE_GO_MAX_TOKENS")));
        }
    } else if !(200..300).contains(&status) {
        return Err(Failure::plain(format!(
            "openrouter {status}: {}",
            crate::text::slice(&body.to_string(), 400)
        )));
    }
    let first = &body["choices"][0];
    let content = first["message"]["content"]
        .as_str()
        .or_else(|| first["text"].as_str())
        .unwrap_or("");
    if content.is_empty() {
        return Err(Failure::plain(if tier == "opencode-go" {
            format!(
                "opencode-go returned 200 with no choices[0].message.content{}; finish_reason={}",
                usage(body).map_or(String::new(), |u| format!(" (usage {u})")),
                string(&first["finish_reason"])
            )
        } else {
            format!(
                "openrouter returned no content{}",
                body.get("error")
                    .filter(|v| !v.is_null() && *v != &json!(false))
                    .map_or(String::new(), |e| format!(
                        ": {}",
                        crate::text::slice(&e.to_string(), 300)
                    ))
            )
        }));
    }
    let mut spec = parse_spec(content)?;
    let allowed = input["problem"]["allowedMechanics"].as_array().unwrap();
    let mut seen = HashSet::new();
    let mut mechanics = Vec::new();
    for mut m in spec["mechanics"].take().as_array().unwrap().clone() {
        if !allowed.contains(&m["id"]) || !seen.insert(string(&m["id"]).to_owned()) {
            continue;
        }
        m["boundDsaOp"] = json!(crate::runtime::op(string(&m["id"])));
        mechanics.push(m);
        if mechanics.len() == 4 {
            break;
        }
    }
    if mechanics.is_empty() {
        return Err(Failure::schema(format!(
            "mechanics[] had nothing in common with allowedMechanics [{}]",
            allowed.iter().map(string).collect::<Vec<_>>().join(", ")
        )));
    }
    spec["mechanics"] = json!(mechanics);
    spec["problemId"] = input["problem"]["id"].clone();
    spec["seed"] = input["seed"].clone();
    if let Some(language) = input.get("language") {
        spec["language"] = language.clone()
    };
    spec["generatedBy"] = json!(tier);
    Ok(spec)
}

pub fn repair_request(
    input: &Value,
    tier: &str,
    model: &str,
    temperature: f64,
    max_tokens: u32,
    issues: &str,
) -> Value {
    let mut body = request(input, tier, model, temperature, max_tokens);
    body["messages"][1]["content"] = json!(format!("{}\n\n---\n\nYour previous reply was rejected. It is NOT valid against the GameSpec JSON Schema.\n\nSchema violations reported by the validator:\n{}\n\nFix ONLY these problems. Do not change your theme, vocabulary or mechanics choice.\nRe-send the complete corrected JSON object and nothing else — no fences, no explanation.", user_prompt(input), issues));
    body
}
