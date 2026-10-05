//! A bounded view of the current board for coaching; never includes the answer or internal state.
use serde_json::{json, Value};
fn integer(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| {
        v.as_f64()
            .filter(|n| n.is_finite() && n.fract() == 0.0)
            .map(|n| n as i64)
    })
}
fn trailing(id: &str) -> Option<i64> {
    let digits: String = id
        .chars()
        .rev()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    digits.parse().ok()
}
fn slot_position(state: &Value, id: &str) -> Option<i64> {
    integer(&state["slots"][id]["index"])
        .filter(|n| *n >= 0)
        .or_else(|| trailing(id))
}
fn position(state: &Value, id: &str) -> Option<i64> {
    integer(&state["objects"][id]["tags"]["index"])
        .filter(|n| *n >= 0)
        .or_else(|| {
            state["slots"]
                .as_object()?
                .values()
                .find(|s| s["occupantId"] == id)
                .and_then(|s| integer(&s["index"]).filter(|n| *n >= 0))
        })
        .or_else(|| trailing(id))
}
fn bound(state: &Value, name: &str) -> Option<i64> {
    integer(&state["variables"][name]).or_else(|| {
        state["cursor"][format!("{name}SlotId")]
            .as_str()
            .and_then(|id| slot_position(state, id))
    })
}
fn label(state: &Value, index: usize, value: &Value) -> String {
    let object = state["objects"]
        .as_object()
        .and_then(|objects| {
            objects
                .values()
                .find(|o| integer(&o["tags"]["index"]) == Some(index as i64))
        })
        .or_else(|| {
            state["slots"]
                .as_object()?
                .values()
                .find(|s| integer(&s["index"]) == Some(index as i64))?["occupantId"]
                .as_str()
                .map(|id| &state["objects"][id])
        });
    if let Some(o) = object {
        if o["visual"]["kind"] == "emoji" {
            if let Some(glyph) = o["visual"]["glyph"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
            {
                return glyph.to_owned();
            }
        }
        if let Some(own) = o["label"].as_str().map(str::trim).filter(|s| {
            !s.is_empty() && *s != "target" && s.chars().any(|c| c.is_ascii_alphabetic())
        }) {
            return own.to_owned();
        }
    }
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}
pub fn build(state: &Value, spec: &Value, prompt: &Value) -> Value {
    let empty = Vec::new();
    let values = state["instance"]["values"].as_array().unwrap_or(&empty);
    let lo = bound(state, "lo");
    let hi = bound(state, "hi");
    let mid = bound(state, "mid").filter(|n| *n >= 0);
    let mut eliminated = std::collections::BTreeSet::new();
    if let (Some(lo), Some(hi)) = (lo.filter(|n| *n >= 0), hi.filter(|n| *n >= 0)) {
        for i in 0..values.len() as i64 {
            if i < lo || i > hi {
                eliminated.insert(i);
            }
        }
    }
    let trace = state["trace"].as_array().unwrap_or(&empty);
    if let Some(ids) = trace
        .last()
        .and_then(|f| f["pointers"]["eliminated"].as_array())
    {
        for id in ids.iter().filter_map(Value::as_str) {
            if let Some(i) = position(state, id) {
                eliminated.insert(i);
            }
        }
    }
    if let Some(objects) = state["objects"].as_object() {
        for (id, o) in objects {
            if o["state"] == "eliminated" {
                if let Some(i) = position(state, id) {
                    eliminated.insert(i);
                }
            }
        }
    }
    let id = state["problemId"].as_str().unwrap_or("");
    let problem = crate::reference()["problems"]
        .as_array()
        .and_then(|a| a.iter().find(|p| p["id"] == id));
    let complexity = crate::oracle_plan::complexity(id);
    let time = complexity["time"].as_str().unwrap_or("").trim();
    let space = complexity["space"].as_str().unwrap_or("").trim();
    let complexity = if !time.is_empty() {
        if space.is_empty() {
            time.to_owned()
        } else {
            format!("{time} time, {space} space")
        }
    } else {
        problem
            .map(|p| {
                format!(
                    "{} time, {} space",
                    p["complexity"]["time"].as_str().unwrap_or(""),
                    p["complexity"]["space"].as_str().unwrap_or("")
                )
            })
            .unwrap_or_else(|| "unspecified".into())
    };
    let mistake = trace
        .iter()
        .rev()
        .find(|f| f["correct"] == false && !f["note"].as_str().unwrap_or("").contains("rejected:"));
    json!({"problemId":state["problemId"],"problemTitle":problem.map(|p|p["title"].clone()).unwrap_or_else(||json!(id)),"board":values.iter().enumerate().map(|(i,v)|json!({"label":label(state,i,v),"value":if v.is_number(){v.clone()}else{Value::Null}})).collect::<Vec<_>>(),"targetLabel":spec["vocabulary"]["target"].as_str().unwrap_or("").trim(),"targetValue":if state["instance"]["target"].is_number(){state["instance"]["target"].clone()}else{Value::Null},"lo":lo,"mid":mid,"hi":hi,"eliminated":eliminated,"step":state["progress"]["steps"],"mistakes":state["progress"]["mistakes"],"lastMistakeDsaOp":mistake.map(|f|f["dsaOp"].clone()),"phase":state["phase"],"goal":prompt["goal"],"instruction":prompt["instruction"],"complexity":complexity})
}
