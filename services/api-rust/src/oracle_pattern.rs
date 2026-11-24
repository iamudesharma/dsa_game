//! Array, string, window, prefix, interval and pointer algorithms.
use serde_json::{json, Value};
pub const IDS: [&str; 11] = [
    "sliding-window-max-sum",
    "two-pointers-pair",
    "prefix-sum-range",
    "kadane-max-subarray",
    "merge-intervals",
    "next-greater-element",
    "rotated-search",
    "linked-list-cycle",
    "frequency-count",
    "valid-anagram",
    "valid-palindrome",
];
pub fn supports(id: &str) -> bool {
    IDS.contains(&id)
}
fn nums(v: &Value) -> Vec<i64> {
    v.as_array()
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
fn select(i: usize) -> Value {
    json!({"type":"selectObject","objectId":format!("v{i}")})
}
fn assign(target: String, value: i64) -> Value {
    json!({"type":"assignValue","targetId":target,"value":value.to_string()})
}
fn submit(target: String, value: String) -> Value {
    json!({"type":"submitAnswer","targetId":target,"value":value})
}
fn compare(a: usize, b: usize, relation: &str) -> Value {
    json!({"type":"comparePair","aId":format!("v{a}"),"bId":format!("v{b}"),"relation":relation})
}
pub fn setup(state: &mut Value) {
    let id = state["problemId"].as_str().unwrap().to_owned();
    let instance = state["instance"].clone();
    let v = nums(&instance["values"]);
    let n = v.len();
    let e = &instance["extras"];
    state["variables"] = json!({"i":0,"n":n});
    match id.as_str() {
        "sliding-window-max-sum" => {
            let k = e["k"].as_i64().unwrap_or(3);
            state["objects"]["k-guide"] = json!({"id":"k-guide","kind":"target","label":format!("window {k}"),"value":k,"state":"locked"});
            state["variables"] = json!({"i":0,"k":k,"best":null,"window":0,"n":n});
        }
        "two-pointers-pair" | "rotated-search" => {
            let t = instance["target"].clone();
            state["objects"]["target"] = json!({"id":"target","kind":"target","label":format!("target {t}"),"value":t,"state":"idle"});
            state["variables"] = if id == "two-pointers-pair" {
                json!({"L":0,"R":n-1,"target":t,"n":n})
            } else {
                json!({"lo":0,"hi":n-1,"mid":0,"target":t,"n":n})
            };
        }
        "prefix-sum-range" => {
            let l = e["l"].as_i64().unwrap_or(0);
            let r = e["r"].as_i64().unwrap_or(0);
            state["objects"]["query"] = json!({"id":"query","kind":"target","label":format!("sum [{l}..{r}]"),"state":"locked"});
            state["variables"] = json!({"i":0,"l":l,"r":r,"n":n});
        }
        "kadane-max-subarray" => state["variables"] = json!({"i":1,"cur":v[0],"best":v[0],"n":n}),
        "merge-intervals" => {
            state["variables"] =
                json!({"i":1,"curStart":e["starts"][0],"curEnd":e["ends"][0],"n":n})
        }
        "next-greater-element" => {
            state["containers"]["stack"] = json!({"id":"stack","kind":"stack","label":"decreasing stack","order":[],"capacity":n})
        }
        "valid-anagram" | "valid-palindrome" => {
            for (i, ch) in instance["tokens"].as_array().unwrap().iter().enumerate() {
                let o = &mut state["objects"][format!("v{i}")];
                o["kind"] = json!("token");
                o["label"] = ch.clone();
                o["visual"]["text"] = ch.clone();
                o.as_object_mut().unwrap().shift_remove("value");
            }
            if id == "valid-palindrome" {
                state["variables"] = json!({"left":0,"right":n-1,"n":n});
            }
        }
        "linked-list-cycle" => {
            state["objects"] = json!({});
            for (i, node) in instance["list"].as_array().unwrap().iter().enumerate() {
                let id = node["id"].as_str().unwrap();
                let value = node["value"].clone();
                state["objects"][id] = json!({"id":id,"kind":"node","label":value.to_string(),"value":value,"visual":{"kind":"text","text":value.to_string()},"state":"idle","tags":{"index":i}});
            }
            state["objects"]["null"] = json!({"id":"null","kind":"node","label":"NULL","visual":{"kind":"text","text":"∅"},"state":"idle"});
            state["slots"] = json!({});
            let mut links: Vec<_> = (0..n - 1)
                .map(|i| json!({"from":format!("n{i}"),"to":format!("n{}",i+1),"kind":"next"}))
                .collect();
            if e["hasCycle"] == true {
                let index = e["cycleIndex"].as_i64().unwrap_or(-1);
                if index >= 0 && index < n as i64 {
                    links.push(
                        json!({"from":format!("n{}",n-1),"to":format!("n{index}"),"kind":"next"}),
                    );
                }
            }
            state["links"] = json!(links);
            state["cursor"] = json!({"nodeId":"n0"});
            state["variables"] = json!({"slow":0,"fast":0,"n":n});
            state["internal"] = json!({"planIndex":0,"step":0,"slow":0,"fast":0});
        }
        _ => {}
    }
}
pub fn actions(instance: &Value) -> Vec<Value> {
    let id = instance["problemId"].as_str().unwrap();
    let v = nums(&instance["values"]);
    let n = v.len();
    let e = &instance["extras"];
    let mut out = vec![];
    match id {
        "sliding-window-max-sum" => {
            let k = e["k"].as_u64().unwrap_or(3) as usize;
            let mut best = i64::MIN;
            for s in 0..=n - k {
                let sum = v[s..s + k].iter().sum::<i64>();
                best = best.max(sum);
                out.push(select(s));
                out.push(assign(format!("w_{s}"), sum));
            }
            out.push(submit(format!("v{}", n - k), best.to_string()));
        }
        "two-pointers-pair" => {
            let target = instance["target"].as_i64().unwrap_or(0);
            let (mut l, mut r) = (0, n - 1);
            for _ in 0..2 * n + 4 {
                if l >= r {
                    break;
                }
                out.extend([select(l), select(r)]);
                let relation = rel(v[l] + v[r], target);
                out.push(compare(l, r, relation));
                if relation == "eq" {
                    out.push(submit(format!("v{r}"), format!("{l},{r}")));
                    return out;
                }
                if relation == "lt" {
                    l += 1;
                } else {
                    r -= 1;
                }
            }
            out.push(submit("v0".into(), "0,1".into()));
        }
        "prefix-sum-range" => {
            let mut run = 0;
            for (i, value) in v.iter().enumerate() {
                run += value;
                out.extend([select(i), assign(format!("p_{}", i + 1), run)]);
            }
            let l = e["l"].as_u64().unwrap_or(0) as usize;
            let r = e["r"].as_u64().unwrap_or(0) as usize;
            out.push(submit(
                format!("v{r}"),
                v[l..=r].iter().sum::<i64>().to_string(),
            ));
        }
        "kadane-max-subarray" => {
            let (mut cur, mut best) = (v[0], v[0]);
            for (i, value) in v.iter().enumerate().skip(1) {
                let extend = cur + value;
                out.extend([select(i), compare(i, i - 1, rel(extend, *value))]);
                cur = extend.max(*value);
                best = best.max(cur);
                out.push(assign("cur".into(), cur));
            }
            out.push(submit(format!("v{}", n - 1), best.to_string()));
        }
        "merge-intervals" => {
            let starts = nums(&e["starts"]);
            let ends = nums(&e["ends"]);
            let (mut s, mut end) = (starts[0], ends[0]);
            let mut merged = vec![];
            for i in 1..starts.len() {
                out.extend([
                    select(2 * i),
                    compare(2 * i, 2 * (i - 1), rel(starts[i], end)),
                ]);
                if starts[i] <= end {
                    end = end.max(ends[i]);
                    out.push(assign("curEnd".into(), end));
                } else {
                    merged.push(format!("{s}-{end}"));
                    s = starts[i];
                    end = ends[i];
                    out.extend([assign("curStart".into(), s), assign("curEnd".into(), end)]);
                }
            }
            merged.push(format!("{s}-{end}"));
            out.push(submit(
                format!("v{}", 2 * (starts.len() - 1)),
                merged.join(","),
            ));
        }
        "next-greater-element" => {
            let mut stack: Vec<usize> = vec![];
            let mut ans = vec![-1; n];
            for i in 0..n {
                out.push(select(i));
                while stack.last().is_some_and(|top| v[*top] < v[i]) {
                    let top = stack.pop().unwrap();
                    out.push(compare(top, i, "lt"));
                    out.push(json!({"type":"pushPop","containerId":"stack","op":"pop"}));
                    ans[top] = v[i];
                }
                out.push(json!({"type":"pushPop","containerId":"stack","op":"push","objectId":format!("v{i}")}));
                stack.push(i);
            }
            out.push(submit(
                "v0".into(),
                ans.iter().map(i64::to_string).collect::<Vec<_>>().join(","),
            ));
        }
        "rotated-search" => {
            let target = instance["target"].as_i64().unwrap_or(0);
            let (mut lo, mut hi) = (0i64, n as i64 - 1);
            for _ in 0..64 {
                if lo > hi {
                    break;
                }
                let mid = ((lo + hi) / 2) as usize;
                out.push(select(mid));
                let relation = rel(v[mid], target);
                out.push(json!({"type":"comparePair","aId":format!("v{mid}"),"bId":"target","relation":relation}));
                if relation == "eq" {
                    out.push(
                        json!({"type":"choosePath","fromId":format!("v{mid}"),"pathId":"found"}),
                    );
                    out.push(submit(format!("v{mid}"), mid.to_string()));
                    return out;
                }
                let left = if v[lo as usize] <= v[mid] {
                    target >= v[lo as usize] && target < v[mid]
                } else {
                    !(target > v[mid] && target <= v[hi as usize])
                };
                out.push(json!({"type":"choosePath","fromId":format!("v{mid}"),"pathId":if left{"left"}else{"right"}}));
                if left {
                    hi = mid as i64 - 1;
                } else {
                    lo = mid as i64 + 1;
                }
            }
            let index = e["answerIndex"].as_i64().unwrap_or(0);
            out.push(submit(format!("v{index}"), index.to_string()));
        }
        "linked-list-cycle" => {
            let cycle = e["hasCycle"] == true;
            let index = e["cycleIndex"].as_i64().unwrap_or(-1);
            let next = |i: i64| {
                if i + 1 < n as i64 {
                    i + 1
                } else if cycle {
                    index
                } else {
                    -1
                }
            };
            let node = |i: i64| {
                if i == -1 {
                    "null".into()
                } else {
                    format!("n{i}")
                }
            };
            let (mut slow, mut fast) = (0, 0);
            for _ in 0..4 * n + 8 {
                let s = next(slow);
                out.push(json!({"type":"traverseNode","fromNodeId":format!("n{slow}"),"toNodeId":node(s)}));
                slow = s;
                let f = next(fast);
                out.push(json!({"type":"traverseNode","fromNodeId":format!("n{fast}"),"toNodeId":node(f)}));
                if f == -1 {
                    out.push(submit("null".into(), "acyclic".into()));
                    return out;
                }
                fast = f;
                let f = next(fast);
                out.push(json!({"type":"traverseNode","fromNodeId":format!("n{fast}"),"toNodeId":node(f)}));
                if f == -1 {
                    out.push(submit("null".into(), "acyclic".into()));
                    return out;
                }
                fast = f;
                if slow == fast {
                    out.push(submit(node(slow), "cycle".into()));
                    return out;
                }
            }
            out.push(submit(
                "null".into(),
                if cycle { "cycle" } else { "acyclic" }.into(),
            ));
        }
        "frequency-count" => {
            let mut counts = std::collections::HashMap::new();
            let (mut mode, mut best) = (v[0], 0);
            for (i, value) in v.iter().enumerate() {
                let c = counts.entry(*value).or_insert(0);
                *c += 1;
                if *c > best {
                    best = *c;
                    mode = *value;
                }
                out.extend([select(i), assign(format!("freq_{value}"), *c)]);
            }
            out.push(submit(
                format!("v{}", v.iter().position(|v| *v == mode).unwrap()),
                mode.to_string(),
            ));
        }
        "valid-anagram" => {
            let tokens = instance["tokens"].as_array().unwrap();
            let l = e["split"].as_u64().map(|v| v as usize).unwrap_or(n / 2);
            let mut counts = std::collections::HashMap::new();
            for (i, token) in tokens.iter().enumerate().take(2 * l) {
                let token = token.as_str().unwrap();
                let c = counts.entry(token).or_insert(0);
                *c += if i < l { 1 } else { -1 };
                out.extend([select(i), assign(format!("cnt_{token}"), *c)]);
            }
            out.push(submit(
                format!("v{}", 2 * l - 1),
                if e["valid"] == true {
                    "valid"
                } else {
                    "invalid"
                }
                .into(),
            ));
        }
        "valid-palindrome" => {
            for l in 0..n / 2 {
                let r = n - 1 - l;
                let relation = rel(v[l], v[r]);
                out.extend([select(l), compare(l, r, relation)]);
                if relation != "eq" {
                    out.push(submit(format!("v{l}"), "invalid".into()));
                    return out;
                }
            }
            out.push(submit(
                format!("v{}", n - 1),
                if e["valid"] == true {
                    "valid"
                } else {
                    "invalid"
                }
                .into(),
            ));
        }
        _ => unreachable!(),
    }
    out
}
pub fn code_line(id: &str, a: &Value) -> usize {
    match a["type"].as_str().unwrap() {
        "submitAnswer" => {
            if id == "linked-list-cycle" {
                if a["value"] == "cycle" {
                    6
                } else {
                    8
                }
            } else if id == "valid-anagram" {
                if a["value"] == "valid" {
                    9
                } else {
                    7
                }
            } else {
                8
            }
        }
        "selectObject" => 3,
        "comparePair" => 4,
        "assignValue" | "pushPop" => 5,
        "choosePath" => 8,
        "traverseNode" => 4,
        _ => 1,
    }
}
pub fn legal(id: &str, next: &Value) -> Value {
    json!([match next["type"].as_str().unwrap() {
        "selectObject" =>
            json!({"type":"selectObject","label":"Read the next item","options":{"objectIds":[next["objectId"]]}}),
        "comparePair" =>
            json!({"type":"comparePair","label":match id{"two-pointers-pair"=>"Is the pair sum below, equal to, or above the target?","kadane-max-subarray"=>"Extending gives cur + value, restarting gives just the value — which is larger?","merge-intervals"=>"Does the next interval start inside the running merged interval?",_=>"Compare these two items"},"options":{"objectIds":[next["aId"],next["bId"]]},"expects":"relation"}),
        "assignValue" =>
            json!({"type":"assignValue","label":"Record the value","expects":"value","options":{"objectIds":[],"targetIds":[next["targetId"]]}}),
        "pushPop" =>
            json!({"type":"pushPop","label":if next["op"]=="push"{"Push the current item onto the stack"}else{"Pop every smaller item — the current value is their answer"},"options":{"objectIds":next.get("objectId").map(|v|json!([v])).unwrap_or(json!([])),"containerIds":[next["containerId"]]}}),
        "choosePath" =>
            json!({"type":"choosePath","label":"Keep the half that can still hold the target","options":{"objectIds":[next["fromId"]]}}),
        "traverseNode" =>
            json!({"type":"traverseNode","label":"Advance the pointer one link","options":{"objectIds":[next["fromNodeId"],next["toNodeId"]]}}),
        _ =>
            json!({"type":"submitAnswer","label":"Submit the result","expects":"value","options":{"objectIds":[next["targetId"]]}}),
    }])
}

pub fn stack_move(s: &mut Value, a: &Value) -> (String, String) {
    let container = a["containerId"].as_str().unwrap();
    if a["op"] == "push" {
        let object = a["objectId"].as_str().unwrap();
        s["containers"][container]["order"]
            .as_array_mut()
            .unwrap()
            .push(json!(object));
        if let Some(slot) = s["objects"][object]["slotId"].as_str().map(str::to_owned) {
            s["slots"][&slot]
                .as_object_mut()
                .unwrap()
                .shift_remove("occupantId");
            s["objects"][object]
                .as_object_mut()
                .unwrap()
                .shift_remove("slotId");
        }
        s["objects"][object]["state"] = json!("visited");
        let label = s["objects"][object]["label"]
            .as_str()
            .unwrap_or("That item");
        (
            format!("{label} goes on the top of the stack."),
            format!("Push {label}."),
        )
    } else {
        let removed = s["containers"][container]["order"]
            .as_array_mut()
            .unwrap()
            .pop();
        if let Some(id) = removed.as_ref().and_then(Value::as_str) {
            s["objects"][id]["state"] = json!("visited");
        }
        let label = removed
            .as_ref()
            .and_then(|id| s["objects"][id.as_str().unwrap()]["label"].as_str())
            .unwrap_or("The item");
        (
            format!("{label} is resolved — the current value is its next greater element."),
            format!(
                "Pop {}: it is smaller, so it is answered.",
                removed
                    .as_ref()
                    .and_then(Value::as_str)
                    .unwrap_or("the top")
            ),
        )
    }
}
pub fn traverse(s: &mut Value, a: &Value) -> (String, String) {
    let dest = a["toNodeId"].as_str().unwrap();
    s["cursor"]["nodeId"] = json!(dest);
    let count = s["internal"]["step"].as_i64().unwrap_or(0);
    let index = if dest == "null" {
        -1
    } else {
        dest[1..].parse::<i64>().unwrap_or(-1)
    };
    let pointer = if count % 3 == 0 { "slow" } else { "fast" };
    s["internal"][pointer] = json!(index);
    s["variables"][pointer] = json!(index);
    s["internal"]["step"] = json!(count + 1);
    (
        if dest == "null" {
            "The fast pointer ran off the end — there is no cycle.".into()
        } else {
            format!(
                "Follow one link to {}.",
                s["objects"][dest]["label"].as_str().unwrap_or(dest)
            )
        },
        "Advance one link.".into(),
    )
}
pub fn after(s: &mut Value, a: &Value, feedback: &mut String, note: &mut String) {
    let id = s["problemId"].as_str().unwrap().to_owned();
    match a["type"].as_str().unwrap() {
        "selectObject" => {
            if id == "rotated-search" {
                s["variables"]["mid"] = s["variables"]["i"].clone();
            }
        }
        "assignValue" => {
            let target = a["targetId"].as_str().unwrap();
            let value = crate::compat::number(a["value"].as_str().unwrap());
            if value.is_finite()
                && ((id == "sliding-window-max-sum" && target.starts_with("w_"))
                    || (id == "kadane-max-subarray" && target == "cur"))
            {
                let best = s["variables"]["best"]
                    .as_f64()
                    .map(|best| best.max(value))
                    .unwrap_or(value);
                s["variables"]["best"] = json!(best as i64);
            }
        }
        "comparePair" => {
            if id == "two-pointers-pair" {
                let key = if a["relation"] == "lt" {
                    Some(("L", 1))
                } else if a["relation"] == "gt" {
                    Some(("R", -1))
                } else {
                    None
                };
                if let Some((key, delta)) = key {
                    s["variables"][key] = json!(s["variables"][key].as_i64().unwrap_or(0) + delta);
                }
            }
            if id == "valid-palindrome" {
                s["variables"]["left"] = json!(s["variables"]["left"].as_i64().unwrap_or(0) + 1);
                s["variables"]["right"] = json!(s["variables"]["right"].as_i64().unwrap_or(0) - 1);
            }
            *note = if a["relation"] == "eq" {
                "The values match.".into()
            } else {
                format!("The relation is {}.", a["relation"].as_str().unwrap())
            };
        }
        "choosePath" => {
            let path = a["pathId"].as_str().unwrap();
            let mut lo = s["variables"]["lo"].as_i64().unwrap_or(0);
            let mut hi = s["variables"]["hi"].as_i64().unwrap_or(0);
            let mid = s["variables"]["mid"].as_i64().unwrap_or(0);
            if path != "found" {
                if path == "left" {
                    hi = mid - 1;
                } else {
                    lo = mid + 1;
                }
            }
            s["variables"]["lo"] = json!(lo);
            s["variables"]["hi"] = json!(hi);
            if lo <= hi {
                s["variables"]["mid"] = json!(((lo + hi) as f64 / 2.0).floor() as i64);
            }
            *feedback = if path == "found" {
                "The target is at this position.".into()
            } else {
                format!("The {path} half can still hold the target; the other half is discarded.")
            };
            *note = format!("Keep the {path} half.");
        }
        _ => {}
    }
}
pub fn answer(instance: &Value) -> Value {
    let id = instance["problemId"].as_str().unwrap();
    let v = nums(&instance["values"]);
    let e = &instance["extras"];
    match id {
        "sliding-window-max-sum" => {
            let k = e["k"].as_u64().unwrap_or(3) as usize;
            let best = v.windows(k).map(|w| w.iter().sum::<i64>()).max().unwrap();
            json!({"text":format!("max window sum {best}"),"value":best})
        }
        "two-pointers-pair" => {
            let a = e["answerIndices"][0].as_i64().unwrap_or(0);
            let b = e["answerIndices"][1].as_i64().unwrap_or(1);
            json!({"text":format!("indices {a} and {b} sum to {}",instance["target"]),"value":format!("{a},{b}")})
        }
        "prefix-sum-range" => {
            let sum = e["rangeSum"].as_i64().unwrap_or(0);
            json!({"text":format!("range sum {sum}"),"value":sum})
        }
        "kadane-max-subarray" => {
            let (mut cur, mut best) = (v[0], v[0]);
            for value in &v[1..] {
                cur = (*value).max(cur + value);
                best = best.max(cur);
            }
            json!({"text":format!("max subarray sum {best}"),"value":best})
        }
        "merge-intervals" => {
            let starts = nums(&e["starts"]);
            let ends = nums(&e["ends"]);
            let (mut s, mut end) = (starts[0], ends[0]);
            let mut merged = vec![];
            for i in 1..starts.len() {
                if starts[i] <= end {
                    end = end.max(ends[i]);
                } else {
                    merged.push(format!("{s}-{end}"));
                    s = starts[i];
                    end = ends[i];
                }
            }
            merged.push(format!("{s}-{end}"));
            let value = merged.join(",");
            json!({"text":format!("merged: {value}"),"value":value})
        }
        "next-greater-element" => {
            let mut stack: Vec<usize> = vec![];
            let mut answers = vec![-1; v.len()];
            for i in 0..v.len() {
                while stack.last().is_some_and(|top| v[*top] < v[i]) {
                    answers[stack.pop().unwrap()] = v[i];
                }
                stack.push(i);
            }
            let value = answers
                .iter()
                .map(i64::to_string)
                .collect::<Vec<_>>()
                .join(",");
            json!({"text":format!("next greater: {value}"),"value":value})
        }
        "rotated-search" => {
            let index = e["answerIndex"].as_i64().unwrap_or(0);
            json!({"text":format!("target {} at index {index}",instance["target"]),"value":index})
        }
        "linked-list-cycle" => {
            json!({"text":if e["hasCycle"]==true{"the list has a cycle"}else{"the list has no cycle"},"value":if e["hasCycle"]==true{"cycle"}else{"acyclic"}})
        }
        "frequency-count" => {
            let mut counts: Vec<(i64, i64)> = vec![];
            for value in &v {
                if let Some((_, count)) = counts.iter_mut().find(|(v, _)| v == value) {
                    *count += 1;
                } else {
                    counts.push((*value, 1));
                }
            }
            let (mut mode, mut count) = (v[0], 0);
            for (value, c) in counts {
                if c > count {
                    mode = value;
                    count = c;
                }
            }
            json!({"text":format!("value {mode} appears {count} times"),"value":mode})
        }
        "valid-anagram" => {
            json!({"text":if e["valid"]==true{"the strings are anagrams"}else{"the strings are not anagrams"},"value":if e["valid"]==true{"valid"}else{"invalid"}})
        }
        _ => {
            json!({"text":if e["valid"]==true{"the string is a palindrome"}else{"the string is not a palindrome"},"value":if e["valid"]==true{"valid"}else{"invalid"}})
        }
    }
}
