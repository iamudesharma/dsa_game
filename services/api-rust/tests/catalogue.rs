use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use tower::ServiceExt;
#[tokio::test]
async fn serialized_catalogue_matches_node() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("fixture.sqlite");
    let router = dsa_api::app(dsa_api::AppState::new(config).unwrap());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/catalogue")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    assert_eq!(
        std::str::from_utf8(&body).unwrap(),
        include_str!("fixtures/catalogue.json").trim_end()
    );
}

#[tokio::test]
async fn unknown_methods_and_paths_match_node_errors() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("fixture.sqlite");
    let router = dsa_api::app(dsa_api::AppState::new(config).unwrap());
    for (method, path) in [("POST", "/api/catalogue"), ("GET", "/api/does-not-exist")] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 404);
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        assert_eq!(body["error"]["code"], "BAD_REQUEST");
        assert_eq!(
            body["error"]["message"],
            format!("No route for {method} {path}")
        );
    }
}
