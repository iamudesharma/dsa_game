use crate::{error::ApiError, now_ms, AppState};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use scrypt::{scrypt, Params};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    email: String,
    password: String,
}

pub struct RateLimits {
    entries: HashMap<String, (u32, Instant)>,
    cap: usize,
}
impl RateLimits {
    pub fn new(cap: usize) -> Self {
        Self {
            entries: HashMap::new(),
            cap,
        }
    }
    pub fn expire(&mut self, now: Instant) {
        self.entries.retain(|_, (_, until)| *until > now);
    }
    pub fn check(&mut self, key: String, limit: u32, now: Instant) -> bool {
        self.check_window(key, limit, Duration::from_secs(600), now)
    }
    pub fn check_window(
        &mut self,
        key: String,
        limit: u32,
        window: Duration,
        now: Instant,
    ) -> bool {
        self.expire(now);
        if let Some((count, _)) = self.entries.get_mut(&key) {
            if *count >= limit {
                return false;
            }
            *count += 1;
            return true;
        }
        // Fail closed rather than evicting an attacker's already-limited bucket.
        if self.entries.len() >= self.cap {
            return false;
        }
        self.entries.insert(key, (1, now + window));
        true
    }
}

pub fn hash_password(password: &str) -> Result<String, ApiError> {
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    let mut key = [0u8; 64];
    scrypt(
        password.as_bytes(),
        &salt,
        &Params::new(14, 8, 1, 64).map_err(ApiError::internal)?,
        &mut key,
    )
    .map_err(ApiError::internal)?;
    Ok(format!(
        "scrypt$16384$8$1${}${}",
        STANDARD.encode(salt),
        STANDARD.encode(key)
    ))
}
pub fn verify_password(password: &str, stored: &str) -> bool {
    let parts: Vec<_> = stored.split('$').collect();
    if parts.len() != 6 || parts[0] != "scrypt" {
        return false;
    }
    // Existing accounts all use these exact parameters. Reject malicious DB
    // parameters before allocating (scrypt memory grows exponentially).
    if parts[1..4] != ["16384", "8", "1"] {
        return false;
    }
    let (Ok(salt), Ok(expected)) = (STANDARD.decode(parts[4]), STANDARD.decode(parts[5])) else {
        return false;
    };
    if salt.len() != 16 || expected.len() != 64 {
        return false;
    }
    let mut actual = [0u8; 64];
    let Ok(params) = Params::new(14, 8, 1, 64) else {
        return false;
    };
    scrypt(password.as_bytes(), &salt, &params, &mut actual).is_ok()
        && bool::from(actual.ct_eq(expected.as_slice()))
}
pub fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}
fn random_id(prefix: &str) -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!("{prefix}_{}", URL_SAFE_NO_PAD.encode(bytes))
}
fn header<'a>(headers: &'a HeaderMap, key: &str) -> Option<&'a str> {
    headers.get(key)?.to_str().ok()
}
fn tokens(headers: &HeaderMap) -> (Option<String>, Option<String>) {
    let cookie = header(headers, "cookie").and_then(|h| {
        h.split(';').find_map(|part| {
            let (key, value) = part.split_once('=')?;
            (key.trim() == "dsa_session").then(|| value.trim().to_owned())
        })
    });
    let bearer = header(headers, "authorization").and_then(|h| {
        let (scheme, token) = h.split_once(' ')?;
        scheme
            .eq_ignore_ascii_case("bearer")
            .then(|| token.trim().to_owned())
    });
    (cookie, bearer)
}

