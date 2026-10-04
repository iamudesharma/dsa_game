use serde_json::Value;
use sha2::{Digest, Sha256};
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
fn planned_oracles_match_node_complete_journeys_invalid_actions_and_terminal_states() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/oracles.json")).unwrap();
    assert_eq!(cases.len(), 3780);
    check_journeys(&cases);
}

#[test]
fn scan_wrong_claims_and_alternate_actions_match_node() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/scan.json")).unwrap();
    for case in &cases {
        let instance = dsa_api::instances::build(
            "array-max-min",
            case["seed"].as_f64().unwrap(),
            case["difficulty"].as_str().unwrap(),
            None,
        )
        .unwrap();
        let mut state = dsa_api::oracle_plan::init(instance);
        for stage in case["stages"].as_array().unwrap() {
            for check in stage["checks"].as_array().unwrap() {
                let result = dsa_api::oracle_plan::apply(&state, &check["action"]);
                assert_eq!(
                    digest(result.clone()),
                    check["result"],
                    "seed {} action {} result {}",
                    case["seed"],
                    check["action"],
                    result
                );
            }
            state = dsa_api::oracle_plan::apply(&state, &stage["action"])["nextState"].take();
        }
    }
    assert_eq!(cases.len(), 90);
}

#[test]
fn stateful_search_and_sorts_match_node() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/stateful.json")).unwrap();
    check_journeys(&cases);
    assert_eq!(cases.len(), 270);
}
fn check_journeys(cases: &[Value]) {
    use dsa_api::oracle_plan as oracle_dp;
    let mut count = 0;
    let filter = std::env::var("ORACLE_FILTER").ok();
    for case in cases {
        if filter.as_ref().is_some_and(|id| case["id"] != id.as_str()) {
            continue;
        }
        let id = case["id"].as_str().unwrap();
        let code: serde_json::Map<_, _> = ["javascript", "typescript", "python", "java", "cpp"]
            .into_iter()
            .map(|language| {
                (
                    language.to_owned(),
                    serde_json::json!(oracle_dp::code(id, language)),
                )
            })
            .collect();
        assert_eq!(
            digest(
                serde_json::json!({"code":code,"pseudocode":oracle_dp::pseudocode(id),"complexity":oracle_dp::complexity(id)})
            ),
            case["metadata"]
        );
        let instance = dsa_api::instances::build(
            id,
            case["seed"].as_f64().unwrap(),
            case["difficulty"].as_str().unwrap(),
            None,
        )
        .unwrap();
        let mut state = oracle_dp::init(instance.clone());
        assert_eq!(digest(state.clone()), case["initial"]);
        assert_eq!(digest(oracle_dp::canonical(instance)), case["canonical"]);
        for step in case["moves"].as_array().unwrap() {
            assert_eq!(digest(oracle_dp::legal(&state)), step["legal"]);
            for check in step["checks"].as_array().unwrap() {
                let result = oracle_dp::apply(&state, &check["action"]);
                assert_eq!(
                    digest(result.clone()),
                    check["result"],
                    "{id} invalid {} {result}",
                    check["action"]
                );
            }
            let result = oracle_dp::apply(&state, &step["action"]);
            assert_eq!(
                digest(result.clone()),
                step["result"],
                "{id} {} {result}",
                step["action"]
            );
            state = result["nextState"].clone();
            count += 1;
        }
        assert_eq!(state["phase"], "won");
        assert_eq!(digest(oracle_dp::answer(&state)), case["answer"]);
        assert_eq!(
            digest(oracle_dp::apply(
                &state,
                &serde_json::json!({"type":"selectObject","objectId":"v0"})
            )),
            case["terminal"]
        );
        assert_eq!(digest(oracle_dp::legal(&state)), case["terminalLegal"]);
    }
    assert!(count > 0);
}
