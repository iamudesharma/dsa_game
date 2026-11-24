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
fn all_seeded_template_specs_match_node() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/templates.json")).unwrap();
    assert_eq!(cases.len(), 4050);
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let seed = case["seed"].as_f64().unwrap();
        let difficulty = case["difficulty"].as_str().unwrap();
        let problem = dsa_api::reference()["problems"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .unwrap();
        let instance = dsa_api::instances::build(id, seed, difficulty, None).unwrap();
        let result =
            dsa_api::template::build(problem, &instance, seed, difficulty, Some("en")).unwrap();
        let hash = format!(
            "{:x}",
            Sha256::digest(stable(result.clone()).to_string().as_bytes())
        );
        assert_eq!(
            hash, case["hash"],
            "{id} seed {seed} {difficulty}: {result}"
        );
    }
}
