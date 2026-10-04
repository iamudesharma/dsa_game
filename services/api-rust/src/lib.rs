pub mod account;
pub mod auth;
pub mod cache;
pub mod catalogue;
pub mod chat;
pub mod coach_budget;
pub mod coach_fallback;
pub mod coach_guardrails;
pub mod coach_routes;
pub mod coach_snapshot;
pub mod coach_store;
pub mod compat;
pub mod config;
pub mod contracts;
pub mod dashboard;
pub mod db;
pub mod debrief;
pub mod decision_routes;
pub mod decisions;
pub mod error;
pub mod game_chain;
pub mod game_provider;
pub mod game_routes;
pub mod games;
pub mod guidance;
pub mod history;
pub mod instances;
pub mod interview;
pub mod learning;
pub mod oracle_metadata;
pub mod oracle_pattern;
pub mod oracle_plan;
pub mod oracle_tree;
pub mod provider;
pub mod resume;
pub mod sse;
pub mod text;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use config::Config;
use error::ApiError;
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: db::Db,
    pub requests: Arc<Semaphore>,
    pub ai: Arc<Semaphore>,
    pub passwords: Arc<Semaphore>,
    pub cache: Arc<Mutex<cache::Cache>>,
    pub game_mutations: Arc<Mutex<std::collections::HashSet<String>>>,
    pub rates: Arc<Mutex<auth::RateLimits>>,
    pub transport: provider::Transport,
    pub started: Instant,
    pub chats: Arc<Mutex<chat::Active>>,
    pub learning_ready: Arc<tokio::sync::OnceCell<()>>,
}
impl AppState {
    pub fn new(config: Config) -> Result<Self, Box<dyn std::error::Error>> {
        let ai = Arc::new(Semaphore::new(config.ai));
        let transport = provider::Transport::new(ai.clone(), config.provider_bytes)
            .map_err(|e| std::io::Error::other(e.2))?;
        let rates = Arc::new(Mutex::new(auth::RateLimits::new(config.rate_entries)));
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let weak = Arc::downgrade(&rates);
            runtime.spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    let Some(rates) = weak.upgrade() else {
                        break;
                    };
                    if let Ok(mut rates) = rates.lock() {
                        rates.expire(Instant::now());
                    };
                }
            });
        }
        Ok(Self {
            db: db::Db::open_with_cache(&config.db_path, config.db_queue, config.sqlite_cache_kib)?,
            requests: Arc::new(Semaphore::new(config.admitted)),
            ai,
            passwords: Arc::new(Semaphore::new(config.passwords)),
            cache: Arc::new(Mutex::new(cache::Cache::new(config.cache_bytes))),
            game_mutations: Arc::new(Mutex::new(std::collections::HashSet::new())),
            rates,
            transport,
            config,
            started: Instant::now(),
            chats: Arc::new(Mutex::new(chat::Active::default())),
            learning_ready: Arc::new(tokio::sync::OnceCell::new()),
        })
    }
}
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub fn empty_resume() -> Value {
    json!({"version":1,"contact":{"name":"","email":"","location":""},"summary":"","experience":[],"projects":[],"education":[],"skills":[],"links":[]})
}
pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/catalogue", get(catalogue::get))
        .route("/api/generate", post(game_routes::generate))
        .route("/api/action", post(game_routes::action))
        .route("/api/undo", post(game_routes::undo))
        .route("/api/hint", post(game_routes::hint))
        .route("/api/game/{gameId}", get(game_routes::get))
        .route("/api/game/{gameId}/debrief", get(game_routes::debrief))
        .route("/api/coach/ask", post(coach_routes::ask))
        .route("/api/coach/threads", get(coach_routes::list))
        .route(
            "/api/coach/threads/{id}",
            get(coach_routes::get).delete(coach_routes::delete),
        )
        .route("/api/suggest", post(decision_routes::suggest))
        .route("/api/decide", post(decision_routes::decide))
        .route("/api/auth/signup", post(auth::signup))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route(
            "/api/me/resume",
            get(account::resume).put(account::put_resume),
        )
        .route(
            "/api/me/target",
            get(account::target).put(account::put_target),
        )
        .route(
            "/api/me/progress",
            get(account::progress).post(account::merge_progress),
        )
        .route("/api/me/parse-resume", post(resume::ingest))
        .route("/api/interview/generate", post(interview::generate))
        .route("/api/interview/kits", get(account::kits))
        .route("/api/interview/kits/{id}", get(account::get_kit))
        .route("/api/learning/dashboard", get(dashboard::get))
        .route("/api/learning/history", get(history::list))
        .route("/api/learning/history/{id}", get(history::get))
        .route(
            "/api/learning/history/{id}/reflection",
            post(history::reflect),
        )
        .route(
            "/api/lessons",
            get(|| async { Json(json!({"lessons":reference()["lessons"]})) }),
        )
        .route(
            "/api/companies",
            get(|| async { Json(json!({"companies":reference()["companies"]})) }),
        )
        .route(
            "/api/learning/threads",
            get(learning::list_threads).post(learning::create_thread),
        )
        .route(
            "/api/learning/threads/{id}",
            get(learning::get_thread)
                .put(learning::rename_thread)
                .delete(learning::delete_thread),
        )
        .route("/api/learning/threads/{id}/messages", post(chat::send))
        .route("/api/learning/threads/{id}/cancel", post(chat::cancel))
        .route("/api/learning/threads/{id}/actions", post(chat::action))
        .route("/api/learning/plans", get(learning::plans))
        .fallback(missing_route)
        .method_not_allowed_fallback(missing_route)
        .layer(DefaultBodyLimit::max(state.config.body_bytes))
        .layer(middleware::from_fn_with_state(state.clone(), admission))
        .layer(middleware::from_fn(cors))
        .with_state(state)
}
async fn missing_route(
    method: axum::http::Method,
    uri: axum::http::Uri,
) -> axum::response::Response {
    decision_routes::fail(
        axum::http::StatusCode::NOT_FOUND,
        "BAD_REQUEST",
        &format!("No route for {method} {}", uri.path()),
        None,
    )
}
pub fn reference() -> &'static Value {
    static DATA: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../data/reference.json"))
            .expect("checked-in reference data must be valid")
    })
}
async fn cors(request: Request, next: Next) -> Response {
    let origin = request.headers().get("origin").cloned().filter(|value| {
        value
            .to_str()
            .ok()
            .and_then(|text| reqwest::Url::parse(text).ok())
            .filter(|url| {
                matches!(url.scheme(), "http" | "https") && url.port().is_none_or(|p| p == 3000)
            })
            .and_then(|url| url.host_str().map(str::to_owned))
            .is_some_and(|host| matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]"))
    });
    let mut response = if request.method() == axum::http::Method::OPTIONS {
        axum::http::StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    if let Some(origin) = origin {
        let headers = response.headers_mut();
        headers.insert("access-control-allow-origin", origin);
        headers.insert("vary", "Origin".parse().unwrap());
        headers.insert(
            "access-control-allow-methods",
            "GET,POST,PUT,DELETE,OPTIONS".parse().unwrap(),
        );
        headers.insert(
            "access-control-allow-headers",
            "content-type, authorization".parse().unwrap(),
        );
        headers.insert("access-control-allow-credentials", "true".parse().unwrap());
        headers.insert("access-control-max-age", "600".parse().unwrap());
    }
    response
}
async fn admission(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let Ok(permit) = state.requests.clone().try_acquire_owned() else {
        return ApiError::busy().into_response();
    };
    let limit = state.config.body_bytes;
    // Applies to all paths, including handlers which do not use Json extractors.
    let (parts, body) = request.into_parts();
    let body = match tokio::time::timeout(
        std::time::Duration::from_secs(15),
        axum::body::to_bytes(body, limit),
    )
    .await
    {
        Ok(Ok(bytes)) => {
            if !text::bounded_structure(&bytes, state.config.json_tokens) {
                return ApiError(
                    axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                    "BAD_REQUEST",
                    "Request JSON exceeded complexity limit".into(),
                )
                .into_response();
            }
            Body::from(bytes)
        }
        Err(_) => {
            return ApiError(
                axum::http::StatusCode::REQUEST_TIMEOUT,
                "BAD_REQUEST",
                "Request body timed out".into(),
            )
            .into_response()
        }
        Ok(Err(_)) => {
            return ApiError(
                axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                "BAD_REQUEST",
                "Request body exceeded limit".into(),
            )
            .into_response()
        }
    };
    let response = next.run(Request::from_parts(parts, body)).await;
    let (parts, body) = response.into_parts();
    // Keep admission until the entire response (including future SSE) is dropped.
    let stream = futures_util::stream::unfold(
        (body.into_data_stream(), permit),
        |(mut stream, permit)| async move {
            use futures_util::StreamExt;
            stream.next().await.map(|chunk| (chunk, (stream, permit)))
        },
    );
    Response::from_parts(parts, Body::from_stream(stream))
}
async fn health(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let cache_bytes = state.cache.lock().map_err(ApiError::internal)?.bytes();
    let (tiers, decision, laya) = state.transport.health_status().await;
    Ok(Json(json!({
        "ok":true,"version":env!("CARGO_PKG_VERSION"),"runtime":"rust","migrationComplete":false,
        "tiers":tiers,"decision":decision,"laya":laya,
        "uptimeSec":state.started.elapsed().as_secs(),
        "memory":{"cachePayloadBytes":cache_bytes,"cacheBudgetBytes":state.config.cache_bytes,"accounting":"serialized payload and key bytes; excludes allocator and process memory"},
        "concurrency":{"activeRequests":state.config.admitted-state.requests.available_permits(),"activeAiRequests":state.config.ai-state.ai.available_permits(),"activePasswordOperations":state.config.passwords-state.passwords.available_permits()},
        "limits":{"requestBytes":state.config.body_bytes,"jsonStructuralTokens":state.config.json_tokens,"providerBytes":state.config.provider_bytes,"pendingSseBytes":state.config.sse_bytes,"sqliteCacheKiB":state.config.sqlite_cache_kib,"passwordOperations":state.config.passwords}
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    fn state(path: std::path::PathBuf) -> AppState {
        let mut config = Config::from_env().unwrap();
        config.db_path = path;
        AppState::new(config).unwrap()
    }
    async fn request(
        app: Router,
        path: &str,
        data: Value,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json");
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        let response = app
            .oneshot(builder.body(Body::from(data.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    #[tokio::test]
    async fn signup_login_restart_and_logout() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let router = app(state(path.clone()));
        let credentials = json!({"email":" Test@Example.com ","password":"password123"});
        let (status, signup) = request(
            router.clone(),
            "/api/auth/signup",
            credentials.clone(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(signup["user"]["email"], "test@example.com");
        let (status, _) = request(
            router.clone(),
            "/api/auth/signup",
            credentials.clone(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        let (status, login) = request(router, "/api/auth/login", credentials, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(login["user"], signup["user"]);
        let reopened = state(path);
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            "authorization",
            format!("Bearer {}", signup["token"].as_str().unwrap())
                .parse()
                .unwrap(),
        );
        headers.insert("cookie", "dsa_session=invalidcookievalue".parse().unwrap());
        assert_eq!(
            auth::resolve(&reopened, &headers).await.unwrap().1,
            "test@example.com"
        );
        let (status, _) = request(
            app(reopened.clone()),
            "/api/auth/logout",
            json!({}),
            Some(signup["token"].as_str().unwrap()),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(auth::resolve(&reopened, &headers).await.is_err());
    }
    #[tokio::test]
    async fn overload_body_limit_and_incomplete_routes() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path().join("db"));
        let router = app(state.clone());
        let permit = state
            .requests
            .clone()
            .acquire_many_owned(state.config.admitted as u32)
            .await
            .unwrap();
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()["retry-after"], "1");
        drop(permit);
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/signup")
                    .body(Body::from(vec![b'x'; state.config.body_bytes + 1]))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let wide = format!("[{}]", vec!["0"; state.config.json_tokens + 1].join(","));
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/me/resume")
                    .body(Body::from(wide))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/unported-probe")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
    #[tokio::test]
    async fn cors_and_response_admission_lifetime() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path().join("db"));
        let router = app(state.clone());
        for (origin, allowed) in [
            ("http://localhost:3000", true),
            ("http://[::1]:3000", true),
            ("http://localhost:8000", false),
            ("http://evil.example", false),
            ("ftp://localhost", false),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("OPTIONS")
                        .uri("/api/auth/signup")
                        .header("origin", origin)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NO_CONTENT);
            assert_eq!(
                response
                    .headers()
                    .contains_key("access-control-allow-origin"),
                allowed
            );
        }
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            state.requests.available_permits(),
            state.config.admitted - 1
        );
        drop(response);
        assert_eq!(state.requests.available_permits(), state.config.admitted);
    }
}

pub mod oracle_structures;

pub mod oracle_remaining;

pub mod oracle_graph;

pub mod oracle_extreme;

pub mod oracle_sort;

pub mod oracle_binary;

pub mod hints;
pub mod runtime;
pub mod template;
