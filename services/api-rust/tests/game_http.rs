use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tower::ServiceExt;
fn stable(v: Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.into_iter().map(stable).collect()),
        Value::Object(o) => {
            let sorted: std::collections::BTreeMap<_, _> = o
                .into_iter()
                .map(|(k, v)| {
                    let v = if k == "gameId" {
                        json!("fixture-game")
                    } else if k == "ms" {
                        json!(0)
                    } else {
                        stable(v)
                    };
                    (k, v)
                })
                .collect();
            Value::Object(sorted.into_iter().collect())
        }
        v => v,
    }
}
fn hash(status: u16, body: Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            stable(json!({"status":status,"body":body}))
                .to_string()
                .as_bytes()
        )
    )
}
async fn request(router: axum::Router, path: &str, body: Option<Value>) -> (u16, Value) {
    let mut request =
        Request::builder()
            .uri(path)
            .method(if body.is_some() { "POST" } else { "GET" });
    let body = if let Some(body) = body {
        request = request.header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    let response = router.oneshot(request.body(body).unwrap()).await.unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test]
async fn complete_playable_http_journeys_match_node_every_seed_and_difficulty() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/game-http.json")).unwrap();
    assert_eq!(cases.len(), 4050);
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("fixtures.sqlite");
    let app = dsa_api::AppState::new(config).unwrap();
    let router = dsa_api::app(app.clone());
    let mut total = 0;
    let filter = std::env::var("DSA_PARITY_PROBLEM").ok();
    let seed_filter = std::env::var("DSA_PARITY_SEED")
        .ok()
        .map(|s| s.parse::<u64>().expect("DSA_PARITY_SEED must be 0..29"));
    assert!(seed_filter.is_none_or(|seed| seed < 30));
    for c in cases {
        if seed_filter.is_some_and(|seed| c["seed"] != seed) {
            continue;
        }
        if filter.as_deref().is_some_and(|id| c["id"] != id) {
            continue;
        }
        let (status,initial)=request(router.clone(),"/api/generate",Some(json!({"problemId":c["id"],"seed":c["seed"],"difficulty":c["difficulty"],"forceTemplate":true}))).await;
        let id = initial["gameId"]
            .as_str()
            .unwrap_or_else(|| panic!("{} generate: {initial}", c["id"]))
            .to_owned();
        assert_eq!(
            hash(status, initial),
            c["generate"],
            "{} {} {} generate",
            c["id"],
            c["seed"],
            c["difficulty"]
        );
        total += 1;
        for (i, req) in c["requests"].as_array().unwrap().iter().enumerate() {
            let path = req["path"].as_str().unwrap().replace("fixture-game", &id);
            let body = req.get("body").map(|b| {
                let mut b = b.clone();
                b["gameId"] = json!(id);
                b
            });
            let (status, response) = request(router.clone(), &path, body).await;
            if hash(status, response.clone()) != req["hash"] {
                std::fs::write("/tmp/dsa-rust-game-mismatch.json", response.to_string()).unwrap();
            }
            assert_eq!(
                hash(status, response.clone()),
                req["hash"],
                "{} {} {} request {i}: {path}",
                c["id"],
                c["seed"],
                c["difficulty"]
            );
            total += 1;
        }
        assert!(app.cache.lock().unwrap().bytes() <= app.config.cache_bytes);
    }
    assert!(total > 0);
    if filter.is_none() && seed_filter.is_none() {
        assert_eq!(total, 134681);
    }
}
#[tokio::test]
async fn game_validation_and_error_envelopes_match_node() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/game-validation.json")).unwrap();
    assert_eq!(cases.len(), 38);
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("validation.sqlite");
    let router = dsa_api::app(dsa_api::AppState::new(config).unwrap());
    for c in cases {
        let (status, response) = request(
            router.clone(),
            c["path"].as_str().unwrap(),
            Some(c["body"].clone()),
        )
        .await;
        assert_eq!(status as u64, c["status"].as_u64().unwrap(), "{c}");
        assert_eq!(response, c["response"], "{c}")
    }
}

#[tokio::test]
async fn owned_game_http_recovery_and_ownership_precede_action_validation() {
    use dsa_api::{auth::token_hash, error::ApiError};
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
    async fn owned_request(
        router: axum::Router,
        path: &str,
        body: Option<Value>,
        owner: Option<&str>,
    ) -> (u16, Value) {
        let mut req =
            Request::builder()
                .uri(path)
                .method(if body.is_some() { "POST" } else { "GET" });
        if let Some(owner) = owner {
            req = req.header("cookie", format!("dsa_session={owner}-long-session-token"));
        }
        let body = if let Some(b) = body {
            req = req.header("content-type", "application/json");
            Body::from(b.to_string())
        } else {
            Body::empty()
        };
        let response = router.oneshot(req.body(body).unwrap()).await.unwrap();
        let status = response.status().as_u16();
        (
            status,
            serde_json::from_slice(
                &to_bytes(response.into_body(), 4 * 1024 * 1024)
                    .await
                    .unwrap(),
            )
            .unwrap(),
        )
    }
    let router = dsa_api::app(app);
    let (status, initial) = owned_request(
        router,
        "/api/generate",
        Some(json!({"problemId":"binary-search","seed":7,"forceTemplate":true})),
        Some("alice"),
    )
    .await;
    assert_eq!(status, 200);
    let id = initial["gameId"].as_str().unwrap();
    let restarted = dsa_api::AppState::new(config).unwrap();
    let router = dsa_api::app(restarted.clone());
    let (status, restored) = owned_request(
        router.clone(),
        &format!("/api/game/{id}"),
        None,
        Some("alice"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(restored["state"], initial["state"]);
    assert_eq!(restored["spec"], initial["spec"]);
    for owner in [None, Some("bob")] {
        for path in ["/api/action", "/api/undo", "/api/hint"] {
            let (status, body) = owned_request(
                router.clone(),
                path,
                Some(json!({"gameId":id,"action":{"type":"bad"}})),
                owner,
            )
            .await;
            assert_eq!(status, 404);
            assert_eq!(body["error"]["code"], "UNKNOWN_GAME");
        }
    }
    let action = dsa_api::runtime::canonical(&restored["state"], None)[0]["action"].clone();
    let (status, applied) = owned_request(
        router.clone(),
        "/api/action",
        Some(json!({"gameId":id,"action":action})),
        Some("alice"),
    )
    .await;
    assert_eq!(status, 200);
    assert_ne!(applied["state"], restored["state"]);
    let (status, undone) = owned_request(
        router,
        "/api/undo",
        Some(json!({"gameId":id})),
        Some("alice"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(undone["undone"], true);
    assert_eq!(undone["state"]["objects"], restored["state"]["objects"]);
    let cached = restarted
        .cache
        .lock()
        .unwrap()
        .get(&format!("game:{id}"), std::time::Instant::now())
        .unwrap();
    dsa_api::games::load(&restarted, id, Some("alice"))
        .await
        .unwrap()
        .unwrap();
    let after = restarted
        .cache
        .lock()
        .unwrap()
        .get(&format!("game:{id}"), std::time::Instant::now())
        .unwrap();
    assert!(
        std::sync::Arc::ptr_eq(&cached, &after),
        "A cache hit must not copy and reserialize the undo history"
    );
}
