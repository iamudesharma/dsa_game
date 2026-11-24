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
fn hash(v: Value) -> String {
    format!("{:x}", Sha256::digest(stable(v).to_string().as_bytes()))
}
#[test]
fn coach_snapshots_match_node_all_seeds_and_difficulties() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/coach-snapshots.json")).unwrap();
    assert_eq!(cases.len(), 4050);
    for c in cases {
        let id = c["id"].as_str().unwrap();
        let seed = c["seed"].as_f64().unwrap();
        let difficulty = c["difficulty"].as_str().unwrap();
        let mut state = dsa_api::runtime::init(id, seed, difficulty).unwrap();
        let problem = dsa_api::reference()["problems"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .unwrap();
        let spec =
            dsa_api::template::build(problem, &state["instance"], seed, difficulty, None).unwrap();
        let snapshot = |state: &Value| {
            dsa_api::coach_snapshot::build(
                state,
                &spec,
                &dsa_api::guidance::derive_turn_prompt(state, &spec),
            )
        };
        assert_eq!(hash(snapshot(&state)), c["initial"], "{c} initial");
        let actions = dsa_api::runtime::canonical(&state, None);
        for frame in actions.as_array().unwrap() {
            state = dsa_api::runtime::apply(&state, &frame["action"])["state"].take();
        }
        assert_eq!(hash(snapshot(&state)), c["terminal"], "{c} terminal");
    }
}
