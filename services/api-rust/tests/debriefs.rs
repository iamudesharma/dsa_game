use serde_json::{json, Value};
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
fn themed_debrief_matches_node_for_every_problem_seed_and_difficulty() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/debriefs.json")).unwrap();
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
        assert_eq!(
            hash(dsa_api::debrief::build(&spec, &state)),
            c["initial"],
            "{c} initial"
        );
        let actions = dsa_api::runtime::canonical(&state, None);
        state = dsa_api::runtime::apply(
            &state,
            &json!({"type":"assignValue","targetId":"missing","value":"wrong"}),
        )["state"]
            .take();
        for frame in actions.as_array().unwrap() {
            state = dsa_api::runtime::apply(&state, &frame["action"])["state"].take();
        }
        state["progress"]["hintsUsed"] = json!(2);
        assert_eq!(
            hash(dsa_api::debrief::build(&spec, &state)),
            c["terminal"],
            "{c} terminal"
        );
    }
}
