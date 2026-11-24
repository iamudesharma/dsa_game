//! Account profile persistence; SQLite operations run only on its dedicated worker.
use crate::{auth, contracts, error::ApiError, now_ms, AppState};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub fn read_profile(db: &Connection, owner: &str, name: &str) -> Result<Value, ApiError> {
    let (table, schema, fallback) = if name == "resume" {
        ("resumes", "Resume", crate::empty_resume())
    } else {
        ("targets", "Target", Value::Null)
    };
    let raw: Option<String> = db
        .query_row(
            &format!("SELECT data_json FROM {table} WHERE user_id=?"),
            [owner],
            |r| r.get(0),
        )
        .optional()
        .map_err(ApiError::internal)?;
    Ok(raw
        .and_then(|s| serde_json::from_str(&s).ok())
        .and_then(|v| contracts::parse(schema, v).ok())
        .unwrap_or(fallback))
}
pub fn read_progress(db: &Connection, owner: &str) -> Result<Value, ApiError> {
    let raw: Option<String> = db
        .query_row(
            "SELECT completed_json FROM progress WHERE user_id=?",
            [owner],
            |r| r.get(0),
        )
        .optional()
        .map_err(ApiError::internal)?;
    Ok(clean_progress(
        raw.and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({})),
        false,
    ))
}
fn clean_progress(value: Value, limit: bool) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(map) = value.as_object() {
        for (key, value) in map {
            if crate::reference()["problems"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["id"] == *key)
                && value.as_str().is_some_and(|s| {
                    (!limit || s.encode_utf16().count() <= 40) && crate::dashboard::valid_stamp(s)
                })
            {
                out.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(out)
}
fn invalid(message: &str, details: Vec<Value>) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":{"code":"BAD_REQUEST","message":message,"details":details}})),
    )
        .into_response()
}
async fn get_profile(
    state: AppState,
    headers: HeaderMap,
    name: &'static str,
) -> Result<Json<Value>, ApiError> {
    let (owner, _) = auth::resolve(&state, &headers).await?;
    state
        .db
        .call(move |db| Ok(Json(json!({name:read_profile(db,&owner,name)?}))))
        .await
}
async fn put_profile(
    state: AppState,
    headers: HeaderMap,
    name: &'static str,
    body: Value,
) -> Result<Response, ApiError> {
    let (owner, _) = auth::resolve(&state, &headers).await?;
    let data = match contracts::parse(if name == "resume" { "Resume" } else { "Target" }, body) {
        Ok(v) => v,
        Err(e) => {
            return Ok(invalid(
                if name == "resume" {
                    "Invalid resume"
                } else {
                    "Invalid target"
                },
                e,
            ))
        }
    };
    state.db.call(move|db| {
  let table=if name=="resume" {"resumes"}else{"targets"};
  db.execute(&format!("INSERT INTO {table}(user_id,data_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at"),params![owner,data.to_string(),now_ms()]).map_err(ApiError::internal)?;
  Ok(Json(json!({name:data})).into_response())
 }).await
}
pub async fn resume(State(s): State<AppState>, h: HeaderMap) -> Result<Json<Value>, ApiError> {
    get_profile(s, h, "resume").await
}
pub async fn target(State(s): State<AppState>, h: HeaderMap) -> Result<Json<Value>, ApiError> {
    get_profile(s, h, "target").await
}
pub async fn put_resume(
    State(s): State<AppState>,
    h: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    put_profile(
        s,
        h,
        "resume",
        serde_json::from_slice(&body).unwrap_or_else(|_| json!({})),
    )
    .await
}
pub async fn put_target(
    State(s): State<AppState>,
    h: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    put_profile(
        s,
        h,
        "target",
        serde_json::from_slice(&body).unwrap_or_else(|_| json!({})),
    )
    .await
}
pub async fn progress(State(s): State<AppState>, h: HeaderMap) -> Result<Json<Value>, ApiError> {
    let (owner, _) = auth::resolve(&s, &h).await?;
    s.db.call(move |db| Ok(Json(json!({"completed":read_progress(db,&owner)?}))))
        .await
}
pub async fn merge_progress(
    State(s): State<AppState>,
    h: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let (owner, _) = auth::resolve(&s, &h).await?;
    let mut data = match contracts::parse(
        "Progress",
        serde_json::from_slice(&body).unwrap_or_else(|_| json!({})),
    ) {
        Ok(v) => v["completed"].clone(),
        Err(e) => return Ok(invalid("Invalid progress", e)),
    };
    s.db.call(move|db|{
  // Read/merge/write is a single worker job, so concurrent merges cannot lose updates.
  for (key,val) in read_progress(db,&owner)?.as_object().unwrap(){data.as_object_mut().unwrap().insert(key.clone(),val.clone());}
  let clean=clean_progress(data,true);
  db.execute("INSERT INTO progress(user_id,completed_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET completed_json=excluded.completed_json,updated_at=excluded.updated_at",params![owner,clean.to_string(),now_ms()]).map_err(ApiError::internal)?;
  Ok(Json(json!({"completed":clean})).into_response())
 }).await
}
pub(crate) fn kit(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    let target: String = row.get(1)?;
    let questions: String = row.get(2)?;
    let target=serde_json::from_str(&target).ok().and_then(|v|contracts::parse("Target",v).ok()).unwrap_or(json!({"goal":"","companyId":"custom","customCompany":"","seniority":"mid","focusAreas":[]}));
    let questions: Value = serde_json::from_str::<Value>(&questions)
        .ok()
        .filter(Value::is_array)
        .unwrap_or(json!([]));
    Ok(
        json!({"kitId":row.get::<_,String>(0)?,"target":target,"questions":questions,"usedTier":row.get::<_,String>(3)?,"createdAt":row.get::<_,i64>(4)?}),
    )
}
pub async fn kits(State(s): State<AppState>, h: HeaderMap) -> Result<Json<Value>, ApiError> {
    let (owner, _) = auth::resolve(&s, &h).await?;
    s.db.call(move|db|{
  let mut stmt=db.prepare("SELECT id,target_json,questions_json,used_tier,created_at FROM interview_kits WHERE user_id=? ORDER BY created_at DESC LIMIT 10").map_err(ApiError::internal)?;
  let rows=stmt.query_map([owner],kit).map_err(ApiError::internal)?;
  let mut kits=Vec::new();for row in rows{let mut v=row.map_err(ApiError::internal)?;let n=v["questions"].as_array().unwrap().len();v.as_object_mut().unwrap().remove("questions");v["count"]=json!(n);kits.push(v);}
  Ok(Json(json!({"kits":kits})))
 }).await
}
pub async fn get_kit(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (owner, _) = auth::resolve(&s, &h).await?;
    s.db.call(move|db|{
  db.query_row("SELECT id,target_json,questions_json,used_tier,created_at FROM interview_kits WHERE id=? AND user_id=?",params![id,owner],kit).optional().map_err(ApiError::internal)?.map(Json).ok_or(ApiError(StatusCode::NOT_FOUND,"BAD_REQUEST","Unknown interview kit".into()))
 }).await
}
