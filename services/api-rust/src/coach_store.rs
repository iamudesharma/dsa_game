//! Durable owned conversations and guest conversations in the shared payload cache.
use crate::{error::ApiError, AppState};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
const TTL: Duration = Duration::from_secs(6 * 60 * 60);
fn key(id: &str) -> String {
    format!("coach:{id}")
}
fn valid(record: &Value) -> bool {
    record["id"].is_string()
        && record["gameId"].is_string()
        && record["problemId"].is_string()
        && record["turns"].as_array().is_some_and(|a| {
            a.len() <= 200
                && a.iter().all(|t| {
                    t["id"].is_string()
                        && matches!(t["role"].as_str(), Some("learner" | "coach"))
                        && t["text"].is_string()
                        && t["approxTokens"].is_number()
                })
        })
        && record["givenHints"]
            .as_array()
            .is_some_and(|a| a.len() <= 12 && a.iter().all(Value::is_string))
        && (record["summary"].is_null() || record["summary"].is_string())
        && record["spentTokens"].is_number()
        && record["createdAt"].is_number()
        && record["updatedAt"].is_number()
}
pub fn public(record: &Value) -> Value {
    let mut copy = record.clone();
    let o = copy.as_object_mut().unwrap();
    o.remove("userId");
    o.remove("lastAccessedAt");
    copy
}
pub fn new(game_id: &str, problem_id: &str, owner: Option<&str>) -> Value {
    use rand::RngCore;
    let now = crate::now_ms();
    let mut record = json!({"id":format!("thr-{game_id}-{now:x}-{:x}",rand::rngs::OsRng.next_u64()),"gameId":game_id,"problemId":problem_id,"turns":[],"summary":null,"spentTokens":0,"givenHints":[],"createdAt":now,"updatedAt":now,"lastAccessedAt":now});
    if let Some(owner) = owner {
        record["userId"] = json!(owner)
    }
    record
}
pub async fn save(app: &AppState, record: &Value) -> Result<(), ApiError> {
    if !valid(record) {
        return Err(ApiError::internal("Invalid coach conversation"));
    }
    let id = record["id"].as_str().unwrap().to_owned();
    let payload: Arc<[u8]> = serde_json::to_vec(record)
        .map_err(ApiError::internal)?
        .into();
    if let Some(owner) = record["userId"].as_str() {
        let owner = owner.to_owned();
        let game = record["gameId"].as_str().unwrap().to_owned();
        let id = id.clone();
        let bytes = payload.clone();
        app.db.call(move|db|{let tx=db.transaction().map_err(ApiError::internal)?;let prior:Option<String>=tx.query_row("SELECT user_id FROM coach_history WHERE id=?",[&id],|r|r.get(0)).optional().map_err(ApiError::internal)?;if prior.is_some_and(|p|p!=owner){return Err(ApiError::internal("Coach ownership cannot change"))};tx.execute("INSERT INTO coach_history(id,user_id,game_id,data_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json",params![id,owner,game,std::str::from_utf8(&bytes).map_err(ApiError::internal)?]).map_err(ApiError::internal)?;tx.commit().map_err(ApiError::internal)}).await?;
    }
    if !app
        .cache
        .lock()
        .map_err(ApiError::internal)?
        .put(key(&id), payload, TTL, Instant::now())
    {
        if record["userId"].is_string() {
            app.cache
                .lock()
                .map_err(ApiError::internal)?
                .discard(&key(&id));
        } else {
            return Err(ApiError::busy());
        }
    }
    Ok(())
}
pub async fn load(
    app: &AppState,
    id: &str,
    owner: Option<&str>,
) -> Result<Option<Value>, ApiError> {
    let cached = app
        .cache
        .lock()
        .map_err(ApiError::internal)?
        .get(&key(id), Instant::now());
    let cache_hit = cached.is_some();
    let bytes = if let Some(bytes) = cached {
        bytes
    } else {
        let Some(owner) = owner else { return Ok(None) };
        let id = id.to_owned();
        let owner = owner.to_owned();
        let row: Option<String> = app
            .db
            .call(move |db| {
                db.query_row(
                    "SELECT data_json FROM coach_history WHERE id=? AND user_id=?",
                    params![id, owner],
                    |r| r.get(0),
                )
                .optional()
                .map_err(ApiError::internal)
            })
            .await?;
        let Some(row) = row else { return Ok(None) };
        Arc::from(row.into_bytes())
    };
    let Ok(mut record) = serde_json::from_slice::<Value>(&bytes) else {
        return Ok(None);
    };
    if !valid(&record)
        || record["id"] != id
        || record.get("userId").is_some_and(|v| v.as_str() != owner)
    {
        return Ok(None);
    }
    // A guest conversation cannot outlive its game, even if the coach TTL is longer.
    if !record["userId"].is_string()
        && crate::games::load(app, record["gameId"].as_str().unwrap(), None)
            .await?
            .is_none()
    {
        app.cache
            .lock()
            .map_err(ApiError::internal)?
            .discard(&key(id));
        return Ok(None);
    }
    record["lastAccessedAt"] = json!(crate::now_ms());
    if !cache_hit {
        app.cache
            .lock()
            .map_err(ApiError::internal)?
            .put(key(id), bytes, TTL, Instant::now());
    }
    Ok(Some(record))
}
pub fn append(record: &mut Value, turn: Value) {
    let cost = turn["approxTokens"]
        .as_f64()
        .unwrap_or(0.0)
        .trunc()
        .max(0.0);
    let turns = record["turns"].as_array_mut().unwrap();
    turns.push(turn);
    if turns.len() > 200 {
        turns.remove(0);
    }
    let spent = record["spentTokens"].as_f64().unwrap_or(0.0) + cost;
    record["spentTokens"] = json!(spent as u64);
    record["updatedAt"] = json!(crate::now_ms());
    record["lastAccessedAt"] = record["updatedAt"].clone();
}
pub fn remember(record: &mut Value, text: &str) {
    let hints = record["givenHints"].as_array_mut().unwrap();
    hints.push(json!(text));
    if hints.len() > 12 {
        hints.remove(0);
    }
    record["updatedAt"] = json!(crate::now_ms());
    record["lastAccessedAt"] = record["updatedAt"].clone();
}
pub async fn delete(app: &AppState, id: &str, owner: Option<&str>) -> Result<bool, ApiError> {
    let Some(record) = load(app, id, owner).await? else {
        return Ok(false);
    };
    if record["userId"].is_string() {
        let id = id.to_owned();
        let owner = owner.unwrap().to_owned();
        app.db
            .call(move |db| {
                db.execute(
                    "DELETE FROM coach_history WHERE id=? AND user_id=?",
                    params![id, owner],
                )
                .map_err(ApiError::internal)?;
                Ok(())
            })
            .await?;
    }
    app.cache
        .lock()
        .map_err(ApiError::internal)?
        .discard(&key(id));
    Ok(true)
}

