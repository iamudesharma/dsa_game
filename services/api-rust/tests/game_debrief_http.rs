use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use serde_json::Value;
use tower::ServiceExt;
#[tokio::test]
async fn game_debrief_http_responses_match_node() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/game-debrief-http.json")).unwrap();
    assert_eq!(cases.len(), 271);
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("fixtures.sqlite");
    let app = dsa_api::AppState::new(config).unwrap();
    let router = dsa_api::app(app.clone());
    for case in cases {
        if let Some(snapshot) = case.get("snapshot") {
            dsa_api::games::save(&app, snapshot).await.unwrap();
        }
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(case["path"].as_str().unwrap())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16() as u64,
            case["status"].as_u64().unwrap(),
            "{}",
            case["path"]
        );
        let body = to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap();
        let actual = std::str::from_utf8(&body).unwrap();
        let expected = case["response"].as_str().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(actual).unwrap(),
            serde_json::from_str::<Value>(expected).unwrap(),
            "{}",
            case["path"]
        );
    }
}

#[tokio::test]
async fn owned_debrief_requires_owner_and_recovers_after_restart() {
    use dsa_api::{auth::token_hash, error::ApiError, games};
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/game-debrief-http.json")).unwrap();
    let terminal = cases.iter().find(|c| c["status"] == 200).unwrap();
    let mut snapshot = terminal["snapshot"].clone();
    snapshot["userId"] = serde_json::json!("alice");
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("owned.sqlite");
    let app = dsa_api::AppState::new(config.clone()).unwrap();
    app.db
        .call(|db| {
            for user in ["alice", "bob"] {
                db.execute(
                    "INSERT INTO users VALUES(?,?,?,1,1)",
                    rusqlite::params![user, format!("{user}@example.com"), "legacy-hash"],
                )
                .map_err(ApiError::internal)?;
                db.execute(
                    "INSERT INTO sessions VALUES(?,?,?,1,4102444800000,1,'node')",
                    rusqlite::params![
                        user,
                        user,
                        token_hash(&format!("{user}-long-session-token"))
                    ],
                )
                .map_err(ApiError::internal)?;
            }
            Ok(())
        })
        .await
        .unwrap();
    games::save(&app, &snapshot).await.unwrap();
    let router = dsa_api::app(dsa_api::AppState::new(config).unwrap());
    for (header, status) in [
        (None, 404),
        (
            Some(("authorization", "Bearer bob-long-session-token")),
            404,
        ),
        (
            Some(("authorization", "Bearer alice-long-session-token")),
            200,
        ),
        (
            Some(("cookie", "dsa_session=alice-long-session-token")),
            200,
        ),
    ] {
        let mut request = Request::builder().uri(terminal["path"].as_str().unwrap());
        if let Some((key, value)) = header {
            request = request.header(key, value)
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        let body = to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap();
        if status == 200 {
            assert_eq!(
                std::str::from_utf8(&body).unwrap(),
                terminal["response"].as_str().unwrap()
            );
        } else {
            assert_eq!(
                serde_json::from_slice::<Value>(&body).unwrap()["error"]["code"],
                "UNKNOWN_GAME"
            );
        }
    }
}
