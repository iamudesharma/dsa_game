use dsa_api::coach_budget::{self, Budget};
use serde_json::Value;
#[test]
fn bounded_windows_match_node() {
    let fixtures: Value = serde_json::from_str(include_str!("fixtures/coach-budget.json")).unwrap();
    for c in fixtures["cases"].as_array().unwrap() {
        let b = &c["budget"];
        let budget = Budget {
            max_prompt_tokens: b["maxPromptTokens"].as_u64().unwrap() as usize,
            reply_reserve_tokens: b["replyReserveTokens"].as_u64().unwrap() as usize,
            max_turns: b["maxTurns"].as_u64().unwrap() as usize,
        };
        assert_eq!(
            coach_budget::assemble(c["turns"].as_array().unwrap(), budget, c["prior"].as_str()),
            c["expected"],
            "size {}, budget {b}",
            c["turns"].as_array().unwrap().len()
        );
    }
    for c in fixtures["estimates"].as_array().unwrap() {
        assert_eq!(
            coach_budget::estimate_tokens(c["text"].as_str().unwrap()),
            c["expected"].as_u64().unwrap() as usize
        );
    }
    let preamble = coach_budget::after_preamble(&[&"a".repeat(30000)], Budget::default());
    assert_eq!(
        preamble.max_prompt_tokens,
        fixtures["preamble"]["maxPromptTokens"].as_u64().unwrap() as usize
    );
}
