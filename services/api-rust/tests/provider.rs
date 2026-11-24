use axum::{
    extract::State,
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use dsa_api::provider::{ChatConfig, ChatError, Transport};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use tokio::sync::{Notify, Semaphore};
struct Server(tokio::task::JoinHandle<()>, String);
impl Drop for Server {
    fn drop(&mut self) {
        self.0.abort();
    }
}
async fn server(router: Router) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    Server(
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        }),
        format!("http://{address}"),
    )
}
fn cfg(base: String, id: &'static str) -> ChatConfig {
    ChatConfig {
        id,
        key: "test-key".into(),
        base,
        model: String::new(),
        session: String::new(),
        timeout_ms: 1000,
    }
}
#[tokio::test]
async fn go_discovers_once_and_preserves_routing_identity() {
    let calls = Arc::new(Mutex::new(Vec::<(HeaderMap, Value)>::new()));
    let discovery = Arc::new(AtomicUsize::new(0));
    let d = discovery.clone();
    let c = calls.clone();
    let server=server(Router::new().route("/models",get(move||{let d=d.clone();async move{d.fetch_add(1,Ordering::Relaxed);Json(json!({"data":[{"id":"space-bunny-free"},{"id":"longcat-2.5-preview-free"}]}))}})).route("/chat/completions",post(move|h:HeaderMap,Json(v):Json<Value>|{let c=c.clone();async move{c.lock().unwrap().push((h,v));Json(json!({"choices":[{"message":{"content":" answer "}}]}))}}))).await;
    let permits = Arc::new(Semaphore::new(2));
    let transport = Transport::with_chat(
        permits.clone(),
        2048,
        Some(cfg(server.1.clone(), "opencode-go")),
    )
    .unwrap();
    let messages = json!([{"role":"user","content":"Explain"}]);
    let (a, b) = tokio::join!(
        transport.chat(messages.clone(), 4000, 0.1),
        transport.chat(messages, 4000, 0.7)
    );
    assert_eq!(a.unwrap(), "answer");
    assert_eq!(b.unwrap(), "answer");
    assert_eq!(discovery.load(Ordering::Relaxed), 1);
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    for (h, v) in calls.iter() {
        assert_eq!(h["authorization"], "Bearer test-key");
        assert_eq!(h["user-agent"], "dsa-game/0.1.0");
        assert!(h["x-opencode-session"]
            .to_str()
            .unwrap()
            .starts_with("chat-"));
        assert_eq!(v["model"], "longcat-2.5-preview-free");
        assert_eq!(v["max_tokens"], 4000);
        assert!(v.get("stream").is_none());
    }
    assert_ne!(
        calls[0].0["x-opencode-session"],
        calls[1].0["x-opencode-session"]
    );
    assert_eq!(permits.available_permits(), 2);
}
#[tokio::test]
async fn provider_buffer_is_bounded_and_router_headers_match() {
    let server = server(Router::new().route(
        "/chat/completions",
        post(|h: HeaderMap| async move {
            assert_eq!(h["http-referer"], "https://github.com/dsa-game");
            assert_eq!(h["x-title"], "dsa-game coach");
            Json(json!({"choices":[{"message":{"content":"x".repeat(4096)}}]}))
        }),
    ))
    .await;
    let mut config = cfg(server.1.clone(), "openrouter");
    config.model = "test-model".into();
    let transport = Transport::with_chat(Arc::new(Semaphore::new(2)), 1024, Some(config)).unwrap();
    let error = transport.chat(json!([]), 100, 0.1).await.unwrap_err();
    assert!(error.to_string().contains("exceeded limit"));
}
#[tokio::test]
async fn overload_is_immediate_and_cancellation_releases_ai_permits() {
    #[derive(Clone)]
    struct Context {
        entered: Arc<Semaphore>,
        release: Arc<Notify>,
    }
    let context = Context {
        entered: Arc::new(Semaphore::new(0)),
        release: Arc::new(Notify::new()),
    };
    let server = server(
        Router::new()
            .route(
                "/chat/completions",
                post(|State(c): State<Context>| async move {
                    c.entered.add_permits(1);
                    c.release.notified().await;
                    Json(json!({"choices":[{"message":{"content":"done"}}]}))
                }),
            )
            .with_state(context.clone()),
    )
    .await;
    let mut config = cfg(server.1.clone(), "opencode-go");
    config.model = "test".into();
    config.timeout_ms = 5000;
    let permits = Arc::new(Semaphore::new(2));
    let transport = Transport::with_chat(permits.clone(), 1024, Some(config)).unwrap();
    let mut tasks = Vec::new();
    for _ in 0..2 {
        let t = transport.clone();
        tasks.push(tokio::spawn(
            async move { t.chat(json!([]), 100, 0.1).await },
        ));
    }
    let entered = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        context.entered.acquire_many(2),
    )
    .await
    .unwrap()
    .unwrap();
    entered.forget();
    assert!(matches!(
        transport.chat(json!([]), 100, 0.1).await,
        Err(ChatError::Busy)
    ));
    for task in tasks {
        task.abort();
        let _ = task.await;
    }
    assert_eq!(permits.available_permits(), 2);
    context.release.notify_waiters();
}
#[tokio::test]
async fn provider_timeout_aborts_read_and_releases_permit() {
    let server = server(Router::new().route(
        "/chat/completions",
        post(|| async {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            Json(json!({}))
        }),
    ))
    .await;
    let mut config = cfg(server.1.clone(), "opencode-go");
    config.model = "test".into();
    config.timeout_ms = 30;
    let permits = Arc::new(Semaphore::new(2));
    let transport = Transport::with_chat(permits.clone(), 1024, Some(config)).unwrap();
    assert!(transport
        .chat(json!([]), 100, 0.1)
        .await
        .unwrap_err()
        .to_string()
        .contains("timeout"));
    assert_eq!(permits.available_permits(), 2);
}

