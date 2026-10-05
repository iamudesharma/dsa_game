use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use serde_json::Value;
use tower::ServiceExt;
#[tokio::test]
async fn serialized_suggest_and_decide_responses_match_node() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/decision-http.json")).unwrap();
    assert_eq!(cases.len(), 134);
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("fixture.sqlite");
    let router = dsa_api::app(dsa_api::AppState::new(config).unwrap());
    for c in cases {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(c["path"].as_str().unwrap())
                    .header("content-type", "application/json")
                    .body(Body::from(c["body"].to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16() as u64,
            c["status"].as_u64().unwrap(),
            "{c}"
        );
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        assert_eq!(
            std::str::from_utf8(&bytes).unwrap(),
            c["response"].as_str().unwrap(),
            "{c}"
        );
    }
}
