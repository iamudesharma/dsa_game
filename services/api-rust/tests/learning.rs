use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use dsa_api::{app, auth::token_hash, config::Config, error::ApiError, AppState};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn fixture() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("db");
    let state = AppState::new(config).unwrap();
    state.db.call(|db| {
        for user in ["alice","bob"] {
            db.execute("INSERT INTO users VALUES(?,?,?,1,1)",rusqlite::params![user,format!("{user}@example.com"),"hash"]).map_err(ApiError::internal)?;
            db.execute("INSERT INTO sessions VALUES(?,?,?,1,4102444800000,1,'')",rusqlite::params![user,user,token_hash(&format!("{user}-long-session-token"))]).map_err(ApiError::internal)?;
        }
        for (id,owner) in [("thread-a","alice"),("thread-b","bob")] {
            db.execute("INSERT INTO learning_threads VALUES(?,?,'New conversation',1,1)",rusqlite::params![id,owner]).map_err(ApiError::internal)?;
        }
        for i in 0..7 {
            let message=json!({"id":format!("msg-{i}"),"role":"assistant","text":"binary search","requestId":format!("request-{i}"),"status":if i==6 {"streaming"} else {"complete"},"createdAt":1});
            db.execute("INSERT INTO learning_messages VALUES(?,?,?,?)",rusqlite::params![format!("msg-{i}"),"thread-a",format!("request-{i}"),message.to_string()]).map_err(ApiError::internal)?;
        }
        for i in 0..75 {
            // Reverse lexical ids to expose ordering mistakes on timestamp ties.
            db.execute("INSERT INTO study_plans VALUES(?,?,?,?,?,1)",rusqlite::params![format!("plan-{:03}",75-i),"alice",format!("request-{i}"),format!("Plan {i}"),"Content"]).map_err(ApiError::internal)?;
        }
        db.execute("INSERT INTO learning_actions VALUES('pending','alice','running',NULL,NULL)",[]).map_err(ApiError::internal)?;
        for i in 0..7 {
            let record=json!({"gameId":format!("game-{i}"),"problemId":if i%2==0 {"binary-search"} else {"two-sum"},"difficulty":"easy","seed":i,"startedAt":i,"updatedAt":i,"completedAt":null,"outcome":"playing","steps":0,"mistakes":0,"hints":0,"mistakesByMechanic":{}});
            db.execute("INSERT INTO practice_runs VALUES(?,?,?,?,NULL)",rusqlite::params![format!("game-{i}"),"alice",record.to_string(),"{}"]).map_err(ApiError::internal)?;
        }
        Ok(())
    }).await.unwrap();
    (dir, state)
}
async fn req(
    router: Router,
    method: &str,
    path: &str,
    body: Value,
    user: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(user) = user {
        request = request.header("authorization", format!("Bearer {user}-long-session-token"));
    }
    let response = router
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test]
async fn ownership_message_pages_and_recovery() {
    let (_dir, state) = fixture().await;
    let router = app(state.clone());
    let (status, data) = req(
        router.clone(),
        "GET",
        "/api/learning/threads",
        Value::Null,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(data["error"]["code"], "AUTH_REQUIRED");
    assert_eq!(
        req(
            router.clone(),
            "GET",
            "/api/learning/threads/thread-a",
            Value::Null,
            Some("bob")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, page) = req(
        router.clone(),
        "GET",
        "/api/learning/threads/thread-a?limit=3",
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(page["messages"].as_array().unwrap().len(), 3);
    assert_eq!(page["messages"][0]["id"], "msg-0");
    assert_eq!(page["messages"][0]["actions"], json!([]));
    let (_, second) = req(
        router.clone(),
        "GET",
        &format!(
            "/api/learning/threads/thread-a?limit=3&cursor={}",
            page["nextCursor"].as_str().unwrap()
        ),
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(second["messages"][0]["id"], "msg-3");
    let (_, all) = req(
        router.clone(),
        "GET",
        "/api/learning/threads/thread-a?cursor=unknown",
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(all["messages"][6]["status"], "interrupted");
    let status: String = state
        .db
        .call(|db| {
            db.query_row(
                "SELECT status FROM learning_actions WHERE id='pending'",
                [],
                |r| r.get(0),
            )
            .map_err(ApiError::internal)
        })
        .await
        .unwrap();
    assert_eq!(status, "failed");
    let (_, search) = req(
        router,
        "GET",
        "/api/learning/threads?q=binary%20search",
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(search["threads"].as_array().unwrap().len(), 1);
}
#[tokio::test]
async fn mutations_and_streamed_plan_order() {
    let (_dir, state) = fixture().await;
    let router = app(state.clone());
    let (_, data) = req(
        router.clone(),
        "POST",
        "/api/learning/threads",
        json!({}),
        Some("alice"),
    )
    .await;
    let id = data["thread"]["id"].as_str().unwrap();
    let path = format!("/api/learning/threads/{id}");
    assert_eq!(
        req(
            router.clone(),
            "PUT",
            &path,
            json!({"title":"x"}),
            Some("bob")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        req(
            router.clone(),
            "PUT",
            &path,
            json!({"title":" "}),
            Some("alice")
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        req(
            router.clone(),
            "PUT",
            &path,
            json!({"title":"😀".repeat(161)}),
            Some("alice")
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (_, renamed) = req(
        router.clone(),
        "PUT",
        &path,
        json!({"title":"  Named  "}),
        Some("alice"),
    )
    .await;
    assert_eq!(renamed["thread"]["title"], "Named");
    assert_eq!(
        req(router.clone(), "DELETE", &path, Value::Null, Some("alice"))
            .await
            .0,
        StatusCode::OK
    );
    let (_, plans) = req(
        router.clone(),
        "GET",
        "/api/learning/plans",
        Value::Null,
        Some("alice"),
    )
    .await;
    let plans = plans["plans"].as_array().unwrap();
    assert_eq!(plans.len(), 75);
    assert_eq!(plans[0]["title"], "Plan 0");
    assert_eq!(plans[2]["title"], "Plan 10");
    assert_eq!(plans[74]["title"], "Plan 9");
    let (_, other) = req(
        router,
        "GET",
        "/api/learning/plans",
        Value::Null,
        Some("bob"),
    )
    .await;
    assert_eq!(other["plans"], json!([]));
}
#[tokio::test]
async fn history_filters_cursors_and_reflections() {
    let (_dir, state) = fixture().await;
    let router = app(state);
    let (_, first) = req(
        router.clone(),
        "GET",
        "/api/learning/history?topic=binary-search&limit=2",
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(first["total"], 4);
    assert_eq!(first["records"][0]["gameId"], "game-6");
    let (_, second) = req(
        router.clone(),
        "GET",
        &format!(
            "/api/learning/history?topic=binary-search&limit=2&cursor={}",
            first["nextCursor"].as_str().unwrap()
        ),
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(second["records"][0]["gameId"], "game-2");
    assert!(second["nextCursor"].is_null());
    let (_, filtered) = req(
        router.clone(),
        "GET",
        "/api/learning/history?from=2&to=4",
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(filtered["total"], 3);
    assert_eq!(
        req(
            router.clone(),
            "GET",
            "/api/learning/history/game-0",
            Value::Null,
            Some("bob")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let path = "/api/learning/history/game-0/reflection";
    assert_eq!(
        req(router.clone(), "POST", path, json!({}), Some("alice"))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        req(
            router.clone(),
            "POST",
            path,
            json!({"retention":"Learned","integration":"Apply","skipped":false}),
            Some("bob")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        req(
            router,
            "POST",
            path,
            json!({"retention":"Learned","integration":"Apply","skipped":false}),
            Some("alice")
        )
        .await
        .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn dashboard_reviews_evidence_and_stream_disconnect() {
    let (_dir, state) = fixture().await;
    state.db.call(|db| {
        db.execute("INSERT INTO progress VALUES('alice',?,1)",[json!({"two-sum":"2026-01-01T00:00:00.000Z","unknown":"2026-01-01T00:00:00.000Z","jump-game":"invalid"}).to_string()]).map_err(ApiError::internal)?;
        for (i,mistakes,hints) in [(0,5,5),(2,0,0),(4,0,1),(6,0,0)] {
            db.execute("UPDATE practice_runs SET record_json=json_set(record_json,'$.completedAt',?,'$.outcome','won','$.mistakes',?,'$.hints',?) WHERE game_id=?",rusqlite::params![1000+i*1000,mistakes,hints,format!("game-{i}")]).map_err(ApiError::internal)?;
        }
        Ok(())
    }).await.unwrap();
    let router = app(state.clone());
    let (_, dashboard) = req(
        router.clone(),
        "GET",
        "/api/learning/dashboard",
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(dashboard["records"].as_array().unwrap().len(), 7);
    assert_eq!(dashboard["reviews"].as_array().unwrap().len(), 1);
    assert_eq!(dashboard["reviews"][0]["stage"], 1);
    assert_eq!(
        dashboard["reviews"][0]["dueAt"].as_f64(),
        Some(7000.0 + 3.0 * 86400000.0)
    );
    // Preserve the original completion-map overwrite order, independently from
    // the review schedule (the Node reference resolves this to the oldest win).
    assert_eq!(
        dashboard["completed"]["binary-search"],
        "1970-01-01T00:00:01.000Z"
    );
    assert!(dashboard["completed"].get("unknown").is_none());
    assert!(dashboard["completed"].get("jump-game").is_none());
    assert_eq!(dashboard["recommendation"]["problemId"], "binary-search");
    let (_, other) = req(
        router.clone(),
        "GET",
        "/api/learning/dashboard",
        Value::Null,
        Some("bob"),
    )
    .await;
    assert_eq!(other["records"], json!([]));
    assert_eq!(other["reviews"], json!([]));
    state
        .db
        .call(|db| {
            let tx = db.transaction().map_err(ApiError::internal)?;
            for i in 0..300 {
                tx.execute(
                    "INSERT INTO study_plans VALUES(?,?,?,?,?,1)",
                    rusqlite::params![
                        format!("large-{i}"),
                        "alice",
                        format!("large-{i}"),
                        "Large",
                        "x".repeat(16000)
                    ],
                )
                .map_err(ApiError::internal)?;
            }
            tx.commit().map_err(ApiError::internal)
        })
        .await
        .unwrap();
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/learning/plans")
                .header("authorization", "Bearer alice-long-session-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    drop(response);
    // A client dropping a large JSON response must release the DB worker.
    tokio::time::timeout(std::time::Duration::from_secs(2), state.db.call(|_| Ok(())))
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn account_profiles_progress_recovery_and_kit_isolation() {
    let (_dir, state) = fixture().await;
    let router = app(state.clone());
    let (status, _) = req(router.clone(), "PUT", "/api/me/resume", json!({}), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, data) = req(
        router.clone(),
        "PUT",
        "/api/me/resume",
        json!({"summary":"Engineer","contact":{"name":"😀".repeat(120)}}),
        Some("alice"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(data["resume"]["skills"], json!([]));
    assert_eq!(
        req(
            router.clone(),
            "GET",
            "/api/me/resume",
            Value::Null,
            Some("bob")
        )
        .await
        .1["resume"],
        dsa_api::empty_resume()
    );
    let (status, _) = req(
        router.clone(),
        "PUT",
        "/api/me/resume",
        json!({"contact":{"name":"😀".repeat(121)}}),
        Some("alice"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    req(
        router.clone(),
        "POST",
        "/api/me/progress",
        json!({"completed":{"binary-search":"2026-01-01","not-a-problem":"2026-01-01"}}),
        Some("alice"),
    )
    .await;
    let (_, data) = req(
        router.clone(),
        "POST",
        "/api/me/progress",
        json!({"completed":{"binary-search":"2026-02-01","two-sum":"2026-01-03"}}),
        Some("alice"),
    )
    .await;
    assert_eq!(
        data["completed"],
        json!({"binary-search":"2026-01-01","two-sum":"2026-01-03"})
    );
    state
        .db
        .call(|db| {
            db.execute("INSERT INTO targets VALUES('alice','{}',1)", [])
                .map_err(ApiError::internal)?;
            db.execute(
                "UPDATE resumes SET data_json='invalid-json' WHERE user_id='alice'",
                [],
            )
            .map_err(ApiError::internal)?;
            db.execute(
                "INSERT INTO interview_kits VALUES('kit-a','alice','{}','[]','template',1)",
                [],
            )
            .map_err(ApiError::internal)?;
            Ok(())
        })
        .await
        .unwrap();
    let (_, me) = req(
        router.clone(),
        "GET",
        "/api/auth/me",
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(me["resume"], dsa_api::empty_resume());
    assert!(me["target"].is_null());
    assert_eq!(me["progress"], data["completed"]);
    let (_, kit) = req(
        router.clone(),
        "GET",
        "/api/interview/kits/kit-a",
        Value::Null,
        Some("alice"),
    )
    .await;
    assert_eq!(kit["target"]["companyId"], "custom");
    assert_eq!(
        req(
            router.clone(),
            "GET",
            "/api/interview/kits/kit-a",
            Value::Null,
            Some("bob")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        req(
            router,
            "GET",
            "/api/interview/kits",
            Value::Null,
            Some("bob")
        )
        .await
        .1,
        json!({"kits":[]})
    );
}
