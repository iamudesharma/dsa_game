use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use tower::ServiceExt;
fn normalize(v: Value, key: &str, ids: &mut HashMap<String, String>, turn: &mut usize) -> Value {
    if [
        "createdAt",
        "updatedAt",
        "lastAccessedAt",
        "at",
        "latencyMs",
    ]
    .contains(&key)
    {
        return json!(0);
    }
    match v {
        Value::String(s) => {
            if let Some(id) = ids.get(&s) {
                json!(id)
            } else if s.starts_with("turn-") {
                let id = format!("turn-{turn}");
                *turn += 1;
                ids.insert(s, id.clone());
                json!(id)
            } else {
                json!(s)
            }
        }
        Value::Array(a) => {
            let mut values: Vec<_> = a.into_iter().map(|v| normalize(v, "", ids, turn)).collect();
            if key == "threads" {
                values.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
            }
            Value::Array(values)
        }
        Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, v)| {
                    let v = normalize(v, &k, ids, turn);
                    (k, v)
                })
                .collect(),
        ),
        v => v,
    }
}
async fn request(
    router: axum::Router,
    path: &str,
    body: Option<Value>,
    method: &str,
) -> (u16, Value) {
    authenticated_request(router, path, body, method, None).await
}
async fn authenticated_request(
    router: axum::Router,
    path: &str,
    body: Option<Value>,
    method: &str,
    token: Option<&str>,
) -> (u16, Value) {
    let mut builder = Request::builder().uri(path).method(method);
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }

    let body = if let Some(body) = body {
        builder = builder.header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    let response = router.oneshot(builder.body(body).unwrap()).await.unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test]
async fn coach_http_journeys_match_node_all_problems_and_difficulties() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/coach-http.json")).unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 135);
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("coach-http.sqlite");
    let mut state = dsa_api::AppState::new(config).unwrap();
    state.transport = dsa_api::provider::Transport::with_chat(
        state.ai.clone(),
        state.config.provider_bytes,
        None,
    )
    .unwrap();
    let router = dsa_api::app(state);
    for c in fixture["cases"].as_array().unwrap() {
        let(_,generated)=request(router.clone(),"/api/generate",Some(json!({"problemId":c["id"],"seed":7,"difficulty":c["difficulty"],"forceTemplate":true})),"POST").await;
        let game = generated["gameId"].as_str().unwrap();
        let mut ids = HashMap::from([(game.to_owned(), "fixture-game".into())]);
        let mut threads: Vec<String> = Vec::new();
        let mut turn = 0;
        for (i, s) in c["steps"].as_array().unwrap().iter().enumerate() {
            let mut path = s["path"].as_str().unwrap().replace("fixture-game", game);
            for (i, id) in threads.iter().enumerate() {
                path = path.replace(&format!("thread-{i}"), id)
            }
            let body = s.get("body").map(|b| {
                let mut b = b.clone();
                b["gameId"] = json!(game);
                if let Some(id) = b["threadId"].as_str() {
                    if let Some(index) = id
                        .strip_prefix("thread-")
                        .and_then(|s| s.parse::<usize>().ok())
                    {
                        b["threadId"] = json!(threads[index]);
                    }
                }
                b
            });
            let (status, response) =
                request(router.clone(), &path, body, s["method"].as_str().unwrap()).await;
            if let Some(id) = response["threadId"].as_str() {
                if !ids.contains_key(id) {
                    ids.insert(id.into(), format!("thread-{}", threads.len()));
                    threads.push(id.to_owned());
                }
            }
            assert_eq!(
                status,
                s["status"].as_u64().unwrap() as u16,
                "{} {} step {i} {path}: {response}",
                c["id"],
                c["difficulty"]
            );
            assert_eq!(
                normalize(response, "", &mut ids, &mut turn),
                s["response"],
                "{} {} step {i} {path}",
                c["id"],
                c["difficulty"]
            );
        }
    }
    for c in fixture["errors"].as_array().unwrap() {
        let (status, response) = request(
            router.clone(),
            c["path"].as_str().unwrap(),
            c.get("body").cloned(),
            c["method"].as_str().unwrap(),
        )
        .await;
        assert_eq!(status, c["status"].as_u64().unwrap() as u16, "{c}");
        assert_eq!(response, c["response"], "{c}");
    }
}