/// Guests do not enqueue a SQLite lookup; invalid or expired credentials remain guest scope.
pub async fn optional_owner(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Option<String>, ApiError> {
    let (cookie, bearer) = tokens(headers);
    if cookie.is_none() && bearer.is_none() {
        return Ok(None);
    }
    match resolve(state, headers).await {
        Ok((owner, _)) => Ok(Some(owner)),
        Err(ApiError(StatusCode::UNAUTHORIZED, _, _)) => Ok(None),
        Err(error) => Err(error),
    }
}

pub async fn resolve(state: &AppState, headers: &HeaderMap) -> Result<(String, String), ApiError> {
    let (cookie, bearer) = tokens(headers);
    state.db.call(move |db| {
        for token in [cookie, bearer].into_iter().flatten() {
            if token.len() < 16 { continue; }
            let found: Option<(String, String, String, i64)> = db.query_row(
                "SELECT u.id,u.email,s.id,s.expires_at FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=?",
                [token_hash(&token)], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))
                .optional().map_err(ApiError::internal)?;
            if let Some((id, email, session, expiry)) = found {
                if expiry <= now_ms() {
                    db.execute("DELETE FROM sessions WHERE id=?", [session]).map_err(ApiError::internal)?;
                    continue;
                }
                db.execute("UPDATE sessions SET last_seen_at=? WHERE id=?", params![now_ms(),session]).map_err(ApiError::internal)?;
                return Ok((id, email));
            }
        }
        Err(ApiError::unauthorized())
    }).await
}

