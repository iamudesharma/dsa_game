//! Account-owned learning reads. SQL limits rows before JSON deserialization.
use crate::{auth, error::ApiError, now_ms, AppState};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

pub enum Error {
    Api(ApiError),
    Detail(StatusCode, String),
    Message(StatusCode, &'static str),
}
impl From<ApiError> for Error {
    fn from(e: ApiError) -> Self {
        Self::Api(e)
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        match self {
            Self::Api(e) => e.into_response(),
            Self::Detail(status, message) => {
                (status, Json(json!({"error":{"message":message}}))).into_response()
            }
            Self::Message(status, message) => {
                (status, Json(json!({"error":{"message":message}}))).into_response()
            }
        }
    }
}
fn unknown_thread() -> Error {
    Error::Message(StatusCode::NOT_FOUND, "Unknown conversation")
}

pub async fn user(state: &AppState, headers: &HeaderMap) -> Result<String, Error> {
    let (id, _) = auth::resolve(state, headers).await.map_err(|e| {
        if e.0 == StatusCode::UNAUTHORIZED {
            ApiError(
                e.0,
                "AUTH_REQUIRED",
                "Sign in to access your learning history and conversations.".into(),
            )
        } else {
            e
        }
    })?;
    state.learning_ready.get_or_try_init(|| async {
        state.db.call(|db| {
            let tx = db.transaction().map_err(ApiError::internal)?;
            // Recover in SQL, avoiding hydration of every historical message.
            tx.execute("UPDATE learning_threads SET updated_at=? WHERE id IN (SELECT thread_id FROM learning_messages WHERE json_extract(data_json,'$.status')='streaming')",[now_ms()]).map_err(ApiError::internal)?;
            tx.execute("UPDATE learning_messages SET data_json=json_set(data_json,'$.status','interrupted') WHERE json_extract(data_json,'$.status')='streaming'",[]).map_err(ApiError::internal)?;
            tx.execute("UPDATE learning_actions SET status='failed' WHERE status='running'",[]).map_err(ApiError::internal)?;
            tx.commit().map_err(ApiError::internal)
        }).await
    }).await?;
    Ok(id)
}

#[derive(Default, Deserialize)]
pub struct Page {
    cursor: Option<String>,
    limit: Option<String>,
    q: Option<String>,
}
impl Page {
    fn size(&self, default: usize) -> usize {
        match self.limit.as_deref() {
            None => default,
            Some("") => 1,
            Some(value) => Some(crate::compat::number(value))
                .filter(|n| n.is_finite())
                .map(|n| n.floor().clamp(1.0, 100.0) as usize)
                .unwrap_or(default),
        }
    }
    fn after(&self) -> Option<String> {
        self.cursor.as_ref().and_then(|v| crate::compat::cursor(v))
    }
}
fn paged(mut rows: Vec<Value>, size: usize) -> (Vec<Value>, Value) {
    let cursor = if rows.len() > size {
        rows.truncate(size);
        rows.last()
            .and_then(|r| r["id"].as_str())
            .map(|id| json!(URL_SAFE_NO_PAD.encode(id)))
            .unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    (rows, cursor)
}
pub(crate) fn thread(db: &Connection, owner: &str, id: &str) -> Result<Option<Value>, ApiError> {
    db.query_row("SELECT id,title,created_at,updated_at FROM learning_threads WHERE user_id=? AND id=?",params![owner,id], |r| Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"createdAt":r.get::<_,i64>(2)?,"updatedAt":r.get::<_,i64>(3)?}))).optional().map_err(ApiError::internal)
}
pub async fn list_threads(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(page): Query<Page>,
) -> Result<Json<Value>, Error> {
    let owner = user(&state, &headers).await?;
    let size = page.size(30);
    let after = page.after();
    let search = String::from_utf16_lossy(
        &page
            .q
            .unwrap_or_default()
            .encode_utf16()
            .take(200)
            .collect::<Vec<_>>(),
    );
    let result = state.db.call(move |db| {
        // The cursor rank is calculated in SQLite, including the search filter.
        // Unknown cursors fall back to the first page, matching Node's contract.
        let mut stmt = db.prepare("WITH filtered AS (SELECT id,title,created_at,updated_at,row_number() OVER (ORDER BY updated_at DESC,id DESC) AS n FROM learning_threads WHERE user_id=?1 AND (instr(lower(title),lower(?2))>0 OR EXISTS(SELECT 1 FROM learning_messages WHERE thread_id=learning_threads.id AND instr(lower(data_json),lower(?2))>0))) SELECT id,title,created_at,updated_at FROM filtered WHERE n>COALESCE((SELECT n FROM filtered WHERE id=?3),0) ORDER BY n LIMIT ?4").map_err(ApiError::internal)?;
        let rows = stmt.query_map(params![owner,search,after,size+1], |r| Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"createdAt":r.get::<_,i64>(2)?,"updatedAt":r.get::<_,i64>(3)?}))).map_err(ApiError::internal)?.collect::<Result<Vec<_>,_>>().map_err(ApiError::internal)?;
        let (threads,cursor) = paged(rows,size);
        Ok(json!({"threads":threads,"nextCursor":cursor}))
    }).await?;
    Ok(Json(result))
}
pub async fn create_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let owner = user(&state, &headers).await?;
    let mut random = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let id = format!("chat_{}", URL_SAFE_NO_PAD.encode(random));
    let result = state.db.call(move |db| {
        let now = now_ms();
        db.execute("INSERT INTO learning_threads VALUES(?,?,?,?,?)",params![id,owner,"New conversation",now,now]).map_err(ApiError::internal)?;
        Ok(json!({"thread":{"id":id,"title":"New conversation","createdAt":now,"updatedAt":now}}))
    }).await?;
    Ok(Json(result))
}
pub async fn get_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(page): Query<Page>,
) -> Result<Response, Error> {
    use std::io::Write;
    let owner = user(&state, &headers).await?;
    let size = page.size(100);
    let after = page.after();
    let response = crate::dashboard::stream_json(state, move |db, output| {
        let t=thread(db,&owner,&id)?.ok_or_else(||ApiError(StatusCode::NOT_FOUND,"UNKNOWN_THREAD","Unknown conversation".into()))?;
        let start:i64=db.query_row("SELECT rowid FROM learning_messages WHERE thread_id=? AND id=?",params![id,after],|r|r.get(0)).optional().map_err(ApiError::internal)?.unwrap_or(0);
        let mut stmt=db.prepare("SELECT id FROM learning_messages WHERE thread_id=? AND rowid>? ORDER BY rowid LIMIT ?").map_err(ApiError::internal)?;
        let ids=stmt.query_map(params![id,start,size+1],|r|r.get::<_,String>(0)).map_err(ApiError::internal)?.collect::<Result<Vec<_>,_>>().map_err(ApiError::internal)?;
        let cursor=if ids.len()>size {json!(URL_SAFE_NO_PAD.encode(&ids[size-1]))}else{Value::Null};
        output.write_all(b"{\"thread\":").map_err(ApiError::internal)?;
        serde_json::to_writer(&mut *output,&t).map_err(ApiError::internal)?;
        output.write_all(b",\"messages\":[").map_err(ApiError::internal)?;
        let mut stmt=db.prepare("SELECT data_json FROM learning_messages WHERE thread_id=? AND rowid>? ORDER BY rowid LIMIT ?").map_err(ApiError::internal)?;
        let raw=stmt.query_map(params![id,start,size],|r|r.get::<_,String>(0)).map_err(ApiError::internal)?;
        let mut comma=false;
        for row in raw {
            let mut value:Value=serde_json::from_str(&row.map_err(ApiError::internal)?).map_err(ApiError::internal)?;
            if let Some(object)=value.as_object_mut(){object.entry("actions").or_insert_with(||json!([]));object.entry("sources").or_insert_with(||json!([]));}
            if comma{output.write_all(b",").map_err(ApiError::internal)?;}
            serde_json::to_writer(&mut *output,&value).map_err(ApiError::internal)?;
            comma=true;
        }
        output.write_all(b"],\"nextCursor\":").map_err(ApiError::internal)?;
        serde_json::to_writer(&mut *output,&cursor).map_err(ApiError::internal)?;
        output.write_all(b"}").map_err(ApiError::internal)?;
        Ok(())
    }).await.map_err(|e|if e.1=="UNKNOWN_THREAD" {unknown_thread()}else{Error::Api(e)})?;
    Ok(response)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Title {
    title: String,
}
pub async fn rename_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Result<Json<Title>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, Error> {
    let owner = user(&state, &headers).await?;
    let title = body
        .ok()
        .map(|Json(t)| crate::compat::trim(&t.title).to_owned())
        .filter(|t| (1..=160).contains(&t.chars().count()));
    let result = state
        .db
        .call(move |db| {
            let Some(mut t) = thread(db, &owner, &id)? else {
                return Ok((false, None));
            };
            let Some(title) = title else {
                return Ok((true, None));
            };
            db.execute(
                "UPDATE learning_threads SET title=? WHERE id=? AND user_id=?",
                params![title, id, owner],
            )
            .map_err(ApiError::internal)?;
            t["title"] = json!(title);
            Ok((true, Some(t)))
        })
        .await?;
    if !result.0 {
        return Err(unknown_thread());
    }
    Ok(Json(
        json!({"thread":result.1.ok_or(Error::Message(StatusCode::BAD_REQUEST,"Enter a title of 1–160 characters."))?}),
    ))
}
pub async fn delete_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, Error> {
    let owner = user(&state, &headers).await?;
    let thread_id = id.clone();
    let removed = state
        .db
        .call(move |db| {
            db.execute(
                "DELETE FROM learning_threads WHERE user_id=? AND id=?",
                params![owner, id],
            )
            .map_err(ApiError::internal)
        })
        .await?;
    if removed == 0 {
        return Err(unknown_thread());
    }
    crate::chat::abort(&state, &thread_id);
    Ok(Json(json!({"deleted":true})))
}
pub async fn plans(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, Error> {
    use std::io::Write;
    let owner = user(&state, &headers).await?;
    Ok(crate::dashboard::stream_json(state, move |db,output| {
        output.write_all(b"{\"plans\":[").map_err(ApiError::internal)?;
        let mut stmt = db.prepare("SELECT id,title,content,created_at FROM study_plans WHERE user_id=? ORDER BY created_at DESC").map_err(ApiError::internal)?;
        let rows = stmt.query_map([owner], |r| Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"content":r.get::<_,String>(2)?,"createdAt":r.get::<_,i64>(3)?}))).map_err(ApiError::internal)?;
        let mut comma = false;
        for row in rows {
            if comma { output.write_all(b",").map_err(ApiError::internal)?; }
            serde_json::to_writer(&mut *output,&row.map_err(ApiError::internal)?).map_err(ApiError::internal)?;
            comma = true;
        }
        output.write_all(b"]}").map_err(ApiError::internal)?;
        Ok(())
    }).await?)
}
