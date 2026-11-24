//! Stateful linear scan, including wrong-but-legal comparisons and submissions.
use serde_json::{json, Value};
fn index(i: i64) -> String {
    format!("v{i}")
}
fn number(v: &Value, f: i64) -> i64 {
    v.as_i64().unwrap_or(f)
}
fn parsed(v: &Value) -> Option<i64> {
    let text = v.as_str().unwrap_or("");
    static REGEX: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let r = REGEX.get_or_init(|| regex::Regex::new(r"-?[0-9]+").unwrap());
    r.find(text)?.as_str().parse().ok()
}
fn internal(s: &Value) -> Value {
    let r = &s["internal"];
    json!({"i":number(&r["i"],1),"best":number(&r["best"],0),"done":r["done"]==true,"picked":r["picked"]==true,"compared":r["compared"]==true,"comparisons":number(&r["comparisons"],0),"wrong":number(&r["wrong"],0),"wantMax":r["wantMax"]==true,"answerValue":r["answerValue"].as_str().unwrap_or(""),"terminated":r["terminated"]==true})
}
fn value(s: &Value, i: i64) -> Value {
    s["objects"][index(i)]["value"].clone()
}
fn eliminated(i: &Value) -> Vec<String> {
    (1..number(&i["i"], 1))
        .filter(|k| *k != number(&i["best"], 0))
        .map(index)
        .collect()
}
fn vars(s: &Value, i: &Value) -> Value {
    json!({"i":i["i"],"best":i["best"],"comparisons":i["comparisons"],"steps":s["progress"]["steps"],"n":s["instance"]["values"].as_array().unwrap().len(),"a_i":value(s,number(&i["i"],1)),"a_best":value(s,number(&i["best"],0))})
}
pub fn setup(s: &mut Value) {
    let want = s["instance"]["extras"]["wantMax"] != false;
    let n = s["instance"]["values"].as_array().unwrap().len();
    s["objects"]["mode"] = json!({"id":"mode","kind":"target","label":if want{"the largest"}else{"the smallest"},"visual":{"kind":"text","text":if want{"max"}else{"min"}},"state":"idle","tags":{"mode":true}});
    s["variables"] =
        json!({"i":1,"best":0,"comparisons":0,"steps":0,"wantMax":if want{1}else{0},"n":n});
    s["cursor"] = json!({"iSlotId":"s1","bestObjectId":"v0"});
    s["internal"] = json!({"i":1,"best":0,"done":false,"picked":false,"compared":false,"comparisons":0,"wrong":0,"wantMax":want,"answerValue":"","terminated":false});
}
fn sync(s: &mut Value, i: &Value) {
    let n = s["instance"]["values"].as_array().unwrap().len() as i64;
    let cur = number(&i["i"], 1);
    let best = number(&i["best"], 0);
    if best >= 0 && best < n {
        for k in 1..=1.max(cur - 1) {
            s["slots"][format!("s{k}")]["state"] = json!("eliminated");
            s["objects"][index(k)]["state"] = json!("eliminated");
        }
    }
    s["cursor"] = json!({"bestObjectId":index(best)});
    if cur < n {
        s["cursor"]["iSlotId"] = json!(format!("s{cur}"));
    }
    s["variables"] = json!({"i":cur,"best":best,"comparisons":i["comparisons"],"steps":s["progress"]["steps"],"wantMax":if i["wantMax"]==true{1}else{0},"n":n});
}
fn advance(i: &mut Value, n: i64) {
    if number(&i["i"], 1) + 1 < n {
        i["i"] = json!(number(&i["i"], 1) + 1);
    } else {
        i["done"] = json!(true);
    }
    i["picked"] = json!(false);
}
fn mistake(s: &mut Value, i: &mut Value, t: &str) {
    s["progress"]["mistakes"] = json!(number(&s["progress"]["mistakes"], 0) + 1);
    s["progress"]["mistakesByMechanic"][t] =
        json!(number(&s["progress"]["mistakesByMechanic"][t], 0) + 1);
    i["wrong"] = json!(number(&i["wrong"], 0) + 1);
}
fn frame(
    s: &mut Value,
    i: &Value,
    a: &Value,
    line: usize,
    op: &str,
    correct: bool,
    detail: (String, Value),
) {
    let (note, pointers) = detail;
    let idx = s["trace"].as_array().unwrap().len();
    let listing = &crate::oracle_metadata::get("array-max-min")["code"]["javascript"];
    let v = vars(s, i);
    s["trace"].as_array_mut().unwrap().push(json!({"index":idx,"action":a,"codeLine":line,"codeLineText":listing[line-1],"variables":v,"pointers":pointers,"dsaOp":op,"correct":correct,"note":note}));
}
fn reject(
    s: &Value,
    a: &Value,
    i: &Value,
    line: usize,
    op: &str,
    feedback: String,
    note: String,
) -> Value {
    let mut next = s.clone();
    next["progress"]["steps"] = json!(number(&next["progress"]["steps"], 0) + 1);
    frame(&mut next, i, a, line, op, false, (note, json!({})));
    let idx = next["trace"].as_array().unwrap().len() - 1;
    json!({"nextState":next,"outcome":{"correct":false,"illegal":true,"feedback":feedback,"dsaOp":op,"traceStep":idx}})
}
pub fn legal(s: &Value) -> Value {
    let i = internal(s);
    if i["terminated"] == true {
        return json!([{"type":"submitAnswer","label":"Return the index of the best cell","expects":"value"}]);
    }
    if i["compared"] == true {
        return json!([{"type":"selectObject","label":"Look at the next cell","options":{"objectIds":[index(number(&i["i"],1)+1)]}}]);
    }
    if i["picked"] == true {
        return json!([{"type":"comparePair","label":"Is the value you are holding above or below the running best?","options":{"objectIds":[index(number(&i["i"],1)),index(number(&i["best"],0))]},"expects":"relation"}]);
    }
    if i["done"] == true {
        return json!([{"type":"submitAnswer","label":"Return the index of the best cell","expects":"value"}]);
    }
    json!([{"type":"selectObject","label":"Look at the next cell","options":{"objectIds":[index(number(&i["i"],1))]}}])
}
pub fn apply(s: &Value, a: &Value) -> Value {
    let mut i = internal(s);
    let n = s["instance"]["values"].as_array().unwrap().len() as i64;
    let mut next = s.clone();
    let t = a["type"].as_str().unwrap();
    let pointers;
    let line;
    let mut correct = true;
    let feedback;
    let note;
    let op;
    let mut expected = None;
    let mut won = None;
    match t {
        "selectObject" => {
            op = "read";
            let oid = a["objectId"].as_str().unwrap();
            let reject_reason = if s["objects"].get(oid).is_none() {
                Some((
                    1,
                    "That is not on the board.".into(),
                    "rejected: unknown objectId".into(),
                ))
            } else if i["terminated"] == true {
                Some((
                    1,
                    "The run is over. Commit the answer.".into(),
                    "rejected: after the run ended".into(),
                ))
            } else if i["compared"] == true {
                Some((
                    1,
                    "That value has already been compared. Move on to the next one.".into(),
                    "rejected: comparison already recorded".into(),
                ))
            } else {
                let pos = number(&s["objects"][oid]["tags"]["index"], -1);
                let cur = number(&i["i"], 1);
                if pos != cur {
                    Some((3,format!("The scan looks at one cell at a time, in order. The next one is cell {cur}."),format!("rejected: expected cell {cur}")))
                } else {
                    None
                }
            };
            if let Some((l, f, note)) = reject_reason {
                return reject(s, a, &i, l, op, f, note);
            }
            let cur = number(&i["i"], 1);
            i["picked"] = json!(true);
            next["objects"][index(cur)]["state"] = json!("current");
            next["selection"] = json!([index(cur)]);
            sync(&mut next, &i);
            line = 3;
            note = format!("a[{cur}] = {}", value(&next, cur));
            feedback = format!(
                "Cell {cur} holds {}. Compare it with the running best.",
                value(&next, cur)
            );
            pointers =
                json!({"current":index(cur),"read":[index(cur)],"eliminated":eliminated(&i)});
        }
        "comparePair" => {
            op = "compare";
            if i["picked"] != true {
                return reject(
                    s,
                    a,
                    &i,
                    1,
                    op,
                    "Choose the next cell before comparing it.".into(),
                    "rejected: compare before select".into(),
                );
            }
            if i["compared"] == true {
                return reject(
                    s,
                    a,
                    &i,
                    1,
                    op,
                    "That comparison is already on the record. Pick the next cell.".into(),
                    "rejected: comparison already recorded".into(),
                );
            }
            let cur = number(&i["i"], 1);
            let best = number(&i["best"], 0);
            let probeid = index(cur);
            let bestid = index(best);
            if ![&a["aId"], &a["bId"]].iter().any(|v| **v == probeid)
                || ![&a["aId"], &a["bId"]].iter().any(|v| **v == bestid)
            {
                return reject(
                    s,
                    a,
                    &i,
                    1,
                    op,
                    "Compare the cell you just picked against the running best, nothing else."
                        .into(),
                    "rejected: comparePair is not probe-vs-best".into(),
                );
            }
            let probe = number(&value(&next, cur), 0);
            let incumbent = number(&value(&next, best), 0);
            let truth = if probe > incumbent {
                "gt"
            } else if probe < incumbent {
                "lt"
            } else {
                "eq"
            };
            correct = a["relation"] == truth;
            if correct {
                i["comparisons"] = json!(number(&i["comparisons"], 0) + 1);
                if if i["wantMax"] == true {
                    probe > incumbent
                } else {
                    probe < incumbent
                } {
                    i["best"] = json!(cur);
                }
                next["objects"][&probeid]["state"] = json!(if i["best"] == cur {
                    "matched"
                } else {
                    "visited"
                });
                i["compared"] = json!(false);
                i["picked"] = json!(false);
                advance(&mut i, n);
            } else {
                mistake(&mut next, &mut i, t);
                expected = Some(json!({"type":t,"aId":probeid,"bId":bestid,"relation":truth}));
            }
            next["selection"] = json!([probeid, bestid]);
            sync(&mut next, &i);
            let cur = number(&i["i"], 1);
            let best = number(&i["best"], 0);
            let updated = correct && cur == best;
            line = if updated { 6 } else { 4 };
            note = if correct {
                if updated {
                    format!("a[{cur}] = {probe} beats a[{best}] — best moves")
                } else {
                    format!("a[{cur}] = {probe} does not beat the running best")
                }
            } else {
                format!(
                    "declared {}, the truth is {truth}",
                    a["relation"].as_str().unwrap()
                )
            };
            feedback = if correct {
                if updated {
                    format!(
                        "{probe} is {} than {incumbent}, so the running best moves to cell {cur}.",
                        if i["wantMax"] == true {
                            "larger"
                        } else {
                            "smaller"
                        }
                    )
                } else {
                    format!("{probe} does not beat {incumbent}, so the best stays at cell {best}.")
                }
            } else {
                let word = if truth == "eq" {
                    "the same"
                } else if (truth == "gt") == (i["wantMax"] == true) {
                    "the larger one"
                } else {
                    "the smaller one"
                };
                format!(
                    "Cell {cur} holds {probe} and the best holds {incumbent}: {probe} is {word}."
                )
            };
            pointers = json!({"current":probeid,"compare":[probeid,bestid],"read":[probeid],"eliminated":eliminated(&i)});
        }
        "assignValue" => {
            op = "assign";
            let Some(parsed) = parsed(&a["value"]) else {
                return reject(
                    s,
                    a,
                    &i,
                    1,
                    op,
                    "Type a whole number — the index of the cell you think is the best.".into(),
                    "rejected: malformed assignValue".into(),
                );
            };
            if parsed < 0 || parsed >= n {
                return reject(
                    s,
                    a,
                    &i,
                    1,
                    op,
                    format!(
                        "There is no cell {parsed}. The board runs from 0 to {}.",
                        n - 1
                    ),
                    "rejected: assignValue out of range".into(),
                );
            }
            let pending = i["picked"] == true && i["compared"] != true;
            correct = pending && i["best"] == parsed;
            if correct {
                i["comparisons"] = json!(number(&i["comparisons"], 0) + 1);
                i["best"] = json!(parsed);
                i["compared"] = json!(false);
                i["picked"] = json!(false);
                advance(&mut i, n);
                next["objects"][index(parsed)]["state"] = json!("matched");
            } else {
                mistake(&mut next, &mut i, t);
                expected = Some(json!({"type":t,"targetId":"best","value":i["best"].to_string()}));
            }
            sync(&mut next, &i);
            line = if correct { 6 } else { 2 };
            note = if correct {
                format!("best = {parsed}")
            } else {
                format!("best is {}, not {parsed}", i["best"])
            };
            feedback = if correct {
                format!("The running best is cell {parsed}.")
            } else if pending {
                format!(
                    "Cell {} holds {} and the best holds {}, so the best is cell {}.",
                    i["i"],
                    value(&next, number(&i["i"], 1)),
                    value(&next, number(&i["best"], 0)),
                    i["best"]
                )
            } else {
                "Pick a cell first, then record which one becomes the best.".into()
            };
            pointers = json!({"current":index(parsed),"eliminated":eliminated(&i)});
        }
        "submitAnswer" => {
            op = "terminate";
            let Some(submitted) = parsed(&a["value"]) else {
                return reject(
                    s,
                    a,
                    &i,
                    1,
                    op,
                    "Submit a whole number — the index of the cell you think holds the answer."
                        .into(),
                    "rejected: malformed submitAnswer".into(),
                );
            };
            i["answerValue"] = json!(submitted.to_string());
            correct = i["best"] == submitted;
            i["terminated"] = json!(true);
            won = Some(correct);
            if correct {
                next["phase"] = json!("won");
                next["objects"][index(submitted)]["state"] = json!("matched");
            } else {
                next["phase"] = json!("lost");
                next["progress"]["mistakes"] = json!(number(&next["progress"]["mistakes"], 0) + 1);
                next["progress"]["mistakesByMechanic"][t] =
                    json!(number(&next["progress"]["mistakesByMechanic"][t], 0) + 1);
                expected = Some(json!({"type":t,"targetId":"best","value":i["best"].to_string()}));
            }
            sync(&mut next, &i);
            line = 9;
            note = if correct {
                format!("returned {submitted}")
            } else {
                format!("returned {submitted}, the answer is {}", i["best"])
            };
            let mode = if i["wantMax"] == true {
                "largest"
            } else {
                "smallest"
            };
            let held = value(&next, submitted);
            let held = if held.is_null() {
                "NaN".into()
            } else {
                held.to_string()
            };
            feedback = if correct {
                format!("Correct — cell {submitted} holds {held}, the {mode} value, after {} comparisons.",i["comparisons"])
            } else {
                format!(
                    "Cell {submitted} holds {held}; the {mode} value is at cell {}.",
                    i["best"]
                )
            };
            pointers = json!({"current":index(submitted),"read":[index(submitted)],"eliminated":eliminated(&i)});
        }
        _ => {
            return reject(
                s,
                a,
                &i,
                1,
                "read",
                "That move is not part of a linear scan.".into(),
                format!("rejected: {t} is not used by this problem"),
            )
        }
    }
    next["progress"]["steps"] = json!(number(&next["progress"]["steps"], 0) + 1);
    frame(&mut next, &i, a, line, op, correct, (note, pointers));
    next["internal"] = i;
    let idx = next["trace"].as_array().unwrap().len() - 1;
    let mut outcome = json!({"correct":correct,"feedback":feedback,"dsaOp":op,"traceStep":idx});
    if let Some(e) = expected {
        outcome["expected"] = e;
    }
    if let Some(w) = won {
        outcome["won"] = json!(w);
    }
    json!({"nextState":next,"outcome":outcome})
}
pub fn canonical(s: &Value) -> Value {
    let values = nums(&s["instance"]["values"]);
    let want = s["instance"]["extras"]["wantMax"] != false;
    let live = internal(s);
    let mut best = number(&live["best"], 0) as usize;
    let mut comparisons = number(&live["comparisons"], 0);
    let start = number(&live["i"], 1).max(1) as usize;
    let mut settled: Vec<_> = (1..start)
        .filter(|k| *k != best)
        .map(|i| index(i as i64))
        .collect();
    let mut frames = vec![];
    let listing = &crate::oracle_metadata::get("array-max-min")["code"]["javascript"];
    for i in start..values.len() {
        let vars = |steps: usize| json!({"i":i,"best":best,"comparisons":comparisons,"steps":steps,"n":values.len(),"a_i":values[i],"a_best":values[best]});
        let probe = index(i as i64);
        let incumbent = index(best as i64);
        let action = json!({"type":"selectObject","objectId":probe});
        frames.push(json!({"index":frames.len(),"action":action,"codeLine":3,"codeLineText":listing[2],"variables":vars(frames.len()),"pointers":{"current":probe,"read":[probe],"eliminated":settled},"dsaOp":"read","correct":true,"note":format!("a[{i}] = {}",values[i])}));
        let relation = if values[i] > values[best] {
            "gt"
        } else if values[i] < values[best] {
            "lt"
        } else {
            "eq"
        };
        frames.push(json!({"index":frames.len(),"action":{"type":"comparePair","aId":probe,"bId":incumbent,"relation":relation},"codeLine":4,"codeLineText":listing[3],"variables":vars(frames.len()),"pointers":{"current":probe,"compare":[probe,incumbent],"read":[probe],"eliminated":settled},"dsaOp":"compare","correct":true,"note":format!("a[{i}] = {} vs best a[{best}] = {} -> {relation}",values[i],values[best])}));
        comparisons += 1;
        if relation == "eq"
            || if want {
                relation != "gt"
            } else {
                relation != "lt"
            }
        {
            settled.push(probe);
        } else {
            settled.push(incumbent);
            best = i;
        }
    }
    let i = values.len() - 1;
    frames.push(json!({"index":frames.len(),"action":{"type":"submitAnswer","targetId":"best","value":best.to_string()},"codeLine":9,"codeLineText":listing[8],"variables":{"i":i,"best":best,"comparisons":comparisons,"steps":frames.len(),"n":values.len(),"a_i":values[i],"a_best":values[best]},"pointers":{"current":index(best as i64),"read":[index(best as i64)],"eliminated":settled},"dsaOp":"terminate","correct":true,"note":format!("return {best}")}));
    json!(frames)
}
fn nums(v: &Value) -> Vec<i64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect()
}
pub fn answer(s: &Value) -> Value {
    let v = nums(&s["instance"]["values"]);
    let want = s["instance"]["extras"]["wantMax"] != false;
    let mut best = 0;
    for i in 1..v.len() {
        if if want { v[i] > v[best] } else { v[i] < v[best] } {
            best = i;
        }
    }
    json!({"text":format!("index {best} (the {} value, {})",if want{"largest"}else{"smallest"},v[best]),"value":best,"details":[{"label":"index","value":best},{"label":"value","value":v[best]},{"label":"comparisons","value":internal(s)["comparisons"]},{"label":"array length","value":v.len()}]})
}
