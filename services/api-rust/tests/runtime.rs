use serde_json::Value;
use sha2::{Digest, Sha256};
#[test]
fn undo_restores_board_without_erasing_learning_evidence() {
    let snapshot = dsa_api::runtime::init("binary-search", 7.0, "easy").unwrap();
    let mut current = snapshot.clone();
    current["phase"] = serde_json::json!("lost");
    current["progress"] = serde_json::json!({"steps":9,"mistakes":2,"hintsUsed":3,"mistakesByMechanic":{"comparePair":2}});
    let restored = dsa_api::runtime::rewind(&current, &snapshot);
    assert_eq!(restored["phase"], snapshot["phase"]);
    assert_eq!(restored["board"], snapshot["board"]);
    assert_eq!(restored["trace"], snapshot["trace"]);
    assert_eq!(restored["progress"], current["progress"]);
}
fn stable(v: Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.into_iter().map(stable).collect()),
        Value::Object(o) => {
            let sorted: std::collections::BTreeMap<_, _> =
                o.into_iter().map(|(k, v)| (k, stable(v))).collect();
            Value::Object(sorted.into_iter().collect())
        }
        v => v,
    }
}
fn digest(v: Value) -> String {
    format!("{:x}", Sha256::digest(stable(v).to_string().as_bytes()))
}
#[test]
fn engine_progress_replay_and_debrief_match_node_for_every_problem() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/runtime.json")).unwrap();
    let filter = std::env::var("RUNTIME_FILTER").ok();
    for case in &cases {
        let id = case["id"].as_str().unwrap();
        if filter.as_ref().is_some_and(|f| f != id) {
            continue;
        }
        let mut state = dsa_api::runtime::init(
            id,
            case["seed"].as_f64().unwrap(),
            case["difficulty"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(digest(state.clone()), case["initial"], "{id} initial");
        for step in case["moves"].as_array().unwrap() {
            for check in step["checks"].as_array().unwrap() {
                let result = dsa_api::runtime::apply(&state, &check["action"]);
                assert_eq!(
                    digest(result.clone()),
                    check["result"],
                    "{id} check {} {result}",
                    check["action"]
                );
            }
            let result = dsa_api::runtime::apply(&state, &step["action"]);
            assert_eq!(
                digest(result.clone()),
                step["result"],
                "{id} action {} {result}",
                step["action"]
            );
            state = result["state"].clone();
        }
        let debrief = dsa_api::runtime::debrief(&state);
        assert_eq!(
            digest(debrief.clone()),
            case["debrief"],
            "{id} debrief {debrief}"
        );
    }
    assert_eq!(cases.len(), 4050);
}
