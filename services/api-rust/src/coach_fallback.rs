//! Deterministic coaching from visible board facts and the oracle's turn prompt.
use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;
struct Intent {
    name: String,
    weight: usize,
    patterns: Vec<Regex>,
}
fn intents() -> &'static Vec<Intent> {
    static INTENTS: OnceLock<Vec<Intent>> = OnceLock::new();
    INTENTS.get_or_init(|| {
        let data: Value =
            serde_json::from_str(include_str!("../data/coach-fallback.json")).unwrap();
        data["INTENTS"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| Intent {
                name: i["intent"].as_str().unwrap().into(),
                weight: i["weight"].as_u64().unwrap() as usize,
                patterns: i["patterns"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| {
                        Regex::new(&crate::coach_guardrails::js_spaces(
                            p["source"].as_str().unwrap(),
                        ))
                        .unwrap()
                    })
                    .collect(),
            })
            .collect()
    })
}
pub fn classify(question: &str) -> Value {
    let text = question.to_lowercase();
    let mut scores: Vec<_> = intents()
        .iter()
        .map(|i| {
            (
                i.name.as_str(),
                i.weight * i.patterns.iter().filter(|p| p.is_match(&text)).count(),
            )
        })
        .collect();
    scores.sort_by(|a, b| b.1.cmp(&a.1));
    if scores[0].1 == 0 {
        return json!({"intent":"general","confidence":0.2});
    };
    json!({"intent":scores[0].0,"confidence":(0.5+(scores[0].1-scores[1].1) as f64*0.1).min(0.95)})
}
fn number(v: &Value) -> String {
    v.as_f64()
        .filter(|n| n.fract() == 0.0)
        .map(|n| format!("{n:.0}"))
        .unwrap_or_else(|| v.to_string())
}
fn label(s: &Value, index: &Value) -> String {
    let entry = index
        .as_u64()
        .and_then(|i| s["board"].as_array()?.get(i as usize));
    match entry {
        None => "the one you are holding".into(),
        Some(e) => {
            if e["value"].is_null() {
                e["label"].as_str().unwrap_or("").into()
            } else {
                number(&e["value"])
            }
        }
    }
}
fn lower(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|first| format!("{}{}", first.to_lowercase(), c.as_str()))
        .unwrap_or_default()
}
fn article(s: &str) -> String {
    static ARTICLE: OnceLock<Regex> = OnceLock::new();
    let s = crate::compat::trim(s);
    if s.is_empty() {
        "the target".into()
    } else if ARTICLE
        .get_or_init(|| Regex::new(r"(?i-u)^(the|a|an|my|your|this|that)\b").unwrap())
        .is_match(s)
    {
        s.into()
    } else {
        format!("the {s}")
    }
}
fn bounds(s: &Value) -> String {
    let lo = &s["lo"];
    let hi = &s["hi"];
    if lo.is_null() || hi.is_null() {
        "The whole row is still in play".into()
    } else if lo == hi {
        "Only the one value in the middle of the row is still in play".into()
    } else {
        format!(
            "Everything still in play sits between {} and {}",
            number(lo),
            number(hi)
        )
    }
}
fn counts(s: &Value) -> (i64, usize) {
    let total = s["board"].as_array().map_or(0, Vec::len);
    (
        total as i64 - s["eliminated"].as_array().map_or(0, Vec::len) as i64,
        total,
    )
}
fn answers(s: &Value, p: &Value, short: bool) -> std::collections::HashMap<&'static str, String> {
    let mid = &s["mid"];
    let held = (!mid.is_null()).then(|| label(s, mid));
    let target = article(s["targetLabel"].as_str().unwrap_or(""));
    let value = &s["targetValue"];
    let instruction = p["instruction"].as_str().unwrap_or("");
    let reason = p["reason"].as_str().unwrap_or("");
    let b = bounds(s);
    let (left, total) = counts(s);
    let which_value = match &held {
        None => {
            let board = s["board"].as_array();
            let first = board
                .and_then(|b| b.first())
                .and_then(|e| e["label"].as_str())
                .unwrap_or("value");
            let last = board
                .and_then(|b| b.last())
                .and_then(|e| e["label"].as_str())
                .unwrap_or("value");
            format!("There is no single middle yet, so start from an end. Read {first} at one end and {last} at the other, and compare those against {target}.")
        }
        Some(h) => {
            if value.is_null() {
                format!("The one you are holding is {h}. Read it, then decide which way it goes against {target}.")
            } else {
                let lead = if short {
                    format!("{h} is what you are holding.")
                } else {
                    format!("Right now the one you are holding is {h}.")
                };
                let v = number(value);
                format!("{lead} {target} is {v}, so all you have to do is ask yourself: is {h} bigger than {v}, smaller, or exactly equal?")
            }
        }
    };
    let which_half=held.as_ref().map(|h|format!("Only one side of {h} can still hold {target}. {b}, so throw away whichever side {h} is on and keep the other — the side the value is not sitting on. Say which one that is, and we go on.")).unwrap_or_else(||format!("You cannot pick a half until you have read a value. {reason}"));
    let why = if let Some(op) = s["lastMistakeDsaOp"].as_str() {
        let(opener,detail)=match op {"compare"=>("The comparison was the part that went wrong","a comparison is not a guess — hold both values in your head and say which is larger before you touch anything"),"choose-path"=>("The half you kept was the part that went wrong","the value you read decides the half, and reading it carefully costs nothing"),"read"=>("The value you chose to read was the part that went wrong","the middle is a calculation, not a hunch: take the two edges you are left with and halve the distance between them"),"assign"=>("The edge you moved was the part that went wrong","moving an edge is how you throw a half away, so move it to just past what you ruled out"),"terminate"=>("The answer you committed was the part that went wrong","only commit once the window is down to something you can read yourself"),_=>("That move did not land","go back one move and take it again, this time from the values")};
        let steps = s["step"].as_u64().unwrap_or(0);
        let words = [
            "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        ];
        let step = words
            .get(steps as usize)
            .map(|s| (*s).to_owned())
            .unwrap_or_else(|| steps.to_string());
        format!("{opener}: {detail}. You are {step} {} in, and {} of {} not landed — that is information, not failure.",if steps==1{"move"}else{"moves"},number(&s["mistakes"]),if s["mistakes"]==1{"them has"}else{"them have"})
    } else if s["mistakes"] == 0 {
        let where_at = held
            .as_ref()
            .map(|h| format!("You are holding {h} and nothing has gone wrong yet"))
            .unwrap_or_else(|| s["instruction"].as_str().unwrap_or("").into());
        format!("{where_at}. {}", s["instruction"].as_str().unwrap_or(""))
    } else {
        "I cannot see which move you are asking about, so tell me the one just before the screen changed, and we will work out what it should have been.".into()
    };
    let where_at = held
        .as_ref()
        .map(|h| {
            format!("{b}; you are holding {h}, and {left} of {total} values are still in play.")
        })
        .unwrap_or_else(|| format!("{b}, with {left} of {total} values still to play."));
    let what_now = if s["phase"] == "won" {
        format!("You found it, and that is the whole algorithm. {reason} Open the debrief to watch your moves run next to the real code.")
    } else if s["phase"] == "lost" {
        format!("This run is over, so there is no next move to give you. {reason} Undo a step and try that move again, or read the debrief to see the run the algorithm would have played.")
    } else if short {
        format!(
            "{where_at} {} {}",
            crate::compat::trim(instruction),
            crate::compat::trim(reason)
        )
    } else {
        format!(
            "{where_at}\n\nNext: {}\n\nWhy it matters: {}",
            lower(crate::compat::trim(instruction)),
            lower(crate::compat::trim(reason))
        )
    };
    let greeting_where = held
        .as_ref()
        .map(|h| format!("you are holding {h}, and {left} of {total} values are still in play"))
        .unwrap_or_else(|| {
            "nothing has been looked at yet, so the whole row is still in play".into()
        });
    let greeting = format!(
        "Hello! Ask me anything about the board. Right now {greeting_where}. {}",
        lower(s["instruction"].as_str().unwrap_or(""))
    );
    let mut general =
        format!("Here is where you are: {b}, with {left} of {total} values still in play.");
    if let Some(h) = held.filter(|_| !value.is_null()) {
        general.push_str(&format!(
            " The one you are holding is {h}, and {target} is {}.",
            number(value)
        ))
    }
    general.push_str(&format!(
        " That comparison is the only thing that decides your next move, so start there. {}",
        lower(reason)
    ));
    std::collections::HashMap::from([
        ("which-value", which_value),
        ("which-half", which_half),
        ("why-wrong", why),
        ("what-now", what_now),
        ("greeting", greeting),
        ("general", general),
    ])
}
pub fn answer(
    question: &str,
    snapshot: &Value,
    prompt: &Value,
    band: Option<&str>,
    given: &[String],
) -> Value {
    let classification = classify(question);
    let intent = classification["intent"].as_str().unwrap();
    let answers = answers(snapshot, prompt, band == Some("newcomer"));
    let norm = |s: &str| {
        static SPACE: OnceLock<Regex> = OnceLock::new();
        let lower = s.to_lowercase();
        let text = SPACE
            .get_or_init(|| Regex::new(&crate::coach_guardrails::js_spaces(r"\s+")).unwrap())
            .replace_all(&lower, " ");
        crate::compat::trim(&text).to_owned()
    };
    let mut order = Vec::new();
    if intent != "general" {
        order.push(intent)
    }
    order.extend([
        "what-now",
        "which-value",
        "which-half",
        "why-wrong",
        "greeting",
        "general",
    ]);
    let text = order
        .into_iter()
        .map(|i| &answers[i])
        .find(|text| {
            !crate::compat::trim(text).is_empty()
                && !given.iter().any(|h| {
                    let a = norm(h);
                    let b = norm(text);
                    a == b || a.contains(&b) || b.contains(&a)
                })
        })
        .unwrap_or(&answers["general"]);
    let screened = crate::coach_guardrails::screen(text, snapshot);
    json!({"text":if screened["ok"]==true{screened["text"].clone()}else{json!(text)},"intent":intent,"confidence":classification["confidence"]})
}
