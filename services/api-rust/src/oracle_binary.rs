//! Binary search preserves off-centre probes, wrong paths and bounded turn history.
use serde_json::{json, Value};
fn num(v: &Value, f: i64) -> i64 {
    v.as_i64().unwrap_or(f)
}
fn oid(i: i64) -> String {
    format!("v{i}")
}
fn n(s: &Value) -> i64 {
    s["instance"]["values"].as_array().unwrap().len() as i64
}
fn target_index(x: &Value) -> i64 {
    x["extras"]["targetIndex"]
        .as_i64()
        .filter(|i| *i >= 0 && (*i as usize) < x["values"].as_array().unwrap().len())
        .unwrap_or_else(|| {
            x["values"]
                .as_array()
                .unwrap()
                .iter()
                .position(|v| v == &x["target"])
                .map(|i| i as i64)
                .unwrap_or(-1)
        })
}
fn internal(s: &Value) -> Value {
    let r = &s["internal"];
    json!({"lo":num(&r["lo"],0),"hi":num(&r["hi"],(n(s)-1).max(0)),"mid":num(&r["mid"],-1),"midChosen":r["midChosen"]==true,"targetIndex":num(&r["targetIndex"],-1),"found":r["found"]==true,"comparisons":num(&r["comparisons"],0),"wrongAnswers":num(&r["wrongAnswers"],0),"history":r["history"].as_str().unwrap_or(""),"hasComparison":r["hasComparison"]==true,"lastRelation":r["lastRelation"].as_str().unwrap_or(""),"terminated":r["terminated"]==true,"wrongPath":r["wrongPath"]==true,"answerValue":r["answerValue"].as_str().unwrap_or("")})
}
fn midpoint(i: &Value) -> Option<i64> {
    let lo = num(&i["lo"], 0);
    let hi = num(&i["hi"], 0);
    (lo <= hi).then_some((lo + hi).div_euclid(2))
}
fn value(s: &Value, i: i64) -> i64 {
    if i >= 0 {
        s["instance"]["values"]
            .get(i as usize)
            .and_then(Value::as_i64)
            .unwrap_or(0)
    } else {
        0
    }
}
fn vars(s: &Value, i: &Value, steps: bool) -> Value {
    let mut out = json!({"lo":i["lo"],"mid":i["mid"],"hi":i["hi"],"target":s["instance"]["target"],"comparisons":i["comparisons"]});
    if steps {
        out["steps"] = s["progress"]["steps"].clone();
        out["found"] = i["found"].clone();
    }
    out
}
fn eliminated(s: &Value, i: &Value) -> Vec<String> {
    (0..n(s))
        .filter(|k| *k < num(&i["lo"], 0) || *k > num(&i["hi"], 0))
        .map(oid)
        .collect()
}
pub fn setup(s: &mut Value) {
    let hi = (n(s) - 1).max(0);
    let mid = hi / 2;
    let target = s["instance"]["target"].clone();
    s["objects"]["target"] = json!({"id":"target","kind":"target","label":"target","value":target,"visual":{"kind":"text","text":target.to_string()},"state":"idle"});
    s["cursor"] =
        json!({"loSlotId":"s0","midSlotId":format!("s{mid}"),"hiSlotId":format!("s{hi}")});
    s["variables"] =
        json!({"lo":0,"mid":mid,"hi":hi,"target":target,"comparisons":0,"steps":0,"found":false});
    s["internal"] = json!({"lo":0,"hi":hi,"mid":mid,"midChosen":false,"targetIndex":target_index(&s["instance"]),"found":false,"comparisons":0,"wrongAnswers":0,"history":"[]","hasComparison":false,"lastRelation":"","terminated":false,"wrongPath":false,"answerValue":""});
}
fn history(i: &mut Value, entry: Value) {
    let parsed: Value =
        serde_json::from_str(i["history"].as_str().unwrap_or("")).unwrap_or(Value::Null);
    let mut all = vec![];
    if let Some(rows) = parsed.as_array() {
        for r in rows {
            if !r.is_object() || num(&r["index"], -1) < 0 {
                continue;
            }
            let kind = r["kind"]
                .as_str()
                .filter(|k| ["compare", "path", "assign", "answer"].contains(k))
                .unwrap_or("select");
            let mut item = json!({"step":num(&r["step"],0),"kind":kind,"index":num(&r["index"],-1),"correct":r["correct"]==true});
            for key in ["relation", "path"] {
                if r[key].is_string() {
                    item[key] = r[key].clone();
                }
            }
            all.push(item);
        }
    }
    all.push(entry);
    if all.len() > 64 {
        all.drain(..all.len() - 64);
    }
    i["history"] = json!(serde_json::to_string(&all).unwrap());
}
fn mistake(s: &mut Value, i: &mut Value, t: &str) {
    s["progress"]["mistakes"] = json!(num(&s["progress"]["mistakes"], 0) + 1);
    s["progress"]["mistakesByMechanic"][t] =
        json!(num(&s["progress"]["mistakesByMechanic"][t], 0) + 1);
    i["wrongAnswers"] = json!(num(&i["wrongAnswers"], 0) + 1);
}
fn end(s: &mut Value, i: &Value) {
    let lo = num(&i["lo"], 0);
    let hi = num(&i["hi"], 0);
    for k in 0..n(s) {
        if k < lo || k > hi {
            s["slots"][format!("s{k}")]["state"] = json!("eliminated");
            s["objects"][oid(k)]["state"] = json!("eliminated");
        }
    }
    s["cursor"] = json!({});
    for (key, numkey) in [("loSlotId", "lo"), ("hiSlotId", "hi"), ("midSlotId", "mid")] {
        let v = num(&i[numkey], -1);
        if v >= 0 {
            s["cursor"][key] = json!(format!("s{v}"));
        }
    }
    s["variables"] = vars(s, i, true);
    let idx = num(&i["targetIndex"], -1);
    if (lo > hi || idx < lo || idx > hi || num(&i["wrongAnswers"], 0) > 2)
        && s["phase"] == "playing"
    {
        s["phase"] = json!("lost");
    }
}
fn frame(s: &mut Value, a: &Value, i: &Value, spec: (usize, &str, bool, String, Value)) {
    let (line, op, correct, note, mut pointers) = spec;
    pointers["eliminated"] = json!(eliminated(s, i));
    let idx = s["trace"].as_array().unwrap().len();
    let variables = vars(s, i, true);
    let listing = &crate::oracle_metadata::get("binary-search")["code"]["javascript"];
    s["trace"].as_array_mut().unwrap().push(json!({"index":idx,"action":a,"codeLine":line,"codeLineText":listing[line-1],"variables":variables,"pointers":pointers,"dsaOp":op,"correct":correct,"note":note}));
}
fn reject(s: &Value, a: &Value, op: &str, feedback: String, note: String) -> Value {
    let mut next = s.clone();
    next["progress"]["steps"] = json!(num(&next["progress"]["steps"], 0) + 1);
    let i = internal(&next);
    frame(&mut next, a, &i, (1, op, false, note, json!({})));
    json!({"outcome":{"correct":false,"illegal":true,"feedback":feedback,"dsaOp":op,"traceStep":next["trace"].as_array().unwrap().len()-1},"nextState":next})
}
fn parsed(raw: &str, prefix: bool) -> Option<i64> {
    static ALL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static PREFIX: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let regex = if prefix {
        PREFIX.get_or_init(|| regex::Regex::new(r"^[+-]?[0-9]+").unwrap())
    } else {
        ALL.get_or_init(|| regex::Regex::new(r"-?[0-9]+").unwrap())
    };
    regex.find(crate::compat::trim(raw))?.as_str().parse().ok()
}
fn relation(target: i64, mid: i64) -> &'static str {
    if target > mid {
        "gt"
    } else if target < mid {
        "lt"
    } else {
        "eq"
    }
}
fn word(r: &str) -> &'static str {
    match r {
        "lt" => "below",
        "gt" => "above",
        "eq" => "level with",
        _ => "compared to",
    }
}
pub fn legal(s: &Value) -> Value {
    if s["phase"] != "playing" {
        return json!([]);
    }
    let i = internal(s);
    if i["terminated"] == true {
        return json!([{"type":"submitAnswer","label":"Commit the index of the target","expects":"value"}]);
    }
    if i["midChosen"] != true {
        let lo = num(&i["lo"], 0);
        let hi = num(&i["hi"], 0);
        let ids: Vec<_> = (lo.max(0)..=hi.min(n(s) - 1)).map(oid).collect();
        let label = midpoint(&i)
            .map(|mid| format!("Choose index {mid}, the middle of [{lo}, {hi}]"))
            .unwrap_or_else(|| "Choose the middle element".into());
        return json!([{"type":"selectObject","label":label,"options":{"objectIds":ids},"expects":"none"}]);
    }
    if i["hasComparison"] != true {
        return json!([{"type":"comparePair","label":"Declare how the target compares to the middle","options":{"objectIds":[oid(num(&i["mid"],-1)),"target"]},"expects":"relation"}]);
    }
    let hit = i["lastRelation"] == "eq";
    json!([{"type":"choosePath","dsaOp":if hit{"terminate"}else{"choose-path"},"label":if hit{"Report the hit"}else{"Keep the half that can still hold the target"},"options":{"objectIds":[oid(num(&i["mid"],-1))]},"expects":"none"}])
}
pub fn apply(s: &Value, a: &Value) -> Value {
    let fallback = json!({"type":"selectObject","objectId":""});
    let a = if a.is_object() { a } else { &fallback };
    let t = a["type"].as_str().unwrap_or("undefined");
    let mut op = match t {
        "selectObject" => "read",
        "comparePair" => "compare",
        "choosePath" => "choose-path",
        "assignValue" => "assign",
        "submitAnswer" => "terminate",
        "swapPair" => "swap",
        "moveObject" => "move",
        "pushPop" => "push",
        "traverseNode" => "traverse",
        "connectNodes" => "link",
        _ => "read",
    };
    if ![
        "selectObject",
        "comparePair",
        "choosePath",
        "assignValue",
        "submitAnswer",
    ]
    .contains(&t)
    {
        return reject(
            s,
            a,
            op,
            format!("{t} is not a move in this problem."),
            "rejected: action type not allowed for this problem".into(),
        );
    }
    if s["phase"] != "playing" {
        return reject(
            s,
            a,
            op,
            "The run is already over.".into(),
            format!("rejected: phase is {}", s["phase"].as_str().unwrap()),
        );
    }
    let mut i = internal(s);
    let mut next = s.clone();
    let line;
    let note;
    let feedback;
    let pointers;
    let correct;
    let mut expected = None;
    let mut won = None;
    macro_rules! no {
        ($f:expr,$n:expr) => {
            return reject(s, a, op, $f.into(), $n.into())
        };
    }
    match t {
        "selectObject" => {
            let Some(id) = a["objectId"]
                .as_str()
                .filter(|id| s["objects"].get(*id).is_some())
            else {
                no!(
                    "That object is not on the board.",
                    "rejected: unknown objectId"
                )
            };
            if i["terminated"] == true {
                no!(
                    "The target is already located. Commit the index.",
                    "rejected: search already terminated"
                )
            }
            let cmid = midpoint(&i);
            let cid = cmid.map(oid).unwrap_or_default();
            let target = num(&s["instance"]["target"], 0);
            line = 5;
            if id == "target" {
                correct = false;
                mistake(&mut next, &mut i, t);
                note = "the target is the needle, not a candidate".into();
                feedback=format!("The target {target} is what you are hunting for, not a candidate to probe. Read the middle element of the window instead.");
                expected = Some(if cid.is_empty() {
                    json!({"type":t})
                } else {
                    json!({"type":t,"objectId":cid})
                });
                pointers = json!({"current":"target","read":["target"]});
            } else {
                let picked = id
                    .strip_prefix('v')
                    .filter(|tail| !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()))
                    .and_then(|tail| tail.parse::<i64>().ok());
                let Some(picked) = picked.filter(|p| *p < n(s)) else {
                    no!(
                        "That object is not part of the array.",
                        "rejected: objectId is not an array element"
                    )
                };
                if i["midChosen"] == true && i["mid"] == picked {
                    no!(format!("Index {picked} is already the middle. Declare how it compares to the target."),"rejected: repeated selection of the current mid")
                }
                correct = cmid == Some(picked);
                if !correct {
                    mistake(&mut next, &mut i, t);
                    expected = Some(json!({"type":t,"objectId":cid}));
                }
                i["mid"] = json!(picked);
                i["midChosen"] = json!(true);
                i["hasComparison"] = json!(false);
                i["lastRelation"] = json!("");
                next["selection"] = json!([id]);
                if next["objects"][id]["state"] != "eliminated" {
                    next["objects"][id]["state"] = json!("selected");
                }
                history(
                    &mut i,
                    json!({"step":next["progress"]["steps"],"kind":"select","index":picked,"correct":correct}),
                );
                let cmid = cmid.map(|i| i.to_string()).unwrap_or_else(|| "null".into());
                note = if correct {
                    format!("mid = {picked}")
                } else {
                    format!("mid should be {cmid}")
                };
                feedback = if correct {
                    format!(
                        "Index {picked} is the midpoint of [{}, {}]. It holds {}.",
                        i["lo"],
                        i["hi"],
                        value(s, picked)
                    )
                } else {
                    format!("The midpoint of [{}, {}] is index {cmid}, not {picked}. Probing off-centre throws away the halving.",i["lo"],i["hi"])
                };
                pointers = json!({"current":id,"read":[id]});
            }
        }
        "comparePair" => {
            let (Some(aid), Some(bid)) = (a["aId"].as_str(), a["bId"].as_str()) else {
                no!(
                    "A comparison needs two objects.",
                    "rejected: incomplete comparePair"
                )
            };
            if s["objects"].get(aid).is_none() || s["objects"].get(bid).is_none() {
                no!(
                    "One of those objects is not on the board.",
                    "rejected: unknown objectId in comparePair"
                )
            }
            let Some(r) = a["relation"]
                .as_str()
                .filter(|r| ["lt", "eq", "gt"].contains(r))
            else {
                no!(
                    "The relation must be lt, eq or gt.",
                    "rejected: malformed relation"
                )
            };
            let mid = num(&i["mid"], -1);
            if i["midChosen"] != true || mid < 0 {
                no!(
                    "Choose the middle element before comparing.",
                    "rejected: compare before select"
                )
            }
            if i["hasComparison"] == true {
                no!(
                    "That comparison is already on the record. Now choose which half to keep.",
                    "rejected: comparison already recorded"
                )
            }
            let Some(target) = s["instance"]["target"].as_i64() else {
                no!(
                    "This instance has no target to compare against.",
                    "rejected: instance without a target"
                )
            };
            let midid = oid(mid);
            if ![aid, bid].contains(&midid.as_str()) || ![aid, bid].contains(&"target") {
                no!(
                    "Compare the middle element against the target, nothing else.",
                    "rejected: comparePair is not mid-vs-target"
                )
            }
            if mid >= n(s) {
                no!(
                    "The middle element is no longer in the window.",
                    "rejected: mid index out of range"
                )
            }
            let midval = value(s, mid);
            let truth = relation(target, midval);
            correct = r == truth;
            if !correct {
                mistake(&mut next, &mut i, t);
                expected = Some(json!({"type":t,"aId":midid,"bId":"target","relation":truth}));
            } else {
                i["comparisons"] = json!(num(&i["comparisons"], 0) + 1);
                i["hasComparison"] = json!(true);
                i["lastRelation"] = json!(truth);
                next["objects"][&midid]["state"] = json!("visited");
            }
            next["selection"] = json!([midid, "target"]);
            history(
                &mut i,
                json!({"step":next["progress"]["steps"],"kind":"compare","index":mid,"relation":r,"correct":correct}),
            );
            line = if truth == "eq" { 6 } else { 7 };
            note = format!("{r} declared, {truth} is the truth");
            feedback = if correct {
                format!("Mid holds {midval} and the target is {target}: the target is {} it, so \"{truth}\" holds.",word(truth))
            } else {
                format!("Mid holds {midval} and the target is {target}, so the relation is \"{truth}\" — the target is {} the middle. Nothing was discarded, read it again.",word(truth))
            };
            pointers = json!({"current":midid,"compare":[midid,"target"],"read":[midid]});
        }
        "choosePath" => {
            let Some(from) = a["fromId"]
                .as_str()
                .filter(|id| s["objects"].get(*id).is_some())
            else {
                no!(
                    "That object is not on the board.",
                    "rejected: unknown objectId in choosePath"
                )
            };
            let mid = num(&i["mid"], -1);
            if i["midChosen"] != true || mid < 0 {
                no!(
                    "Choose the middle element first.",
                    "rejected: choosePath before select"
                )
            }
            if i["hasComparison"] != true {
                no!(
                    "Compare first — the comparison is what tells you which half survives.",
                    "rejected: choosePath before compare"
                )
            }
            let midid = oid(mid);
            if from != midid {
                no!(
                    "Branches are taken from the middle element.",
                    "rejected: choosePath fromId is not the mid"
                )
            }
            let raw = a["pathId"].as_str().unwrap_or("");
            let idx = num(&i["targetIndex"], -1);
            let path = match raw {
                "left" | "right" => raw,
                "found" | "eq" => "found",
                _ => {
                    if raw.strip_prefix('s').is_some_and(|tail| {
                        !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit())
                    }) {
                        if idx == mid {
                            "found"
                        } else if idx < mid {
                            "left"
                        } else {
                            "right"
                        }
                    } else {
                        no!(
                            "Choose left, right, or the hit itself.",
                            "rejected: unresolvable pathId"
                        )
                    }
                }
            };
            let truth = if i["lastRelation"] == "eq" {
                "found"
            } else if idx < mid {
                "left"
            } else {
                "right"
            };
            correct = path == truth;
            let midval = value(s, mid);
            if !correct {
                mistake(&mut next, &mut i, t);
                i["wrongPath"] = json!(true);
                expected = Some(json!({"type":t,"fromId":midid,"pathId":truth}));
            }
            match path {
                "found" => {
                    next["objects"][&midid]["state"] = json!("matched");
                    i["terminated"] = json!(true);
                }
                "left" => i["hi"] = json!(mid - 1),
                _ => i["lo"] = json!(mid + 1),
            }
            i["midChosen"] = json!(false);
            i["hasComparison"] = json!(false);
            i["lastRelation"] = json!("");
            i["mid"] = json!(midpoint(&i).unwrap_or(-1));
            next["selection"] = json!([]);
            history(
                &mut i,
                json!({"step":next["progress"]["steps"],"kind":"path","index":mid,"path":path,"correct":correct}),
            );
            end(&mut next, &i);
            op = if path == "found" {
                "terminate"
            } else {
                "choose-path"
            };
            line = if path == "found" {
                6
            } else if path == "left" {
                10
            } else {
                8
            };
            note = if correct {
                if path == "found" {
                    format!("found at {midid}")
                } else {
                    format!("keep {path}, window [{}, {}]", i["lo"], i["hi"])
                }
            } else {
                format!("kept {path}, the target left the window")
            };
            feedback = if correct {
                if path == "found" {
                    format!(
                        "Index {} holds {midval} — that is the target. Commit the answer.",
                        i["mid"]
                    )
                } else {
                    format!(
                        "Keeping the {path} half: the window is [{}, {}], {} element(s) left.",
                        i["lo"],
                        i["hi"],
                        (num(&i["hi"], 0) - num(&i["lo"], 0) + 1).max(0)
                    )
                }
            } else {
                format!("That half never held the target, and index {idx} has just been ruled out. The window is [{}, {}] and the search is over.",i["lo"],i["hi"])
            };
            won = Some(false);
            let mut ptr = json!({"compare":[midid,"target"]});
            if path == "found" {
                ptr["current"] = json!(midid);
            }
            pointers = ptr;
        }
        "assignValue" => {
            let key = a["targetId"].as_str().unwrap_or("");
            if !["lo", "mid", "hi"].contains(&key) {
                no!(
                    "Only lo, mid and hi can be assigned here.",
                    "rejected: unknown assignValue target"
                )
            }
            let Some(p) = parsed(a["value"].as_str().unwrap_or(""), true) else {
                no!(
                    "That value is not a whole number.",
                    "rejected: malformed assignValue"
                )
            };
            if p < 0 || p >= n(s) {
                no!(
                    format!("Indices run from 0 to {}.", n(s) - 1),
                    "rejected: assignValue outside the array"
                )
            }
            let mid = num(&i["mid"], -1);
            let expectedval = if key == "mid" {
                if mid >= 0 {
                    mid
                } else {
                    midpoint(&i).unwrap_or(0)
                }
            } else {
                num(&i[key], 0)
            };
            let lo = num(&i["lo"], 0);
            let hi = num(&i["hi"], 0);
            let ordering = if key == "lo" {
                p <= hi
            } else if key == "hi" {
                p >= lo
            } else {
                p >= lo && p <= hi
            };
            correct = ordering && p == expectedval;
            if correct {
                if key != "mid" {
                    i[key] = json!(p);
                }
                i["midChosen"] = json!(false);
                i["hasComparison"] = json!(false);
                i["lastRelation"] = json!("");
                i["mid"] = json!(if key == "mid" {
                    p
                } else {
                    midpoint(&i).unwrap_or(-1)
                });
            } else {
                mistake(&mut next, &mut i, t);
                expected = Some(json!({"type":t,"targetId":key,"value":expectedval.to_string()}));
            }
            history(
                &mut i,
                json!({"step":next["progress"]["steps"],"kind":"assign","index":p,"path":key,"correct":correct}),
            );
            end(&mut next, &i);
            line = if key == "lo" {
                2
            } else if key == "hi" {
                3
            } else {
                5
            };
            note = if correct {
                format!("{key} = {p}")
            } else {
                format!("{key} should be {expectedval}")
            };
            feedback = if correct {
                format!("{key} is now {p}.")
            } else {
                format!(
                    "{key} should be {expectedval}; the window is [{}, {}] with mid {}.",
                    i["lo"], i["hi"], i["mid"]
                )
            };
            pointers = if key == "mid" {
                json!({"current":oid(p)})
            } else {
                json!({})
            };
        }
        "submitAnswer" => {
            let Some(p) = parsed(a["value"].as_str().unwrap_or(""), false) else {
                no!(
                    "Submit a whole number — the index of the target, or the target value itself.",
                    "rejected: malformed submitAnswer"
                )
            };
            let idx = num(&i["targetIndex"], -1);
            let Some(target) = s["instance"]["target"].as_i64().filter(|_| idx >= 0) else {
                no!(
                    "This instance has no target to report.",
                    "rejected: instance without a target"
                )
            };
            i["answerValue"] = json!(p.to_string());
            correct = (p == idx && p >= 0 && p < n(s)) || p == target;
            if correct {
                i["found"] = json!(true);
                next["phase"] = json!("won");
                next["objects"][oid(idx)]["state"] = json!("revealed");
            } else {
                mistake(&mut next, &mut i, t);
                next["phase"] = json!("lost");
                expected = Some(json!({"type":t,"targetId":a["targetId"],"value":idx.to_string()}));
            }
            i["terminated"] = json!(true);
            next["selection"] = json!([]);
            history(
                &mut i,
                json!({"step":next["progress"]["steps"],"kind":"answer","index":p,"correct":correct}),
            );
            end(&mut next, &i);
            next["phase"] = json!(if correct { "won" } else { "lost" });
            line = if correct { 6 } else { 13 };
            note = if correct {
                format!("target is at index {idx}")
            } else {
                format!("submitted {p}, truth is index {idx}")
            };
            feedback = if correct {
                format!("Correct — the target {target} sits at index {idx}, reached in {} comparison(s).",i["comparisons"])
            } else {
                format!("The target {target} is at index {idx}, not {p}. {} comparison(s) were not enough to pin it down.",i["comparisons"])
            };
            won = Some(correct);
            pointers = json!({"current":oid(idx),"read":[oid(idx),"target"]});
        }
        _ => unreachable!(),
    }
    next["progress"]["steps"] = json!(num(&next["progress"]["steps"], 0) + 1);
    frame(&mut next, a, &i, (line, op, correct, note, pointers));
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
    let idx = num(&i["targetIndex"], -1);
    let idx = if idx >= 0 {
        idx
    } else {
        target_index(&s["instance"])
    };
    json!({"text":format!("index {idx}"),"value":idx,"details":[{"label":"target","value":s["instance"]["target"].as_i64().unwrap_or(0)},{"label":"comparisons","value":i["comparisons"]},{"label":"array length","value":n(s)}]})
}
pub fn canonical(s: &Value, played: Option<&[Value]>) -> Value {
    let target = s["instance"]["target"].as_i64();
    let mut frames = vec![];
    let (mut lo, mut hi, mut comparisons, mut answer) = (0, n(s) - 1, 0, -1);
    let mut eliminated: Vec<String> = vec![];
    let listing = &crate::oracle_metadata::get("binary-search")["code"]["javascript"];
    let emit = |frames: &mut Vec<Value>,
                lo: i64,
                mid: i64,
                hi: i64,
                comparisons: i64,
                action: Value,
                line: usize,
                pointers: Value,
                op: &str,
                note: String| {
        frames.push(json!({"index":frames.len(),"action":action,"codeLine":line,"codeLineText":listing[line-1],"variables":{"lo":lo,"mid":mid,"hi":hi,"target":target,"comparisons":comparisons},"pointers":pointers,"dsaOp":op,"correct":true,"note":note}));
    };
    let Some(target) = target else {
        emit(
            &mut frames,
            0,
            -1,
            n(s) - 1,
            0,
            json!({"type":"submitAnswer","targetId":"answer","value":"-1"}),
            13,
            json!({"eliminated":[]}),
            "terminate",
            "no target on this instance".into(),
        );
        return json!(frames);
    };
    while lo <= hi {
        let mid = (lo + hi) / 2;
        let id = oid(mid);
        let v = value(s, mid);
        let r = relation(target, v);
        emit(
            &mut frames,
            lo,
            mid,
            hi,
            comparisons,
            json!({"type":"selectObject","objectId":id}),
            5,
            json!({"current":id,"read":[id],"eliminated":eliminated}),
            "read",
            format!("mid = {mid} (window {lo}..{hi})"),
        );
        emit(
            &mut frames,
            lo,
            mid,
            hi,
            comparisons,
            json!({"type":"comparePair","aId":id,"bId":"target","relation":r}),
            if r == "eq" { 6 } else { 7 },
            json!({"current":id,"compare":[id,"target"],"eliminated":eliminated}),
            "compare",
            format!("a[{mid}] = {v} vs target {target} -> {r}"),
        );
        if r == "eq" {
            answer = mid;
            emit(
                &mut frames,
                lo,
                mid,
                hi,
                comparisons,
                json!({"type":"choosePath","fromId":id,"pathId":"found"}),
                6,
                json!({"current":id,"eliminated":eliminated}),
                "terminate",
                format!("a[{mid}] === target: found, and the answer is {mid}"),
            );
            break;
        }
        comparisons += 1;
        let range = if r == "gt" { lo..=mid } else { mid..=hi };
        for k in range {
            let id = oid(k);
            if !eliminated.contains(&id) {
                eliminated.push(id);
            }
        }
        if r == "gt" {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
        emit(
            &mut frames,
            lo,
            mid,
            hi,
            comparisons,
            json!({"type":"choosePath","fromId":id,"pathId":if r=="gt"{"right"}else{"left"}}),
            if r == "gt" { 8 } else { 10 },
            json!({"current":id,"eliminated":eliminated}),
            "choose-path",
            format!(
                "{} = {}, window {lo}..{hi}",
                if r == "gt" { "lo" } else { "hi" },
                if r == "gt" { lo } else { hi }
            ),
        );
    }
    let idx = target_index(&s["instance"]);
    let found = answer >= 0 && answer == idx;
    let pointers = if found {
        json!({"current":oid(idx),"eliminated":eliminated})
    } else {
        json!({"eliminated":eliminated})
    };
    let mut note = if found {
        format!("found: target {target} at index {idx}")
    } else {
        "target absent from the array".into()
    };
    let mistakes = played
        .unwrap_or(&[])
        .iter()
        .filter(|f| f["correct"] == false)
        .count();
    if mistakes > 0 {
        note.push_str(&format!(" (player made {mistakes} misstep(s))"));
    }
    emit(
        &mut frames,
        lo,
        -1,
        hi,
        comparisons,
        json!({"type":"submitAnswer","targetId":"answer","value":answer.to_string()}),
        if found { 6 } else { 13 },
        pointers,
        "terminate",
        note,
    );
    json!(frames)
}
