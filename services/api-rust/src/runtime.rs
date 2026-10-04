//! Engine-owned progress, replay integrity and deterministic debriefs.
use serde_json::{json, Map, Value};

/// Restore the board while retaining the cumulative learning ledger.
pub fn rewind(current: &Value, snapshot: &Value) -> Value {
    let mut restored = snapshot.clone();
    for field in ["steps", "mistakes", "mistakesByMechanic"] {
        restored["progress"][field] = current["progress"][field].clone();
    }
    if current["progress"]["hintsUsed"].as_f64().unwrap_or(0.0)
        >= snapshot["progress"]["hintsUsed"].as_f64().unwrap_or(0.0)
    {
        restored["progress"]["hintsUsed"] = current["progress"]["hintsUsed"].clone();
    }
    restored
}
const ACTIONS: [&str; 10] = [
    "selectObject",
    "moveObject",
    "comparePair",
    "swapPair",
    "pushPop",
    "choosePath",
    "traverseNode",
    "connectNodes",
    "assignValue",
    "submitAnswer",
];
const OPS: [&str; 10] = [
    "read",
    "move",
    "compare",
    "swap",
    "push",
    "choose-path",
    "traverse",
    "link",
    "assign",
    "terminate",
];
pub fn op(kind: &str) -> &'static str {
    ACTIONS
        .iter()
        .position(|a| *a == kind)
        .map(|i| OPS[i])
        .unwrap_or("read")
}
fn valid_op(v: &Value) -> bool {
    v.as_str().is_some_and(|v| OPS.contains(&v) || v == "pop")
}
fn count(v: &Value) -> u64 {
    v.as_f64()
        .filter(|v| *v > 0.0)
        .map(|v| v.floor() as u64)
        .unwrap_or(0)
}
fn map(v: &Value, predicate: fn(&Value) -> bool) -> Value {
    let mut out = Map::new();
    if let Some(m) = v.as_object() {
        let mut keys: Vec<_> = m.keys().collect();
        keys.sort();
        for key in keys {
            if predicate(&m[key]) {
                out.insert(key.clone(), m[key].clone());
            }
        }
    }
    Value::Object(out)
}
fn scalar(v: &Value) -> bool {
    v.is_null() || v.is_string() || v.is_number() || v.is_boolean()
}
fn array(v: &Value, predicate: fn(&Value) -> bool) -> Value {
    json!(v
        .as_array()
        .map(|a| a
            .iter()
            .filter(|v| predicate(v))
            .cloned()
            .collect::<Vec<_>>())
        .unwrap_or_default())
}
fn cursor(v: &Value) -> Value {
    let mut out = json!({});
    for key in [
        "nodeId",
        "prevNodeId",
        "loSlotId",
        "midSlotId",
        "hiSlotId",
        "iSlotId",
        "jSlotId",
        "bestObjectId",
    ] {
        if v[key].as_str().is_some_and(|s| !s.is_empty()) {
            out[key] = v[key].clone();
        }
    }
    out
}
fn progress(v: &Value) -> Value {
    json!({"steps":count(&v["steps"]),"mistakes":count(&v["mistakes"]),"hintsUsed":count(&v["hintsUsed"]),"mistakesByMechanic":map(&v["mistakesByMechanic"],Value::is_number)})
}
pub fn coerce(s: &Value) -> Value {
    let instance = s
        .get("instance")
        .cloned()
        .unwrap_or_else(|| json!({"problemId":"unknown","seed":0,"values":[],"slots":[]}));
    json!({"problemId":s["problemId"].as_str().filter(|s|!s.is_empty()).unwrap_or("unknown"),"seed":s["seed"].as_f64().map(|_|s["seed"].clone()).unwrap_or(json!(0)),"instance":instance,"objects":map(&s["objects"],Value::is_object),"slots":map(&s["slots"],Value::is_object),"containers":map(&s["containers"],Value::is_object),"links":array(&s["links"],Value::is_object),"selection":array(&s["selection"],Value::is_string),"cursor":cursor(&s["cursor"]),"variables":map(&s["variables"],scalar),"progress":progress(&s["progress"]),"phase":s["phase"].as_str().filter(|s|["won","lost","playing"].contains(s)).unwrap_or("playing"),"trace":array(&s["trace"],Value::is_object),"internal":map(&s["internal"],scalar)})
}
pub fn init(id: &str, seed: f64, difficulty: &str) -> Option<Value> {
    let instance = crate::instances::build(id, seed, difficulty, None)?;
    Some(coerce(&crate::oracle_plan::init(instance)))
}
fn pointers(v: &Value) -> Value {
    let mut out = json!({});
    if v["current"].is_string() {
        out["current"] = v["current"].clone();
    }
    for key in ["compare", "eliminated", "swapped", "read"] {
        let ids = array(&v[key], Value::is_string);
        if !ids.as_array().unwrap().is_empty() {
            out[key] = ids;
        }
    }
    out
}
fn normalize_frame(id: &str, f: &Value, index: usize, action: &Value) -> Value {
    let code = f["codeLine"]
        .as_f64()
        .filter(|n| *n > 0.0 && n.fract() == 0.0)
        .map(|n| n as usize)
        .unwrap_or(1);
    let meta = crate::oracle_metadata::get(id);
    let text = f["codeLineText"]
        .as_str()
        .filter(|s| !crate::compat::trim(s).is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            meta["pseudocode"]
                .get(code - 1)
                .or_else(|| meta["code"]["javascript"].get(code - 1))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| format!("// line {code}"))
        });
    json!({"index":index,"action":f.get("action").unwrap_or(action),"codeLine":code,"codeLineText":text,"variables":map(&f["variables"],scalar),"pointers":pointers(&f["pointers"]),"dsaOp":if valid_op(&f["dsaOp"]){f["dsaOp"].clone()}else{json!(op(action["type"].as_str().unwrap_or("")))},"correct":f["correct"]==true,"note":f["note"].as_str().unwrap_or("")})
}
fn rejected(mut s: Value, kind: &str, feedback: String, warnings: Vec<String>) -> Value {
    let idx = s["trace"].as_array().unwrap().len();
    s["progress"]["steps"] = json!(count(&s["progress"]["steps"]) + 1);
    json!({"state":s,"outcome":{"correct":false,"feedback":feedback,"dsaOp":op(kind),"traceStep":idx,"illegal":true},"warnings":warnings})
}
pub fn apply(s: &Value, a: &Value) -> Value {
    let input = coerce(s);
    let kind = a["type"].as_str().unwrap_or("");
    if !ACTIONS.contains(&kind) {
        let description = if a["type"].is_string() {
            a["type"].to_string()
        } else if a.get("type").is_none() {
            "undefined".into()
        } else {
            match &a["type"] {
                Value::Null | Value::Object(_) | Value::Array(_) => "object",
                Value::Bool(_) => "boolean",
                _ => "number",
            }
            .into()
        };
        return rejected(input,"",format!("The game could not process that move, so nothing changed. (unknown action type: {description})"),vec![format!("oracle.applyAction was not called: unknown action type {description} is not in the mechanic catalog")]);
    }
    let id = input["problemId"].as_str().unwrap().to_owned();
    let returned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::oracle_plan::apply(&input, a)
    }));
    let result =
        match returned {
            Ok(v) => v,
            Err(_) => return rejected(
                input,
                kind,
                "The game could not process that move, so nothing changed. unknown oracle error"
                    .into(),
                vec![format!(
                    "oracle \"{id}\" threw while applying {kind}: unknown oracle error"
                )],
            ),
        };
    let mut next = coerce(&result["nextState"]);
    let mut outcome = result["outcome"].clone();
    let before = input["trace"].as_array().unwrap();
    let appended = next["trace"].as_array().unwrap().len() as i64 - before.len() as i64;
    let mut warnings = vec![];
    let f = if appended >= 1 {
        normalize_frame(
            &id,
            next["trace"].as_array().unwrap().last().unwrap(),
            before.len(),
            a,
        )
    } else {
        let text = crate::oracle_metadata::get(&id)["pseudocode"][0]
            .as_str()
            .unwrap_or("");
        json!({"index":before.len(),"action":a,"codeLine":1,"codeLineText":text,"variables":next["variables"],"pointers":{},"dsaOp":op(kind),"correct":true,"note":"engine-synthesised frame: the oracle did not record this move"})
    };
    if appended < 1 {
        warnings.push(format!("oracle appended {appended} trace frames; the engine synthesised 1 so the replay stays valid"));
    } else if appended > 1 {
        warnings.push(format!("oracle appended {appended} trace frames; the engine kept the last 1 for replay integrity"));
    }
    let illegal = outcome["illegal"] == true;
    outcome["illegal"] = json!(illegal);
    if !outcome["won"].is_boolean() {
        outcome["won"] = json!(next["phase"] == "won");
    }
    outcome["traceStep"] = json!(before.len());
    let mut trace = before.clone();
    if !illegal {
        trace.push(f);
    }
    next["trace"] = json!(trace);
    let mut p = input["progress"].clone();
    p["steps"] = json!(count(&p["steps"]) + 1);
    if outcome["correct"] != true && !illegal {
        p["mistakes"] = json!(count(&p["mistakes"]) + 1);
        p["mistakesByMechanic"][kind] =
            json!(p["mistakesByMechanic"][kind].as_f64().unwrap_or(0.0) + 1.0);
        if let Some(v) = p["mistakesByMechanic"][kind]
            .as_f64()
            .filter(|v| v.fract() == 0.0)
        {
            p["mistakesByMechanic"][kind] = json!(v as i64);
        }
    }
    next["progress"] = p;
    json!({"state":next,"outcome":outcome,"warnings":warnings})
}
pub fn canonical(s: &Value, played: Option<&[Value]>) -> Value {
    match s["problemId"].as_str().unwrap() {
        "binary-search" => crate::oracle_binary::canonical(s, played),
        "array-max-min" => crate::oracle_extreme::canonical(s),
        id if crate::oracle_sort::supports(id) => crate::oracle_sort::canonical(s),
        _ => crate::oracle_plan::canonical(s["instance"].clone()),
    }
}
fn bump(v: &mut Value, key: &str) {
    v[key] = json!(v[key].as_u64().unwrap_or(0) + 1);
}
fn algorithm_steps(trace: &[Value]) -> usize {
    trace
        .iter()
        .filter(|f| f["action"]["type"] != "submitAnswer" && f["dsaOp"] != "terminate")
        .count()
}
pub(crate) fn efficiency(played: &[Value], reference: &[Value]) -> Value {
    let used = algorithm_steps(played);
    let optimal = algorithm_steps(reference);
    if optimal == 0 {
        return json!({"score":1,"ratio":0,"note":format!("The oracle produced no reference steps, so this {used}-step run cannot be compared for efficiency.")});
    }
    let ratio = ((used as f64 / optimal as f64) * 1000.0).round() / 1000.0;
    let score = if used <= optimal {
        1.0
    } else {
        ((1.0 / ratio) * 1000.0).round() / 1000.0
    };
    let band = if ratio <= 1.0 {
        "That is exactly the optimal line."
    } else if ratio <= 1.25 {
        "Very close to optimal."
    } else if ratio <= 1.5 {
        "A few steps were wasted."
    } else if ratio <= 2.0 {
        "Noticeably longer than it needed to be."
    } else {
        "Far longer than the algorithm requires."
    };
    let note = if used == optimal {
        band.into()
    } else {
        format!(
            "{band} You took {used} step{}; the reference line needs {optimal} step{}.",
            if used == 1 { "" } else { "s" },
            if optimal == 1 { "" } else { "s" }
        )
    };
    let numeric = |n: f64| {
        if n.fract() == 0.0 {
            json!(n as i64)
        } else {
            json!(n)
        }
    };
    json!({"score":numeric(score),"ratio":numeric(ratio),"note":note})
}
const TERMS: [(&str, &str); 10] = [
    ("the element you picked", "a read of one element"),
    (
        "moving an element to a new position",
        "a write into an array cell",
    ),
    (
        "comparing two values",
        "a comparison that decides which branch comes next",
    ),
    ("exchanging two elements", "a swap of two elements"),
    (
        "adding to / removing from a structure",
        "a push or a pop (last in, first out)",
    ),
    (
        "choosing which part of the space to keep",
        "discarding part of the search space",
    ),
    (
        "moving to the next node",
        "advancing a pointer: current = current.next",
    ),
    (
        "wiring two nodes together",
        "assigning a next / prev pointer",
    ),
    ("writing a value down", "a variable assignment"),
    (
        "committing the final answer",
        "returning a result / terminating",
    ),
];
pub(crate) fn action_mappings(trace: &[Value]) -> Value {
    let mut used = Vec::new();
    for frame in trace {
        if let Some(index) = ACTIONS.iter().position(|a| frame["action"]["type"] == *a) {
            if !used.contains(&index) {
                used.push(index);
            }
        }
    }
    json!(used
        .into_iter()
        .map(|i| json!({"gameTerm":TERMS[i].0,"algorithmTerm":TERMS[i].1}))
        .collect::<Vec<_>>())
}
pub fn debrief(s: &Value) -> Value {
    let safe = coerce(s);
    let played = safe["trace"].as_array().unwrap();
    let reference = canonical(&safe, Some(played));
    let mut analysis = json!({"total":0,"byMechanic":{},"byDsaOp":{},"firstMistakeAt":null});
    let mut highlights = std::collections::BTreeSet::new();
    let mut used = vec![];
    for (position, f) in played.iter().enumerate() {
        let kind = f["action"]["type"].as_str().unwrap_or("");
        let mechanic = ACTIONS.iter().position(|a| *a == kind);
        if let Some(index) = mechanic {
            if !used.contains(&index) {
                used.push(index);
            }
        }
        if let Some(line) = f["codeLine"]
            .as_f64()
            .filter(|v| *v > 0.0 && v.fract() == 0.0)
        {
            highlights.insert(line as u64);
        }
        if f["correct"] != false {
            continue;
        }
        let total = analysis["total"].as_u64().unwrap() + 1;
        analysis["total"] = json!(total);
        if analysis["firstMistakeAt"].is_null() {
            analysis["firstMistakeAt"] = f
                .get("index")
                .filter(|v| v.is_number())
                .cloned()
                .unwrap_or(json!(position));
        }
        if mechanic.is_some() {
            bump(&mut analysis["byMechanic"], kind);
        }
        if valid_op(&f["dsaOp"]) {
            bump(&mut analysis["byDsaOp"], f["dsaOp"].as_str().unwrap());
        } else if mechanic.is_some() {
            bump(&mut analysis["byDsaOp"], op(kind));
        }
    }
    let id = safe["problemId"].as_str().unwrap();
    let mut answer = crate::oracle_plan::answer(&safe);
    if !answer["details"].is_array() {
        answer["details"] = json!([]);
    }
    let mappings: Vec<_> = used
        .into_iter()
        .map(|i| json!({"gameTerm":TERMS[i].0,"algorithmTerm":TERMS[i].1}))
        .collect();
    json!({"problemId":id,"phase":if safe["phase"]=="won"{"won"}else{"lost"},"playedTrace":played,"canonicalTrace":reference,"answer":answer,"pseudocode":crate::oracle_plan::pseudocode(id),"code":{"javascript":crate::oracle_plan::code(id,"javascript"),"python":crate::oracle_plan::code(id,"python"),"typescript":crate::oracle_plan::code(id,"typescript")},"complexity":crate::oracle_plan::complexity(id),"stats":{"steps":safe["progress"]["steps"],"mistakes":safe["progress"]["mistakes"],"hintsUsed":safe["progress"]["hintsUsed"],"mistakesByMechanic":safe["progress"]["mistakesByMechanic"],"mistakeAnalysis":analysis,"optimisation":efficiency(played,reference.as_array().unwrap()),"codeHighlights":highlights.into_iter().collect::<Vec<_>>(),"actionMapping":mappings}})
}
