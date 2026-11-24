//! Stateful sorts preserve physical occupants and wrong-but-legal comparisons.
use serde_json::{json, Value};
pub fn supports(id: &str) -> bool {
    ["bubble-sort", "selection-sort"].contains(&id)
}
fn selection(s: &Value) -> bool {
    s["problemId"] == "selection-sort"
}
fn num(v: &Value, f: i64) -> i64 {
    v.as_i64().unwrap_or(f)
}
fn oid(i: i64) -> String {
    format!("v{i}")
}
fn occupant(s: &Value, i: i64) -> String {
    s["slots"][format!("s{i}")]["occupantId"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| oid(i))
}
fn val(s: &Value, i: i64) -> Value {
    s["objects"][occupant(s, i)]["value"].clone()
}
fn textval(s: &Value, i: i64) -> String {
    let v = val(s, i);
    if v.is_null() {
        "NaN".into()
    } else {
        v.to_string()
    }
}
fn internal(s: &Value) -> Value {
    let r = &s["internal"];
    let awaiting = r["awaiting"]
        .as_str()
        .filter(|v| ["select", "compare", "swap", "commit"].contains(v))
        .unwrap_or("select");
    json!({"pass":num(&r["pass"],0),"j":num(&r["j"],0),"min":num(&r["min"],0),"anchor":num(&r["anchor"],0),"awaiting":awaiting,"a":num(&r["a"],0),"b":num(&r["b"],1),"comparisons":num(&r["comparisons"],0),"swaps":num(&r["swaps"],0),"wrong":num(&r["wrong"],0),"answerValue":r["answerValue"].as_str().unwrap_or(""),"terminated":r["terminated"]==true})
}
fn pair(s: &Value, i: &Value) -> (i64, i64) {
    let j = num(&i["j"], 0);
    (
        j,
        if selection(s) {
            num(&i["min"], 0)
        } else {
            j + 1
        },
    )
}
pub fn setup(s: &mut Value) {
    let n = s["instance"]["values"].as_array().unwrap().len();
    let j = if selection(s) { 1 } else { 0 };
    s["variables"] = json!({"pass":0,"j":0,"min":0,"comparisons":0,"swaps":0,"steps":0,"n":n});
    s["cursor"] = json!({"jSlotId":"s0"});
    s["internal"] = json!({"pass":0,"j":j,"min":0,"anchor":0,"awaiting":"select","a":j,"b":if selection(s){0}else{1},"comparisons":0,"swaps":0,"wrong":0,"answerValue":"","terminated":false});
}
fn vars(s: &Value, i: &Value) -> Value {
    let j = num(&i["j"], 0);
    json!({"pass":i["pass"],"j":j,"min":i["min"],"comparisons":i["comparisons"],"swaps":i["swaps"],"steps":s["progress"]["steps"],"n":s["instance"]["values"].as_array().unwrap().len(),"a_j":val(s,j),"a_next":val(s,j+1)})
}
fn sync(s: &mut Value, i: &Value) {
    let n = s["instance"]["values"].as_array().unwrap().len() as i64;
    let cut = (n - 1 - num(&i["pass"], 0)).max(0);
    for k in 0..n {
        let state = if k >= cut && i["awaiting"] == "commit" {
            "matched"
        } else {
            "idle"
        };
        s["slots"][format!("s{k}")]["state"] = json!(state);
        s["objects"][oid(k)]["state"] = json!(state);
    }
    s["cursor"] = json!({});
    if num(&i["j"], 0) < n {
        s["cursor"]["jSlotId"] = json!(format!("s{}", i["j"]));
    }
    s["variables"] = json!({"pass":i["pass"],"j":i["j"],"min":i["min"],"comparisons":i["comparisons"],"swaps":i["swaps"],"steps":s["progress"]["steps"],"n":n});
}
fn advance(s: &Value, i: &mut Value) -> bool {
    let n = s["instance"]["values"].as_array().unwrap().len() as i64;
    let limit = if selection(s) {
        n
    } else {
        (n - 1 - num(&i["pass"], 0)).max(0)
    };
    if num(&i["j"], 0) + 1 < limit {
        i["j"] = json!(num(&i["j"], 0) + 1);
        true
    } else {
        false
    }
}
fn finish_pass(s: &Value, i: &mut Value) {
    let n = s["instance"]["values"].as_array().unwrap().len() as i64;
    let pass = num(&i["pass"], 0) + 1;
    i["pass"] = json!(pass);
    i["anchor"] = json!(pass);
    i["j"] = json!(if selection(s) { pass + 1 } else { 0 });
    i["min"] = json!(pass);
    i["awaiting"] = json!(if pass >= (n - 1).max(0) {
        "commit"
    } else {
        "select"
    });
}
fn rel(a: i64, b: i64) -> &'static str {
    if a > b {
        "gt"
    } else if a < b {
        "lt"
    } else {
        "eq"
    }
}
fn word(r: &str) -> &'static str {
    match r {
        "eq" => "the same as",
        "gt" => "larger than",
        _ => "smaller than",
    }
}
fn frame(s: &mut Value, i: &Value, a: &Value, spec: (usize, &str, bool, String, Value)) {
    let (line, op, correct, note, pointers) = spec;
    let idx = s["trace"].as_array().unwrap().len();
    let listing =
        &crate::oracle_metadata::get(s["problemId"].as_str().unwrap())["code"]["javascript"];
    let variables = vars(s, i);
    s["trace"].as_array_mut().unwrap().push(json!({"index":idx,"action":a,"codeLine":line,"codeLineText":listing[line-1],"variables":variables,"pointers":pointers,"dsaOp":op,"correct":correct,"note":note}));
}
fn reject(s: &Value, a: &Value, i: &Value, spec: (usize, &str, String, String)) -> Value {
    let (line, op, feedback, note) = spec;
    let mut next = s.clone();
    next["progress"]["steps"] = json!(num(&next["progress"]["steps"], 0) + 1);
    frame(&mut next, i, a, (line, op, false, note, json!({})));
    let idx = next["trace"].as_array().unwrap().len() - 1;
    json!({"nextState":next,"outcome":{"correct":false,"illegal":true,"feedback":feedback,"dsaOp":op,"traceStep":idx}})
}
pub fn legal(s: &Value) -> Value {
    let i = internal(s);
    if i["terminated"] == true || i["awaiting"] == "commit" {
        return json!([{"type":"submitAnswer","label":"Report the order of the array","expects":"value"}]);
    }
    if i["awaiting"] == "swap" {
        return json!([{"type":"swapPair","label":"Exchange the two cells that are the wrong way round","options":{"objectIds":[oid(num(&i["a"],0)),oid(num(&i["b"],1))]}}]);
    }
    let (a, b) = pair(s, &i);
    if i["awaiting"] == "compare" {
        return json!([{"type":"comparePair","label":"Which of the two is larger?","options":{"objectIds":[oid(a),oid(b)]},"expects":"relation"}]);
    }
    json!([{"type":"selectObject","label":"Read the next cell","options":{"objectIds":[oid(a)]}}])
}
pub fn apply(s: &Value, a: &Value) -> Value {
    let mut i = internal(s);
    let mut next = s.clone();
    let t = a["type"].as_str().unwrap();
    let line;
    let op;
    let note;
    let feedback;
    let pointers;
    let mut correct = true;
    let mut expected = None;
    let mut won = None;
    match t {
        "selectObject" => {
            op = "read";
            let id = a["objectId"].as_str().unwrap();
            if s["objects"].get(id).is_none() {
                return reject(
                    s,
                    a,
                    &i,
                    (
                        1,
                        op,
                        "That is not on the board.".into(),
                        "rejected: unknown objectId".into(),
                    ),
                );
            }
            if i["terminated"] == true || i["awaiting"] != "select" {
                return reject(
                    s,
                    a,
                    &i,
                    (
                        1,
                        op,
                        "That cell is not the one the sort is looking at right now.".into(),
                        "rejected: select out of turn".into(),
                    ),
                );
            }
            let (pa, _) = pair(s, &i);
            let position = s["slots"]
                .as_object()
                .unwrap()
                .values()
                .find(|v| v["occupantId"] == id)
                .map(|v| num(&v["index"], -1))
                .unwrap_or_else(|| num(&s["objects"][id]["tags"]["index"], -1));
            if position != pa {
                return reject(
                    s,
                    a,
                    &i,
                    (
                        3,
                        op,
                        format!("The inner walk reads cell {pa} next."),
                        format!("rejected: expected cell {pa}"),
                    ),
                );
            }
            i["awaiting"] = json!("compare");
            next["objects"][oid(position)]["state"] = json!("current");
            next["selection"] = json!([occupant(&next, pa)]);
            sync(&mut next, &i);
            line = 3;
            note = format!("a[{position}] = {}", textval(&next, position));
            feedback = format!(
                "Cell {position} holds {}. Compare it with the cell it is checked against.",
                textval(&next, position)
            );
            pointers =
                json!({"current":occupant(&next,position),"read":[occupant(&next,position)]});
        }
        "comparePair" => {
            op = "compare";
            if i["awaiting"] != "compare" {
                return reject(
                    s,
                    a,
                    &i,
                    (
                        1,
                        op,
                        "Choose the cell the sort is looking at before comparing.".into(),
                        "rejected: compare out of turn".into(),
                    ),
                );
            }
            let (pa, pb) = pair(s, &i);
            let aid = occupant(s, pa);
            let bid = occupant(s, pb);
            if ![&a["aId"], &a["bId"]].iter().any(|v| **v == aid)
                || ![&a["aId"], &a["bId"]].iter().any(|v| **v == bid)
            {
                return reject(
                    s,
                    a,
                    &i,
                    (
                        1,
                        op,
                        "Compare the two cells this step checks, nothing else.".into(),
                        "rejected: comparePair is not the expected pair".into(),
                    ),
                );
            }
            let av = num(&val(&next, pa), 0);
            let bv = num(&val(&next, pb), 0);
            let truth = rel(av, bv);
            correct = a["relation"] == truth;
            next["selection"] = json!([aid, bid]);
            if !correct {
                next["progress"]["mistakes"] = json!(num(&next["progress"]["mistakes"], 0) + 1);
                next["progress"]["mistakesByMechanic"][t] =
                    json!(num(&next["progress"]["mistakesByMechanic"][t], 0) + 1);
                i["wrong"] = json!(num(&i["wrong"], 0) + 1);
                sync(&mut next, &i);
                line = 4;
                note = format!(
                    "declared {}, the truth is {truth}",
                    a["relation"].as_str().unwrap()
                );
                feedback = format!(
                    "Cell {pa} holds {av} and cell {pb} holds {bv}: {av} is {} than {bv}.",
                    word(truth)
                );
                expected = Some(json!({"type":t,"aId":aid,"bId":bid,"relation":truth}));
                pointers = json!({"current":aid,"compare":[aid,bid]});
            } else {
                i["comparisons"] = json!(num(&i["comparisons"], 0) + 1);
                if selection(s) {
                    if truth == "lt" {
                        i["min"] = json!(pa);
                    }
                    let more = advance(s, &mut i);
                    if more {
                        i["awaiting"] = json!("select");
                    } else if i["min"] != i["anchor"] {
                        i["anchor"] = i["pass"].clone();
                        i["awaiting"] = json!("swap");
                        i["a"] = i["anchor"].clone();
                        i["b"] = i["min"].clone();
                    } else {
                        finish_pass(s, &mut i);
                    }
                    next["objects"][&aid]["state"] = json!("visited");
                    sync(&mut next, &i);
                    line = 4;
                    note = format!(
                        "{av} vs {bv} -> {truth}; running minimum is now cell {}",
                        i["min"]
                    );
                    feedback = if more {
                        format!("Cell {pa} holds {av}, which is {} than cell {pb}. The running minimum is cell {}.",word(truth),i["min"])
                    } else {
                        format!("That is the last comparison of the pass. The smallest of the unsorted cells is {}.",i["min"])
                    };
                } else {
                    let bad = truth == "gt";
                    if bad {
                        i["awaiting"] = json!("swap");
                        i["a"] = json!(pa);
                        i["b"] = json!(pb);
                    } else if advance(s, &mut i) {
                        i["awaiting"] = json!("select");
                    } else {
                        finish_pass(s, &mut i);
                    }
                    next["objects"][&aid]["state"] =
                        json!(if bad { "selected" } else { "visited" });
                    sync(&mut next, &i);
                    line = if bad { 4 } else { 3 };
                    note = if bad {
                        format!("{av} > {bv}: out of order, swap them")
                    } else {
                        format!("{av} <= {bv}: in order, move on")
                    };
                    feedback = if bad {
                        format!("{av} comes before {bv}, so the two are the wrong way round. Exchange them.")
                    } else {
                        format!("{av} and {bv} are already the right way round. Move on.")
                    };
                }
                pointers = json!({"current":aid,"compare":[aid,bid],"read":[aid]});
            }
        }
        "swapPair" => {
            op = "swap";
            if i["awaiting"] != "swap" {
                return reject(
                    s,
                    a,
                    &i,
                    (
                        1,
                        op,
                        "Nothing is out of order at this step.".into(),
                        "rejected: swap out of turn".into(),
                    ),
                );
            }
            let pa = num(&i["a"], 0);
            let pb = num(&i["b"], 1);
            let aid = occupant(s, pa);
            let bid = occupant(s, pb);
            if ![&a["aId"], &a["bId"]].iter().any(|v| **v == aid)
                || ![&a["aId"], &a["bId"]].iter().any(|v| **v == bid)
            {
                return reject(
                    s,
                    a,
                    &i,
                    (
                        1,
                        op,
                        "Exchange the two cells this step flagged, nothing else.".into(),
                        "rejected: swapPair is not the expected pair".into(),
                    ),
                );
            }
            let before = format!("{}, {}", textval(&next, pa), textval(&next, pb));
            let sa = format!("s{pa}");
            let sb = format!("s{pb}");
            next["slots"][&sa]["occupantId"] = json!(bid);
            next["slots"][&sb]["occupantId"] = json!(aid);
            next["objects"][&aid]["slotId"] = json!(sb);
            next["objects"][&bid]["slotId"] = json!(sa);
            i["swaps"] = json!(num(&i["swaps"], 0) + 1);
            for k in [pa, pb] {
                next["objects"][oid(k)]["state"] = json!("swapped");
            }
            if advance(s, &mut i) {
                i["awaiting"] = json!("select");
            } else {
                finish_pass(s, &mut i);
            }
            next["selection"] = json!([]);
            sync(&mut next, &i);
            line = 6;
            note = format!(
                "swapped {before} -> {}, {}",
                textval(&next, pa),
                textval(&next, pb)
            );
            feedback = format!(
                "Exchanged. Cells {pa} and {pb} now hold {} and {}.",
                textval(&next, pa),
                textval(&next, pb)
            );
            pointers = json!({"compare":[aid,bid]});
        }
        "submitAnswer" => {
            op = "terminate";
            let raw = crate::compat::trim(a["value"].as_str().unwrap()).to_lowercase();
            if !["sorted", "ascending", "in order", "0"].contains(&raw.as_str()) {
                return reject(s,a,&i,(1,op,"The array has a single question left: is it in order? Answer \"sorted\" or \"not sorted\".".into(),"rejected: malformed submitAnswer".into()));
            }
            i["answerValue"] = json!(raw);
            i["terminated"] = json!(true);
            let n = s["slots"].as_object().unwrap().len() as i64;
            let sorted = (1..n).all(|k| num(&val(&next, k - 1), 0) <= num(&val(&next, k), 0));
            next["phase"] = json!(if sorted { "won" } else { "lost" });
            if !sorted {
                next["progress"]["mistakes"] = json!(num(&next["progress"]["mistakes"], 0) + 1);
            }
            sync(&mut next, &i);
            line = 10;
            note = if sorted {
                format!(
                    "sorted in {} comparisons and {} swaps",
                    i["comparisons"], i["swaps"]
                )
            } else {
                "the array is not in order".into()
            };
            feedback = if sorted {
                format!(
                    "Correct — the array is in order after {} comparisons and {} swaps.",
                    i["comparisons"], i["swaps"]
                )
            } else {
                "The array is not in order yet, so there is nothing to report. Keep sorting.".into()
            };
            won = Some(sorted);
            pointers = json!({"read":["v0"]});
        }
        _ => {
            return reject(
                s,
                a,
                &i,
                (
                    1,
                    "read",
                    "That move is not part of a sort.".into(),
                    format!("rejected: {t} is not used by this problem"),
                ),
            )
        }
    }
    next["progress"]["steps"] = json!(num(&next["progress"]["steps"], 0) + 1);
    frame(&mut next, &i, a, (line, op, correct, note, pointers));
    next["internal"] = i;
    let mut outcome = json!({"correct":correct,"feedback":feedback,"dsaOp":op,"traceStep":next["trace"].as_array().unwrap().len()-1});
    if let Some(v) = expected {
        outcome["expected"] = v;
    }
    if let Some(v) = won {
        outcome["won"] = json!(v);
    }
    json!({"nextState":next,"outcome":outcome})
}
pub fn answer(s: &Value) -> Value {
    let i = internal(s);
    json!({"text":"sorted, ascending","value":"sorted","details":[{"label":"comparisons","value":i["comparisons"]},{"label":"swaps","value":i["swaps"]},{"label":"array length","value":s["instance"]["values"].as_array().unwrap().len()}]})
}
pub fn canonical(s: &Value) -> Value {
    let mut values: Vec<_> = s["instance"]["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    let n = values.len();
    let mut occupants: Vec<_> = (0..n).map(|i| oid(i as i64)).collect();
    let (mut comparisons, mut swaps) = (0, 0);
    let mut eliminated = vec![];
    let mut frames = vec![];
    let listing =
        &crate::oracle_metadata::get(s["problemId"].as_str().unwrap())["code"]["javascript"];
    let emit = |frames: &mut Vec<Value>,
                values: &[i64],
                pass: usize,
                j: usize,
                min: usize,
                comparisons: usize,
                swaps: usize,
                action: Value,
                line: usize,
                pointers: Value,
                op: &str,
                note: String| {
        let vars = json!({"pass":pass,"j":j,"min":min,"comparisons":comparisons,"swaps":swaps,"steps":frames.len(),"n":n,"a_j":values.get(j).copied().unwrap_or(0),"a_next":values.get(j+1).copied().unwrap_or(0)});
        frames.push(json!({"index":frames.len(),"action":action,"codeLine":line,"codeLineText":listing[line-1],"variables":vars,"pointers":pointers,"dsaOp":op,"correct":true,"note":note}));
    };
    for pass in 0..n - 1 {
        let mut min = if selection(s) { pass } else { 0 };
        let range = if selection(s) {
            pass + 1..n
        } else {
            0..n - 1 - pass
        };
        for j in range {
            let a = j;
            let b = if selection(s) { min } else { j + 1 };
            let aid = occupants[a].clone();
            let bid = occupants[b].clone();
            let relation = rel(values[a], values[b]);
            emit(
                &mut frames,
                &values,
                pass,
                j,
                min,
                comparisons,
                swaps,
                json!({"type":"selectObject","objectId":aid}),
                3,
                json!({"current":aid,"read":[aid],"eliminated":eliminated}),
                "read",
                format!("a[{a}] = {}", values[a]),
            );
            comparisons += 1;
            let mut ptr = json!({"current":aid,"compare":[aid,bid],"eliminated":eliminated});
            if !selection(s) {
                ptr["read"] = json!([aid]);
            }
            emit(
                &mut frames,
                &values,
                pass,
                j,
                min,
                comparisons,
                swaps,
                json!({"type":"comparePair","aId":aid,"bId":bid,"relation":relation}),
                4,
                ptr,
                "compare",
                format!(
                    "a[{a}] = {} vs a[{b}] = {} -> {relation}",
                    values[a], values[b]
                ),
            );
            if selection(s) {
                if relation == "lt" {
                    min = a;
                }
            } else if relation == "gt" {
                let before = format!("{}, {}", values[a], values[b]);
                values.swap(a, b);
                occupants.swap(a, b);
                swaps += 1;
                emit(
                    &mut frames,
                    &values,
                    pass,
                    j,
                    0,
                    comparisons,
                    swaps,
                    json!({"type":"swapPair","aId":aid,"bId":bid}),
                    6,
                    json!({"compare":[oid(a as i64),oid(b as i64)],"eliminated":eliminated}),
                    "swap",
                    format!("swapped {before} -> {}, {}", values[a], values[b]),
                );
            }
        }
        if selection(s) && min != pass {
            let (a, b) = (pass, min);
            let aid = occupants[a].clone();
            let bid = occupants[b].clone();
            let before = format!("{}, {}", values[a], values[b]);
            values.swap(a, b);
            occupants.swap(a, b);
            swaps += 1;
            emit(
                &mut frames,
                &values,
                pass,
                0,
                min,
                comparisons,
                swaps,
                json!({"type":"swapPair","aId":aid,"bId":bid}),
                6,
                json!({"compare":[oid(a as i64),oid(b as i64)],"eliminated":eliminated}),
                "swap",
                format!("swapped {before} -> {}, {}", values[a], values[b]),
            );
        }
        eliminated.push(oid((n - 2 - pass) as i64));
    }
    emit(
        &mut frames,
        &values,
        n - 1,
        0,
        0,
        comparisons,
        swaps,
        json!({"type":"submitAnswer","targetId":"order","value":"sorted"}),
        10,
        json!({"eliminated":eliminated}),
        "terminate",
        format!("sorted after {comparisons} comparisons and {swaps} swaps"),
    );
    json!(frames)
}
