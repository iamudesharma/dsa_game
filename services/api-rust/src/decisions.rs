//! Deterministic routing and coaching decisions; tables are captured from Node.
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

fn keys(options: &Value) -> Vec<String> {
    let Some(options) = options.as_object() else {
        return Vec::new();
    };
    let mut indexed: Vec<_> = options
        .keys()
        .filter_map(|k| {
            k.parse::<u32>()
                .ok()
                .filter(|n| *n < u32::MAX && n.to_string() == *k)
                .map(|n| (n, k.clone()))
        })
        .collect();
    indexed.sort_by_key(|(n, _)| *n);
    let mut keys: Vec<_> = indexed.into_iter().map(|(_, k)| k).collect();
    for key in options.keys() {
        if !keys.contains(key) {
            keys.push(key.clone());
        }
    }
    keys
}
const HINT_COUNTS: &[&str] = &[
    "hintsused",
    "hints_used",
    "hints used",
    "hints",
    "hintcount",
];
const MISTAKE_COUNTS: &[&str] = &["mistakes", "mistake", "errors", "error", "wronganswers"];
const STEP_COUNTS: &[&str] = &["steps", "step", "moves", "moves taken", "turns", "actions"];
fn count(text: &str, names: &[&str]) -> Option<f64> {
    for name in names {
        let regex = Regex::new(&format!(
            r"(?i)(?-u:\b){}(?-u:\b)[^0-9]{{0,3}}([0-9]+)",
            regex::escape(name)
        ))
        .unwrap();
        if let Some(c) = regex.captures(text) {
            if let Ok(n) = c[1].parse::<f64>() {
                if n.is_finite() {
                    return Some(n);
                }
            }
        }
    }
    None
}
fn parsed_ops(text: &str) -> Vec<Value> {
    let mut frames = Vec::new();
    for line in text.split(['\n', ';']) {
        let parts: Vec<_> = crate::compat::trim(line)
            .split(|c: char| c.is_whitespace() || c == '\u{feff}' || c == ',' || c == '|')
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() < 2 {
            continue;
        }
        let op = parts[0]
            .replace(['(', ')', ':', ',', '.', '-'], "")
            .to_lowercase();
        if data()["OP_TO_LABEL"][&op].is_null() {
            continue;
        }
        let verdict = parts[1..].join(" ").to_lowercase();
        if ["mistake", "wrong", "incorrect", "!", "x", "bad", "fail"]
            .iter()
            .any(|m| verdict.contains(m))
        {
            frames.push(json!({"dsaOp":op,"correct":false}));
        }
    }
    frames
}
fn ordinal(s: &str) -> Option<i64> {
    static PREFIX: OnceLock<Regex> = OnceLock::new();
    let c = PREFIX
        .get_or_init(|| Regex::new(r"^[+-]?[0-9]+").unwrap())
        .find(crate::compat::trim(s))?;
    c.as_str().parse().ok()
}
pub fn decide(req: &Value) -> Value {
    let options = &req["options"];
    let mut keys = keys(options);
    let kind = req["kind"].as_str().unwrap_or("");
    let text = req["stateText"].as_str().unwrap_or("");
    let mut result = if keys.is_empty() {
        outcome("", 0.0)
    } else if keys.len() == 1 {
        outcome(&keys[0], 1.0)
    } else {
        match kind {
            "route-problem" => route(text, Some(&keys)),
            "pick-theme" => theme(&keys, Some(text)),
            "pick-hint" => {
                keys.sort_by(|a, b| match (ordinal(a), ordinal(b)) {
                    (Some(a), Some(b)) => a.cmp(&b),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    _ => std::cmp::Ordering::Equal,
                });
                let regex =
                    Regex::new(r"(?i)(?-u:\b)lastmistake(?:dsa)?op(?-u:\b)[^0-9]{0,3}([a-z-]+)")
                        .unwrap();
                let op = regex.captures(text).map(|c| c[1].to_lowercase());
                hint(
                    &keys,
                    count(text, HINT_COUNTS).unwrap_or(0.0),
                    op.as_deref(),
                )
            }
            "tag-misconception" => tag(&parsed_ops(text)),
            "difficulty" => {
                let has_stats = STEP_COUNTS
                    .iter()
                    .chain(MISTAKE_COUNTS)
                    .chain(HINT_COUNTS)
                    .any(|s| count(text, &[s]).is_some());
                let split = Regex::new("(?i)player wish:|their wish:").unwrap();
                let wish = split.split(text).last().unwrap_or(text);
                let negated=Regex::new(r"(?i)(?-u:\b)not\s+(easy|low|gentle|beginner|medium|moderate|hard|high|challenging)(?-u:\b)").unwrap().replace_all(wish,"").into_owned();
                let explicit=Regex::new(r"(?i)(?-u:\b)(easy|low|gentle|beginner|medium|moderate|hard|high|challenging)(?-u:\b)").unwrap();
                if let Some(c) = explicit.captures(&negated).filter(|_| !has_stats) {
                    let level = c[1].to_lowercase();
                    outcome(
                        if ["easy", "low", "gentle", "beginner"].contains(&level.as_str()) {
                            "easy"
                        } else if ["hard", "high", "challenging"].contains(&level.as_str()) {
                            "hard"
                        } else {
                            "medium"
                        },
                        1.0,
                    )
                } else {
                    difficulty(
                        count(text, STEP_COUNTS).unwrap_or(0.0),
                        count(text, MISTAKE_COUNTS).unwrap_or(0.0),
                        count(text, HINT_COUNTS).unwrap_or(0.0),
                    )
                }
            }
            _ => outcome("", 0.0),
        }
    };
    if !keys.is_empty() && !keys.iter().any(|k| result["choice"] == k.as_str()) {
        let preference = match kind {
            "difficulty" => vec!["easy", "medium", "hard"],
            "tag-misconception" => strings(&data()["MISCONCEPTION_LABELS"]),
            _ => Vec::new(),
        };
        result["choice"] = json!(preference
            .iter()
            .find(|p| keys.iter().any(|k| k == **p))
            .copied()
            .unwrap_or(&keys[0]));
    }
    result["scoreKind"] = json!("heuristic");
    result
}
fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/decisions.json")).unwrap())
}
fn strings(v: &Value) -> Vec<&str> {
    v.as_array()
        .map_or_else(Vec::new, |a| a.iter().filter_map(Value::as_str).collect())
}
pub fn tokenize(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}
pub fn hash_string(s: &str) -> u32 {
    s.encode_utf16()
        .fold(0x811c9dc5, |h, c| (h ^ c as u32).wrapping_mul(0x01000193))
}
fn form(token: &str, word: &str) -> bool {
    strings(&data()["INFLECTIONS"])
        .iter()
        .any(|s| token == format!("{word}{s}"))
}
fn phrase(tokens: &[String], word: &str) -> bool {
    let words = tokenize(word);
    if words.is_empty() {
        return false;
    }
    tokens
        .windows(words.len())
        .any(|w| w.iter().zip(&words).all(|(t, w)| form(t, w)))
}
fn outcome(choice: &str, confidence: f64) -> Value {
    let confidence = (confidence.clamp(0.0, 1.0) * 10000.0).round() / 10000.0;
    let confidence = if confidence.fract() == 0.0 {
        json!(confidence as u64)
    } else {
        json!(confidence)
    };
    json!({"choice":choice,"confidence":confidence,"source":"heuristic"})
}
pub fn scores(text: &str, allowed: Option<&[String]>) -> Vec<Value> {
    let tokens = tokenize(text);
    let stop = strings(&data()["STOPWORDS"]);
    let mut rows = Vec::new();
    for p in crate::reference()["problems"].as_array().unwrap() {
        let id = p["id"].as_str().unwrap();
        if allowed.is_some_and(|a| !a.iter().any(|s| s == id)) {
            continue;
        }
        let mut score = 0;
        let mut best = None;
        let keywords = &data()["KEYWORDS"][id];
        for k in strings(&keywords["specific"]) {
            if phrase(&tokens, k) {
                score += 4;
                if best.is_none() {
                    best = Some(k.to_owned());
                }
            }
        }
        let topic = p["topic"].as_str().unwrap();
        if keywords.is_object() {
            for k in strings(&keywords["topic"])
                .into_iter()
                .map(str::to_owned)
                .chain(tokenize(
                    crate::template::data()["topicLabels"][topic]
                        .as_str()
                        .unwrap(),
                ))
            {
                if phrase(&tokens, &k) {
                    score += 2;
                }
            }
        }
        let mut weak = Vec::new();
        for field in ["title", "learningObjective", "canonicalAlgorithm"] {
            for t in tokenize(p[field].as_str().unwrap()) {
                if t.len() > 2 && !stop.contains(&t.as_str()) && !weak.contains(&t) {
                    weak.push(t);
                }
            }
        }
        for k in weak {
            if phrase(&tokens, &k) {
                score += 1;
                if best.is_none() {
                    best = Some(k);
                }
            }
        }
        rows.push(json!({"id":id,"topic":topic,"score":score,"bestKeyword":best}));
    }
    rows.sort_by(|a, b| {
        b["score"]
            .as_i64()
            .cmp(&a["score"].as_i64())
            .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
    });
    rows
}
pub fn route(text: &str, allowed: Option<&[String]>) -> Value {
    let ranked = scores(text, allowed);
    let Some(first) = ranked.first() else {
        return outcome("", 0.0);
    };
    if first["score"] == 0 {
        let fallback = crate::reference()["problems"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| {
                allowed.is_none_or(|a| a.is_empty() || a.iter().any(|id| p["id"] == id.as_str()))
            });
        return fallback.map_or_else(
            || outcome("", 0.0),
            |p| outcome(p["id"].as_str().unwrap(), 0.15),
        );
    }
    let tied: Vec<_> = ranked
        .iter()
        .filter(|p| p["score"] == first["score"])
        .collect();
    let best = if tied.len() > 1 {
        tied.iter()
            .find(|p| data()["TOPIC_ENTRY"][p["topic"].as_str().unwrap()] == p["id"])
            .copied()
            .unwrap_or(first)
    } else {
        first
    };
    let second = ranked
        .iter()
        .find(|p| p["id"] != best["id"])
        .map_or(0.0, |p| p["score"].as_f64().unwrap());
    let score = best["score"].as_f64().unwrap();
    outcome(
        best["id"].as_str().unwrap(),
        0.4 + 0.6 * ((score - second) / score) * (score / 6.0).min(1.0),
    )
}
pub fn theme(candidates: &[String], text: Option<&str>) -> Value {
    if candidates.is_empty() {
        return outcome("", 0.0);
    }
    let seed = format!(
        "{}:{}|{}",
        candidates.len(),
        candidates.join(","),
        text.unwrap_or("")
    );
    let rotation = hash_string(&seed) as usize % candidates.len();
    let tokens = tokenize(text.unwrap_or(""));
    let overlap: Vec<_> = candidates
        .iter()
        .map(|c| {
            tokenize(c)
                .iter()
                .filter(|w| w.len() >= 3 && tokens.iter().any(|t| form(t, w)))
                .count()
        })
        .collect();
    let best = overlap
        .iter()
        .enumerate()
        .max_by(|(a, x), (b, y)| x.cmp(y).then_with(|| b.cmp(a)));
    if let Some((i, n)) = best.filter(|(_, n)| **n > 0) {
        let mut result = outcome(
            &candidates[i],
            0.6 + 0.3 * (*n as f64 / (*n).max(1) as f64).min(1.0),
        );
        let distribution: Map<_, _> = candidates
            .iter()
            .zip(overlap)
            .map(|(k, v)| (k.clone(), json!(v)))
            .collect();
        result["distribution"] = json!(distribution);
        result
    } else {
        outcome(&candidates[rotation], 0.5)
    }
}
pub fn hint(pool: &[String], used: f64, last_op: Option<&str>) -> Value {
    if pool.is_empty() {
        return outcome("", 0.0);
    }
    let used = if used.is_finite() {
        used.trunc().max(0.0) as usize
    } else {
        0
    };
    let exhausted = used >= pool.len();
    let mut index = used.min(pool.len() - 1);
    let mut aligned = false;
    if !exhausted {
        if let Some(op) = last_op {
            let words = strings(&data()["DSA_OP_HINT_WORDS"][op]);
            for (i, line) in pool.iter().enumerate().skip(used) {
                let tokens = tokenize(line);
                if words.iter().any(|w| phrase(&tokens, w)) {
                    index = i;
                    aligned = true;
                    break;
                }
            }
        }
    }
    let confidence = if exhausted {
        0.3
    } else {
        let c = 0.7 + 0.25 * ((pool.len() - index) as f64 / pool.len() as f64);
        if aligned {
            (c + 0.03).min(0.98)
        } else {
            c
        }
    };
    outcome(&pool[index], confidence)
}
pub fn tag_detailed(trace: &[Value]) -> Value {
    let mut counts = Map::new();
    let mut total = 0;
    for f in trace {
        if f["correct"] == true {
            continue;
        }
        let Some(op) = f["dsaOp"].as_str() else {
            continue;
        };
        let Some(label) = data()["OP_TO_LABEL"][op].as_str() else {
            continue;
        };
        let n = counts.get(label).and_then(Value::as_u64).unwrap_or(0) + 1;
        counts.insert(label.into(), json!(n));
        total += 1;
    }
    let mut best = "no-mistakes";
    let mut n = 0;
    for label in strings(&data()["MISCONCEPTION_LABELS"]) {
        let count = counts.get(label).and_then(Value::as_u64).unwrap_or(0);
        if count > n
            || (count > 0
                && count == n
                && data()["LABEL_PRIORITY"][label].as_u64()
                    < data()["LABEL_PRIORITY"][best].as_u64())
        {
            best = label;
            n = count;
        }
    }
    json!({"label":best,"count":n,"totalMistakes":total,"distribution":counts})
}
pub fn tag(trace: &[Value]) -> Value {
    let detailed = tag_detailed(trace);
    let label = detailed["label"].as_str().unwrap();
    let total = detailed["totalMistakes"].as_f64().unwrap();
    let mut result = if total == 0.0 {
        outcome(label, 1.0)
    } else {
        outcome(
            label,
            0.6 + 0.35 * detailed["count"].as_f64().unwrap() / total,
        )
    };
    result["distribution"] = if total == 0.0 {
        json!({"no-mistakes":1})
    } else {
        json!(detailed["distribution"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), json!(v.as_f64().unwrap() / total)))
            .collect::<Map<_, _>>())
    };
    result
}
pub fn difficulty(steps: f64, mistakes: f64, hints: f64) -> Value {
    let finite = |n: f64| if n.is_finite() { n } else { 0.0 };
    let challenge = (50.0 - (finite(mistakes) * 8.0).min(50.0) - (finite(hints) * 5.0).min(25.0)
        + (finite(steps).max(0.0) / 40.0).min(15.0) * 15.0)
        .clamp(0.0, 100.0);
    let choice = if challenge < 35.0 {
        "easy"
    } else if challenge < 65.0 {
        "medium"
    } else {
        "hard"
    };
    let distance = (challenge - 35.0).abs().min((challenge - 65.0).abs());
    let mut result = outcome(choice, 0.55 + 0.4 * (distance / 15.0).min(1.0));
    result["distribution"] = json!({choice:1});
    result
}
