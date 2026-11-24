use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub &'static str, pub String);
impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.1, self.2)
    }
}
impl std::error::Error for ApiError {}
impl ApiError {
    pub fn busy() -> Self {
        Self(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Server is busy. Try again shortly.".into(),
        )
    }
    pub fn internal(e: impl std::fmt::Display) -> Self {
        eprintln!("[dsa-api] {e}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Internal error".into(),
        )
    }
    pub fn bad(message: &str) -> Self {
        Self(StatusCode::BAD_REQUEST, "BAD_REQUEST", message.into())
    }
    pub fn unauthorized() -> Self {
        Self(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Sign in to continue.".into(),
        )
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (
            self.0,
            Json(json!({"error":{"code":self.1,"message":self.2}})),
        )
            .into_response();
        if self.0 == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert("retry-after", "1".parse().unwrap());
        }
        response
    }
}
