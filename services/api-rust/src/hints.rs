//! Deterministic hint ladder; authored hints are screened before delivery.
use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;

// JavaScript uses ASCII word/digit classes but its own Unicode whitespace set.
fn js_regex(pattern: &str) -> Regex {
    let whitespace = r"(?u:[\t\n\x0b\x0c\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}])";
    Regex::new(&pattern.replace(r"\s", whitespace))
        .expect("static JavaScript-compatible hint pattern")
}

fn patterns() -> &'static Vec<(&'static str, &'static str, Regex)> {
    static RULES: OnceLock<Vec<(&str, &str, Regex)>> = OnceLock::new();
    RULES.get_or_init(|| vec![
        ("notation", "used the algorithm’s own bookkeeping", r#"\b(?:lo|hi|mid|left|right|start|end|idx|index|ptr|cursor)\s*=\s*-?\w+|\b\w+\s*\[\s*\w+\s*\]|<=|>=|!=|==|->|=>|::|\+\+|--|[\w)\]]\s*[<>]\s*[\w(]|\bwhile\s*\(|\bfor\s*\(|\bif\s*\(|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|^\s*return\s+[\w"'-]+\s*;?\s*$"#),
        ("resolution", "asserted a result", r"\banswer\s*(?:is|=|:)\s*(?:the\s+)?(?:number\s+|value\s+|index\s+|position\s+)?#?-?\d+|\b(?:it'?s|it is|this is|that'?s|that is)\s+(?:the\s+)?(?:answer|number|value|index|position)\s*#?\s*-?\d+|\b-?\d+\s+is\s+(?:the\s+)?answer\b|\b(?:take|choose|pick|select|go\s+with|submit|commit)\s+(?:the\s+)?#?-?\d+(?:st|nd|rd|th)?\s*(?:as\s+(?:the\s+)?answer)?\b|\b-?\d+(?:st|nd|rd|th)?\s+as\s+(?:the\s+)?answer\b"),
        ("position", "named a position on the board", r"\b(?:index|indices|position|positions|slot|slots|cell|cells|tile|tiles|square|squares|spot|spots)\s*#?\s*-?\d+\b|\b-?\d+(?:st|nd|rd|th)\s+(?:one|cell|slot|square|tile|position|place|pitch|value|element)\b|\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:one|cell|slot|square|tile|position|place)\b"),
        ("unearned-praise", "claimed correctness the engine has not established", r"\b(?:that'?s|that\s+is|that\s+has)\s+(?:correct|right|it|the\s+answer)\b|\b(?:you'?re|you\s+are)\s+(?:right|correct)\b|\bspot\s+on\b|\bwell\s+done\b|\bnice\s+work\b|\bgreat\s+job\b"),
    ].into_iter().map(|(id, reason, pattern)| (id, reason, js_regex(&format!("(?i-u:{pattern})")))).collect())
}
fn code_shape() -> &'static Regex {
    static SHAPE: OnceLock<Regex> = OnceLock::new();
    SHAPE.get_or_init(|| js_regex(r"(?-u:^\s*(//|#|/\*)|^\s*(function|def|class|const|let|var|while|for|if|else|return|int|bool)\b|[{};]\s*$)"))
}
pub fn violation(text: &str) -> Option<Value> {
    let text = crate::compat::trim(text);
    let lines: Vec<_> = text
        .split('\n')
        .map(crate::compat::trim)
        .filter(|s| !s.is_empty())
        .collect();
    static RETURN: OnceLock<Regex> = OnceLock::new();
    let is_return = RETURN
        .get_or_init(|| js_regex(r"(?-u:\breturn\s+(-?\d+|\w+)\s*;?)"))
        .is_match(text);
    if text.contains("```")
        || (lines.len() >= 2 && lines.iter().filter(|s| code_shape().is_match(s)).count() >= 2)
        || (is_return && text.contains(['{', '}', ';']))
    {
        return Some(json!({"id":"pasted-code","reason":"read as source code"}));
    }
    patterns()
        .iter()
        .find(|(_, _, p)| p.is_match(text))
        .map(|(id, reason, _)| json!({"id":id,"reason":reason}))
}
fn word(n: usize) -> String {
    const WORDS: [&str; 21] = [
        "no",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
        "twenty",
    ];
    WORDS
        .get(n)
        .map_or_else(|| n.to_string(), |s| s.to_string())
}
fn capital(s: String) -> String {
    let mut chars = s.chars();
    chars.next().map_or_else(String::new, |c| {
        format!("{}{rest}", c.to_uppercase(), rest = chars.as_str())
    })
}
pub fn window(state: &Value) -> String {
    let n = state["instance"]["values"].as_array().map_or(0, Vec::len);
    let bounds = state["variables"]["lo"]
        .as_f64()
        .zip(state["variables"]["hi"].as_f64())
        .filter(|(lo, hi)| lo.fract() == 0.0 && hi.fract() == 0.0 && *lo >= 0.0 && *hi >= 0.0);
    let left = bounds.map_or(n, |(lo, hi)| (hi - lo + 1.0).max(0.0) as usize);
    if n == 0 {
        return if bounds.is_some() {
            format!("{} of the values are still in play.", capital(word(left)))
        } else {
            "Start at the end you can see and work inwards.".into()
        };
    }
    if bounds.is_none() {
        return format!(
            "All {} of the values are still in play. Decide from those.",
            word(n)
        );
    }
    match left {
        0 => "Nothing is left to check, so the target is not here.".into(),
        1 => "Only one value is still in play. Look at it closely.".into(),
        _ => format!("{} of the {} values are still in play. Work out which end the target has to be on, and rule the other one out.", capital(word(left)), word(n)),
    }
}
fn count(v: &Value) -> u64 {
    v.as_f64()
        .filter(|v| *v > 0.0)
        .map_or(0, |v| v.floor() as u64)
}
pub fn next(state: &Value, spec: &Value, preferred: Option<usize>) -> Value {
    let used = count(&state["progress"]["hintsUsed"]);
    let pool = spec["narration"]["hintPool"].as_array();
    let index = preferred
        .filter(|i| pool.is_some_and(|p| *i < p.len()))
        .unwrap_or(used as usize);
    let authored = pool
        .and_then(|p| p.get(index))
        .and_then(Value::as_str)
        .map(crate::compat::trim)
        .filter(|s| !s.is_empty());
    let legal = if authored.is_some() {
        Value::Null
    } else {
        std::panic::catch_unwind(|| crate::oracle_plan::legal(state)).unwrap_or(Value::Null)
    };
    let label = legal
        .as_array()
        .filter(|a| a.len() == 1)
        .and_then(|a| a[0]["label"].as_str())
        .map(crate::compat::trim)
        .filter(|s| !s.is_empty());
    let (text, source, index) = if let Some(text) = authored {
        (text.to_string(), "spec", index as u64)
    } else if let Some(text) = label {
        (text.to_string(), "heuristic", used)
    } else {
        (window(state), "heuristic", used)
    };
    let mut result = json!({"hint":text,"source":source,"index":index});
    if let Some(v) = violation(&text) {
        result["hint"] = json!(window(state));
        result["screened"] = v;
    }
    result
}
pub fn increment(state: &Value) -> Value {
    let mut next = state.clone();
    next["progress"] = json!({"steps":count(&state["progress"]["steps"]),"mistakes":count(&state["progress"]["mistakes"]),"hintsUsed":count(&state["progress"]["hintsUsed"])+1,"mistakesByMechanic":state["progress"]["mistakesByMechanic"]});
    next
}
