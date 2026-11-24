use dsa_api::decisions as d;
use serde_json::Value;
fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect()
}
fn numeric(v: Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.into_iter().map(numeric).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, numeric(v))).collect()),
        Value::Number(ref n)
            if n.as_f64()
                .is_some_and(|n| n.fract() == 0.0 && n.abs() <= 9007199254740991.0) =>
        {
            serde_json::json!(n.as_f64().unwrap() as i64)
        }
        v => v,
    }
}
#[test]
fn routing_hint_theme_difficulty_and_misconception_match_node() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/decisions.json")).unwrap();
    assert_eq!(cases.len(), 1255);
    for c in cases {
        let result = match c["kind"].as_str().unwrap() {
            "route" => {
                let text = c["text"].as_str().unwrap();
                let allowed = c["allowed"].as_array().map(|_| strings(&c["allowed"]));
                assert_eq!(d::tokenize(text), strings(&c["tokens"]));
                assert_eq!(d::hash_string(text) as u64, c["hash"].as_u64().unwrap());
                assert_eq!(
                    d::scores(text, allowed.as_deref()),
                    *c["scores"].as_array().unwrap(),
                    "scores {text}"
                );
                d::route(text, allowed.as_deref())
            }
            "theme" => d::theme(&strings(&c["candidates"]), c["text"].as_str()),
            "hint" => d::hint(
                &strings(&c["pool"]),
                c["used"].as_f64().unwrap(),
                c["op"].as_str(),
            ),
            "difficulty" => d::difficulty(
                c["steps"].as_f64().unwrap(),
                c["mistakes"].as_f64().unwrap(),
                c["hints"].as_f64().unwrap(),
            ),
            "tag" => {
                assert_eq!(
                    d::tag_detailed(c["trace"].as_array().unwrap()),
                    c["detailed"]
                );
                d::tag(c["trace"].as_array().unwrap())
            }
            _ => panic!("unexpected fixture"),
        };
        assert_eq!(numeric(result), numeric(c["result"].clone()), "{c}");
    }
}
