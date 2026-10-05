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
fn hint_screening_and_undo_match_node_at_every_played_stage() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/hints.json")).unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let mut current = dsa_api::runtime::init(
            case["id"].as_str().unwrap(),
            7.0,
            case["difficulty"].as_str().unwrap(),
        )
        .unwrap();
        for step in case["moves"].as_array().unwrap() {
            let state = &current;
            for check in step["checks"].as_array().unwrap() {
                let preferred = check["preferred"].as_u64().map(|v| v as usize);
                assert_eq!(
                    digest(dsa_api::hints::next(state, &check["spec"], preferred)),
                    check["result"],
                    "{} hint {}",
                    case["id"],
                    check["spec"]
                );
            }
            assert_eq!(
                digest(dsa_api::hints::increment(state)),
                step["increment"],
                "{} increment",
                case["id"]
            );
            let next = dsa_api::runtime::apply(state, &step["action"])["state"].clone();
            assert_eq!(
                digest(dsa_api::runtime::rewind(&next, state)),
                step["undo"],
                "{} undo",
                case["id"]
            );
            current = next;
        }
    }
}
