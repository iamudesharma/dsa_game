use serde_json::Value;
#[test]
fn spoiler_screen_and_digit_free_rewrites_match_node() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/coach-guardrails.json")).unwrap();
    assert_eq!(cases.len(), 32256);
    for c in cases {
        let reply = c["reply"].as_str().unwrap();
        let snapshot = &c["snapshot"];
        assert_eq!(
            dsa_api::coach_guardrails::violation(reply, snapshot).unwrap_or(Value::Null),
            c["violation"],
            "{c}"
        );
        let screen = dsa_api::coach_guardrails::screen(reply, snapshot);
        assert_eq!(screen, c["screen"], "{c}");
        if screen["ok"] == false {
            let text = screen["text"].as_str().unwrap();
            assert!(!text.chars().any(|c| c.is_ascii_digit()));
            assert!(dsa_api::coach_guardrails::violation(text, snapshot).is_none());
        }
    }
}
