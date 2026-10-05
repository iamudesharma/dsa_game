use std::{env, path::PathBuf};

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub db_path: PathBuf,
    pub workers: usize,
    pub admitted: usize,
    pub game_operations: usize,
    pub ai: usize,
    pub passwords: usize,
    pub sqlite_cache_kib: usize,
    pub cache_bytes: usize,
    pub body_bytes: usize,
    pub json_tokens: usize,
    pub provider_bytes: usize,
    pub sse_bytes: usize,
    pub db_queue: usize,
    pub rate_entries: usize,
}

fn number(name: &str, default: usize, max: usize) -> Result<usize, String> {
    match env::var(name) {
        Err(env::VarError::NotPresent) => Ok(default),
        Ok(value) => value
            .parse::<usize>()
            .ok()
            .filter(|n| *n > 0 && *n <= max)
            .ok_or_else(|| format!("{name} must be between 1 and {max}")),
        Err(e) => Err(format!("{name}: {e}")),
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            host: env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            port: number("PORT", 8787, 65535)? as u16,
            db_path: env::var("DSA_DB_PATH")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "run/dsa.db".into())
                .into(),
            workers: number("DSA_RUNTIME_WORKERS", 2, 32)?,
            admitted: number("DSA_MAX_REQUESTS", 32, 1024)?,
            game_operations: number("DSA_MAX_GAME_OPERATIONS", 4, 32)?,
            ai: number("DSA_MAX_AI_REQUESTS", 2, 32)?,
            passwords: number("DSA_MAX_PASSWORD_OPERATIONS", 1, 4)?,
            sqlite_cache_kib: number("DSA_SQLITE_CACHE_KIB", 8192, 65536)?,
            cache_bytes: number("DSA_CACHE_BYTES", 32 * 1024 * 1024, 128 * 1024 * 1024)?,
            body_bytes: number("DSA_BODY_BYTES", 1024 * 1024, 8 * 1024 * 1024)?,
            json_tokens: number("DSA_JSON_TOKENS", 4096, 65536)?,
            provider_bytes: number("DSA_PROVIDER_BYTES", 2 * 1024 * 1024, 8 * 1024 * 1024)?,
            sse_bytes: number("DSA_SSE_BYTES", 64 * 1024, 1024 * 1024)?,
            db_queue: number("DSA_DB_QUEUE", 32, 1024)?,
            rate_entries: number("DSA_RATE_ENTRIES", 4096, 65536)?,
        })
    }
}
