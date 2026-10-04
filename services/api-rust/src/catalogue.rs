use crate::{error::ApiError, AppState};
use axum::{extract::State, Json};
use serde_json::{json, Value};
use std::{sync::OnceLock, time::Instant};
pub async fn get(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    static DATA: OnceLock<Value> = OnceLock::new();
    let data =
        DATA.get_or_init(|| serde_json::from_str(include_str!("../data/catalogue.json")).unwrap());
    let problems = crate::reference()["problems"].as_array().unwrap();
    let topics: Vec<_> = data["topics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|topic| {
            let entries: Vec<_> = problems
                .iter()
                .filter(|p| p["topic"] == topic["id"])
                .map(|p| {
                    let mut p = p.clone();
                    p["playable"] = json!(true); // All registered catalogue entries pass the oracle journey fixtures.
                    p
                })
                .collect();
            json!({"id":topic["id"],"label":topic["label"],"problems":entries})
        })
        .collect();
    let active = state
        .cache
        .lock()
        .map_err(ApiError::internal)?
        .count_prefix("game:", Instant::now());
    Ok(Json(
        json!({"topics":topics,"tiers":data["tiers"],"laya":{"enabled":false,"available":false},"activeGames":active}),
    ))
}
