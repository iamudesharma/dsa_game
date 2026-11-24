//! Heap and trie transitions. Plans track physical object identity across swaps.
use serde_json::{json, Value};
pub fn supports(id: &str) -> bool {
    ["kth-largest-heap", "trie-prefix-search"].contains(&id)
}
pub fn setup(s: &mut Value) {
    let x = s["instance"].clone();
    if x["problemId"] == "kth-largest-heap" {
        s["variables"] = json!({"i":x["extras"]["k"],"k":x["extras"]["k"],"heapMin":x["values"][0],"n":x["values"].as_array().unwrap().len()});
        return;
    }
    let nodes = x["extras"]["trieNodes"].as_array().unwrap();
    let mut objects = serde_json::Map::new();
    for (i, n) in nodes.iter().enumerate() {
        let id = n["id"].as_str().unwrap();
        let ch = n["ch"].as_str().unwrap();
        objects.insert(id.into(),json!({"id":id,"kind":"node","label":if ch.is_empty(){"root"}else{ch},"value":ch.chars().next().map(|c|c as u32).unwrap_or(0),"visual":{"kind":"text","text":if ch.is_empty(){"·"}else{ch}},"state":"idle","tags":{"index":i}}));
    }
    s["objects"] = Value::Object(objects);
    s["slots"] = json!({});
    s["cursor"] = json!({"nodeId":"t0"});
    s["variables"] = json!({"matched":0,"found":0,"n":nodes.len()});
    for end in x["extras"]["ends"].as_array().unwrap() {
        s["variables"][format!("end_{}", end.as_str().unwrap())] = json!(1);
    }
    s["links"] = json!(x["extras"]["trieLinks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| json!({"from":l["from"],"to":l["to"],"kind":"next"}))
        .collect::<Vec<_>>());
}
fn children(x: &Value, id: &str) -> Vec<String> {
    let mut out: Vec<_> = x["extras"]["trieLinks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|l| l["from"] == id)
        .map(|l| l["to"].as_str().unwrap().to_owned())
        .collect();
    out.sort_by_key(|id| {
        x["extras"]["trieNodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id.as_str())
            .unwrap()["ch"]
            .as_str()
            .unwrap()
            .to_owned()
    });
    out
}
fn completions(x: &Value, id: &str, out: &mut Vec<String>) {
    if x["extras"]["ends"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == id)
    {
        out.push(id.into());
    }
    for child in children(x, id) {
        completions(x, &child, out);
    }
}
pub fn actions(x: &Value) -> Vec<Value> {
    let mut out = vec![];
    if x["problemId"] == "trie-prefix-search" {
        let mut cur = "t0".to_owned();
        for ch in x["extras"]["query"].as_str().unwrap().chars() {
            let found = children(x, &cur).into_iter().find(|id| {
                x["extras"]["trieNodes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|n| n["id"] == id.as_str())
                    .unwrap()["ch"]
                    == ch.to_string()
            });
            let Some(next) = found else { break };
            out.push(json!({"type":"traverseNode","fromNodeId":cur,"toNodeId":next}));
            cur = next;
        }
        let mut ends = vec![];
        completions(x, &cur, &mut ends);
        for id in &ends {
            out.push(json!({"type":"selectObject","objectId":id}));
        }
        out.push(json!({"type":"submitAnswer","targetId":ends.last().unwrap_or(&cur),"value":ends.len().to_string()}));
        return out;
    }
    let mut h: Vec<_> = x["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    let mut ids: Vec<_> = (0..h.len()).map(|i| format!("v{i}")).collect();
    let k = x["extras"]["k"].as_u64().unwrap() as usize;
    for i in k..h.len() {
        out.push(json!({"type":"selectObject","objectId":ids[i]}));
        let rel = if h[i] > h[0] {
            "gt"
        } else if h[i] < h[0] {
            "lt"
        } else {
            "eq"
        };
        out.push(json!({"type":"comparePair","aId":ids[i],"bId":ids[0],"relation":rel}));
        if rel != "gt" {
            continue;
        }
        out.push(json!({"type":"swapPair","aId":ids[i],"bId":ids[0]}));
        h.swap(i, 0);
        ids.swap(i, 0);
        let mut p = 0;
        loop {
            let mut smallest = p;
            for child in [2 * p + 1, 2 * p + 2] {
                if child < k && h[child] < h[smallest] {
                    smallest = child;
                }
            }
            if smallest == p {
                break;
            }
            out.push(
                json!({"type":"comparePair","aId":ids[p],"bId":ids[smallest],"relation":"gt"}),
            );
            out.push(json!({"type":"swapPair","aId":ids[p],"bId":ids[smallest]}));
            h.swap(p, smallest);
            ids.swap(p, smallest);
            p = smallest;
        }
    }
    out.push(json!({"type":"submitAnswer","targetId":ids[0],"value":h[0].to_string()}));
    out
}
pub fn code_line(id: &str, a: &Value) -> usize {
    match (id, a["type"].as_str().unwrap()) {
        ("trie-prefix-search", "submitAnswer" | "selectObject") => 7,
        ("trie-prefix-search", "traverseNode") => 4,
        (_, "submitAnswer") => 10,
        (_, "selectObject") => 4,
        (_, "comparePair") => 5,
        (_, "swapPair") => 6,
        _ => 1,
    }
}
pub fn legal(id: &str, a: &Value) -> Value {
    let trie = id == "trie-prefix-search";
    let kind = a["type"].as_str().unwrap();
    let label = match kind {
        "traverseNode" => "Follow the link for the next letter",
        "selectObject" => {
            if trie {
                "Count this word completion"
            } else {
                "Read the next scan value"
            }
        }
        "comparePair" => "Is this value larger than the heap minimum?",
        "swapPair" => "Exchange with the heap root and restore the heap",
        _ => {
            if trie {
                "Submit the completion count"
            } else {
                "Report the kth largest value"
            }
        }
    };
    let ids = match kind {
        "traverseNode" => json!([a["fromNodeId"], a["toNodeId"]]),
        "selectObject" => json!([a["objectId"]]),
        "comparePair" | "swapPair" => json!([a["aId"], a["bId"]]),
        _ => json!([a["targetId"]]),
    };
    let mut desc = json!({"type":kind,"label":label,"options":{"objectIds":ids}});
    if kind == "comparePair" {
        desc["expects"] = json!("relation");
    }
    if kind == "submitAnswer" {
        desc["expects"] = json!("value");
    }
    json!([desc])
}
pub fn swap(s: &mut Value, a: &Value) {
    let left = a["aId"].as_str().unwrap();
    let right = a["bId"].as_str().unwrap();
    let sa = s["objects"][left]["slotId"].as_str().unwrap().to_owned();
    let sb = s["objects"][right]["slotId"].as_str().unwrap().to_owned();
    s["objects"][left]["slotId"] = json!(sb);
    s["objects"][right]["slotId"] = json!(sa);
    s["slots"][&sa]["occupantId"] = json!(right);
    s["slots"][&sb]["occupantId"] = json!(left);
    let root = s["slots"]["s0"]["occupantId"].as_str().unwrap().to_owned();
    s["variables"]["heapMin"] = s["objects"][root]["value"].clone();
}
pub fn answer(x: &Value) -> Value {
    if x["problemId"] == "trie-prefix-search" {
        let query = x["extras"]["query"].as_str().unwrap();
        let count = x["extras"]["words"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|w| w.as_str().unwrap().starts_with(query))
            .count();
        return json!({"text":format!("\"{query}\" matches {count} word{}",if count==1{""}else{"s"}),"value":count});
    }
    let k = x["extras"]["k"].as_u64().unwrap() as usize;
    let mut values: Vec<_> = x["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    values.sort_unstable_by(|a, b| b.cmp(a));
    let answer = values[k - 1];
    json!({"text":format!("kth largest (k={k}) is {answer}"),"value":answer,"details":[{"label":"k","value":k},{"label":"heap minimum","value":answer},{"label":"array length","value":values.len()}]})
}
