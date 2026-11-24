use crate::{contracts, decisions, AppState};
use axum::extract::State;
use axum::{
    body::Bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
pub fn fail(status: StatusCode, code: &str, message: &str, details: Option<Value>) -> Response {
    let mut error = json!({"code":code,"message":message});
    if let Some(details) = details {
        error["details"] = details;
    }
    (status, Json(json!({"error":error}))).into_response()
}
pub async fn decide(State(app): State<AppState>, raw: Bytes) -> Response {
    let value = serde_json::from_slice(&raw).unwrap_or(Value::Null);
    let mut body = match contracts::parse("Decide", value) {
        Ok(v) => v,
        Err(issues) => {
            return fail(
                StatusCode::BAD_REQUEST,
                "BAD_REQUEST",
                "Invalid decide request",
                Some(json!(issues)),
            )
        }
    };
    if body["options"].as_object().is_some_and(|o| o.len() > 64) {
        return fail(
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            "Invalid decide request",
            Some(
                json!([{"code":"custom","path":["options"],"message":"At most 64 routing options"}]),
            ),
        );
    }
    let outcome = app.transport.decision(&body).await;
    let mut result = json!({"kind":body["kind"],"choice":outcome["choice"],"confidence":outcome["confidence"],"source":outcome["source"]});
    for key in [
        "distribution",
        "model",
        "scoreKind",
        "score",
        "margin",
        "fallbackReason",
    ] {
        if let Some(value) = outcome.get(key) {
            result[key] = value.clone();
        }
    }
    // Drop the potentially long input before response serialization.
    body.take();
    Json(result).into_response()
}
pub async fn suggest(State(app): State<AppState>, raw: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&raw).unwrap_or(Value::Null);
    let text = body["freeText"].as_str().unwrap_or("");
    if crate::compat::trim(text).is_empty() {
        return fail(
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            "freeText is required",
            None,
        );
    }
    let text = crate::text::slice(text, 500);
    let normalized = crate::compat::trim(&text).to_lowercase().replace('-', " ");
    let problems = crate::reference()["problems"].as_array().unwrap();
    let direct = problems.iter().find(|p| {
        normalized == p["id"].as_str().unwrap().replace('-', " ")
            || normalized == p["title"].as_str().unwrap().to_lowercase()
    });
    let outcome = if let Some(p) = direct {
        json!({"choice":p["id"],"confidence":1,"source":"heuristic","scoreKind":"heuristic"})
    } else {
        let options = problems
            .iter()
            .map(|p| {
                (
                    p["id"].as_str().unwrap().to_owned(),
                    json!(format!(
                        "{}: {}",
                        p["title"].as_str().unwrap(),
                        p["learningObjective"].as_str().unwrap()
                    )),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        app.transport.decision(
            &json!({"kind":"route-problem","stateText":text,"options":options,"instructions":"Select the playable problem matching this request."}),
        ).await
    };
    let problem = problems.iter().find(|p| p["id"] == outcome["choice"]);
    let alternatives: Vec<_> = decisions::scores(&text, None)
        .into_iter()
        .filter(|p| p["id"] != outcome["choice"])
        .take(3)
        .map(|p| json!({"problemId":p["id"],"score":p["score"]}))
        .collect();
    Json(json!({"problemId":outcome["choice"],"title":problem.map_or(Value::Null,|p|p["title"].clone()),"confidence":outcome["confidence"],"source":outcome["source"],"alternatives":alternatives,"scoreKind":outcome["scoreKind"]})).into_response()
}
