use serde_json::Value;
#[test]
fn game_provider_prompts_schemas_and_response_protocol_match_node() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/game-providers.json")).unwrap();
    assert_eq!(cases.len(), 112);
    for c in cases {
        let tier = c["tier"].as_str().unwrap();
        let request = &c["request"];
        let actual = dsa_api::game_provider::request(
            &c["input"],
            tier,
            "fixture-model",
            request["temperature"].as_f64().unwrap(),
            request["max_tokens"].as_u64().unwrap() as u32,
        );
        assert_eq!(actual, *request, "{} {} request", tier, c["name"]);
        let actual = dsa_api::game_provider::response(
            &c["input"],
            tier,
            c["status"].as_u64().unwrap_or(200) as u16,
            &c["body"],
            request["max_tokens"].as_u64().unwrap() as u32,
        );
        match actual {
            Ok(spec) => assert_eq!(spec, c["spec"], "{} {} spec", tier, c["name"]),
            Err(error) => assert_eq!(error.as_json(), c["error"], "{} {} error", tier, c["name"]),
        }
    }
}
