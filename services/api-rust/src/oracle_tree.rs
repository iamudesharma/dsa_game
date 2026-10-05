//! Binary-tree algorithms share the bounded, ordered action-plan runner.
use serde_json::{json, Value};
fn sequence(n: usize, order: &str) -> Vec<usize> {
    fn walk(i: usize, n: usize, order: &str, out: &mut Vec<usize>) {
        if i >= n {
            return;
        }
        if order == "preorder" {
            out.push(i);
        }
        walk(2 * i + 1, n, order, out);
        if order == "inorder" {
            out.push(i);
        }
        walk(2 * i + 2, n, order, out);
        if order == "postorder" {
            out.push(i);
        }
    }
    let mut out = vec![];
    walk(0, n, order, &mut out);
    out
}
fn values(instance: &Value) -> Vec<i64> {
    instance["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect()
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
pub fn setup(state: &mut Value) {
    let id = state["problemId"].as_str().unwrap().to_owned();
    let n = state["instance"]["values"].as_array().unwrap().len();
    state["variables"] = json!({"i":0,"n":n});
    match id.as_str() {
        "bst-search" => {
            let target = state["instance"]["target"].clone();
            state["objects"]["target"] = json!({"id":"target","kind":"target","label":format!("target {target}"),"value":target,"state":"idle"});
            state["variables"] = json!({"i":0,"target":target,"n":n});
        }
        "tree-level-order" => {
            state["containers"]["queue"] =
                json!({"id":"queue","kind":"queue","label":"bfs queue","order":[],"capacity":n});
            state["variables"] = json!({"i":0,"size":0,"n":n});
        }
        "tree-traversals" => state["variables"] = json!({"i":0,"visited":0,"n":n}),
        _ => {}
    }
}
pub fn actions(instance: &Value) -> Vec<Value> {
    let id = instance["problemId"].as_str().unwrap();
    let v = values(instance);
    let n = v.len();
    let mut out = vec![];
    match id {
        "tree-traversals" => {
            let seq = sequence(n, instance["extras"]["order"].as_str().unwrap_or("inorder"));
            for i in &seq {
                out.push(json!({"type":"selectObject","objectId":format!("v{i}")}));
            }
            out.push(json!({"type":"submitAnswer","targetId":format!("v{}",seq.last().unwrap_or(&0)),"value":seq.iter().map(|i|v[*i].to_string()).collect::<Vec<_>>().join(",")}));
        }
        "bst-validate" => {
            let seq = sequence(n, "inorder");
            for (t, i) in seq.iter().enumerate() {
                out.push(json!({"type":"selectObject","objectId":format!("v{i}")}));
                if t == 0 {
                    continue;
                }
                let relation = rel(v[seq[t - 1]], v[*i]);
                out.push(json!({"type":"comparePair","aId":format!("v{}",seq[t-1]),"bId":format!("v{i}"),"relation":relation}));
                if relation != "lt" {
                    out.push(
                        json!({"type":"submitAnswer","targetId":format!("v{i}"),"value":"invalid"}),
                    );
                    return out;
                }
            }
            out.push(json!({"type":"submitAnswer","targetId":format!("v{}",seq.last().unwrap_or(&0)),"value":"valid"}));
        }
        "tree-level-order" => {
            let mut queue = std::collections::VecDeque::from([0]);
            let mut visited = vec![];
            out.push(json!({"type":"pushPop","containerId":"queue","op":"push","objectId":"v0"}));
            while let Some(i) = queue.pop_front() {
                out.push(json!({"type":"pushPop","containerId":"queue","op":"pop"}));
                out.push(json!({"type":"selectObject","objectId":format!("v{i}")}));
                visited.push(i);
                for c in [2 * i + 1, 2 * i + 2] {
                    if c < n {
                        out.push(json!({"type":"pushPop","containerId":"queue","op":"push","objectId":format!("v{c}")}));
                        queue.push_back(c);
                    }
                }
            }
            out.push(json!({"type":"submitAnswer","targetId":format!("v{}",visited.last().unwrap_or(&0)),"value":visited.iter().map(|i|v[*i].to_string()).collect::<Vec<_>>().join(",")}));
        }
        _ => {
            let target = instance["target"].as_i64().unwrap_or(0);
            let mut i = 0;
            for _ in 0..2 * n + 4 {
                if i >= n {
                    break;
                }
                out.push(json!({"type":"selectObject","objectId":format!("v{i}")}));
                let relation = rel(v[i], target);
                out.push(json!({"type":"comparePair","aId":format!("v{i}"),"bId":"target","relation":relation}));
                if relation == "eq" {
                    out.push(json!({"type":"submitAnswer","targetId":format!("v{i}"),"value":i.to_string()}));
                    return out;
                }
                let left = relation == "gt";
                out.push(json!({"type":"choosePath","fromId":format!("v{i}"),"pathId":if left{"left"}else{"right"}}));
                i = if left { 2 * i + 1 } else { 2 * i + 2 };
            }
            let answer = instance["extras"]["answerIndex"].as_i64().unwrap_or(0);
            out.push(json!({"type":"submitAnswer","targetId":format!("v{answer}"),"value":answer.to_string()}));
        }
    }
    out
}
pub fn code_line(id: &str, action: &Value, instance: &Value) -> usize {
    match action["type"].as_str().unwrap() {
        "submitAnswer" => {
            if id == "bst-validate" {
                if action["value"] == "valid" {
                    7
                } else {
                    5
                }
            } else {
                8
            }
        }
        "selectObject" => {
            if id == "tree-traversals" {
                match instance["extras"]["order"].as_str().unwrap_or("inorder") {
                    "preorder" => 3,
                    "postorder" => 7,
                    _ => 5,
                }
            } else {
                3
            }
        }
        "comparePair" => {
            if id == "bst-search" {
                4
            } else {
                5
            }
        }
        "pushPop" => {
            if action["op"] == "push" {
                7
            } else {
                5
            }
        }
        "choosePath" => 5,
        _ => 1,
    }
}
pub fn legal(next: &Value) -> Value {
    json!([match next["type"].as_str().unwrap() {
        "selectObject" =>
            json!({"type":"selectObject","label":"Visit the next node in the walk","options":{"objectIds":[next["objectId"]]}}),
        "comparePair" =>
            json!({"type":"comparePair","label":if next["bId"]=="target"{"Is the target below, equal to, or above this node?"}else{"Is this inorder value still larger than the previous one?"},"options":{"objectIds":[next["aId"],next["bId"]]},"expects":"relation"}),
        "pushPop" =>
            json!({"type":"pushPop","label":if next["op"]=="push"{"Enqueue the child"}else{"Dequeue the front of the queue"},"options":{"objectIds":next.get("objectId").map(|id|json!([id])).unwrap_or(json!([])),"containerIds":[next["containerId"]]}}),
        "choosePath" =>
            json!({"type":"choosePath","label":"Descend to the child that can still hold the target","options":{"objectIds":[next["fromId"]]}}),
        _ =>
            json!({"type":"submitAnswer","label":"Submit the result","expects":"value","options":{"objectIds":[next["targetId"]]}}),
    }])
}
pub fn queue_move(state: &mut Value, action: &Value) -> (String, String) {
    let container = action["containerId"].as_str().unwrap();
    let (feedback, note) = if action["op"] == "push" {
        let object = action["objectId"].as_str().unwrap();
        state["containers"][container]["order"]
            .as_array_mut()
            .unwrap()
            .push(json!(object));
        let slot = state["objects"][object]["slotId"]
            .as_str()
            .map(str::to_owned);
        if let Some(slot) = slot {
            state["slots"][&slot]
                .as_object_mut()
                .unwrap()
                .shift_remove("occupantId");
            state["objects"][object]
                .as_object_mut()
                .unwrap()
                .shift_remove("slotId");
        }
        state["objects"][object]["state"] = json!("visited");
        let label = state["objects"][object]["label"]
            .as_str()
            .unwrap_or("That node");
        (
            format!("{label} joins the back of the queue."),
            format!("Enqueue {label}."),
        )
    } else {
        let order = state["containers"][container]["order"]
            .as_array_mut()
            .unwrap();
        let object = if order.is_empty() {
            None
        } else {
            Some(order.remove(0))
        };
        if let Some(object) = object.as_ref() {
            state["objects"][object.as_str().unwrap()]["state"] = json!("visited");
        }
        let label = object
            .as_ref()
            .and_then(|o| state["objects"][o.as_str().unwrap()]["label"].as_str())
            .unwrap_or("The node");
        (
            format!("{label} leaves from the front of the queue."),
            format!(
                "Dequeue {}.",
                object
                    .as_ref()
                    .and_then(Value::as_str)
                    .unwrap_or("the front")
            ),
        )
    };
    state["variables"]["size"] = json!(state["containers"][container]["order"]
        .as_array()
        .unwrap()
        .len());
    (feedback, note)
}
pub fn answer(instance: &Value) -> Value {
    let id = instance["problemId"].as_str().unwrap();
    let v = values(instance);
    match id {
        "tree-traversals" => {
            let order = instance["extras"]["order"].as_str().unwrap_or("inorder");
            let value = sequence(v.len(), order)
                .iter()
                .map(|i| v[*i].to_string())
                .collect::<Vec<_>>()
                .join(",");
            json!({"text":format!("{order} order: {value}"),"value":value})
        }
        "bst-validate" => {
            let valid = sequence(v.len(), "inorder")
                .windows(2)
                .all(|w| v[w[1]] >= v[w[0]]);
            json!({"text":if valid{"the tree is a valid BST"}else{"the tree is not a BST"},"value":if valid{"valid"}else{"invalid"}})
        }
        "tree-level-order" => {
            let value = v.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
            json!({"text":format!("level order: {value}"),"value":value})
        }
        _ => {
            let answer = instance["extras"]["answerIndex"].as_i64().unwrap_or(0);
            json!({"text":format!("target {} at index {answer}",instance["target"]),"value":answer})
        }
    }
}