fn title(text: &str) -> String {
    static SPACE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let flat = SPACE
        .get_or_init(|| regex::Regex::new(&crate::coach_guardrails::js_spaces(r"\s+")).unwrap())
        .replace_all(crate::compat::trim(text), " ");
    if flat.is_empty() {
        "New question".into()
    } else if flat.encode_utf16().count() <= 48 {
        flat.into_owned()
    } else {
        format!("{}…", crate::text::slice(&flat, 47))
    }
}
/// Pagination happens in SQLite before decoding a record's JSON. Only the first
/// learner text and summary fields leave the SQLite worker, never stored boards.
pub async fn list(
    app: &AppState,
    game: &str,
    owner: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<Vec<Value>, ApiError> {
    let limit = limit.clamp(1, 200);
    if let Some(owner) = owner {
        let owner = owner.to_owned();
        let game = game.to_owned();
        let rows=app.db.call(move|db|{
   let mut statement=db.prepare("SELECT id,COALESCE((SELECT json_extract(value,'$.text') FROM json_each(data_json,'$.turns') WHERE json_extract(value,'$.role')='learner' LIMIT 1),''),json_array_length(data_json,'$.turns'),json_extract(data_json,'$.updatedAt') FROM coach_history WHERE user_id=? AND game_id=? AND json_valid(data_json) ORDER BY json_extract(data_json,'$.updatedAt') DESC,rowid LIMIT ? OFFSET ?").map_err(ApiError::internal)?;
   let rows=statement.query_map(params![owner,game,limit as i64,offset.min(i64::MAX as usize) as i64],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,usize>(2)?,r.get::<_,i64>(3)?))).map_err(ApiError::internal)?;
   rows.collect::<Result<Vec<_>,_>>().map_err(ApiError::internal)
  }).await?;
        return Ok(rows.into_iter().map(|(id,text,count,updated)|json!({"id":id,"title":title(&text),"turnCount":count,"updatedAt":updated})).collect());
    }
    #[derive(serde::Deserialize)]
    struct Turn {
        role: String,
        text: String,
    }
    #[derive(serde::Deserialize)]
    struct Metadata {
        id: String,
        #[serde(rename = "gameId")]
        game_id: String,
        #[serde(rename = "userId")]
        user_id: Option<String>,
        turns: Vec<Turn>,
        #[serde(rename = "updatedAt")]
        updated_at: i64,
    }
    let bytes = app
        .cache
        .lock()
        .map_err(ApiError::internal)?
        .payloads_prefix("coach:", Instant::now());
    let mut rows = Vec::new();
    for bytes in bytes {
        let Ok(metadata) = serde_json::from_slice::<Metadata>(&bytes) else {
            continue;
        };
        if metadata.game_id != game || metadata.user_id.is_some() {
            continue;
        }
        rows.push(json!({"id":metadata.id,"title":title(metadata.turns.iter().find(|t|t.role=="learner").map(|t|t.text.as_str()).unwrap_or("")),"turnCount":metadata.turns.len(),"updatedAt":metadata.updated_at}));
    }
    rows.sort_by(|a, b| b["updatedAt"].as_i64().cmp(&a["updatedAt"].as_i64()));
    Ok(rows.into_iter().skip(offset).take(limit).collect())
}

pub async fn owner(app: &AppState, id: &str) -> Result<Option<String>, ApiError> {
    #[derive(serde::Deserialize)]
    struct Owner {
        #[serde(rename = "userId")]
        user_id: Option<String>,
    }
    if let Some(bytes) = app
        .cache
        .lock()
        .map_err(ApiError::internal)?
        .get(&key(id), Instant::now())
    {
        return Ok(serde_json::from_slice::<Owner>(&bytes)
            .map_err(ApiError::internal)?
            .user_id);
    }
    let id = id.to_owned();
    app.db
        .call(move |db| {
            db.query_row("SELECT user_id FROM coach_history WHERE id=?", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(ApiError::internal)
        })
        .await
}
pub fn into_public(mut record: Value) -> Value {
    let object = record.as_object_mut().unwrap();
    object.remove("userId");
    object.remove("lastAccessedAt");
    record
}
