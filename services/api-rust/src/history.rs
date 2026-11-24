use crate::{
    error::ApiError,
    learning::{self, Error},
    AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Default, Deserialize)]
pub struct Filter {
    cursor: Option<String>,
    limit: Option<String>,
    topic: Option<String>,
    from: Option<String>,
    to: Option<String>,
}
fn problem_ids(topic: Option<&str>) -> String {
    let ids: Vec<_> = crate::reference()["problems"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| topic.is_none_or(|t| p["topic"] == t))
        .filter_map(|p| p["id"].as_str())
        .collect();
    serde_json::to_string(&ids).unwrap()
}
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<Value>, Error> {
    let owner = learning::user(&state, &headers).await?;
    let size = filter
        .limit
        .as_deref()
        .map(crate::compat::number)
        .filter(|v| v.is_finite())
        .map(|v| v.floor().clamp(1.0, 100.0) as usize)
        .unwrap_or(30);
    let after = filter.cursor.and_then(|s| crate::compat::cursor(&s));
    let ids = problem_ids(filter.topic.as_deref().filter(|s| !s.is_empty()));
    let from = filter.from.as_deref().filter(|s| !s.is_empty()).map(|s| {
        let value = crate::compat::number(s);
        if value.is_nan() {
            f64::INFINITY
        } else {
            value
        }
    });
    let to = filter.to.as_deref().filter(|s| !s.is_empty()).map(|s| {
        let value = crate::compat::number(s);
        if value.is_nan() {
            f64::NEG_INFINITY
        } else {
            value
        }
    });
    let response=state.db.call(move |db| {
        // Materialization happens in SQLite (temp_store=FILE), not in Rust.
        const FILTER:&str="user_id=?1 AND json_extract(record_json,'$.problemId') IN (SELECT value FROM json_each(?2)) AND (?3 IS NULL OR json_extract(record_json,'$.startedAt')>=?3) AND (?4 IS NULL OR json_extract(record_json,'$.startedAt')<=?4)";
        let total:i64=db.query_row(&format!("SELECT count(*) FROM practice_runs WHERE {FILTER}"),params![owner,ids,from,to],|r|r.get(0)).map_err(ApiError::internal)?;
        let sql=format!("WITH filtered AS (SELECT game_id,record_json,row_number() OVER (ORDER BY json_extract(record_json,'$.updatedAt') DESC,rowid ASC) AS n FROM practice_runs WHERE {FILTER}) SELECT record_json FROM filtered WHERE n>COALESCE((SELECT n FROM filtered WHERE game_id=?5),0) ORDER BY n LIMIT ?6");
        let mut stmt=db.prepare(&sql).map_err(ApiError::internal)?;
        let rows=stmt.query_map(params![owner,ids,from,to,after,size+1],|r|r.get::<_,String>(0)).map_err(ApiError::internal)?;
        let mut records=Vec::with_capacity(size+1);
        for row in rows { records.push(serde_json::from_str::<Value>(&row.map_err(ApiError::internal)?).map_err(ApiError::internal)?); }
        let cursor=if records.len()>size { records.truncate(size); json!(URL_SAFE_NO_PAD.encode(records.last().unwrap()["gameId"].as_str().unwrap())) } else {Value::Null};
        Ok(json!({"records":records,"nextCursor":cursor,"total":total}))
    }).await?;
    Ok(Json(response))
}
pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, Error> {
    let owner = learning::user(&state, &headers).await?;
    let result = state
        .db
        .call(move |db| {
            let raw: Option<String> = db
                .query_row(
                    "SELECT record_json FROM practice_runs WHERE user_id=? AND game_id=?",
                    params![owner, id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(ApiError::internal)?;
            raw.map(|s| serde_json::from_str::<Value>(&s).map_err(ApiError::internal))
                .transpose()
        })
        .await?;
    Ok(Json(
        json!({"record":result.ok_or(Error::Message(StatusCode::NOT_FOUND,"Unknown practice run"))?}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reflection {
    retention: String,
    integration: String,
    skipped: bool,
}
pub async fn reflect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Result<Json<Reflection>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, Error> {
    let owner = learning::user(&state, &headers).await?;
    let reflection = body
        .ok()
        .map(|Json(r)| r)
        .filter(|r| r.retention.chars().count() <= 8000 && r.integration.chars().count() <= 8000)
        .map(|r| {
            json!({"retention":r.retention,"integration":r.integration,"skipped":r.skipped})
                .to_string()
        });
    let result = state
        .db
        .call(move |db| {
            let exists: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM practice_runs WHERE user_id=? AND game_id=?)",
                    params![owner, id],
                    |r| r.get(0),
                )
                .map_err(ApiError::internal)?;
            if !exists {
                return Ok(0);
            }
            let Some(reflection) = reflection else {
                return Ok(1);
            };
            db.execute(
                "UPDATE practice_runs SET reflection_json=? WHERE user_id=? AND game_id=?",
                params![reflection, owner, id],
            )
            .map_err(ApiError::internal)?;
            Ok(2)
        })
        .await?;
    match result {
        0 => Err(Error::Message(
            StatusCode::NOT_FOUND,
            "Unknown practice run",
        )),
        1 => Err(Error::Message(
            StatusCode::BAD_REQUEST,
            "Invalid reflection",
        )),
        _ => Ok(Json(json!({"saved":true}))),
    }
}
