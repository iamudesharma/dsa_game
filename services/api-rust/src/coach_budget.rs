//! Keep only bounded recent coaching context, summarizing older exchanges.
use serde_json::{json, Value};
#[derive(Clone, Copy)]
pub struct Budget {
    pub max_prompt_tokens: usize,
    pub reply_reserve_tokens: usize,
    pub max_turns: usize,
}
impl Default for Budget {
    fn default() -> Self {
        Self {
            max_prompt_tokens: 6000,
            reply_reserve_tokens: 800,
            max_turns: 24,
        }
    }
}
pub fn estimate_tokens(text: &str) -> usize {
    text.encode_utf16().count().div_ceil(4)
}
pub fn estimate_turn(turn: &Value) -> usize {
    estimate_tokens(turn["text"].as_str().unwrap_or(""))
        + turn
            .get("snapshot")
            .map(|s| estimate_tokens(&s.to_string()))
            .unwrap_or(0)
}
pub fn after_preamble(parts: &[&str], budget: Budget) -> Budget {
    Budget {
        max_prompt_tokens: budget
            .max_prompt_tokens
            .saturating_sub(parts.iter().map(|p| estimate_tokens(p)).sum())
            .max(budget.reply_reserve_tokens + 1),
        ..budget
    }
}
fn shorten(text: &str, max: usize) -> String {
    if max <= 1 {
        return String::new();
    };
    if text.encode_utf16().count() <= max {
        return text.into();
    }
    let clipped = crate::text::slice(text, max - 1);
    let last = [". ", "? ", "! "]
        .iter()
        .filter_map(|p| clipped.rfind(p))
        .max();
    if let Some(i) = last.filter(|i| clipped[..*i].encode_utf16().count() > 28) {
        return format!("{}…", clipped[..i + 1].trim());
    }
    let body = clipped
        .rfind(' ')
        .filter(|i| *i > 0)
        .map(|i| &clipped[..i])
        .unwrap_or(&clipped);
    format!("{}…", body.trim())
}
fn snippet(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.is_empty() {
        "something".into()
    } else if flat.encode_utf16().count() <= 96 {
        format!("\"{flat}\"")
    } else {
        format!("\"{}…\"", crate::text::slice(&flat, 92).trim_end())
    }
}
fn summarize(turns: &[&Value]) -> String {
    let mut lines = Vec::new();
    let mut i = 0;
    while i < turns.len() {
        let t = turns[i];
        let text = snippet(t["text"].as_str().unwrap_or(""));
        if t["role"] == "learner" {
            if turns.get(i + 1).is_some_and(|t| t["role"] == "coach") {
                lines.push(format!(
                    "asked {text}; I answered {}",
                    snippet(turns[i + 1]["text"].as_str().unwrap_or(""))
                ));
                i += 2;
                continue;
            };
            lines.push(format!("asked {text}"));
        } else if t["role"] == "coach" {
            lines.push(format!("I said {text}"));
        }
        i += 1;
    }
    lines[lines.len().saturating_sub(10)..].join("\n")
}
fn merge(prior: Option<&str>, fresh: &str) -> Option<String> {
    let combined = [prior.unwrap_or("").trim(), fresh.trim()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if combined.is_empty() {
        return None;
    };
    let lines: Vec<_> = combined
        .split('\n')
        .filter(|l| !l.trim().is_empty())
        .collect();
    let mut start = lines.len().saturating_sub(10);
    let mut out = lines[start..].join("\n");
    while out.encode_utf16().count() > 900 && lines.len() - start > 1 {
        start += 1;
        out = lines[start..].join("\n");
    }
    let count = out.encode_utf16().count();
    if count > 900 {
        out = format!(
            "…{}",
            String::from_utf16_lossy(&out.encode_utf16().skip(count - 899).collect::<Vec<_>>())
        );
    }
    Some(out)
}
pub fn assemble(turns: &[Value], budget: Budget, prior: Option<&str>) -> Value {
    let usable = budget
        .max_prompt_tokens
        .saturating_sub(budget.reply_reserve_tokens);
    let start = turns.len().saturating_sub(budget.max_turns);
    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    let mut truncated = Vec::new();
    let mut stripped_count = 0;
    let mut spent = 0;
    for t in turns[start..].iter().rev() {
        let cost = estimate_turn(t);
        if spent + cost <= usable {
            kept.push(t.clone());
            spent += cost;
            continue;
        }
        let mut stripped = t.clone();
        stripped.as_object_mut().unwrap().remove("snapshot");
        let cost = estimate_turn(&stripped);
        if t.get("snapshot").is_some() && spent + cost <= usable {
            stripped_count += 1;
            kept.push(stripped);
            spent += cost;
            continue;
        }
        if kept.is_empty() {
            if cost > usable {
                let room = usable.saturating_mul(4).saturating_sub(24);
                let text = shorten(t["text"].as_str().unwrap_or(""), room);
                if text.is_empty() {
                    dropped.push(t);
                    continue;
                };
                stripped["text"] = json!(text);
            }
            let cost = estimate_turn(&stripped);
            if cost > usable {
                dropped.push(t);
                continue;
            }
            if stripped["text"] != t["text"] {
                truncated.push(t["id"].clone());
            }
            if t.get("snapshot").is_some() {
                stripped_count += 1
            };
            kept.push(stripped);
            spent += cost;
        } else {
            dropped.push(t);
        }
    }
    kept.reverse();
    dropped.reverse();
    let mut all: Vec<_> = turns[..start].iter().collect();
    all.extend(dropped);
    json!({"turns":kept,"summary":merge(prior,&summarize(&all)),"approxPromptTokens":spent,"droppedTurns":all.len(),"snapshotStrippedTurns":stripped_count,"truncatedTurnIds":truncated})
}
