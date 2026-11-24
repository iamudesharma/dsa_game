use dsa_api::{
    game_chain::{self, RemoteGame},
    game_provider::Failure,
};
use serde_json::Value;
struct Mock {
    scenario: Value,
    spec: Value,
}
impl RemoteGame for Mock {
    async fn available(&self, tier: &str) -> bool {
        match tier {
            "opencode-go" => self.scenario["go"] != "off",
            "openrouter" => self.scenario["router"] != "off",
            _ => false,
        }
    }
    async fn generate(
        &self,
        tier: &str,
        _input: &Value,
        repair: Option<&str>,
    ) -> Result<Value, Failure> {
        let mode = self.scenario[if tier == "opencode-go" {
            "go"
        } else {
            "router"
        }]
        .as_str()
        .unwrap();
        if let Some(issues) = repair {
            assert_eq!(issues, "mock schema failure");
            if mode == "repair-failed" {
                return Err(Failure {
                    schema: false,
                    detail: "mock repair failure".into(),
                });
            }
        } else if mode == "error" {
            return Err(Failure {
                schema: false,
                detail: "mock provider failure".into(),
            });
        } else if mode.starts_with("repair") {
            return Err(Failure {
                schema: true,
                detail: "mock schema failure".into(),
            });
        }
        Ok(self.spec.clone())
    }
}
#[tokio::test]
async fn remote_order_schema_repair_skips_and_template_fallback_match_node() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/game-chain.json")).unwrap();
    assert_eq!(cases.len(), 7);
    for c in cases {
        let mut input = c["input"].clone();
        if let Some(forced) = c["scenario"].get("forceTemplate") {
            input["forceTemplate"] = forced.clone()
        }
        let remote = Mock {
            scenario: c["scenario"].clone(),
            spec: c["result"]["spec"].clone(),
        };
        let mut actual = game_chain::generate(&input, &remote).await.unwrap();
        for attempt in actual["attempts"].as_array_mut().unwrap() {
            attempt["ms"] = serde_json::json!(0)
        }
        assert_eq!(actual, c["result"], "{}", c["scenario"]["name"]);
    }
}
