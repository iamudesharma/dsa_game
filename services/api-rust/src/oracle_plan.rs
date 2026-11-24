//! Exact oracles driven by an algorithmic action plan. HTTP gameplay wiring follows after
//! the remaining oracle and engine contracts have been migrated.
use serde_json::{json, Value};
fn source(id: &str) -> Vec<&'static str> {
    crate::oracle_metadata::get(id)["code"]["javascript"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap())
        .collect()
}
fn tree(id: &str) -> bool {
    [
        "tree-traversals",
        "tree-level-order",
        "bst-search",
        "bst-validate",
    ]
    .contains(&id)
}
pub fn init(instance: Value) -> Value {
    let id = instance["problemId"].as_str().unwrap();
    assert!(
        (tree(id)
            || crate::oracle_pattern::supports(id)
            || crate::oracle_structures::supports(id)
            || crate::oracle_remaining::supports(id)
            || crate::oracle_graph::supports(id)
            || id == "array-max-min"
            || crate::oracle_sort::supports(id)
            || id == "binary-search")
            || [
                "climbing-stairs",
                "house-robber",
                "coin-change",
                "jump-game",
                "single-number",
                "subsets",
                "permutations"
            ]
            .contains(&id)
    );
    let n = instance["values"].as_array().unwrap().len();
    let mut objects = serde_json::Map::new();
    let mut slots = serde_json::Map::new();
    for (i, v) in instance["values"].as_array().unwrap().iter().enumerate() {
        let label = v.to_string();
        objects.insert(format!("v{i}"),json!({"id":format!("v{i}"),"kind":"number","label":label,"value":v,"slotId":format!("s{i}"),"visual":{"kind":"text","text":label},"state":"idle","tags":{"index":i}}));
        slots.insert(format!("s{i}"),json!({"id":format!("s{i}"),"index":i,"kind":"default","occupantId":format!("v{i}"),"state":"idle"}));
    }
    let variables = if id == "jump-game" {
        json!({"i":0,"reach":0,"n":n})
    } else if id == "single-number" {
        json!({"i":0,"xor":0,"n":n})
    } else if ["subsets", "permutations"].contains(&id) {
        json!({"i":0,"n":n})
    } else if id == "climbing-stairs" {
        json!({"i":0,"n":n-1})
    } else if id == "coin-change" {
        json!({"i":0,"amount":instance["extras"]["amount"],"n":n})
    } else {
        json!({"i":0,"dpPrev2":0,"dpPrev1":0,"n":n})
    };
    let mut state = json!({"problemId":id,"seed":instance["seed"],"instance":instance,"objects":objects,"slots":slots,"containers":{},"links":[],"selection":[],"cursor":{},"variables":variables,"progress":{"steps":0,"mistakes":0,"hintsUsed":0,"mistakesByMechanic":{}},"phase":"playing","trace":[],"internal":{"planIndex":0}});
    if tree(id) {
        crate::oracle_tree::setup(&mut state);
    }
    if crate::oracle_pattern::supports(id) {
        crate::oracle_pattern::setup(&mut state);
    }
    if crate::oracle_structures::supports(id) {
        crate::oracle_structures::setup(&mut state);
    }
    if crate::oracle_remaining::supports(id) {
        crate::oracle_remaining::setup(&mut state);
    }
    if crate::oracle_graph::supports(id) {
        crate::oracle_graph::setup(&mut state);
    }
    if id == "array-max-min" {
        crate::oracle_extreme::setup(&mut state);
    }
    if crate::oracle_sort::supports(id) {
        crate::oracle_sort::setup(&mut state);
    }
    if id == "binary-search" {
        crate::oracle_binary::setup(&mut state);
    }
    state
}
fn dp(instance: &Value) -> Vec<i64> {
    let id = instance["problemId"].as_str().unwrap();
    let values: Vec<_> = instance["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_i64().unwrap())
        .collect();
    if id == "coin-change" {
        let amount = instance["extras"]["amount"].as_u64().unwrap() as usize;
        let coins: Vec<_> = instance["extras"]["coins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as usize)
            .collect();
        let mut table = vec![9007199254740991; amount + 1];
        table[0] = 0;
        for x in 1..=amount {
            for c in &coins {
                if *c <= x {
                    table[x] = table[x].min(table[x - c] + 1);
                }
            }
        }
        return table;
    }
    let mut table = vec![];
    for (i, v) in values.iter().enumerate() {
        let current = if id == "climbing-stairs" {
            if i < 2 {
                1
            } else {
                table[i - 1] + table[i - 2]
            }
        } else {
            (v + if i >= 2 { table[i - 2] } else { 0 }).max(if i >= 1 { table[i - 1] } else { 0 })
        };
        table.push(current);
    }
    table
}
pub fn actions(instance: &Value) -> Vec<Value> {
    let id = instance["problemId"].as_str().unwrap();
    if id == "binary-search" || crate::oracle_sort::supports(id) {
        let state = init(instance.clone());
        let trace = if id == "binary-search" {
            crate::oracle_binary::canonical(&state, None)
        } else {
            crate::oracle_sort::canonical(&state)
        };
        return trace
            .as_array()
            .unwrap()
            .iter()
            .map(|frame| frame["action"].clone())
            .collect();
    }
    if crate::oracle_graph::supports(instance["problemId"].as_str().unwrap()) {
        return crate::oracle_graph::actions(instance);
    }
    if crate::oracle_remaining::supports(instance["problemId"].as_str().unwrap()) {
        return crate::oracle_remaining::actions(instance);
    }
    if crate::oracle_structures::supports(instance["problemId"].as_str().unwrap()) {
        return crate::oracle_structures::actions(instance);
    }
    if crate::oracle_pattern::supports(instance["problemId"].as_str().unwrap()) {
        return crate::oracle_pattern::actions(instance);
    }
    if tree(instance["problemId"].as_str().unwrap()) {
        return crate::oracle_tree::actions(instance);
    }
    let id = instance["problemId"].as_str().unwrap();
    if ["jump-game", "single-number", "subsets", "permutations"].contains(&id) {
        return simple_actions(instance);
    }
    let table = dp(instance);
    let values = instance["values"].as_array().unwrap();
    let mut out = vec![];
    for (i, value) in table.iter().enumerate() {
        out.push(json!({"type":"selectObject","objectId":format!("v{i}")}));
        if id == "house-robber" {
            let take = values[i].as_i64().unwrap() + if i >= 2 { table[i - 2] } else { 0 };
            let skip = if i > 0 { table[i - 1] } else { 0 };
            out.push(json!({"type":"comparePair","aId":format!("v{i}"),"bId":format!("v{}",i.saturating_sub(2)),"relation":if take<skip{"lt"}else if take>skip{"gt"}else{"eq"}}));
        }
        out.push(
            json!({"type":"assignValue","targetId":format!("dp_{i}"),"value":value.to_string()}),
        );
    }
    out.push(json!({"type":"submitAnswer","targetId":format!("v{}",table.len()-1),"value":table.last().unwrap().to_string()}));
    out
}

// JavaScript array lookup accepts integral numeric indices, including 1.0,
// and rejects negative/fractional indices. Missing/non-number bookkeeping uses 0.
fn plan_index(state: &Value) -> Option<usize> {
    let value = state["internal"]["planIndex"].as_f64().unwrap_or(0.0);
    (value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value < usize::MAX as f64)
        .then_some(value as usize)
}

pub fn legal(state: &Value) -> Value {
    if state["problemId"] == "binary-search" {
        return crate::oracle_binary::legal(state);
    }
    if crate::oracle_sort::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_sort::legal(state);
    }
    if state["problemId"] == "array-max-min" {
        return crate::oracle_extreme::legal(state);
    }
    if state["phase"] != "playing" {
        return json!([]);
    }
    let plan = actions(&state["instance"]);
    let Some(next) = plan_index(state).and_then(|step| plan.get(step)) else {
        return json!([]);
    };
    if crate::oracle_structures::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_structures::legal(state["problemId"].as_str().unwrap(), next);
    }
    if crate::oracle_remaining::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_remaining::legal(next);
    }
    if crate::oracle_graph::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_graph::legal(state["problemId"].as_str().unwrap(), next);
    }
    if tree(state["problemId"].as_str().unwrap()) {
        return crate::oracle_tree::legal(next);
    }
    if crate::oracle_pattern::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_pattern::legal(state["problemId"].as_str().unwrap(), next);
    }
    let mut result = json!([match next["type"].as_str().unwrap() {
        "selectObject" =>
            json!({"type":"selectObject","label":"Read the next step","options":{"objectIds":[next["objectId"]]}}),
        "comparePair" =>
            json!({"type":"comparePair","label":"Robbing here plus two doors down, versus skipping — which is larger?","options":{"objectIds":[next["aId"],next["bId"]]},"expects":"relation"}),
        "assignValue" =>
            json!({"type":"assignValue","label":"Record the table value","expects":"value","options":{"objectIds":[],"targetIds":[next["targetId"]]}}),
        "submitAnswer" =>
            json!({"type":"submitAnswer","label":"Submit the result","expects":"value","options":{"objectIds":[next["targetId"]]}}),
        _ => unreachable!(),
    }]);
    let id = state["problemId"].as_str().unwrap();
    let label = match (id, next["type"].as_str().unwrap()) {
        ("jump-game", "selectObject") => Some("Read how far this cell jumps"),
        ("jump-game", "assignValue") => Some("Record the new farthest reach"),
        ("jump-game", "submitAnswer") => Some("Commit reachable or stuck"),
        ("single-number", "selectObject") => Some("Fold the next value in"),
        ("single-number", "assignValue") => Some("Record the accumulator"),
        ("single-number", "submitAnswer") => Some("Commit the survivor"),
        ("subsets", "selectObject") => Some("Decide this element: include or exclude"),
        ("permutations", "selectObject") => Some("Try this value in the open position"),
        ("subsets" | "permutations", "assignValue") => Some(if next["value"] == "1" {
            "Mark it and go deeper"
        } else {
            "Unmark it — backtrack and try the other way"
        }),
        ("subsets" | "permutations", "submitAnswer") => Some("Submit the full enumeration"),
        _ => None,
    };
    if let Some(label) = label {
        result[0]["label"] = json!(label);
    }
    result
}
fn code_line(id: &str, action: &Value, instance: &Value) -> usize {
    if crate::oracle_graph::supports(id) {
        return crate::oracle_graph::code_line(id, action);
    }
    if crate::oracle_remaining::supports(id) {
        return crate::oracle_remaining::code_line(id, action);
    }
    if crate::oracle_structures::supports(id) {
        return crate::oracle_structures::code_line(id, action);
    }
    if crate::oracle_pattern::supports(id) {
        return crate::oracle_pattern::code_line(id, action);
    }
    if tree(id) {
        return crate::oracle_tree::code_line(id, action, instance);
    }
    if id == "jump-game" {
        return match action["type"].as_str().unwrap() {
            "selectObject" => 3,
            "assignValue" => 5,
            "submitAnswer" => {
                if action["value"] == "true" {
                    7
                } else {
                    4
                }
            }
            _ => 1,
        };
    }
    if id == "single-number" {
        return match action["type"].as_str().unwrap() {
            "selectObject" => 3,
            "assignValue" => 4,
            "submitAnswer" => 6,
            _ => 1,
        };
    }
    if ["subsets", "permutations"].contains(&id) {
        return match action["type"].as_str().unwrap() {
            "selectObject" => 4,
            "assignValue" => {
                if action["value"] == "1" {
                    5
                } else {
                    7
                }
            }
            "submitAnswer" => 9,
            _ => 1,
        };
    }
    match action["type"].as_str().unwrap() {
        "submitAnswer" => {
            if id == "coin-change" {
                8
            } else {
                7
            }
        }
        "selectObject" => 3,
        "comparePair" => 5,
        "assignValue" => 6,
        _ => 1,
    }
}
fn dsa_op(action: &Value) -> &'static str {
    match action["type"].as_str().unwrap() {
        "selectObject" => "read",
        "comparePair" => "compare",
        "assignValue" => "assign",
        "submitAnswer" => "terminate",
        "moveObject" => "move",
        "swapPair" => "swap",
        "pushPop" => "push",
        "choosePath" => "choose-path",
        "traverseNode" => "traverse",
        "connectNodes" => "link",
        _ => unreachable!("validated action type"),
    }
}
pub fn apply(state: &Value, action: &Value) -> Value {
    if state["problemId"] == "binary-search" {
        return crate::oracle_binary::apply(state, action);
    }
    if crate::oracle_sort::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_sort::apply(state, action);
    }
    if state["problemId"] == "array-max-min" {
        return crate::oracle_extreme::apply(state, action);
    }
    let id = state["problemId"].as_str().unwrap();
    let step = plan_index(state);
    let plan = actions(&state["instance"]);
    let expected = step.and_then(|step| plan.get(step));
    let mut clean = action.clone();
    clean.as_object_mut().unwrap().shift_remove("actionId");
    let allowed = state["phase"] == "playing"
        && expected.is_some_and(|e| {
            clean
                .as_object()
                .unwrap()
                .iter()
                .eq(e.as_object().unwrap().iter())
        });
    let mut next = state.clone();
    let mut pointers = json!({});
    let code;
    let mut feedback;
    let mut note;
    let mut outcome = json!({"correct":allowed});
    if !allowed {
        code = expected
            .map(|e| code_line(id, e, &state["instance"]))
            .unwrap_or(1);
        feedback=expected.map(|e|format!("The next algorithm step is {}; follow the highlighted cell and try that operation.",e["type"].as_str().unwrap())).unwrap_or_else(||"This game is already complete.".into());
        if tree(id) || crate::oracle_pattern::supports(id) || crate::oracle_remaining::supports(id)
        {
            feedback = feedback.replace("highlighted cell", "highlighted item");
        }
        if id == "kth-largest-heap" {
            feedback = feedback.replace("highlighted cell", "highlighted item");
        }
        if id == "trie-prefix-search" {
            feedback = feedback.replace("highlighted cell", "highlighted node");
        }
        note = "This action is not legal for the current algorithm step.".to_owned();
        outcome["illegal"] = json!(true);
    } else {
        next["internal"]["planIndex"] = json!(step.unwrap() + 1);
        code = code_line(id, action, &state["instance"]);
        feedback = match action["type"].as_str().unwrap() {
            "selectObject" => {
                let object = action["objectId"].as_str().unwrap();
                next["selection"] = json!([object]);
                next["objects"][object]["state"] = json!("current");
                let pos = next["slots"]
                    .as_object()
                    .unwrap()
                    .values()
                    .find(|s| s["occupantId"] == object)
                    .and_then(|s| s["index"].as_u64())
                    .or_else(|| next["objects"][object]["tags"]["index"].as_u64());
                if let Some(pos) = pos.filter(|_| id != "trie-prefix-search") {
                    next["variables"]["i"] = json!(pos);
                    next["cursor"]["iSlotId"] = json!(format!("s{pos}"));
                }
                pointers["current"] = json!(object);
                note = format!(
                    "Read {}.",
                    next["objects"][object]["label"].as_str().unwrap_or(object)
                );
                if id == "jump-game" {
                    note = format!(
                        "Cell {} jumps {} ahead.",
                        pos.map(|p| p as i64).unwrap_or(-1),
                        next["objects"][object]["value"]
                    );
                } else if id == "single-number" {
                    note = format!(
                        "Fold in {}.",
                        next["objects"][object]["label"].as_str().unwrap_or(object)
                    );
                } else if ["subsets", "permutations"].contains(&id) {
                    note = format!(
                        "Consider {}.",
                        next["objects"][object]["label"].as_str().unwrap_or(object)
                    );
                }
                if tree(id) {
                    note = format!(
                        "Visit {}.",
                        next["objects"][object]["label"].as_str().unwrap_or(object)
                    );
                    if id == "tree-traversals" {
                        next["variables"]["visited"] =
                            json!(next["variables"]["visited"].as_u64().unwrap_or(0) + 1);
                    }
                }
                if id == "trie-prefix-search" {
                    next["variables"]["found"] =
                        json!(next["variables"]["found"].as_u64().unwrap_or(0) + 1);
                    note = format!(
                        "Count {} as a completion.",
                        next["objects"][object]["label"].as_str().unwrap_or(object)
                    );
                }
                "That is the next step in the algorithm.".into()
            }
            "assignValue" => {
                let target = action["targetId"].as_str().unwrap();
                let value = action["value"].as_str().unwrap();
                let num = crate::compat::number(value);
                next["variables"][target] = if num.is_finite() {
                    json!(num as i64)
                } else {
                    json!(value)
                };
                if id == "house-robber" && target.starts_with("dp_") && num.is_finite() {
                    next["variables"]["dpPrev2"] = next["variables"]["dpPrev1"].clone();
                    next["variables"]["dpPrev1"] = json!(num as i64);
                }
                note = format!("Store {value} in {target}.");
                if id == "jump-game" {
                    note = format!("Record reach = {value}.");
                    format!("Farthest reach is now {value}.")
                } else if id == "single-number" {
                    note = format!("acc XOR value = {value}.");
                    format!("Accumulator is now {value}.")
                } else if ["subsets", "permutations"].contains(&id) {
                    note = if value == "1" {
                        "Choose it for this branch.".into()
                    } else {
                        "Un-choose it; the branch is done.".into()
                    };
                    if value == "1" {
                        format!("{target} is marked — go deeper.")
                    } else {
                        format!("{target} is unmarked — backtrack and try the other way.")
                    }
                } else {
                    format!("{target} now records {value}.")
                }
            }
            "comparePair" => {
                next["selection"] = json!([action["aId"], action["bId"]]);
                pointers["compare"] = next["selection"].clone();
                note = if action["relation"] == "eq" {
                    "Take and skip tie.".into()
                } else {
                    format!(
                        "Take is {} than skip.",
                        if action["relation"] == "gt" {
                            "better"
                        } else {
                            "worse"
                        }
                    )
                };
                if tree(id) || id == "kth-largest-heap" {
                    note = if action["relation"] == "eq" {
                        "The values match.".into()
                    } else {
                        format!("The relation is {}.", action["relation"].as_str().unwrap())
                    };
                }
                "That is the next step in the algorithm.".into()
            }
            "swapPair" => {
                crate::oracle_structures::swap(&mut next, action);
                next["selection"] = json!([action["aId"], action["bId"]]);
                pointers["compare"] = next["selection"].clone();
                note = "Exchange and sift the heap back into shape.".into();
                "The larger value takes the heap; the heap property is restored.".into()
            }
            "pushPop" => {
                let (f, n) = if crate::oracle_remaining::supports(id) {
                    crate::oracle_remaining::push_pop(&mut next, action)
                } else if crate::oracle_pattern::supports(id) {
                    crate::oracle_pattern::stack_move(&mut next, action)
                } else {
                    crate::oracle_tree::queue_move(&mut next, action)
                };
                note = n;
                f
            }
            "choosePath" => {
                let from = action["fromId"].as_str().unwrap();
                let path = action["pathId"].as_str().unwrap();
                next["selection"] = json!([from]);
                pointers["current"] = json!(from);
                note = format!("Descend {path}.");
                format!("Down the {path} child: the target can only be in that subtree.")
            }
            "traverseNode" => {
                let (f, n) = if crate::oracle_remaining::supports(id) {
                    crate::oracle_remaining::traverse(&mut next, action)
                } else if id == "trie-prefix-search" {
                    next["cursor"]["prevNodeId"] = action["fromNodeId"].clone();
                    next["cursor"]["nodeId"] = action["toNodeId"].clone();
                    next["variables"]["matched"] =
                        json!(next["variables"]["matched"].as_u64().unwrap_or(0) + 1);
                    let node = action["toNodeId"].as_str().unwrap();
                    (
                        format!(
                            "Follow the link to {}.",
                            next["objects"][node]["label"].as_str().unwrap_or(node)
                        ),
                        "One query letter matched.".into(),
                    )
                } else {
                    crate::oracle_pattern::traverse(&mut next, action)
                };
                pointers["current"] = action["toNodeId"].clone();
                note = n;
                f
            }
            "connectNodes" => {
                let (f, n) = crate::oracle_remaining::connect(&mut next, action);
                pointers["compare"] = next["selection"].clone();
                note = n;
                f
            }
            "submitAnswer" => {
                next["phase"] = json!("won");
                next["variables"]["answer"] = action["value"].clone();
                note = "Commit the result.".into();
                outcome["won"] = json!(true);
                if id == "trie-prefix-search" {
                    "Correct. The prefix search is complete.".into()
                } else if id == "single-number" {
                    "Correct. Only the unpaired value survived.".into()
                } else if ["subsets", "permutations"].contains(&id) {
                    "Correct. The enumeration is complete.".into()
                } else {
                    "Correct. The algorithm is complete.".into()
                }
            }
            _ => unreachable!(),
        };
        if crate::oracle_remaining::supports(id) {
            crate::oracle_remaining::after(&mut next, action, &mut feedback, &mut note);
        }
        if crate::oracle_graph::supports(id) {
            crate::oracle_graph::after(&mut next, action, &mut note);
        }
        if crate::oracle_pattern::supports(id) {
            crate::oracle_pattern::after(&mut next, action, &mut feedback, &mut note);
        }
    }
    next["progress"]["steps"] = json!(next["progress"]["steps"].as_u64().unwrap() + 1);
    let index = next["trace"].as_array().unwrap().len();
    let op = if (tree(id)
        || crate::oracle_pattern::supports(id)
        || crate::oracle_remaining::supports(id))
        && action["type"] == "pushPop"
        && action["op"] == "pop"
    {
        "pop"
    } else {
        dsa_op(action)
    };
    let frame = json!({"index":index,"action":action,"codeLine":code,"codeLineText":source(id).get(code-1).copied().unwrap_or(""),"variables":next["variables"],"pointers":pointers,"dsaOp":op,"correct":allowed,"note":note});
    next["trace"].as_array_mut().unwrap().push(frame);
    outcome["feedback"] = json!(feedback);
    outcome["dsaOp"] = json!(op);
    outcome["traceStep"] = json!(index);
    json!({"nextState":next,"outcome":outcome})
}
pub fn canonical(instance: Value) -> Value {
    if instance["problemId"] == "binary-search" {
        return crate::oracle_binary::canonical(&init(instance), None);
    }
    if crate::oracle_sort::supports(instance["problemId"].as_str().unwrap()) {
        return crate::oracle_sort::canonical(&init(instance));
    }
    if instance["problemId"] == "array-max-min" {
        return crate::oracle_extreme::canonical(&init(instance));
    }
    let plan = actions(&instance);
    let mut state = init(instance);
    for action in plan {
        state = apply(&state, &action)["nextState"].take();
    }
    state["trace"].take()
}
pub fn answer(state: &Value) -> Value {
    if state["problemId"] == "binary-search" {
        return crate::oracle_binary::answer(state);
    }
    if crate::oracle_sort::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_sort::answer(state);
    }
    if state["problemId"] == "array-max-min" {
        return crate::oracle_extreme::answer(state);
    }
    if crate::oracle_graph::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_graph::answer(&state["instance"]);
    }
    if crate::oracle_remaining::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_remaining::answer(&state["instance"]);
    }
    if crate::oracle_structures::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_structures::answer(&state["instance"]);
    }
    if crate::oracle_pattern::supports(state["problemId"].as_str().unwrap()) {
        return crate::oracle_pattern::answer(&state["instance"]);
    }
    if tree(state["problemId"].as_str().unwrap()) {
        return crate::oracle_tree::answer(&state["instance"]);
    }
    let instance = &state["instance"];
    let id = state["problemId"].as_str().unwrap();
    if ["jump-game", "single-number", "subsets", "permutations"].contains(&id) {
        return simple_answer(instance);
    }
    let table = dp(instance);
    let value = *table.last().unwrap();
    let text = match id {
        "climbing-stairs" => format!("{value} ways to climb {} stairs", table.len() - 1),
        "coin-change" => {
            let coins = instance["extras"]["coins"]
                .as_array()
                .unwrap()
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "{value} coins for amount {} with [{coins}]",
                table.len() - 1
            )
        }
        _ => format!("max loot {value}"),
    };
    json!({"text":text,"value":value})
}

