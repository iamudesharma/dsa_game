//! Owned snapshots use the legacy SQLite format; guest snapshots exist only in the shared cache.
use crate::{error::ApiError, AppState};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

const TTL: Duration = Duration::from_secs(3 * 60 * 60);
fn key(id: &str) -> String {
    format!("game:{id}")
}

/// Prevent lost updates without an unbounded per-game waiting queue.
pub struct MutationGuard {
    active: Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    id: String,
}
impl Drop for MutationGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.id);
        }
    }
}
pub fn lock_mutation(app: &AppState, id: &str) -> Result<MutationGuard, ApiError> {
    let mut active = app.game_mutations.lock().map_err(ApiError::internal)?;
    // Decoded boards and 25 undo snapshots are outside serialized-cache accounting.
    // Limit their concurrent lifetime, including time waiting on SQLite persistence.
    if active.len() >= app.config.game_operations.min(app.config.admitted) || active.contains(id) {
        return Err(ApiError::busy());
    }
    active.insert(id.to_owned());
    Ok(MutationGuard {
        active: app.game_mutations.clone(),
        id: id.to_owned(),
    })
}

fn validated(mut session: Value) -> Option<Value> {
    if session["userId"].is_string() {
        return crate::contracts::parse("GameSnapshot", session).ok();
    }
    session["spec"] = crate::contracts::parse("GameSpec", session["spec"].take()).ok()?;
    session["state"] = crate::contracts::parse("StoredState", session["state"].take()).ok()?;
    let undo = session["undo"].as_array_mut()?;
    if undo.len() > 25 {
        return None;
    }
    for state in undo {
        *state = crate::contracts::parse("StoredState", state.take()).ok()?;
    }
    Some(session)
}

/// Persist first, then publish the snapshot to readers. Reflections are never overwritten.
pub async fn save(app: &AppState, session: &Value) -> Result<(), ApiError> {
    save_in_place(app, &mut session.clone()).await
}

pub struct ActionReceipt {
    pub id: String,
    pub payload: Arc<[u8]>,
}
pub fn action_receipt_id(game_id: &str, action_id: &str) -> String {
    use sha2::{Digest, Sha256};
    format!(
        "game-action-{:x}",
        Sha256::digest(format!("{game_id}\0{action_id}"))
    )
}
pub fn action_fingerprint(action: &Value) -> String {
    use sha2::{Digest, Sha256};
    let fields: std::collections::BTreeMap<_, _> = action.as_object().unwrap().iter().collect();
    format!("{:x}", Sha256::digest(serde_json::to_vec(&fields).unwrap()))
}
pub async fn replay_action(
    app: &AppState,
    id: &str,
    owner: Option<&str>,
    fingerprint: &str,
) -> Result<Option<Value>, ApiError> {
    let cached = app
        .cache
        .lock()
        .map_err(ApiError::internal)?
        .get(id, Instant::now());
    let bytes = if let Some(bytes) = cached {
        Some(bytes)
    } else if let Some(owner) = owner {
        let id = id.to_owned();
        let owner = owner.to_owned();
        let row: Option<String> = app.db.call(move |db| {
            db.query_row("SELECT response_json FROM learning_actions WHERE id=? AND user_id=? AND status='game-action'", params![id,owner], |r| r.get(0)).optional().map_err(ApiError::internal)
        }).await?;
        row.map(|s| Arc::<[u8]>::from(s.into_bytes()))
    } else {
        None
    };
    let Some(bytes) = bytes else {
        return Ok(None);
    };
    let mut receipt: Value = serde_json::from_slice(&bytes).map_err(ApiError::internal)?;
    if receipt["fingerprint"] != fingerprint {
        return Err(ApiError(
            axum::http::StatusCode::CONFLICT,
            "BAD_REQUEST",
            "An actionId cannot be reused for a different action".into(),
        ));
    }
    Ok(Some(receipt["response"].take()))
}

pub async fn save_in_place(app: &AppState, session: &mut Value) -> Result<(), ApiError> {
    save_with_receipt(app, session, None).await
}

