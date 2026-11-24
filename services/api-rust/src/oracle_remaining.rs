//! Shared deterministic routines for arrays, stacks, queues and linked lists.
use serde_json::{json, Value};
pub fn supports(id: &str) -> bool {
    [
        "two-sum",
        "move-zeroes",
        "valid-parentheses",
        "stack-push-pop",
        "queue-operations",
        "linked-list-traversal",
        "reverse-linked-list",
    ]
    .contains(&id)
}
fn inc(s: &mut Value, key: &str) {
    s["variables"][key] = json!(s["variables"][key].as_i64().unwrap_or(0) + 1);
}
fn position(s: &Value, id: &str) -> i64 {
    s["slots"]
        .as_object()
        .unwrap()
        .values()
        .find(|slot| slot["occupantId"] == id)
        .and_then(|slot| slot["index"].as_i64())
        .or_else(|| s["objects"][id]["tags"]["index"].as_i64())
        .unwrap_or(-1)
}
pub fn setup(s: &mut Value) {
    let x = s["instance"].clone();
    let id = x["problemId"].as_str().unwrap();
    let n = x["values"].as_array().unwrap().len();
    s["variables"] = json!({"i":0,"n":n});
    match id {
        "linked-list-traversal" | "reverse-linked-list" => {
            let mut objects = serde_json::Map::new();
            for (i, node) in x["list"].as_array().unwrap().iter().enumerate() {
                let id = node["id"].as_str().unwrap();
                let label = node["value"].to_string();
                objects.insert(id.into(),json!({"id":id,"kind":"node","label":label,"value":node["value"],"visual":{"kind":"text","text":label},"state":"idle","tags":{"index":i}}));
            }
            if id == "reverse-linked-list" {
                objects.insert("null".into(),json!({"id":"null","kind":"node","label":"NULL","visual":{"kind":"text","text":"∅"},"state":"idle"}));
            }
            s["objects"] = Value::Object(objects);
            s["slots"] = json!({});
            s["cursor"] = json!({"nodeId":"n0"});
            s["variables"] = json!({"i":0,"count":if n>0{1}else{0},"n":n});
            s["links"] = json!((0..n.saturating_sub(1))
                .map(|i| json!({"from":format!("n{i}"),"to":format!("n{}",i+1),"kind":"next"}))
                .collect::<Vec<_>>());
        }
        "two-sum" => {
            s["objects"]["target"] = json!({"id":"target","kind":"target","label":format!("target {}",x["target"]),"value":x["target"],"state":"idle"});
            s["variables"] = json!({"i":0,"need":null,"target":x["target"]});
            for i in 0..n {
                s["variables"][format!("seen_{i}")] = Value::Null;
            }
        }
        "move-zeroes" => {
            s["objects"]["zero-guide"] = json!({"id":"zero-guide","kind":"target","label":"zero","value":0,"state":"locked"});
            s["variables"] = json!({"read":0,"write":0,"n":n});
        }
        "valid-parentheses" => {
            s["variables"] = json!({"i":0,"depth":0,"pairs":0});
            s["containers"]["stack"] = json!({"id":"stack","kind":"stack","label":"matching openers","order":[],"capacity":n});
            for (i, t) in x["tokens"].as_array().unwrap().iter().enumerate() {
                let o = &mut s["objects"][format!("v{i}")];
                o["kind"] = json!("token");
                o["label"] = t.clone();
                o["visual"]["text"] = t.clone();
                o.as_object_mut().unwrap().shift_remove("value");
            }
        }
        _ => {
            let kind = if id == "queue-operations" {
                "queue"
            } else {
                "stack"
            };
            s["containers"]["main"] =
                json!({"id":"main","kind":kind,"label":kind,"order":[],"capacity":n});
            s["variables"] = json!({"i":0,"size":0,"n":n});
        }
    }
}
fn select(id: &str) -> Value {
    json!({"type":"selectObject","objectId":id})
}
fn assign(key: &str, v: i64) -> Value {
    json!({"type":"assignValue","targetId":key,"value":v.to_string()})
}
fn submit(id: &str, v: String) -> Value {
    json!({"type":"submitAnswer","targetId":id,"value":v})
}
fn rel(a: i64, b: i64) -> &'static str {
    if a < b {
        "lt"
    } else if a > b {
        "gt"
    } else {
        "eq"
    }
}
pub fn actions(x: &Value) -> Vec<Value> {
    let id = x["problemId"].as_str().unwrap();
    let values: Vec<_> = x["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    let n = values.len();
    let mut out = vec![];
    match id {
        "two-sum" => {
            let mut seen = std::collections::HashMap::new();
            for (i, v) in values.iter().enumerate() {
                let oid = format!("v{i}");
                let need = x["target"].as_i64().unwrap() - v;
                out.push(select(&oid));
                out.push(assign("need", need));
                if let Some(other) = seen.get(&need) {
                    let mut pair = [*other, i];
                    pair.sort();
                    out.push(submit(&oid, format!("{},{}", pair[0], pair[1])));
                    return out;
                }
                out.push(assign(&format!("seen_{i}"), *v));
                seen.insert(*v, i);
            }
        }
        "move-zeroes" => {
            let mut cells: Vec<_> = values
                .iter()
                .enumerate()
                .map(|(i, v)| (format!("v{i}"), *v))
                .collect();
            let mut write = 0;
            for read in 0..n {
                let (id, v) = cells[read].clone();
                out.push(select(&id));
                out.push(
                    json!({"type":"comparePair","aId":id,"bId":"zero-guide","relation":rel(v,0)}),
                );
                if v != 0 {
                    if read != write {
                        out.push(json!({"type":"swapPair","aId":id,"bId":cells[write].0}));
                        cells.swap(read, write);
                    }
                    write += 1;
                }
            }
            out.push(submit(&cells[0].0, "done".into()));
        }
        "stack-push-pop" | "queue-operations" => {
            for i in 0..n {
                let id = format!("v{i}");
                out.push(select(&id));
                out.push(json!({"type":"pushPop","containerId":"main","op":"push","objectId":id}));
            }
            let mut indices: Vec<_> = (0..n).collect();
            if id == "stack-push-pop" {
                indices.reverse();
            }
            for _ in &indices {
                out.push(json!({"type":"pushPop","containerId":"main","op":"pop"}));
            }
            out.push(submit(
                "v0",
                indices
                    .iter()
                    .map(|i| values[*i].to_string())
                    .collect::<Vec<_>>()
                    .join(","),
            ));
        }
        "valid-parentheses" => {
            let tokens: Vec<_> = x["tokens"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect();
            let mut stack: Vec<usize> = vec![];
            for (i, token) in tokens.iter().enumerate() {
                if ["(", "[", "{"].contains(token) {
                    out.push(select(&format!("v{i}")));
                    out.push(json!({"type":"pushPop","containerId":"stack","op":"push","objectId":format!("v{i}")}));
                    stack.push(i);
                    continue;
                }
                let opener = stack.last().map(|i| tokens[*i]).unwrap_or("");
                let same = matches!((opener, *token), ("(", ")") | ("[", "]") | ("{", "}"));
                let rank = |t: &str| match t {
                    "(" | ")" => 0,
                    "[" | "]" => 1,
                    "{" | "}" => 2,
                    _ => -1,
                };
                out.push(json!({"type":"comparePair","aId":format!("v{}",stack.last().copied().unwrap_or(0)),"bId":format!("v{i}"),"relation":if same{"eq"}else{rel(rank(opener),rank(token))}}));
                if !same {
                    out.push(submit(&format!("v{i}"), "invalid".into()));
                    return out;
                }
                out.push(json!({"type":"pushPop","containerId":"stack","op":"pop"}));
                stack.pop();
            }
            out.push(submit(
                "v0",
                if stack.is_empty() { "valid" } else { "invalid" }.into(),
            ));
        }
        "linked-list-traversal" => {
            for i in 0..n.saturating_sub(1) {
                out.push(json!({"type":"traverseNode","fromNodeId":format!("n{i}"),"toNodeId":format!("n{}",i+1)}));
            }
            out.push(submit("n0", format!("length {n}")));
        }
        _ => {
            for i in 0..n {
                out.push(json!({"type":"connectNodes","fromNodeId":format!("n{i}"),"toNodeId":if i==0{"null".into()}else{format!("n{}",i-1)},"linkKind":"next"}));
            }
            out.push(submit(&format!("n{}", n - 1), values[n - 1].to_string()));
        }
    }
    out
}
pub fn code_line(id: &str, a: &Value) -> usize {
    let t = a["type"].as_str().unwrap();
    match id {
        "two-sum" => match t {
            "selectObject" => 3,
            "assignValue" => {
                if a["targetId"] == "need" {
                    4
                } else {
                    6
                }
            }
            _ => 5,
        },
        "move-zeroes" => match t {
            "selectObject" => 3,
            "comparePair" => 4,
            "swapPair" => 5,
            _ => 9,
        },
        "valid-parentheses" => match t {
            "selectObject" => 4,
            "comparePair" => 5,
            "pushPop" => {
                if a["op"] == "push" {
                    4
                } else {
                    5
                }
            }
            _ => 7,
        },
        "stack-push-pop" | "queue-operations" => match t {
            "selectObject" => 3,
            "pushPop" => {
                if a["op"] == "push" {
                    3
                } else {
                    5
                }
            }
            _ => 6,
        },
        "linked-list-traversal" => {
            if t == "traverseNode" {
                6
            } else {
                8
            }
        }
        _ => {
            if t == "connectNodes" {
                6
            } else {
                10
            }
        }
    }
}
pub fn legal(a: &Value) -> Value {
    let t = a["type"].as_str().unwrap();
    let label = match t {
        "selectObject" => "Read the next item",
        "comparePair" => "Compare these two items",
        "pushPop" => {
            if a["op"] == "push" {
                "Push / enqueue the selected item"
            } else {
                "Pop / dequeue the next item"
            }
        }
        "assignValue" => "Record the value",
        "traverseNode" => "Follow the next link",
        "connectNodes" => "Connect the next pointer",
        "swapPair" => "Swap the nonzero item into the write position",
        _ => "Submit the result",
    };
    let ids = match t {
        "selectObject" => json!([a["objectId"]]),
        "comparePair" | "swapPair" => json!([a["aId"], a["bId"]]),
        "traverseNode" | "connectNodes" => json!([a["fromNodeId"], a["toNodeId"]]),
        "assignValue" => json!([]),
        "pushPop" => a.get("objectId").map(|v| json!([v])).unwrap_or(json!([])),
        _ => json!([a["targetId"]]),
    };
    let mut desc = json!({"type":t,"label":label,"options":{"objectIds":ids}});
    match t {
        "comparePair" => desc["expects"] = json!("relation"),
        "assignValue" => {
            desc["expects"] = json!("value");
            desc["options"]["targetIds"] = json!([a["targetId"]]);
        }
        "submitAnswer" => desc["expects"] = json!("value"),
        "pushPop" => desc["options"]["containerIds"] = json!([a["containerId"]]),
        _ => {}
    }
    json!([desc])
}
pub fn push_pop(s: &mut Value, a: &Value) -> (String, String) {
    let cid = a["containerId"].as_str().unwrap();
    let kind = s["containers"][cid]["kind"].as_str().unwrap().to_owned();
    let feedback;
    let note;
    if a["op"] == "push" {
        let oid = a["objectId"].as_str().unwrap();
        s["containers"][cid]["order"]
            .as_array_mut()
            .unwrap()
            .push(json!(oid));
        if let Some(slot) = s["objects"][oid]["slotId"].as_str().map(str::to_owned) {
            s["slots"][slot]
                .as_object_mut()
                .unwrap()
                .shift_remove("occupantId");
            s["objects"][oid]
                .as_object_mut()
                .unwrap()
                .shift_remove("slotId");
        }
        s["objects"][oid]["state"] = json!("visited");
        let label = s["objects"][oid]["label"].as_str().unwrap();
        feedback = format!(
            "{label} goes onto the {}.",
            if kind == "queue" {
                "rear of the queue"
            } else {
                "top of the stack"
            }
        );
        note = format!("Push {label}.");
    } else {
        let order = s["containers"][cid]["order"].as_array_mut().unwrap();
        let removed = if kind == "queue" {
            order.remove(0)
        } else {
            order.pop().unwrap()
        };
        let oid = removed.as_str().unwrap();
        s["objects"][oid]["state"] = json!("visited");
        feedback = format!(
            "{} leaves from the {}.",
            s["objects"][oid]["label"].as_str().unwrap(),
            if kind == "queue" {
                "front of the queue"
            } else {
                "top of the stack"
            }
        );
        note = format!("Remove {oid} from the {kind}.");
    }
    let n = s["containers"][cid]["order"].as_array().unwrap().len();
    s["variables"]["size"] = json!(n);
    s["variables"]["depth"] = json!(n);
    (feedback, note)
}
pub fn traverse(s: &mut Value, a: &Value) -> (String, String) {
    s["cursor"]["prevNodeId"] = a["fromNodeId"].clone();
    s["cursor"]["nodeId"] = a["toNodeId"].clone();
    inc(s, "count");
    inc(s, "i");
    let id = a["toNodeId"].as_str().unwrap();
    (
        format!(
            "Follow one link; the pointer now reaches {}.",
            s["objects"][id]["label"].as_str().unwrap_or(id)
        ),
        "Advance current to current.next.".into(),
    )
}
pub fn connect(s: &mut Value, a: &Value) -> (String, String) {
    s["links"]
        .as_array_mut()
        .unwrap()
        .retain(|l| !(l["from"] == a["fromNodeId"] && l["kind"] == a["linkKind"]));
    if a["toNodeId"] != "null" {
        s["links"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":a["fromNodeId"],"to":a["toNodeId"],"kind":a["linkKind"]}));
    }
    inc(s, "i");
    s["selection"] = json!([a["fromNodeId"], a["toNodeId"]]);
    let from = a["fromNodeId"].as_str().unwrap();
    let to = a["toNodeId"].as_str().unwrap();
    (
        format!(
            "{} now points to {}.",
            s["objects"][from]["label"].as_str().unwrap(),
            s["objects"][to]["label"].as_str().unwrap()
        ),
        "Reverse one next pointer toward the previous node.".into(),
    )
}
pub fn after(s: &mut Value, a: &Value, feedback: &mut String, note: &mut String) {
    let id = s["problemId"].as_str().unwrap().to_owned();
    match a["type"].as_str().unwrap() {
        "selectObject" => {
            let pos = position(s, a["objectId"].as_str().unwrap());
            if pos >= 0 {
                s["variables"]["read"] = json!(pos);
            }
        }
        "comparePair" => {
            if id == "move-zeroes" {
                s["variables"]["read"] = json!(position(s, a["aId"].as_str().unwrap()));
                if a["relation"] != "eq" {
                    inc(s, "write");
                }
            }
            if id == "valid-parentheses" {
                if a["relation"] == "eq" {
                    inc(s, "pairs");
                }
                let pos = position(s, a["bId"].as_str().unwrap());
                s["variables"]["i"] = json!(pos);
                s["cursor"]["iSlotId"] = json!(format!("s{pos}"));
            }
            *note = if a["relation"] == "eq" {
                "The values match.".into()
            } else {
                format!("The relation is {}.", a["relation"].as_str().unwrap())
            };
        }
        "swapPair" => {
            s["variables"]
                .as_object_mut()
                .unwrap()
                .shift_remove("heapMin");
            *feedback = "The nonzero value is now in the next write position.".into();
            *note = "Swap the read value into the next available position.".into();
        }
        _ => {}
    }
}
pub fn answer(x: &Value) -> Value {
    let id = x["problemId"].as_str().unwrap();
    let values = x["values"].as_array().unwrap();
    match id {
        "two-sum" => {
            let pair = x["extras"]["answerIndices"].as_array().unwrap();
            json!({"text":format!("indices {} and {}",pair[0],pair[1]),"value":format!("{},{}",pair[0],pair[1])})
        }
        "move-zeroes" => json!({"text":"all zeroes are at the end","value":"done"}),
        "valid-parentheses" => {
            if x["extras"]["valid"] == true {
                json!({"text":"the brackets are balanced","value":"valid"})
            } else {
                json!({"text":"the brackets are not balanced","value":"invalid"})
            }
        }
        "stack-push-pop" | "queue-operations" => {
            let mut v: Vec<_> = values.iter().map(Value::to_string).collect();
            if id == "stack-push-pop" {
                v.reverse();
            }
            json!({"text":format!("{} order: {}",if id=="stack-push-pop"{"pop"}else{"dequeue"},v.join(", ")),"value":v.join(",")})
        }
        "linked-list-traversal" => {
            json!({"text":format!("length {}",values.len()),"value":values.len()})
        }
        _ => {
            json!({"text":format!("new head value {}",values.last().unwrap()),"value":values.last().unwrap()})
        }
    }
}
