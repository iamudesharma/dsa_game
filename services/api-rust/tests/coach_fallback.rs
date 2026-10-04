use serde_json::Value;
#[test]
fn board_specific_coaching_and_repetition_avoidance_match_node() {
    let fixtures: Value =
        serde_json::from_str(include_str!("fixtures/coach-fallback.json")).unwrap();
    for c in fixtures["classified"].as_array().unwrap() {
        assert_eq!(
            dsa_api::coach_fallback::classify(c["question"].as_str().unwrap()),
            c["expected"],
            "{c}"
        );
    }
    for (i, c) in fixtures["cases"].as_array().unwrap().iter().enumerate() {
        let hints = c["givenHints"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            dsa_api::coach_fallback::answer(
                c["question"].as_str().unwrap(),
                &c["snapshot"],
                &c["turnPrompt"],
                c["band"].as_str(),
                &hints
            ),
            c["expected"],
            "case {i}: {c}"
        );
    }
}