pub async fn signup(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Credentials>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    authenticate(state, headers, body, true).await
}
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Credentials>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    authenticate(state, headers, body, false).await
}
async fn authenticate(
    state: AppState,
    headers: HeaderMap,
    body: Result<Json<Credentials>, axum::extract::rejection::JsonRejection>,
    signup: bool,
) -> Result<Response, ApiError> {
    let Json(input) = body.map_err(|e| {
        ApiError(
            e.status(),
            "BAD_REQUEST",
            if signup {
                "Invalid signup request"
            } else {
                "Invalid login request"
            }
            .into(),
        )
    })?;
    // JS validation measures UTF-16 code units.
    let email_len = input.email.encode_utf16().count();
    let password_len = input.password.encode_utf16().count();
    if !(3..=160).contains(&email_len) || !(8..=200).contains(&password_len) {
        return Err(ApiError::bad(if signup {
            "Invalid signup request"
        } else {
            "Invalid login request"
        }));
    }
    let email = input.email.trim().to_lowercase();
    if signup && !valid_email(&email) {
        return Err(ApiError::bad("Enter a valid email address."));
    }
    let ip = header(&headers, "x-forwarded-for")
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .or_else(|| header(&headers, "x-real-ip"))
        .unwrap_or("unknown");
    {
        let mut rates = state.rates.lock().map_err(ApiError::internal)?;
        let now = Instant::now();
        let a = rates.check(format!("auth:email:{email}"), 10, now);
        let b = rates.check(
            format!("auth:ip:{}", ip.chars().take(200).collect::<String>()),
            30,
            now,
        );
        if !a || !b {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "Too many attempts. Try again in a few minutes.".into(),
            ));
        }
    }
    let lookup = email.clone();
    let found: Option<(String, String)> = state
        .db
        .call(move |db| {
            db.query_row(
                "SELECT id,password_hash FROM users WHERE email=?",
                [lookup],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(ApiError::internal)
        })
        .await?;
    if signup && found.is_some() {
        return Err(email_taken());
    }
    let permit = state
        .passwords
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::busy())?;
    let password = input.password;
    let existing_hash = found.as_ref().map(|(_, hash)| hash.clone());
    // The owned permit stays on the blocking worker even if its HTTP task drops.
    let new_hash = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if signup {
            hash_password(&password).map(Some)
        } else if let Some(hash) = existing_hash {
            if verify_password(&password, &hash) {
                Ok(None)
            } else {
                Err(invalid_credentials())
            }
        } else {
            hash_password(&password)?;
            Err(invalid_credentials())
        }
    })
    .await
    .map_err(ApiError::internal)??;
    let user_id = found.map(|(id, _)| id).unwrap_or_else(|| random_id("user"));
    let response_email = email.clone();
    let response_id = user_id.clone();
    let mut raw = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    let token = URL_SAFE_NO_PAD.encode(raw);
    let hash = token_hash(&token);
    let expiry = now_ms() + 30 * 24 * 60 * 60 * 1000;
    let agent: String = header(&headers, "user-agent")
        .unwrap_or("")
        .chars()
        .take(300)
        .collect();
    state.db.call(move |db| {
        let tx = db.transaction().map_err(ApiError::internal)?;
        if let Some(password_hash) = new_hash {
            tx.execute("INSERT INTO users VALUES(?,?,?,?,?)", params![user_id,email,password_hash,now_ms(),now_ms()]).map_err(|e| {
                if matches!(e, rusqlite::Error::SqliteFailure(ref err, _) if err.code == rusqlite::ErrorCode::ConstraintViolation) { email_taken() } else { ApiError::internal(e) }
            })?;
        }
        tx.execute("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",params![random_id("sess"),user_id,hash,now_ms(),expiry,now_ms(),agent]).map_err(ApiError::internal)?;
        tx.commit().map_err(ApiError::internal)
    }).await?;
    let mut response = Json(
        json!({"user":{"id":response_id,"email":response_email},"token":token,"expiresAt":expiry}),
    )
    .into_response();
    response.headers_mut().insert(
        "set-cookie",
        format!(
            "dsa_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
            (expiry - now_ms()).max(1000) / 1000
        )
        .parse()
        .map_err(ApiError::internal)?,
    );
    Ok(response)
}
fn valid_email(email: &str) -> bool {
    if email.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    let Some((host, tld)) = domain.rsplit_once('.') else {
        return false;
    };
    !domain.contains('@')
        && (1..=120).contains(&local.len())
        && (1..=120).contains(&host.len())
        && (2..=24).contains(&tld.len())
}
fn email_taken() -> ApiError {
    ApiError(
        StatusCode::CONFLICT,
        "EMAIL_TAKEN",
        "Could not create that account. Try signing in instead.".into(),
    )
}
fn invalid_credentials() -> ApiError {
    ApiError(
        StatusCode::UNAUTHORIZED,
        "INVALID_CREDENTIALS",
        "Email or password did not match.".into(),
    )
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let (cookie, bearer) = tokens(&headers);
    if let Some(token) = cookie.or(bearer) {
        state
            .db
            .call(move |db| {
                db.execute(
                    "DELETE FROM sessions WHERE token_hash=?",
                    [token_hash(&token)],
                )
                .map_err(ApiError::internal)?;
                Ok(())
            })
            .await?;
    }
    let mut response = Json(json!({"ok":true})).into_response();
    response.headers_mut().insert(
        "set-cookie",
        "dsa_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
            .parse()
            .unwrap(),
    );
    Ok(response)
}

pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (id, email) = resolve(&state, &headers).await?;
    state.db.call(move |db| {
        let resume = crate::account::read_profile(db, &id, "resume")?;
        let target = crate::account::read_profile(db, &id, "target")?;
        let progress = crate::account::read_progress(db, &id)?;
        Ok(Json(json!({"user":{"id":id,"email":email},"resume":resume,"target":target,"progress":progress})))
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn passwords_and_parameter_bomb() {
        let hash = hash_password("password123").unwrap();
        assert!(verify_password("password123", &hash));
        assert!(!verify_password("badpassword", &hash));
        assert!(!verify_password(
            "password123",
            &hash.replace("16384", "1073741824")
        ));
        assert_eq!(
            token_hash("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
    #[test]
    fn rate_buckets_are_bounded_and_expire() {
        let mut limits = RateLimits::new(1);
        let now = Instant::now();
        assert!(limits.check("a".into(), 1, now));
        assert!(!limits.check("a".into(), 1, now));
        assert!(!limits.check("b".into(), 1, now));
        assert!(limits.check("b".into(), 1, now + Duration::from_secs(600)));
    }
}
