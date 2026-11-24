use serde_json::Value;
use sha2::{Digest, Sha256};
fn stable(value: Value) -> Value {
    match value {
        Value::Array(a) => Value::Array(a.into_iter().map(stable).collect()),
        Value::Object(o) => {
            let sorted: std::collections::BTreeMap<_, _> = o.into_iter().collect();
            Value::Object(sorted.into_iter().map(|(k, v)| (k, stable(v))).collect())
        }
        value => value,
    }
}
fn hash(value: Value) -> String {
    format!("{:x}", Sha256::digest(stable(value).to_string().as_bytes()))
}
#[test]
fn external_llama_modes_and_salvage_match_node_every_problem_and_difficulty() {
    let cases: Value = serde_json::from_str(include_str!("fixtures/local-provider.json")).unwrap();
    assert_eq!(cases.as_array().unwrap().len(), 135);
    for case in cases.as_array().unwrap() {
        let input = &case["input"];
        let mut modes = dsa_api::game_provider::llama_modes(input, "local-model", None);
        for mode in &mut modes {
            mode.as_object_mut().unwrap().remove("messages");
        }
        assert_eq!(
            hash(serde_json::json!(modes)),
            case["modes"],
            "{} {} modes",
            input["problem"]["id"],
            input["difficulty"]
        );
        for s in case["salvage"].as_array().unwrap() {
            let result =
                dsa_api::game_provider::salvage(input, &s["partial"]).unwrap_or(Value::Null);
            assert_eq!(
                hash(result),
                s["hash"],
                "{} {} salvage {}",
                input["problem"]["id"],
                input["difficulty"],
                s["partial"]
            );
        }
    }
}
