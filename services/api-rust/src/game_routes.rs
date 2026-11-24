use crate::{auth, decision_routes::fail, games, AppState};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
pub async fn debrief(
    State(app): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let owner = match auth::optional_owner(&app, &headers).await {
        Ok(owner) => owner,
        Err(error) => return error.into_response(),
    };
    let _guard = match games::lock_mutation(&app, &id) {
        Ok(guard) => guard,
        Err(error) => return error.into_response(),
    };
    let session = match games::load(&app, &id, owner.as_deref()).await {
        Ok(Some(session)) => session,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "UNKNOWN_GAME", "Unknown game", None),
        Err(error) => return error.into_response(),
    };
    if session["state"]["phase"] == "playing" {
        return fail(
            StatusCode::CONFLICT,
            "BAD_REQUEST",
            "This game is still in progress",
            Some(json!({"phase":session["state"]["phase"]})),
        );
    }
    Json(crate::debrief::build(&session["spec"], &session["state"])).into_response()
}

fn parse(
    name: &str,
    message: &str,
    value: serde_json::Value,
    details: bool,
) -> Result<serde_json::Value, Box<Response>> {
    crate::contracts::parse(name, value).map_err(|issues| {
        Box::new(fail(
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            message,
            details.then(|| json!(issues)),
        ))
    })
}
async fn actor(
    app: &AppState,
    headers: &HeaderMap,
    body: &serde_json::Value,
) -> Result<Option<String>, Response> {
    let owner = auth::optional_owner(app, headers)
        .await
        .map_err(IntoResponse::into_response)?;
    if let Some(id) = body["gameId"].as_str() {
        if let Some(stored) = games::owner(app, id)
            .await
            .map_err(IntoResponse::into_response)?
        {
            if Some(stored.as_str()) != owner.as_deref() {
                return Err(fail(
                    StatusCode::NOT_FOUND,
                    "UNKNOWN_GAME",
                    "Unknown game",
                    None,
                ));
            }
        }
    }
    Ok(owner)
}
async fn session(
    app: &AppState,
    id: &str,
    owner: Option<&str>,
    quoted: bool,
) -> Result<serde_json::Value, Response> {
    games::load(app, id, owner)
        .await
        .map_err(IntoResponse::into_response)?
        .ok_or_else(|| {
            fail(
                StatusCode::NOT_FOUND,
                "UNKNOWN_GAME",
                &if quoted {
                    format!("Unknown game '{id}'")
                } else {
                    "Unknown game".into()
                },
                None,
            )
        })
}
pub async fn get(
    State(app): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let owner = match actor(&app, &headers, &json!({"gameId":id})).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let _guard = match games::lock_mutation(&app, &id) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let mut session = match session(&app, &id, owner.as_deref(), false).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let prompt = crate::guidance::derive_turn_prompt(&session["state"], &session["spec"]);
    let mut result = json!({"gameId":id,"problemId":session["problemId"],"seed":session["seed"],"difficulty":session["difficulty"],"turnPrompt":prompt,"spec":null,"state":null,"usedTier":session["usedTier"]});
    result["spec"] = session["spec"].take();
    result["state"] = session["state"].take();
    drop(session);
    Json(result).into_response()
}
pub async fn generate(
    State(app): State<AppState>,
    headers: HeaderMap,
    raw: axum::body::Bytes,
) -> Response {
    let body = match parse(
        "Generate",
        "Invalid generate request",
        serde_json::from_slice(&raw).unwrap_or(serde_json::Value::Null),
        true,
    ) {
        Ok(v) => v,
        Err(e) => return *e,
    };
    drop(raw);
    let id = body["problemId"].as_str().unwrap();
    let Some(problem) = crate::reference()["problems"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
    else {
        return fail(
            StatusCode::BAD_REQUEST,
            "UNKNOWN_PROBLEM",
            &format!("Unknown problem '{id}'"),
            Some(
                json!({"known":crate::reference()["problems"].as_array().unwrap().iter().map(|p|p["id"].clone()).collect::<Vec<_>>()}),
            ),
        );
    };
    let owner = match auth::optional_owner(&app, &headers).await {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    use rand::RngCore;
    let seed = body["seed"]
        .as_f64()
        .unwrap_or_else(|| (rand::rngs::OsRng.next_u32() & 0x7fffffff) as f64);
    let difficulty = body["difficulty"]
        .as_str()
        .unwrap_or(problem["defaultDifficulty"].as_str().unwrap());
    let Some(state) = crate::runtime::init(id, seed, difficulty) else {
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            &format!("Oracle '{id}' could not build an instance"),
            None,
        );
    };
    let input = json!({"problem":problem,"instance":state["instance"],"seed":seed as u64,"difficulty":difficulty,"freeText":body["freeText"],"forceTemplate":body["forceTemplate"]});
    let permit = if body["forceTemplate"] != true
        && ["opencode-go", "opencode", "openrouter", "local-llm"]
            .iter()
            .any(|tier| app.transport.game_available(tier))
    {
        match app.transport.reserve() {
            Ok(p) => Some(p),
            Err(_) => return crate::error::ApiError::busy().into_response(),
        }
    } else {
        None
    };
    let remote = crate::game_chain::Reserved {
        transport: &app.transport,
        permit: permit.as_ref(),
    };
    let mut generated = match crate::game_chain::generate(&input, &remote).await {
        Ok(v) => v,
        Err(e) => {
            return fail(
                StatusCode::BAD_GATEWAY,
                "GENERATION_FAILED",
                "All provider tiers failed",
                Some(json!(e.as_json()["message"])),
            )
        }
    };
    drop(permit);
    let game_id = format!(
        "{id}-{:x}-{:016x}",
        crate::now_ms(),
        rand::rngs::OsRng.next_u64()
    );
    let now = crate::now_ms();
    let mut session = json!({"gameId":game_id,"problemId":id,"seed":seed as u64,"difficulty":difficulty,"spec":null,"state":null,"undo":[],"usedTier":generated["tier"],"createdAt":now,"lastAccessedAt":now});
    session["spec"] = generated["spec"].take();
    session["state"] = state;
    if let Some(owner) = owner {
        session["userId"] = json!(owner)
    }
    if let Err(error) = games::save_in_place(&app, &mut session).await {
        return error.into_response();
    }
    let prompt = crate::guidance::derive_turn_prompt(&session["state"], &session["spec"]);
    let mut result = json!({"gameId":game_id,"problemId":id,"seed":seed as u64,"spec":null,"state":null,"usedTier":generated["tier"],"attempts":generated["attempts"].take(),"notes":generated["notes"].take(),"turnPrompt":prompt});
    result["spec"] = session["spec"].take();
    result["state"] = session["state"].take();
    drop(session);
    Json(result).into_response()
}
pub async fn action(
    State(app): State<AppState>,
    headers: HeaderMap,
    raw: axum::body::Bytes,
) -> Response {
    let value = serde_json::from_slice(&raw).unwrap_or(serde_json::Value::Null);
    drop(raw);
    let owner = match actor(&app, &headers, &value).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let body = match parse("Action", "Invalid action request", value, true) {
        Ok(v) => v,
        Err(e) => return *e,
    };
    let id = body["gameId"].as_str().unwrap();
    let _guard = match games::lock_mutation(&app, id) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let mut session = match session(&app, id, owner.as_deref(), true).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let receipt_owner = session["userId"].as_str().map(str::to_owned);
    let receipt_id = body["action"]["actionId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|action_id| games::action_receipt_id(id, action_id));
    let fingerprint = games::action_fingerprint(&body["action"]);
    if let Some(receipt_id) = &receipt_id {
        match games::replay_action(&app, receipt_id, receipt_owner.as_deref(), &fingerprint).await {
            Ok(Some(response)) => return Json(response).into_response(),
            Ok(None) => {}
            Err(error) => return error.into_response(),
        }
        // Remember compact receipt keys with guest snapshots. Even if a response
        // is evicted, its action can never run twice while that guest game lives.
        if session["appliedActionIds"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|v| v == receipt_id))
        {
            return fail(
                StatusCode::CONFLICT,
                "BAD_REQUEST",
                "This action was already applied; reload the game",
                None,
            );
        }
        if receipt_owner.is_none()
            && session["appliedActionIds"]
                .as_array()
                .is_some_and(|ids| ids.len() >= 4096)
        {
            return crate::error::ApiError::busy().into_response();
        }
    }
    let prior = session["state"].take();
    let mut applied = crate::runtime::apply(&prior, &body["action"]);
    session["state"] = applied["state"].take();
    games::push_undo(&mut session, prior);
    let state = session["state"].take();
    let spec = &session["spec"];
    let tier = session["usedTier"].clone();
    let outcome = applied["outcome"].take();
    let frame = state["trace"].as_array().and_then(|t| t.last());
    let prompt = crate::guidance::derive_turn_prompt(&state, spec);
    let feedback = crate::guidance::derive_feedback(&state, &outcome, frame, spec);
    let mut result = json!({"gameId":id,"state":null,"outcome":outcome,"usedTier":tier,"turnPrompt":prompt,"feedback":feedback});
    if state["phase"] != "playing" {
        result["debrief"] = crate::debrief::build(spec, &state)
    }
    result["state"] = state;
    #[derive(serde::Serialize)]
    struct ReceiptDocument<'a> {
        fingerprint: &'a str,
        response: &'a serde_json::Value,
    }
    if receipt_owner.is_none() {
        if let Some(id) = &receipt_id {
            if !session["appliedActionIds"].is_array() {
                session["appliedActionIds"] = json!([]);
            }
            session["appliedActionIds"]
                .as_array_mut()
                .unwrap()
                .push(json!(id));
        }
    }
    let receipt = receipt_id.map(|id| games::ActionReceipt {
        id,
        payload: serde_json::to_vec(&ReceiptDocument {
            fingerprint: &fingerprint,
            response: &result,
        })
        .unwrap()
        .into(),
    });
    // Move the board back for atomic persistence; avoid cloning board/history payloads.
    session["state"] = result["state"].take();
    if let Err(error) = games::save_with_receipt(&app, &mut session, receipt).await {
        return error.into_response();
    }
    result["state"] = session["state"].take();
    Json(result).into_response()
}
pub async fn undo(
    State(app): State<AppState>,
    headers: HeaderMap,
    raw: axum::body::Bytes,
) -> Response {
    let value = serde_json::from_slice(&raw).unwrap_or(serde_json::Value::Null);
    drop(raw);
    let owner = match actor(&app, &headers, &value).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let body = match parse("Undo", "Invalid undo request", value, false) {
        Ok(v) => v,
        Err(e) => return *e,
    };
    let id = body["gameId"].as_str().unwrap();
    let _guard = match games::lock_mutation(&app, id) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let mut session = match session(&app, id, owner.as_deref(), true).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let prior = session["undo"].as_array_mut().unwrap().pop();
    let undone = prior.is_some();
    if let Some(prior) = prior {
        session["state"] = crate::runtime::rewind(&session["state"], &prior);
        if let Err(e) = games::save_in_place(&app, &mut session).await {
            return e.into_response();
        }
    }
    let mut result = json!({"gameId":id,"state":null,"undone":undone});
    result["state"] = session["state"].take();
    drop(session);
    Json(result).into_response()
}
pub async fn hint(
    State(app): State<AppState>,
    headers: HeaderMap,
    raw: axum::body::Bytes,
) -> Response {
    let value = serde_json::from_slice(&raw).unwrap_or(serde_json::Value::Null);
    drop(raw);
    let owner = match actor(&app, &headers, &value).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let body = match parse("Hint", "Invalid hint request", value, false) {
        Ok(v) => v,
        Err(e) => return *e,
    };
    let id = body["gameId"].as_str().unwrap();
    let _guard = match games::lock_mutation(&app, id) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let mut session = match session(&app, id, owner.as_deref(), true).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let used = session["state"]["progress"]["hintsUsed"].as_f64().unwrap();
    let last = session["state"]["trace"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|f| f["correct"] == false)
        .and_then(|f| f["dsaOp"].as_str());
    let pool = session["spec"]["narration"]["hintPool"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    let chosen = crate::decisions::hint(&pool, used, last);
    let preferred = crate::compat::number(chosen["choice"].as_str().unwrap_or(""));
    let preferred = (preferred.is_finite() && preferred >= 0.0 && preferred.fract() == 0.0)
        .then_some(preferred as usize);
    let next = crate::hints::next(&session["state"], &session["spec"], preferred);
    session["state"]["progress"]["hintsUsed"] = json!(used as u64 + 1);
    if let Err(e) = games::save_in_place(&app, &mut session).await {
        return e.into_response();
    }
    let mut result =
        json!({"hint":next["hint"],"source":next["source"],"confidence":chosen["confidence"]});
    if let Some(screened) = next.get("screened") {
        result["screened"] = json!({"id":screened["id"],"reason":screened["reason"]})
    }
    Json(result).into_response()
}
