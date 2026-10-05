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
#[test]
fn every_registered_generator_matches_node_across_seeds_difficulties_and_lengths() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/instances.json")).unwrap();
    let mut ids = std::collections::BTreeSet::new();
    for case in &cases {
        let id = case["id"].as_str().unwrap();
        ids.insert(id);
        let input = &case["input"];
        let result = dsa_api::instances::build(
            id,
            input["seed"].as_f64().unwrap(),
            input["difficulty"].as_str().unwrap(),
            input["length"].as_f64(),
        )
        .unwrap_or_else(|| panic!("Missing generator: {id}"));
        let serialized = stable(result.clone()).to_string();
        let digest = format!("{:x}", Sha256::digest(serialized.as_bytes()));
        assert_eq!(
            digest,
            case["sha256"].as_str().unwrap(),
            "{id} {input}: {result}"
        );
    }
    assert_eq!(ids.len(), 45);
    assert_eq!(cases.len(), 5805);
}