#[tokio::test]
async fn owned_coach_http_recovers_isolates_and_never_changes_game() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("owned.sqlite");
    let offline = |config| {
        let mut state = dsa_api::AppState::new(config).unwrap();
        state.transport = dsa_api::provider::Transport::with_chat(
            state.ai.clone(),
            state.config.provider_bytes,
            None,
        )
        .unwrap();
        dsa_api::app(state)
    };
    let router = offline(config.clone());
    let (_, alice) = request(
        router.clone(),
        "/api/auth/signup",
        Some(json!({"email":"coach-alice@example.com","password":"password123"})),
        "POST",
    )
    .await;
    let (_, bob) = request(
        router.clone(),
        "/api/auth/signup",
        Some(json!({"email":"coach-bob@example.com","password":"password123"})),
        "POST",
    )
    .await;
    let a = alice["token"].as_str().unwrap();
    let b = bob["token"].as_str().unwrap();
    let (_, game) = authenticated_request(
        router.clone(),
        "/api/generate",
        Some(
            json!({"problemId":"binary-search","seed":7,"difficulty":"hard","forceTemplate":true}),
        ),
        "POST",
        Some(a),
    )
    .await;
    let game_id = game["gameId"].as_str().unwrap();
    let path = format!("/api/game/{game_id}");
    let (_, before) = authenticated_request(router.clone(), &path, None, "GET", Some(a)).await;
    let body = json!({"gameId":game_id,"message":"What should I compare next?","band":"builder"});
    let (status, reply) = authenticated_request(
        router.clone(),
        "/api/coach/ask",
        Some(body.clone()),
        "POST",
        Some(a),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(reply["turns"].as_array().unwrap().len(), 2);
    let thread_path = format!("/api/coach/threads/{}", reply["threadId"].as_str().unwrap());
    for method in ["GET", "DELETE"] {
        let (status, _) =
            authenticated_request(router.clone(), &thread_path, None, method, Some(b)).await;
        assert_eq!(status, 404);
    }
    let (status, _) = authenticated_request(
        router.clone(),
        "/api/coach/ask",
        Some(body),
        "POST",
        Some(b),
    )
    .await;
    assert_eq!(status, 404);
    let (_, after) = authenticated_request(router.clone(), &path, None, "GET", Some(a)).await;
    assert_eq!(before, after, "asking the coach must never mutate gameplay");
    drop(router);
    let router = offline(config.clone());
    let (status, restored) =
        authenticated_request(router.clone(), &thread_path, None, "GET", Some(a)).await;
    assert_eq!(status, 200);
    assert_eq!(restored["thread"]["turns"], reply["turns"]);
    let (status, page) = authenticated_request(
        router.clone(),
        &format!("/api/coach/threads?gameId={game_id}&limit=1&offset=1"),
        None,
        "GET",
        Some(a),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(page["threads"], json!([]));
    let action = json!({"gameId":game_id,"action":{"type":"selectObject","objectId":"missing","actionId":"stable-action"}});
    let (status, first) = authenticated_request(
        router.clone(),
        "/api/action",
        Some(action.clone()),
        "POST",
        Some(a),
    )
    .await;
    assert_eq!(status, 200);
    let (status, replay) = authenticated_request(
        router.clone(),
        "/api/action",
        Some(action.clone()),
        "POST",
        Some(a),
    )
    .await;
    assert_eq!((status, replay), (200, first.clone()));
    let mut changed = action.clone();
    changed["action"]["objectId"] = json!("different");
    assert_eq!(
        authenticated_request(
            router.clone(),
            "/api/action",
            Some(changed),
            "POST",
            Some(a)
        )
        .await
        .0,
        409
    );
    assert_eq!(
        authenticated_request(
            router.clone(),
            "/api/action",
            Some(action.clone()),
            "POST",
            Some(b)
        )
        .await
        .0,
        404
    );
    drop(router);
    let router = offline(config.clone());
    let (status, replay) =
        authenticated_request(router.clone(), "/api/action", Some(action), "POST", Some(a)).await;
    assert_eq!((status, replay), (200, first));
    let db = rusqlite::Connection::open(&config.db_path).unwrap();
    let durable_before: String = db
        .query_row(
            "SELECT snapshot_json FROM practice_runs WHERE game_id=?",
            [game_id],
            |r| r.get(0),
        )
        .unwrap();
    db.execute_batch("CREATE TRIGGER receipt_fault BEFORE INSERT ON learning_actions WHEN NEW.status='game-action' BEGIN SELECT RAISE(ABORT,'receipt failure'); END;").unwrap();
    let failed_action = json!({"gameId":game_id,"action":{"type":"selectObject","objectId":"missing","actionId":"broken-receipt"}});
    assert_eq!(
        authenticated_request(
            router.clone(),
            "/api/action",
            Some(failed_action),
            "POST",
            Some(a)
        )
        .await
        .0,
        500
    );
    let durable_after: String = db
        .query_row(
            "SELECT snapshot_json FROM practice_runs WHERE game_id=?",
            [game_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        durable_before, durable_after,
        "receipt failure must roll back the gameplay snapshot"
    );
    db.execute_batch("DROP TRIGGER receipt_fault;").unwrap();

    assert_eq!(
        authenticated_request(router.clone(), &thread_path, None, "DELETE", Some(a))
            .await
            .0,
        200
    );
    assert_eq!(
        authenticated_request(router, &thread_path, None, "GET", Some(a))
            .await
            .0,
        404
    );
}

#[tokio::test]
async fn guest_action_replay_is_bounded_by_the_shared_cache_and_guest_lifetime() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = dsa_api::config::Config::from_env().unwrap();
    config.db_path = dir.path().join("guest.sqlite");
    let state = dsa_api::AppState::new(config).unwrap();
    let router = dsa_api::app(state.clone());
    let (_, game) = request(
        router.clone(),
        "/api/generate",
        Some(json!({"problemId":"binary-search","seed":7,"forceTemplate":true})),
        "POST",
    )
    .await;
    let id = game["gameId"].as_str().unwrap();
    let action = json!({"gameId":id,"action":{"type":"selectObject","objectId":"missing","actionId":"guest-retry"}});
    let first = request(router.clone(), "/api/action", Some(action.clone()), "POST").await;
    assert_eq!(first.0, 200);
    assert_eq!(
        request(router.clone(), "/api/action", Some(action.clone()), "POST").await,
        first
    );
    let count: i64 = state
        .db
        .call(|db| {
            db.query_row("SELECT count(*) FROM learning_actions", [], |r| r.get(0))
                .map_err(dsa_api::error::ApiError::internal)
        })
        .await
        .unwrap();
    assert_eq!(
        count, 0,
        "guest receipts must never become durable account data"
    );
    state
        .cache
        .lock()
        .unwrap()
        .discard(&dsa_api::games::action_receipt_id(id, "guest-retry"));
    assert_eq!(
        request(router.clone(), "/api/action", Some(action.clone()), "POST")
            .await
            .0,
        409,
        "an evicted receipt must never allow applying a traced action twice"
    );
    state.cache.lock().unwrap().discard(&format!("game:{id}"));
    assert_eq!(
        request(router, "/api/action", Some(action), "POST").await.0,
        404
    );
}