pub fn code(id: &str, language: &str) -> Vec<String> {
    crate::oracle_metadata::get(id)["code"][language]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect()
}
pub fn pseudocode(id: &str) -> Vec<&'static str> {
    crate::oracle_metadata::get(id)["pseudocode"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap())
        .collect()
}
pub fn complexity(id: &str) -> Value {
    crate::oracle_metadata::get(id)["complexity"].clone()
}

fn enumerations(id: &str, v: &[i64]) -> Vec<String> {
    fn subset(i: usize, v: &[i64], path: &mut Vec<i64>, out: &mut Vec<String>) {
        if i == v.len() {
            out.push(if path.is_empty() {
                "∅".into()
            } else {
                path.iter().map(i64::to_string).collect()
            });
            return;
        }
        path.push(v[i]);
        subset(i + 1, v, path, out);
        path.pop();
        subset(i + 1, v, path, out);
    }
    fn permute(v: &[i64], used: &mut [bool], path: &mut Vec<i64>, out: &mut Vec<String>) {
        if path.len() == v.len() {
            out.push(path.iter().map(i64::to_string).collect());
            return;
        }
        for j in 0..v.len() {
            if used[j] {
                continue;
            }
            used[j] = true;
            path.push(v[j]);
            permute(v, used, path, out);
            path.pop();
            used[j] = false;
        }
    }
    let mut out = vec![];
    if id == "subsets" {
        subset(0, v, &mut vec![], &mut out);
    } else {
        permute(v, &mut vec![false; v.len()], &mut vec![], &mut out);
    }
    out
}
fn simple_actions(instance: &Value) -> Vec<Value> {
    let id = instance["problemId"].as_str().unwrap();
    let v: Vec<_> = instance["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    let mut out = vec![];
    match id {
        "jump-game" => {
            let mut reach = 0;
            for (i, value) in v.iter().enumerate() {
                if i as i64 > reach {
                    out.push(json!({"type":"submitAnswer","targetId":format!("v{}",i.saturating_sub(1)),"value":"false"}));
                    return out;
                }
                out.push(json!({"type":"selectObject","objectId":format!("v{i}")}));
                reach = reach.max(i as i64 + value);
                out.push(
                    json!({"type":"assignValue","targetId":"reach","value":reach.to_string()}),
                );
            }
            out.push(
                json!({"type":"submitAnswer","targetId":format!("v{}",v.len()-1),"value":"true"}),
            );
        }
        "single-number" => {
            let mut acc = 0i32;
            for (i, value) in v.iter().enumerate() {
                acc ^= crate::compat::to_uint32(*value as f64) as i32;
                out.push(json!({"type":"selectObject","objectId":format!("v{i}")}));
                out.push(json!({"type":"assignValue","targetId":"xor","value":acc.to_string()}));
            }
            out.push(json!({"type":"submitAnswer","targetId":format!("v{}",v.iter().position(|v|*v==acc as i64).map(|i|i as i64).unwrap_or(-1)),"value":acc.to_string()}));
        }
        "subsets" => {
            fn dfs(i: usize, n: usize, out: &mut Vec<Value>) {
                if i == n {
                    return;
                }
                out.push(json!({"type":"selectObject","objectId":format!("v{i}")}));
                out.push(json!({"type":"assignValue","targetId":format!("inc_{i}"),"value":"1"}));
                dfs(i + 1, n, out);
                out.push(json!({"type":"assignValue","targetId":format!("inc_{i}"),"value":"0"}));
                dfs(i + 1, n, out);
            }
            dfs(0, v.len(), &mut out);
            out.push(json!({"type":"submitAnswer","targetId":format!("v{}",v.len()-1),"value":enumerations(id,&v).join(";")}));
        }
        "permutations" => {
            fn dfs(v: &[i64], used: &mut [bool], out: &mut Vec<Value>) {
                if used.iter().all(|b| *b) {
                    return;
                }
                for j in 0..v.len() {
                    if used[j] {
                        continue;
                    }
                    out.push(json!({"type":"selectObject","objectId":format!("v{j}")}));
                    out.push(json!({"type":"assignValue","targetId":format!("used_{}",v[j]),"value":"1"}));
                    used[j] = true;
                    dfs(v, used, out);
                    used[j] = false;
                    out.push(json!({"type":"assignValue","targetId":format!("used_{}",v[j]),"value":"0"}));
                }
            }
            dfs(&v, &mut vec![false; v.len()], &mut out);
            out.push(json!({"type":"submitAnswer","targetId":"v0","value":enumerations(id,&v).join(";")}));
        }
        _ => unreachable!(),
    }
    out
}
fn simple_answer(instance: &Value) -> Value {
    let id = instance["problemId"].as_str().unwrap();
    let v: Vec<_> = instance["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    if id == "jump-game" {
        let mut reach = 0;
        let mut ok = true;
        for (i, value) in v.iter().enumerate() {
            if i as i64 > reach {
                ok = false;
                break;
            }
            reach = reach.max(i as i64 + value);
        }
        return json!({"text":if ok{"the last index is reachable"}else{"the run gets stuck"},"value":if ok{"true"}else{"false"}});
    }
    if id == "single-number" {
        let acc = v.iter().fold(0i32, |acc, v| {
            acc ^ (crate::compat::to_uint32(*v as f64) as i32)
        });
        return json!({"text":format!("the single number is {acc}"),"value":acc});
    }
    let list = enumerations(id, &v);
    json!({"text":format!("{} {id}: {}{}",list.len(),list.iter().take(4).cloned().collect::<Vec<_>>().join(";"),if list.len()>4{";…"}else{""}),"value":list.join(";")})
}

#[cfg(test)]
mod index_tests {
    use super::*;
    #[test]
    fn restored_numeric_indices_keep_javascript_array_lookup_semantics() {
        let instance = crate::instances::build("jump-game", 0.0, "easy", None).unwrap();
        let state = init(instance);
        let mut restored = state.clone();
        restored["internal"]["planIndex"] = json!(1.0);
        let mut integer = state.clone();
        integer["internal"]["planIndex"] = json!(1);
        assert_eq!(legal(&restored), legal(&integer));
        for invalid in [json!(-1), json!(0.5)] {
            restored["internal"]["planIndex"] = invalid;
            assert_eq!(legal(&restored), json!([]));
            assert_eq!(
                apply(&restored, &actions(&state["instance"])[0])["outcome"]["illegal"],
                true
            );
        }
        restored["internal"]["planIndex"] = json!("1");
        assert_eq!(legal(&restored), legal(&state));
    }
}
