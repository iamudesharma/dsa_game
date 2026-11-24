use crate::{
    auth, coach_budget as budget, coach_store as store, decision_routes::fail, error::ApiError,
    games, AppState,
};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::OnceLock, time::Instant};
fn unknown(id: &str) -> Response {
    fail(
        StatusCode::NOT_FOUND,
        "UNKNOWN_THREAD",
        &format!("Unknown coach thread '{id}'"),
        Some(json!({"threadId":id})),
    )
}
async fn game_owner(
    app: &AppState,
    headers: &HeaderMap,
    id: Option<&str>,
) -> Result<(Option<String>, bool), ApiError> {
    let owner = auth::optional_owner(app, headers).await?;
    let hidden = if let Some(id) = id {
        games::owner(app, id)
            .await?
            .is_some_and(|stored| Some(stored) != owner)
    } else {
        false
    };
    Ok((owner, hidden))
}
async fn thread_hidden(app: &AppState, id: &str, owner: Option<&str>) -> Result<bool, ApiError> {
    Ok(store::owner(app, id)
        .await?
        .is_some_and(|stored| Some(stored.as_str()) != owner))
}
pub async fn get(
    State(app): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let owner = auth::optional_owner(&app, &headers).await?;
    if thread_hidden(&app, &id, owner.as_deref()).await? {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_THREAD",
            "Unknown conversation",
            None,
        ));
    }
    let Some(record) = store::load(&app, &id, owner.as_deref()).await? else {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_THREAD",
            "Unknown conversation",
            None,
        ));
    };
    if games::owner(&app, record["gameId"].as_str().unwrap())
        .await?
        .is_some_and(|stored| Some(stored) != owner)
    {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_GAME",
            "Unknown game",
            None,
        ));
    }
    Ok(Json(json!({"thread":store::into_public(record)})).into_response())
}
pub async fn delete(
    State(app): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let owner = auth::optional_owner(&app, &headers).await?;
    if thread_hidden(&app, &id, owner.as_deref()).await? {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_THREAD",
            "Unknown conversation",
            None,
        ));
    }
    let _guard = games::lock_mutation(&app, &format!("coach:{id}"))?;
    if !store::delete(&app, &id, owner.as_deref()).await? {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_THREAD",
            &format!("Unknown coach thread '{id}'"),
            None,
        ));
    }
    Ok(Json(json!({"threadId":id,"deleted":true})).into_response())
}
pub async fn list(
    State(app): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let (owner, hidden) =
        game_owner(&app, &headers, query.get("gameId").map(String::as_str)).await?;
    if hidden {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_GAME",
            "Unknown game",
            None,
        ));
    }
    let body = query
        .get("gameId")
        .map(|id| json!({"gameId":id}))
        .unwrap_or_else(|| json!({}));
    let parsed = match crate::contracts::parse("CoachThreadsQuery", body) {
        Ok(v) => v,
        Err(issues) => {
            return Ok(fail(
                StatusCode::BAD_REQUEST,
                "BAD_REQUEST",
                "gameId is required",
                Some(json!(issues)),
            ))
        }
    };
    let id = parsed["gameId"].as_str().unwrap();
    if games::load(&app, id, owner.as_deref()).await?.is_none() {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_GAME",
            &format!("Unknown game '{id}'"),
            None,
        ));
    }
    let offset = query
        .get("offset")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let limit = query
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(200)
        .clamp(1, 200);
    Ok(Json(
        json!({"gameId":id,"threads":store::list(&app,id,owner.as_deref(),offset,limit).await?}),
    )
    .into_response())
}
pub fn system(band: Option<&str>) -> String {
    static RULES: OnceLock<Vec<String>> = OnceLock::new();
    let rules = RULES
        .get_or_init(|| serde_json::from_str(include_str!("../data/coach-prompt.json")).unwrap());
    let register=match band{Some("newcomer")=>"The learner is brand new to this. Use the smallest words you can and never assume a term.",Some("builder")=>"The learner is comfortable with code terms, but still explain any term you do use.",_=>"The learner knows the basics. Explain any term you do use."};
    format!("{}\n\nTwo things you are not told elsewhere:\n- The answer is the POSITION of the target on the board, never its value. The value is already visible to them; the position is what they are learning to find.\n- The board description below was taken when they asked. They may have moved since. If it disagrees with what they tell you, believe them.\n\n{register}",rules.join("\n"))
}
pub fn messages(
    system: &str,
    summary: &str,
    snapshot: &Value,
    prompt: &Value,
    window: &Value,
    question: &str,
) -> Value {
    let mut messages = vec![json!({"role":"system","content":system})];
    let mut history = Vec::new();
    if !crate::compat::trim(summary).is_empty() {
        history.push("EARLIER IN THIS CONVERSATION (older turns, condensed):".into());
        history.push(summary.to_owned())
    }
    for turn in window["turns"].as_array().unwrap() {
        let text = turn["text"].as_str().unwrap();
        if turn["role"] == "learner" {
            let board = turn
                .get("snapshot")
                .map(|s| format!("\n[board at the time: {s}]"))
                .unwrap_or_default();
            history.push(format!("learner: {text}{board}"))
        } else {
            history.push(format!("coach: {text}"))
        }
    }
    if !history.is_empty() {
        messages.push(json!({"role":"user","content":history.join("\n")}))
    }
    let mut lines = vec![
        "THE BOARD RIGHT NOW".into(),
        snapshot.to_string(),
        "WHAT THE GAME IS ASKING THEM TO DO NEXT".into(),
        format!("goal: {}", prompt["goal"].as_str().unwrap()),
        format!("instruction: {}", prompt["instruction"].as_str().unwrap()),
        format!("why: {}", prompt["reason"].as_str().unwrap()),
    ];
    if let Some(nudge) = prompt["nudge"]["message"].as_str() {
        lines.push(format!("they need: {nudge}"))
    }
    lines.push("Answer their question in your own words. Two or three short sentences.".into());
    messages.push(json!({"role":"user","content":lines.join("\n")}));
    messages.push(json!({"role":"user","content":question}));
    json!(messages)
}
fn turn(role: &str, text: &str, snapshot: &Value, synthetic: bool) -> Value {
    use rand::RngCore;
    let at = crate::now_ms();
    let mut turn = json!({"id":format!("turn-{at:x}-{:x}",rand::rngs::OsRng.next_u64()),"role":role,"text":text,"at":at,"approxTokens":budget::estimate_tokens(text)+budget::estimate_tokens(&snapshot.to_string()),"snapshot":snapshot});
    if synthetic {
        turn["synthetic"] = json!(true)
    }
    turn
}
pub async fn ask(
    State(app): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<Response, ApiError> {
    let value: Value = serde_json::from_slice(&raw).unwrap_or(Value::Null);
    let (owner, hidden) = game_owner(&app, &headers, value["gameId"].as_str()).await?;
    if hidden {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_GAME",
            "Unknown game",
            None,
        ));
    }
    let body = match crate::contracts::parse("CoachAsk", value) {
        Ok(v) => v,
        Err(issues) => {
            return Ok(fail(
                StatusCode::BAD_REQUEST,
                "BAD_REQUEST",
                "Invalid coach request",
                Some(json!(issues)),
            ))
        }
    };
    let game_id = body["gameId"].as_str().unwrap();
    let session = {
        let _guard = games::lock_mutation(&app, game_id)?;
        games::load(&app, game_id, owner.as_deref()).await?
    };
    let Some(session) = session else {
        return Ok(fail(
            StatusCode::NOT_FOUND,
            "UNKNOWN_GAME",
            &format!("Unknown game '{game_id}'"),
            None,
        ));
    };
    let band = body["band"].as_str();
    let question = crate::text::slice(crate::compat::trim(body["message"].as_str().unwrap()), 1000);
    let started = Instant::now();
    let prompt = crate::guidance::derive_turn_prompt(&session["state"], &session["spec"]);
    let snapshot = crate::coach_snapshot::build(&session["state"], &session["spec"], &prompt);
    let problem_id = session["problemId"].clone();
    drop(session);
    // Lock before loading an existing record so concurrent requests cannot save stale turns.
    let existing_guard = body["threadId"]
        .as_str()
        .map(|id| games::lock_mutation(&app, &format!("coach:{id}")))
        .transpose()?;
    let mut record = if let Some(id) = body["threadId"].as_str() {
        let Some(record) = store::load(&app, id, owner.as_deref()).await? else {
            return Ok(unknown(id));
        };
        if record["gameId"] != game_id {
            return Ok(unknown(id));
        }
        record
    } else {
        store::new(game_id, problem_id.as_str().unwrap(), owner.as_deref())
    };
    let id = record["id"].as_str().unwrap().to_owned();
    let _guard = if let Some(guard) = existing_guard {
        guard
    } else {
        games::lock_mutation(&app, &format!("coach:{id}"))?
    };
    // Admission happens before saving the question; there is no waiting queue.
    let enabled =
        std::env::var("COACH_TRANSPORT").as_deref() != Ok("0") && app.transport.chat_id().is_some();
    let permit = if enabled {
        Some(app.transport.reserve().map_err(|_| ApiError::busy())?)
    } else {
        None
    };
    store::append(&mut record, turn("learner", &question, &snapshot, false));
    store::save(&app, &record).await?;
    let system = system(band);
    let summary = record["summary"].as_str().unwrap_or("");
    let window = budget::assemble(
        record["turns"].as_array().unwrap(),
        budget::after_preamble(&[&system, summary], budget::Budget::default()),
        Some(summary),
    );
    let preamble = budget::estimate_tokens(&system) + budget::estimate_tokens(summary);
    let mut transport_failed = false;
    let model_reply = if let Some(permit) = permit {
        app.transport
            .coach_chat(
                &permit,
                messages(&system, summary, &snapshot, &prompt, &window, &question),
            )
            .await
            .map_err(|_| {
                transport_failed = true;
            })
            .ok()
    } else {
        None
    };
    let source = if model_reply.is_some() {
        "model"
    } else {
        "fallback"
    };
    let model = model_reply
        .as_ref()
        .and_then(|r| r["model"].as_str())
        .unwrap_or("fallback");
    let raw_reply = model_reply
        .as_ref()
        .and_then(|r| r["text"].as_str())
        .unwrap_or("");
    let screened = crate::coach_guardrails::screen(raw_reply, &snapshot);
    let final_text = if crate::compat::trim(screened["text"].as_str().unwrap()).is_empty() {
        let given = record["givenHints"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        crate::coach_fallback::answer(&question, &snapshot, &prompt, band, &given)["text"]
            .as_str()
            .unwrap()
            .to_owned()
    } else {
        screened["text"].as_str().unwrap().to_owned()
    };
    store::append(
        &mut record,
        turn("coach", &final_text, &snapshot, source == "fallback"),
    );
    record["summary"] = window["summary"].clone();
    store::remember(&mut record, &final_text);
    store::save(&app, &record).await?;
    let public = store::into_public(record);
    let classified = crate::coach_fallback::classify(&question);
    let approx_total = budget::estimate_tokens(&question)
        + budget::estimate_tokens(&final_text)
        + 2 * budget::estimate_tokens(&snapshot.to_string());
    let outcome = if transport_failed {
        "transport-unavailable"
    } else if source == "fallback" {
        "answered-fallback"
    } else if crate::compat::trim(raw_reply).is_empty() {
        "empty-reply-fell-back"
    } else if screened["ok"] == false {
        "answered-after-rewrite"
    } else {
        "answered"
    };
    println!(
        "{}",
        json!({"event":"coach","threadId":id,"gameId":game_id,"problemId":problem_id,"model":model,"source":source,"intent":classified["intent"],"confidence":classified["confidence"],"latencyMs":started.elapsed().as_millis(),"approxPromptTokens":window["approxPromptTokens"].as_u64().unwrap_or(0)+preamble as u64,"approxReplyTokens":budget::estimate_tokens(&final_text),"approxTotalTokens":approx_total,"redactedReason":screened["redacted"]["reason"],"outcome":outcome,"guardrailFired":screened["ok"]==false,"droppedTurns":window["droppedTurns"],"snapshotStrippedTurns":window["snapshotStrippedTurns"],"turnsInThread":public["turns"].as_array().unwrap().len()})
    );
    Ok(Json(json!({"threadId":id,"reply":final_text,"redacted":screened.get("redacted").unwrap_or(&Value::Null),"source":source,"model":model,"latencyMs":started.elapsed().as_millis(),"approxTokens":public["spentTokens"],"turnPrompt":prompt,"turns":public["turns"],"threads":store::list(&app,game_id,owner.as_deref(),0,200).await?})).into_response())
}