#[tokio::test]
async fn streaming_handles_byte_splits_and_requires_done() {
    use axum::body::Body;
    use futures_util::stream;
    for (wire, expected, succeeds) in [
        (
            "data: {\"choices\":[{\"delta\":{\"content\":\"😀\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n",
            "😀",
            true,
        ),
        ("data: {\"choices\":\n data: ignored\n\n", "", false),
        (
            "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
            "partial",
            false,
        ),
        ("data: {\"error\":{\"message\":\"failed\"}}\n\n", "", false),
        ("data: garbage\n\n", "", false),
    ] {
        let chunks: Vec<_> = wire
            .bytes()
            .map(|b| Ok::<_, std::convert::Infallible>(vec![b]))
            .collect();
        let server = server(Router::new().route(
            "/chat/completions",
            post(move |h: HeaderMap, Json(body): Json<Value>| {
                let chunks = chunks.clone();
                async move {
                    assert_eq!(h["x-opencode-session"], "thread-test");
                    assert_eq!(body["stream"], true);
                    Body::from_stream(stream::iter(chunks))
                }
            }),
        ))
        .await;
        let mut config = cfg(server.1.clone(), "opencode-go");
        config.model = "test".into();
        let permits = Arc::new(Semaphore::new(2));
        let t = Transport::with_chat(permits.clone(), 1024, Some(config)).unwrap();
        let permit = t.reserve().unwrap();
        let text = Arc::new(Mutex::new(String::new()));
        let output = text.clone();
        let result = t
            .stream_reserved(&permit, json!([]), "thread-test", move |delta| {
                output.lock().unwrap().push_str(&delta);
                async { Ok(()) }
            })
            .await;
        assert_eq!(result.is_ok(), succeeds, "{wire}");
        assert_eq!(*text.lock().unwrap(), expected);
        drop(permit);
        assert_eq!(permits.available_permits(), 2);
    }
}

