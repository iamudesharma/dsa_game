//! Post-game teaching payload: authored prose plus deterministic oracle and engine evidence.
use serde_json::{json, Value};
use std::collections::HashSet;
fn merge(themed: &Value, engine: &Value) -> Value {
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    let mut add = |row: &Value| {
        let game = row["gameTerm"].as_str().unwrap_or("");
        let algorithm = row["algorithmTerm"].as_str().unwrap_or("");
        if !game.is_empty() && !algorithm.is_empty() && seen.insert(game.to_lowercase()) {
            Some(json!({"gameTerm":game,"algorithmTerm":algorithm}))
        } else {
            None
        }
    };
    for row in themed.as_array().into_iter().flatten() {
        if let Some(row) = add(row) {
            rows.push(row)
        }
    }
    let text = rows
        .iter()
        .map(|r| r["algorithmTerm"].as_str().unwrap().to_lowercase())
        .collect::<Vec<_>>()
        .join(" | ");
    for row in engine.as_array().into_iter().flatten() {
        if rows.len() >= 10 {
            break;
        }
        let algorithm = row["algorithmTerm"].as_str().unwrap_or("").to_lowercase();
        let head: String = algorithm
            .split(' ')
            .next()
            .unwrap_or("")
            .chars()
            .filter(char::is_ascii_lowercase)
            .collect();
        if head.len() >= 4 && text.contains(&head) {
            continue;
        }
        if let Some(row) = add(row) {
            rows.push(row)
        }
    }
    rows.truncate(12);
    json!(rows)
}
pub fn build(spec: &Value, state: &Value) -> Value {
    let trace = state["trace"].as_array().unwrap();
    let canonical = std::panic::catch_unwind(|| crate::runtime::canonical(state, Some(trace)))
        .unwrap_or_else(|_| json!([]));
    let score = crate::runtime::efficiency(trace, canonical.as_array().unwrap());
    let tag = crate::decisions::tag_detailed(trace);
    let label = tag["label"].as_str().unwrap();
    let mut parts = Vec::new();
    for part in [
        spec["debrief"]["summary"].as_str().unwrap_or(""),
        score["note"].as_str().unwrap_or(""),
    ] {
        if !part.is_empty() {
            parts.push(part.to_owned())
        }
    }
    if label != "no-mistakes" {
        parts.push(format!(
            "A pattern we noticed: {}.",
            label.replace('-', " ")
        ));
    }
    let mapping = merge(
        &spec["debrief"]["mapping"],
        &crate::runtime::action_mappings(trace),
    );
    let id = spec["problemId"].as_str().unwrap();
    let mut code = json!({"javascript":crate::oracle_plan::code(id,"javascript"),"python":crate::oracle_plan::code(id,"python"),"typescript":crate::oracle_plan::code(id,"typescript")});
    if ["linked-list-traversal", "reverse-linked-list"].contains(&id) {
        code["java"] = json!(crate::oracle_plan::code(id, "java"));
        code["cpp"] = json!(crate::oracle_plan::code(id, "cpp"));
    }
    let count = tag["count"].as_f64().unwrap();
    let total = tag["totalMistakes"].as_f64().unwrap();
    let confidence = if total == 0.0 { 0.0 } else { count / total };
    let confidence = if confidence.fract() == 0.0 {
        json!(confidence as i64)
    } else {
        json!(confidence)
    };
    let stats = json!({"steps":state["progress"]["steps"],"mistakes":state["progress"]["mistakes"],"hintsUsed":state["progress"]["hintsUsed"],"mistakesByMechanic":state["progress"]["mistakesByMechanic"],"misconception":if label=="no-mistakes"{""}else{label},"confidence":confidence});
    let hints = spec["narration"]["hintPool"]
        .as_array()
        .unwrap()
        .iter()
        .take(state["progress"]["hintsUsed"].as_u64().unwrap_or(0) as usize)
        .cloned()
        .collect::<Vec<_>>();
    let answer = std::panic::catch_unwind(|| crate::oracle_plan::answer(state))
        .unwrap_or_else(|_| json!({"text":"unavailable","value":null,"details":[]}));
    json!({"problemId":spec["problemId"],"phase":if state["phase"]=="won"{"won"}else{"lost"},"playedTrace":trace,"canonicalTrace":canonical,"answer":answer,"pseudocode":crate::oracle_plan::pseudocode(id),"code":code,"complexity":crate::oracle_plan::complexity(id),"summary":parts.join(" "),"actionMeaning":spec["debrief"]["actionMeaning"],"mapping":mapping,"stats":stats,"hintPool":hints})
}
