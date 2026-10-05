//! Dashboard summaries retain only catalogue-sized aggregates. The existing
//! unpaginated records array streams from one read transaction in bounded chunks.
use crate::{
    error::ApiError,
    learning::{self, Error},
    now_ms, AppState,
};
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::HeaderMap,
    response::Response,
};
use futures_util::StreamExt;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::io::Write;
use tokio::sync::mpsc;

pub(crate) fn summary(db: &Connection, owner: &str) -> Result<Value, ApiError> {
    let problems = crate::reference()["problems"].as_array().unwrap();
    let imported: Option<String> = db
        .query_row(
            "SELECT completed_json FROM progress WHERE user_id=?",
            [owner],
            |r| r.get(0),
        )
        .optional()
        .map_err(ApiError::internal)?;
    let mut completed = Map::new();
    if let Some(imported) = imported.and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
        if let Some(object) = imported.as_object() {
            for (id, value) in object {
                if problems.iter().any(|p| p["id"] == *id)
                    && value.as_str().is_some_and(valid_stamp)
                {
                    completed.insert(id.clone(), value.clone());
                }
            }
        }
    }
    let mut stmt=db.prepare("SELECT json_extract(record_json,'$.problemId'),json_extract(record_json,'$.completedAt') FROM practice_runs WHERE user_id=? AND json_extract(record_json,'$.completedAt') IS NOT NULL AND json_extract(record_json,'$.completedAt')!=0 ORDER BY json_extract(record_json,'$.updatedAt') DESC,rowid ASC").map_err(ApiError::internal)?;
    let wins = stmt
        .query_map([owner], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
        })
        .map_err(ApiError::internal)?;
    for win in wins {
        let (id, ms) = win.map_err(ApiError::internal)?;
        let date = chrono::DateTime::from_timestamp_millis(ms.trunc() as i64)
            .ok_or_else(|| ApiError::internal("invalid completion timestamp"))?;
        completed.insert(
            id,
            json!(date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        );
    }
    let mut reviews = Vec::new();
    for p in problems {
        let mut stmt=db.prepare("SELECT json_extract(record_json,'$.completedAt'),json_extract(record_json,'$.mistakes'),json_extract(record_json,'$.hints') FROM practice_runs WHERE user_id=? AND json_extract(record_json,'$.problemId')=? AND json_extract(record_json,'$.completedAt') IS NOT NULL AND json_extract(record_json,'$.completedAt')!=0 ORDER BY json_extract(record_json,'$.completedAt') ASC,json_extract(record_json,'$.updatedAt') DESC,rowid ASC").map_err(ApiError::internal)?;
        let rows = stmt
            .query_map(params![owner, p["id"].as_str().unwrap()], |r| {
                Ok((
                    r.get::<_, f64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(ApiError::internal)?;
        let mut last = None;
        let mut stage = 0usize;
        for row in rows {
            let (time, mistakes, hints) = row.map_err(ApiError::internal)?;
            if last.is_some() {
                stage = if mistakes == 0 && hints == 0 {
                    (stage + 1).min(3)
                } else {
                    0
                };
            }
            last = Some(time);
        }
        if let Some(last) = last {
            reviews.push(json!({"problemId":p["id"],"stage":stage,"dueAt":last+([1,3,7,14][stage] as f64)*86400000.0}));
        }
    }
    reviews.sort_by(|a, b| {
        a["dueAt"]
            .as_f64()
            .unwrap()
            .total_cmp(&b["dueAt"].as_f64().unwrap())
    });
    let mut topics = Vec::new();
    for p in problems {
        let topic = p["topic"].as_str().unwrap();
        if topics.iter().any(|t: &Value| t["topic"] == topic) {
            continue;
        }
        let ps: Vec<_> = problems.iter().filter(|p| p["topic"] == topic).collect();
        let ids = serde_json::to_string(
            &ps.iter()
                .map(|p| p["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let (attempts,mistakes,hints):(i64,i64,i64)=db.query_row("SELECT count(*),COALESCE(sum(json_extract(record_json,'$.mistakes')),0),COALESCE(sum(json_extract(record_json,'$.hints')),0) FROM practice_runs WHERE user_id=? AND json_extract(record_json,'$.problemId') IN (SELECT value FROM json_each(?))",params![owner,ids],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(ApiError::internal)?;
        topics.push(json!({"topic":topic,"completed":ps.iter().filter(|p|completed.contains_key(p["id"].as_str().unwrap())).count(),"total":ps.len(),"attempts":attempts,"mistakes":mistakes,"hints":hints}));
    }
    let ongoing:Option<(String,String)>=db.query_row("SELECT game_id,json_extract(record_json,'$.problemId') FROM practice_runs WHERE user_id=? AND json_extract(record_json,'$.outcome')='playing' ORDER BY json_extract(record_json,'$.updatedAt') DESC,rowid ASC LIMIT 1",[owner],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(ApiError::internal)?;
    let recommendation = if let Some(due) = reviews
        .iter()
        .find(|r| r["dueAt"].as_f64().unwrap() <= now_ms() as f64)
    {
        json!({"problemId":due["problemId"],"reason":"This problem is due for a scheduled review."})
    } else if let Some((id, problem)) = ongoing {
        json!({"problemId":problem,"action":"resume","gameId":id,"reason":"You have an unfinished practice run for this problem."})
    } else if let Some(p) = problems
        .iter()
        .find(|p| !completed.contains_key(p["id"].as_str().unwrap()))
    {
        json!({"problemId":p["id"],"reason":"Try a problem you have not completed yet."})
    } else if let Some(r) = reviews.first() {
        json!({"problemId":r["problemId"],"reason":"Revisit a completed problem with a fresh instance."})
    } else {
        Value::Null
    };
    Ok(
        json!({"completed":completed,"reviews":reviews,"topics":topics,"recommendation":recommendation}),
    )
}
pub(crate) fn valid_stamp(s: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(s).is_ok()
        || chrono::DateTime::parse_from_rfc2822(s).is_ok()
        || chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
        || ["%m/%d/%Y", "%Y/%m/%d", "%b %d %Y", "%B %d, %Y"]
            .iter()
            .any(|format| chrono::NaiveDate::parse_from_str(s, format).is_ok())
        || [
            "%Y-%m-%dT%H:%M",
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y-%m-%d %H:%M:%S%.f",
        ]
        .iter()
        .any(|format| chrono::NaiveDateTime::parse_from_str(s, format).is_ok())
}

pub(crate) struct Output {
    sender: mpsc::Sender<Result<Bytes, ApiError>>,
    buffer: Vec<u8>,
}
impl Output {
    fn flush_chunk(&mut self) -> std::io::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        self.sender
            .blocking_send(Ok(Bytes::from(std::mem::replace(
                &mut self.buffer,
                Vec::with_capacity(32768),
            ))))
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "client disconnected"))
    }
}
impl Write for Output {
    fn write(&mut self, mut bytes: &[u8]) -> std::io::Result<usize> {
        let total = bytes.len();
        while !bytes.is_empty() {
            let length = (32768 - self.buffer.len()).min(bytes.len());
            self.buffer.extend_from_slice(&bytes[..length]);
            bytes = &bytes[length..];
            if self.buffer.len() == 32768 {
                self.flush_chunk()?;
            }
        }
        Ok(total)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.flush_chunk()
    }
}
pub async fn get(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, Error> {
    let owner = learning::user(&state, &headers).await?;
    Ok(stream_json(state, move |db, output| {
        let summary = summary(db, &owner)?;
        output.write_all(b"{\"records\":[").map_err(ApiError::internal)?;
        let mut stmt = db.prepare("SELECT record_json FROM practice_runs WHERE user_id=? ORDER BY json_extract(record_json,'$.updatedAt') DESC,rowid ASC").map_err(ApiError::internal)?;
        let rows = stmt.query_map([owner], |r| r.get::<_,String>(0)).map_err(ApiError::internal)?;
        let mut comma=false;
        for row in rows {
            if comma { output.write_all(b",").map_err(ApiError::internal)?; }
            output.write_all(row.map_err(ApiError::internal)?.as_bytes()).map_err(ApiError::internal)?;
            comma=true;
        }
        output.write_all(b"],").map_err(ApiError::internal)?;
        let rest=serde_json::to_vec(&summary).map_err(ApiError::internal)?;
        output.write_all(&rest[1..]).map_err(ApiError::internal)?;
        Ok(())
    }).await?)
}

pub(crate) async fn stream_json<F>(state: AppState, job: F) -> Result<Response, ApiError>
where
    F: FnOnce(&Connection, &mut Output) -> Result<(), ApiError> + Send + 'static,
{
    let (sender, mut receiver) = mpsc::channel::<Result<Bytes, ApiError>>(2);
    tokio::spawn(async move {
        let failure = sender.clone();
        let result = state
            .db
            .call(move |db| {
                let tx = db.transaction().map_err(ApiError::internal)?;
                let mut output = Output {
                    sender,
                    buffer: Vec::with_capacity(32768),
                };
                job(&tx, &mut output)?;
                output.flush().map_err(ApiError::internal)
            })
            .await;
        if let Err(error) = result {
            let _ = failure.send(Err(error)).await;
        }
    });
    let first = receiver
        .recv()
        .await
        .ok_or_else(|| ApiError::internal("JSON worker stopped"))??;
    let stream = futures_util::stream::once(async { Ok::<_, ApiError>(first) }).chain(
        futures_util::stream::unfold(receiver, |mut r| async { r.recv().await.map(|v| (v, r)) }),
    );
    let mut response = Response::new(Body::from_stream(stream));
    response
        .headers_mut()
        .insert("content-type", "application/json".parse().unwrap());
    Ok(response)
}
