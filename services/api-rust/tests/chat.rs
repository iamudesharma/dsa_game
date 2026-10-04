use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
    routing::post,
    Json, Router,
};
use dsa_api::{
    app,
    auth::token_hash,
    config::Config,
    error::ApiError,
    provider::{ChatConfig, Transport},
    AppState,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tower::ServiceExt;
struct Server(tokio::task::JoinHandle<()>, String);
impl Drop for Server {
    fn drop(&mut self) {
        self.0.abort();
    }
}
async fn server(router: Router) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    Server(
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        }),
        format!("http://{addr}"),
    )
}
async fn fixture() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = Config::from_env().unwrap();
    cfg.db_path = dir.path().join("db");
    cfg.sse_bytes = 64;
    let state = AppState::new(cfg).unwrap();
    state
        .db
        .call(|db| {
            for user in ["alice", "bob"] {
                db.execute(
                    "INSERT INTO users VALUES(?,?,?,1,1)",
                    rusqlite::params![user, format!("{user}@example.com"), "hash"],
                )
                .map_err(ApiError::internal)?;
                db.execute(
                    "INSERT INTO sessions VALUES(?,?,?,1,4102444800000,1,'')",
                    rusqlite::params![
                        user,
                        user,
                        token_hash(&format!("{user}-long-session-token"))
                    ],
                )
                .map_err(ApiError::internal)?;
            }
            for (id, owner) in [
                ("thread-a", "alice"),
                ("thread-b", "bob"),
                ("thread-c", "alice"),
            ] {
                db.execute(
                    "INSERT INTO learning_threads VALUES(?,?,'New conversation',1,1)",
                    rusqlite::params![id, owner],
                )
                .map_err(ApiError::internal)?;
            }
            Ok(())
        })
        .await
        .unwrap();
    (dir, state)
}
fn configure(state: &mut AppState, base: String) {
    state.transport = Transport::with_chat(
        state.ai.clone(),
        state.config.provider_bytes,
        Some(ChatConfig {
            id: "opencode-go",
            base,
            key: "test".into(),
            model: "test-model".into(),
            session: String::new(),
            timeout_ms: 5000,
        }),
    )
    .unwrap();
}
async fn request(router: Router, path: &str, body: Value, user: &str) -> axum::response::Response {
    router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {user}-long-session-token"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn events(response: axum::response::Response) -> Vec<Value> {
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "text/event-stream");
    let mut stream = response.into_body().into_data_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.unwrap();
        bytes.extend_from_slice(&chunk);
        drop(chunk);
    }
    String::from_utf8(bytes)
        .unwrap()
        .split("\n\n")
        .filter(|s| !s.is_empty())
        .map(|s| serde_json::from_str(s.strip_prefix("data: ").unwrap()).unwrap())
        .collect()
}
fn input(request_id: &str, text: &str) -> Value {
    json!({"requestId":request_id,"text":text,"context":{"history":false}})
}
#[tokio::test]
async fn durable_stream_replay_regenerate_and_plan_idempotency() {
    let calls = Arc::new(AtomicUsize::new(0));
    let c = calls.clone();
    let upstream=server(Router::new().route("/chat/completions",post(move|Json(v):Json<Value>|{let c=c.clone();async move{
        c.fetch_add(1,Ordering::SeqCst);
        if v["stream"]==true{assert_eq!(v["messages"].as_array().unwrap().last().unwrap()["content"],"Make a plan");Body::from("data: {\"choices\":[{\"delta\":{\"content\":\"Study arrays 😀\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n")}
        else{assert_eq!(v["max_tokens"],5000);Body::from(json!({"choices":[{"message":{"content":"{\"actions\":[{\"type\":\"plan\",\"title\":\"Arrays\",\"content\":\"Day 1: arrays\"}]}"}}]}).to_string())}
    }}))).await;
    let (_dir, mut state) = fixture().await;
    configure(&mut state, upstream.1.clone());
    let router = app(state.clone());
    let body = input("request-01", "Make a plan");
    let first = events(
        request(
            router.clone(),
            "/api/learning/threads/thread-a/messages",
            body.clone(),
            "alice",
        )
        .await,
    )
    .await;
    assert_eq!(
        first
            .iter()
            .map(|e| e["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["status", "status", "text", "actions", "complete"]
    );
    let message = first.last().unwrap()["message"].clone();
    assert_eq!(message["status"], "complete");
    assert_eq!(message["text"], "Study arrays 😀");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let duplicate = events(
        request(
            router.clone(),
            "/api/learning/threads/thread-a/messages",
            body,
            "alice",
        )
        .await,
    )
    .await;
    assert_eq!(
        duplicate,
        json!([{"type":"complete","message":message}])
            .as_array()
            .unwrap()
            .clone()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let regen = json!({"requestId":"request-02","text":"Make a plan","context":{"history":false},"regenerate":true});
    let retried = events(
        request(
            router.clone(),
            "/api/learning/threads/thread-a/messages",
            regen,
            "alice",
        )
        .await,
    )
    .await;
    assert_eq!(retried.last().unwrap()["message"]["status"], "complete");
    let selected = json!({"messageId":message["id"],"index":0,"requestId":"action-0001"});
    let a = request(
        router.clone(),
        "/api/learning/threads/thread-a/actions",
        selected.clone(),
        "alice",
    )
    .await;
    let a = axum::body::to_bytes(a.into_body(), 4096).await.unwrap();
    let b = request(
        router.clone(),
        "/api/learning/threads/thread-a/actions",
        selected,
        "alice",
    )
    .await;
    let b = axum::body::to_bytes(b.into_body(), 4096).await.unwrap();
    assert_eq!(a, b);
    let counts=state.db.call(|db|Ok((db.query_row("SELECT count(*) FROM learning_messages WHERE json_extract(data_json,'$.role')='user'",[],|r|r.get::<_,i64>(0)).map_err(ApiError::internal)?,db.query_row("SELECT count(*) FROM study_plans",[],|r|r.get::<_,i64>(0)).map_err(ApiError::internal)?))).await.unwrap();
    assert_eq!(counts, (1, 1));
    assert_eq!(state.ai.available_permits(), 2);
}
#[tokio::test]
async fn ownership_validation_and_failure_are_durable() {
    let (_dir, mut state) = fixture().await;
    state.transport = Transport::with_chat(state.ai.clone(), 1024, None).unwrap();
    let router = app(state.clone());
    assert_eq!(
        request(
            router.clone(),
            "/api/learning/threads/thread-a/messages",
            json!({}),
            "bob"
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            router.clone(),
            "/api/learning/threads/thread-a/messages",
            json!({}),
            "alice"
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    let mut unknown = input("request-03", "Explain");
    unknown["context"]["reference"] = json!({"type":"problem","problemId":"missing"});
    assert_eq!(
        request(
            router.clone(),
            "/api/learning/threads/thread-a/messages",
            unknown,
            "alice"
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let mut regen = input("request-04", "Explain");
    regen["regenerate"] = json!(true);
    assert_eq!(
        request(
            router.clone(),
            "/api/learning/threads/thread-a/messages",
            regen,
            "alice"
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    let result = events(
        request(
            router,
            "/api/learning/threads/thread-a/messages",
            input("request-05", "Explain"),
            "alice",
        )
        .await,
    )
    .await;
    assert_eq!(
        result
            .iter()
            .map(|e| e["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["status", "status", "error", "complete"]
    );
    assert_eq!(result.last().unwrap()["message"]["status"], "failed");
    let status=state.db.call(|db|db.query_row("SELECT json_extract(data_json,'$.status') FROM learning_messages WHERE json_extract(data_json,'$.role')='assistant'",[],|r|r.get::<_,String>(0)).map_err(ApiError::internal)).await.unwrap();
    assert_eq!(status, "failed");
}
async fn wait_idle(state: &AppState) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while state.ai.available_permits() != 2
            || state.requests.available_permits() != state.config.admitted
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn cancel_disconnect_and_delete_preserve_partial_without_resurrection() {
    use futures_util::stream;
    let upstream = server(Router::new().route(
        "/chat/completions",
        post(|| async {
            Body::from_stream(
                stream::once(async {
                    Ok::<_, std::convert::Infallible>(Bytes::from_static(
                        b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
                    ))
                })
                .chain(stream::pending()),
            )
        }),
    ))
    .await;
    for mode in ["cancel", "disconnect", "delete"] {
        let (_dir, mut state) = fixture().await;
        configure(&mut state, upstream.1.clone());
        let router = app(state.clone());
        let response = request(
            router.clone(),
            "/api/learning/threads/thread-a/messages",
            input("request-06", "Explain"),
            "alice",
        )
        .await;
        let mut body = response.into_body().into_data_stream();
        let mut received = Vec::new();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !String::from_utf8_lossy(&received).contains("partial") {
                let bytes = body.next().await.unwrap().unwrap();
                received.extend_from_slice(&bytes);
                drop(bytes);
            }
        })
        .await
        .unwrap();
        assert_eq!(
            request(
                router.clone(),
                "/api/learning/threads/thread-c/messages",
                input("request-07", "Other"),
                "alice"
            )
            .await
            .status(),
            StatusCode::CONFLICT
        );
        if mode == "cancel" {
            let response = request(
                router.clone(),
                "/api/learning/threads/thread-a/cancel",
                json!({}),
                "alice",
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            while let Some(bytes) = body.next().await {
                let bytes = bytes.unwrap();
                received.extend_from_slice(&bytes);
                drop(bytes);
            }
            assert!(String::from_utf8_lossy(&received).contains("interrupted"));
        } else if mode == "delete" {
            let r = router
                .oneshot(
                    Request::builder()
                        .method("DELETE")
                        .uri("/api/learning/threads/thread-a")
                        .header("authorization", "Bearer alice-long-session-token")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::OK);
            drop(r);
            drop(body);
        } else {
            drop(body);
        }
        wait_idle(&state).await;
        let(count,status)=state.db.call(|db|{let count=db.query_row("SELECT count(*) FROM learning_threads WHERE id='thread-a'",[],|r|r.get::<_,i64>(0)).map_err(ApiError::internal)?;let status=db.query_row("SELECT json_extract(data_json,'$.status') FROM learning_messages WHERE thread_id='thread-a' AND json_extract(data_json,'$.role')='assistant'",[],|r|r.get::<_,String>(0)).optional().map_err(ApiError::internal)?;Ok((count,status))}).await.unwrap();
        if mode == "delete" {
            assert_eq!((count, status), (0, None));
        } else {
            assert_eq!(status.as_deref(), Some("interrupted"));
        }
    }
}
use rusqlite::OptionalExtension;

#[tokio::test]
async fn game_action_card_generates_owned_game_once_across_replay_and_restart() {
    let (_dir, state) = fixture().await;
    state.db.call(|db| {let message=json!({"id":"game-card","role":"assistant","text":"Try this practice game","status":"complete","createdAt":1,"actions":[{"type":"game","problemId":"binary-search","difficulty":"hard"}],"sources":[]});db.execute("INSERT INTO learning_messages VALUES('game-card','thread-a','card-request',?)",[message.to_string()]).map_err(ApiError::internal)?;Ok(())}).await.unwrap();
    async fn execute(
        router: Router,
        user: &str,
        request_id: &str,
        force: bool,
    ) -> (StatusCode, Value) {
        let response=router.oneshot(Request::builder().uri("/api/learning/threads/thread-a/actions").method("POST").header("authorization",format!("Bearer {user}-long-session-token")).header("content-type","application/json").body(Body::from(json!({"messageId":"game-card","index":0,"requestId":request_id,"forceTemplate":force}).to_string())).unwrap()).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    let router = app(state.clone());
    let (status, first) = execute(router.clone(), "alice", "card-execution-1", true).await;
    assert_eq!(status, 200);
    let id = first["gameId"].as_str().unwrap();
    assert_eq!(first["usedTier"], "template");
    let (status, replayed) = execute(router.clone(), "alice", "card-execution-2", false).await;
    assert_eq!(status, 200);
    assert_eq!(replayed, first);
    let (status, _) = execute(router, "bob", "card-execution-3", true).await;
    assert_eq!(status, 404);
    let restarted = AppState::new(state.config.clone()).unwrap();
    let (status, replayed) =
        execute(app(restarted.clone()), "alice", "card-execution-4", true).await;
    assert_eq!(status, 200);
    assert_eq!(replayed, first);
    assert!(dsa_api::games::load(&restarted, id, Some("alice"))
        .await
        .unwrap()
        .is_some());
    let count = state
        .db
        .call(|db| {
            db.query_row(
                "SELECT count(*) FROM practice_runs WHERE user_id='alice'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map_err(ApiError::internal)
        })
        .await
        .unwrap();
    assert_eq!(count, 1);
}