pub async fn save_with_receipt(
    app: &AppState,
    session: &mut Value,
    receipt: Option<ActionReceipt>,
) -> Result<(), ApiError> {
    let invalid = |_| ApiError::internal("Invalid game snapshot");
    if session["userId"].is_string() {
        crate::contracts::parse_in_place("GameSnapshot", session).map_err(invalid)?;
    } else {
        crate::contracts::parse_in_place("GameSpec", &mut session["spec"]).map_err(invalid)?;
        crate::contracts::parse_in_place("StoredState", &mut session["state"]).map_err(invalid)?;
        let undo = session["undo"]
            .as_array_mut()
            .ok_or_else(|| ApiError::internal("Invalid undo stack"))?;
        if undo.len() > 25 {
            return Err(ApiError::internal("Invalid undo stack"));
        }
        for state in undo {
            crate::contracts::parse_in_place("StoredState", state).map_err(invalid)?;
        }
    }
    let bytes: Arc<[u8]> = serde_json::to_vec(session)
        .map_err(ApiError::internal)?
        .into();
    let id = session["gameId"]
        .as_str()
        .ok_or_else(|| ApiError::internal("Missing game id"))?
        .to_owned();
    if let Some(owner) = session["userId"].as_str().filter(|s| !s.is_empty()) {
        let owner = owner.to_owned();
        let progress = &session["state"]["progress"];
        let mut record = json!({"gameId":id,"problemId":session["problemId"],"difficulty":session["difficulty"],"seed":session["seed"],"startedAt":session["createdAt"],"updatedAt":crate::now_ms(),"completedAt":if session["state"]["phase"]=="won" {json!(crate::now_ms())}else{Value::Null},"outcome":session["state"]["phase"],"steps":progress["steps"],"mistakes":progress["mistakes"],"hints":progress["hintsUsed"],"mistakesByMechanic":progress["mistakesByMechanic"]});
        let snapshot = bytes.clone();
        let game_id = id.clone();
        let durable_receipt = receipt.as_ref().map(|r| (r.id.clone(), r.payload.clone()));
        app.db.call(move |db| {
            let tx = db.transaction().map_err(ApiError::internal)?;
            let prior: Option<(String,String)> = tx.query_row("SELECT user_id,record_json FROM practice_runs WHERE game_id=?",[&game_id], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(ApiError::internal)?;
            if let Some((prior_owner, prior)) = prior {
                if prior_owner != owner {return Err(ApiError::internal("Game ownership cannot change"));}
                let prior: Value = serde_json::from_str(&prior).map_err(ApiError::internal)?;
                if prior["completedAt"].as_i64().is_some_and(|v|v != 0) && !record["completedAt"].is_null() {record["completedAt"] = prior["completedAt"].clone();}
            }
            tx.execute("INSERT INTO practice_runs(game_id,user_id,record_json,snapshot_json) VALUES(?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET record_json=excluded.record_json,snapshot_json=excluded.snapshot_json",params![game_id,owner,record.to_string(),std::str::from_utf8(&snapshot).map_err(ApiError::internal)?]).map_err(ApiError::internal)?;
            if let Some((receipt_id, payload)) = durable_receipt {
                tx.execute("INSERT INTO learning_actions(id,user_id,status,response_json,response_status) VALUES(?,?,'game-action',?,200)", params![receipt_id,owner,std::str::from_utf8(&payload).map_err(ApiError::internal)?]).map_err(ApiError::internal)?;
            }
            tx.commit().map_err(ApiError::internal)
        }).await?;
    }
    let cached =
        app.cache
            .lock()
            .map_err(ApiError::internal)?
            .put(key(&id), bytes, TTL, Instant::now());
    if !cached {
        if session["userId"].as_str().is_none() {
            return Err(ApiError::busy());
        }
        app.cache
            .lock()
            .map_err(ApiError::internal)?
            .discard(&key(&id));
    }
    if let Some(receipt) = receipt {
        app.cache.lock().map_err(ApiError::internal)?.put(
            receipt.id,
            receipt.payload,
            TTL,
            Instant::now(),
        );
    }
    Ok(())
}

/// Read only ownership metadata, without deserializing the board or undo history.
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
        let owner: Owner = serde_json::from_slice(&bytes).map_err(ApiError::internal)?;
        return Ok(owner.user_id);
    }
    let id = id.to_owned();
    app.db
        .call(move |db| {
            db.query_row(
                "SELECT user_id FROM practice_runs WHERE game_id=?",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(ApiError::internal)
        })
        .await
}

/// Owner checks apply equally to cache hits and SQLite recovery.
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
    let session: Value = if let Some(bytes) = cached {
        serde_json::from_slice(&bytes).map_err(ApiError::internal)?
    } else {
        let Some(owner) = owner else {
            return Ok(None);
        };
        let game_id = id.to_owned();
        let owner = owner.to_owned();
        let row: Option<String> = app
            .db
            .call(move |db| {
                db.query_row(
                    "SELECT snapshot_json FROM practice_runs WHERE game_id=? AND user_id=?",
                    params![game_id, owner],
                    |r| r.get(0),
                )
                .optional()
                .map_err(ApiError::internal)
            })
            .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let Ok(snapshot) = serde_json::from_str::<Value>(&row) else {
            return Ok(None);
        };
        snapshot
    };
    let Some(mut session) = validated(session) else {
        return Ok(None);
    };
    if session.get("userId").is_some_and(|v| v.as_str() != owner)
        || session["gameId"] != id
        || session["spec"]["problemId"] != session["problemId"]
        || session["state"]["problemId"] != session["problemId"]
        || session["state"]["seed"] != session["seed"]
        || session["undo"].as_array().is_none_or(|a| a.len() > 25)
        || !crate::reference()["problems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == session["problemId"])
    {
        return Ok(None);
    }
    session["lastAccessedAt"] = json!(crate::now_ms());
    // Cache::get already renews TTL and LRU position. A read need not serialize
    // the board and all undo snapshots merely to update a diagnostic timestamp.
    if !cache_hit {
        let payload: Arc<[u8]> = serde_json::to_vec(&session)
            .map_err(ApiError::internal)?
            .into();
        app.cache
            .lock()
            .map_err(ApiError::internal)?
            .put(key(id), payload, TTL, Instant::now());
    }
    Ok(Some(session))
}

pub fn push_undo(session: &mut Value, prior: Value) {
    let undo = session["undo"]
        .as_array_mut()
        .expect("validated undo stack");
    undo.push(prior);
    if undo.len() > 25 {
        undo.remove(0);
    }
}