#[tokio::test]
async fn streaming_frame_limit_releases_admission() {
    let server =
        server(Router::new().route("/chat/completions", post(|| async { "x".repeat(2048) }))).await;
    let mut config = cfg(server.1.clone(), "opencode-go");
    config.model = "test".into();
    let permits = Arc::new(Semaphore::new(2));
    let t = Transport::with_chat(permits.clone(), 128, Some(config)).unwrap();
    let permit = t.reserve().unwrap();
    let error = t
        .stream_reserved(&permit, json!([]), "thread", |_| async { Ok(()) })
        .await
        .unwrap_err();
    assert!(error.to_string().contains("frame exceeded"));
    drop(permit);
    assert_eq!(permits.available_permits(), 2);
}

#[tokio::test]
async fn dropping_stream_future_releases_permit_without_waiting_for_provider() {
    use axum::body::Body;
    use futures_util::stream;
    let server = server(Router::new().route(
        "/chat/completions",
        post(|| async {
            Body::from_stream(stream::pending::<Result<Vec<u8>, std::convert::Infallible>>())
        }),
    ))
    .await;
    let mut config = cfg(server.1.clone(), "opencode-go");
    config.model = "test".into();
    config.timeout_ms = 5000;
    let permits = Arc::new(Semaphore::new(2));
    let t = Transport::with_chat(permits.clone(), 128, Some(config)).unwrap();
    let task = tokio::spawn(async move {
        let permit = t.reserve().unwrap();
        t.stream_reserved(&permit, json!([]), "thread", |_| async { Ok(()) })
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while permits.available_permits() == 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert_eq!(permits.available_permits(), 2);
}

#[tokio::test]
async fn fallback_cools_failed_primary_and_never_mixes_partial_answers() {
    use axum::body::Body;
    for partial in [false, true] {
        let calls = Arc::new(AtomicUsize::new(0));
        let primary_calls = calls.clone();
        let primary = server(Router::new().route(
            "/chat/completions",
            post(move || {
                let calls = primary_calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    if partial {
                        (
                            axum::http::StatusCode::OK,
                            Body::from(
                                "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
                            ),
                        )
                    } else {
                        (axum::http::StatusCode::SERVICE_UNAVAILABLE, Body::empty())
                    }
                }
            }),
        ))
        .await;
        let secondary_calls = Arc::new(AtomicUsize::new(0));
        let c = secondary_calls.clone();
        let secondary=server(Router::new().route("/chat/completions",post(move||{let c=c.clone();async move{c.fetch_add(1,Ordering::SeqCst);"data: {\"choices\":[{\"delta\":{\"content\":\"fallback\"}}]}\n\ndata: [DONE]\n\n"}}))).await;
        let mut a = cfg(primary.1.clone(), "opencode-go");
        a.model = "test".into();
        let mut b = cfg(secondary.1.clone(), "openrouter");
        b.model = "test".into();
        let transport =
            Transport::with_candidates(Arc::new(Semaphore::new(2)), 1024, Some(a), Some(b))
                .unwrap();
        let permit = transport.reserve().unwrap();
        let text = Arc::new(Mutex::new(String::new()));
        let output = text.clone();
        let result = transport
            .stream_reserved(&permit, json!([]), "thread", move |delta| {
                output.lock().unwrap().push_str(&delta);
                async { Ok(()) }
            })
            .await;
        if partial {
            assert!(result.is_err());
            assert_eq!(*text.lock().unwrap(), "partial");
            assert_eq!(secondary_calls.load(Ordering::SeqCst), 0);
        } else {
            assert!(result.is_ok());
            assert_eq!(*text.lock().unwrap(), "fallback");
            transport
                .stream_reserved(&permit, json!([]), "thread", |_| async { Ok(()) })
                .await
                .unwrap();
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert_eq!(secondary_calls.load(Ordering::SeqCst), 2);
        }
    }
}

#[tokio::test]
async fn game_generation_uses_node_schema_headers_and_bounded_admission() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/game-providers.json")).unwrap();
    for tier in ["opencode-go", "openrouter"] {
        let case = cases.iter().find(|c| c["tier"] == tier).unwrap().clone();
        let expected = case["request"].clone();
        let reply = case["body"].clone();
        let remote = server(Router::new().route(
            "/chat/completions",
            post(move |h: HeaderMap, Json(body): Json<Value>| {
                let expected = expected.clone();
                let reply = reply.clone();
                async move {
                    assert_eq!(body, expected);
                    assert_eq!(h["authorization"], "Bearer test-key");
                    if tier == "opencode-go" {
                        assert_eq!(h["user-agent"], "dsa-game/0.1.0");
                        assert_eq!(h["x-opencode-session"], "fixture-session");
                    } else {
                        assert_eq!(h["x-title"], "dsa-game provider-chain");
                    }
                    Json(reply)
                }
            }),
        ))
        .await;
        let permits = Arc::new(Semaphore::new(2));
        let mut config = cfg(remote.1.clone(), tier);
        config.model = "fixture-model".into();
        config.session = "fixture-session".into();
        let transport =
            Transport::with_chat(permits.clone(), 2 * 1024 * 1024, Some(config)).unwrap();
        assert!(transport.game_available(tier));
        let a = transport.reserve().unwrap();
        let b = transport.reserve().unwrap();
        assert!(matches!(transport.reserve(), Err(ChatError::Busy)));
        let spec = transport
            .game_reserved(&a, tier, &case["input"], None)
            .await
            .unwrap();
        assert_eq!(spec, case["spec"]);
        drop(a);
        drop(b);
        assert_eq!(permits.available_permits(), 2);
    }
}

