//! Screen every coaching reply before publication, including deterministic fallbacks.
use crate::compat::trim;
use regex::{Regex, RegexBuilder};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::OnceLock};
struct Rules {
    data: Value,
    patterns: HashMap<String, Regex>,
    code: Vec<Regex>,
}
pub(crate) fn js_spaces(pattern: &str) -> String {
    pattern.replace(r"[,\s]",r"(?:,|\s)").replace(r"\b",r"(?-u:\b)").replace(r"\w",r"(?-u:\w)").replace(r"\d",r"(?-u:\d)").replace(r"\s",r"(?u:[\t\n\x0b\x0c\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}])")
}
fn compile(v: &Value) -> Regex {
    RegexBuilder::new(&js_spaces(v["source"].as_str().unwrap()))
        .case_insensitive(v["flags"].as_str().unwrap().contains('i'))
        .unicode(true)
        .build()
        .unwrap()
}
fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(|| {
        let data: Value =
            serde_json::from_str(include_str!("../data/coach-guardrails.json")).unwrap();
        let patterns = data
            .as_object()
            .unwrap()
            .iter()
            .filter(|(_, v)| v["source"].is_string())
            .map(|(k, v)| (k.clone(), compile(v)))
            .collect();
        let code = data["CODE_LINE_SHAPES"]
            .as_array()
            .unwrap()
            .iter()
            .map(compile)
            .collect();
        Rules {
            data,
            patterns,
            code,
        }
    })
}
fn pattern(name: &str) -> &'static Regex {
    &rules().patterns[name]
}
fn hit(name: &str, text: &str) -> Option<String> {
    pattern(name).find(text).map(|m| m.as_str().trim().into())
}
fn safe(text: &str) -> bool {
    static ENGAGEMENT: OnceLock<Regex> = OnceLock::new();
    !pattern("RESOLUTION_WORDS").is_match(text)&&ENGAGEMENT.get_or_init(||Regex::new(r"(?i)\b(?:window|ends?|edge|edges|half|halves|middle|mid|between|left|right|smaller|bigger|larger|narrow|discard|ruled\s+out|out\s+of|numbers?|values?|stones?|cards?|cells?|compare|comparing|checking|still\s+in\s+play|remaining|left)\b").unwrap()).is_match(text)
}
fn sentences(text: &str) -> Vec<&str> {
    let mut start = 0;
    let mut parts = Vec::new();
    let mut previous = None;
    for (i, c) in text.char_indices() {
        if c == '\n'
            || trim(&c.to_string()).is_empty()
                && previous.is_some_and(|p| matches!(p, '.' | '!' | '?'))
        {
            let part = trim(&text[start..i]);
            if !part.is_empty() {
                parts.push(part)
            }
            start = i + c.len_utf8();
        }
        previous = Some(c);
    }
    let rest = trim(&text[start..]);
    if !rest.is_empty() {
        parts.push(rest)
    }
    parts
}
pub fn violation(reply: &str, snapshot: &Value) -> Option<Value> {
    let text = trim(reply);
    if text.is_empty() {
        return None;
    }
    let found = |id: &str, reason: String| Some(json!({"id":id,"reason":reason}));
    if text.contains("```") {
        return found("pasted-code", "reply contains a fenced code block".into());
    }
    let lines: Vec<_> = text.lines().map(trim).filter(|s| !s.is_empty()).collect();
    if lines.len() >= 2
        && lines
            .iter()
            .filter(|s| rules().code.iter().any(|p| p.is_match(s)))
            .count()
            >= 2
    {
        return found("pasted-code", "reply is source code, not coaching".into());
    }
    static RETURN: OnceLock<Regex> = OnceLock::new();
    if RETURN
        .get_or_init(|| Regex::new(&js_spaces(r"\breturn\s+(-?\d+|\w+)\s*;?")).unwrap())
        .is_match(text)
        && text.contains(['{', '}', ';'])
    {
        return found("pasted-code", "reply contains executable statements".into());
    }
    if let Some(c) = pattern("ANSWER_CLAIM").captures(text) {
        let value = c.get(1).or_else(|| c.get(0)).unwrap().as_str().trim();
        return found(
            "answer-claim",
            format!("asserted \"{value}\" as the answer"),
        );
    }
    if let Some(target) = snapshot.get("targetValue").filter(|v| !v.is_null()) {
        let target = target
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| target.to_string());
        let literal = regex::escape(&target);
        let contains = Regex::new(&format!(r"(?-u)\b{literal}\b"))
            .unwrap()
            .is_match(text);
        if contains&&Regex::new(&js_spaces(&format!(r"(?i)\b(?:answer|found|it|that|this)\b[^.!?\n]{{0,40}}\b{literal}\b|\b{literal}\b[^.!?\n]{{0,20}}\b(?:is\s+the\s+answer|is\s+it|got\s+it|the\s+target)\b"))).unwrap().is_match(text){return found("answer-is-target-value",format!("used the target value {target} as a resolution"))}
    }
    if !safe(text) {
        if let Some(m) = hit("INDEX_CLAIM", text) {
            return found("index-claim", format!("named a board position (\"{m}\")"));
        }
    }
    if let Some(m) = hit("VALUE_CLAIM", text) {
        return found(
            "value-claim",
            format!("asserted a specific value as the resolution (\"{m}\")"),
        );
    }
    if sentences(text)
        .iter()
        .any(|s| pattern("SOLUTION_STEP").is_match(s) && pattern("SOLUTION_JOIN").is_match(s))
    {
        return found(
            "full-solution",
            "gave an ordered list of moves instead of the next one".into(),
        );
    }
    if let Some(m) = hit("FUTURE_LEAK", text) {
        return found("future-leak", format!("narrated a future step (\"{m}\")"));
    }
    if snapshot["phase"] != "won" {
        if let Some(m) = hit("UNEARNED_CORRECTION", text) {
            return found(
                "unearned-correction",
                format!("claimed correctness the engine has not established (\"{m}\")"),
            );
        }
    }
    None
}
fn lower(text: &str) -> String {
    let mut chars = text.chars();
    chars
        .next()
        .map(|c| format!("{}{}", c.to_lowercase(), chars.as_str()))
        .unwrap_or_default()
}
fn rewrite(id: &str, s: &Value) -> String {
    let instruction = trim(s["instruction"].as_str().unwrap_or(""));
    let subject = if !instruction.is_empty() && !instruction.chars().any(|c| c.is_ascii_digit()) {
        lower(instruction)
    } else {
        "look at the values that are still in play, and start from the middle of them".into()
    };
    let total = s["board"].as_array().map_or(0, Vec::len);
    let eliminated = s["eliminated"].as_array().map_or(0, Vec::len);
    let left = total as i64 - eliminated as i64;
    let word = |n: usize| rules().data["NUMBER_WORDS"][n].as_str().unwrap_or("some");
    let window = if total == 0 {
        "Nothing has been ruled out yet, so start from the end you can see.".into()
    } else if left <= 0 {
        "Everything has been ruled out, so go back and re-read your two ends.".into()
    } else if left == 1 {
        "Only one value is still in play.".into()
    } else {
        let line = format!(
            "{} of the {} values are still in play.",
            word(left as usize),
            word(total)
        );
        let mut chars = line.chars();
        format!("{}{}", chars.next().unwrap().to_uppercase(), chars.as_str())
    };
    let raw = s["targetLabel"].as_str().unwrap_or("");
    let clean = raw
        .chars()
        .filter(|c| !c.is_ascii_digit())
        .collect::<String>();
    static SPACES: OnceLock<Regex> = OnceLock::new();
    let clean = SPACES
        .get_or_init(|| Regex::new(&js_spaces(r"\s{2,}")).unwrap())
        .replace_all(&clean, " ");
    let clean = trim(&clean).to_owned();
    static ARTICLE: OnceLock<Regex> = OnceLock::new();
    let target = if clean.is_empty() {
        "the target".into()
    } else if ARTICLE
        .get_or_init(|| Regex::new(r"(?i-u)^(the|a|an|my|your)\b").unwrap())
        .is_match(&clean)
    {
        clean
    } else {
        format!("the {clean}")
    };
    let composed=match id{
 "pasted-code"=>format!("I am not going to paste you the code — reading the finished answer backwards is not the same as deciding. So let us decide instead: {subject}. What would you check first?"),
 "answer-claim"|"answer-is-target-value"|"index-claim"|"value-claim"=>format!("I cannot hand you the answer, and that is the part worth doing yourself. {window} Compare what is left against {target} and tell me which one it sits nearer."),
 "full-solution"=>format!("I will give you the next step, not the whole recipe — a recipe played for you teaches you nothing. So: {subject}. Stop there, tell me what you see, and then we go on."),
 "future-leak"=>format!("Let us stay on the move in front of you, because deciding it is the whole game. {window} What is the first thing you would check?"),
 _=>format!("I will not call that right yet — only {target} and the board get to decide, not me. {window} What do those two numbers tell you?")};
    if violation(&composed, s).is_some() {
        rules().data["SAFE_LAST_RESORT"].as_str().unwrap().into()
    } else {
        composed
    }
}
pub fn screen(reply: &str, snapshot: &Value) -> Value {
    if let Some(v) = violation(reply, snapshot) {
        json!({"ok":false,"redacted":{"reason":format!("{}: {}",v["id"].as_str().unwrap(),v["reason"].as_str().unwrap()),"original":reply},"text":rewrite(v["id"].as_str().unwrap(),snapshot)})
    } else {
        json!({"ok":true,"text":trim(reply)})
    }
}