#[tokio::test]
async fn game_generation_timeout_cancellation_and_oversize_release_admission() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/game-providers.json")).unwrap();
    let input = cases[0]["input"].clone();
    let entered = Arc::new(Notify::new());
    let e = entered.clone();
    let remote = server(Router::new().route(
        "/chat/completions",
        post(move || {
            let e = e.clone();
            async move {
                e.notify_one();
                std::future::pending::<Json<Value>>().await
            }
        }),
    ))
    .await;
    let permits = Arc::new(Semaphore::new(2));
    let mut config = cfg(remote.1.clone(), "opencode-go");
    config.model = "fixture-model".into();
    config.timeout_ms = 50;
    let transport = Transport::with_chat(permits.clone(), 1024, Some(config.clone())).unwrap();
    let permit = transport.reserve().unwrap();
    let error = transport
        .game_reserved(&permit, "opencode-go", &input, None)
        .await
        .unwrap_err();
    assert!(error.detail.contains("timeout"));
    drop(permit);
    tokio::time::timeout(std::time::Duration::from_secs(1), entered.notified())
        .await
        .unwrap();
    config.timeout_ms = 5000;
    let transport = Transport::with_chat(permits.clone(), 1024, Some(config)).unwrap();
    let t = transport.clone();
    let i = input.clone();
    let task = tokio::spawn(async move {
        let permit = t.reserve().unwrap();
        t.game_reserved(&permit, "opencode-go", &i, None).await
    });
    tokio::time::timeout(std::time::Duration::from_secs(1), entered.notified())
        .await
        .unwrap();
    task.abort();
    let _ = task.await;
    assert_eq!(permits.available_permits(), 2);
    let remote =
        server(Router::new().route("/chat/completions", post(|| async { "x".repeat(2048) }))).await;
    let mut config = cfg(remote.1.clone(), "opencode-go");
    config.model = "fixture-model".into();
    let transport = Transport::with_chat(permits.clone(), 1024, Some(config)).unwrap();
    let permit = transport.reserve().unwrap();
    let error = transport
        .game_reserved(&permit, "opencode-go", &input, None)
        .await
        .unwrap_err();
    assert!(error.detail.contains("exceeded limit"));
    drop(permit);
    assert_eq!(permits.available_permits(), 2);
}
