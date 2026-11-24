use crate::error::ApiError;
use rusqlite::Connection;
use std::{
    path::Path,
    sync::{mpsc, Arc},
    time::Duration,
};
use tokio::sync::oneshot;

type Job = Box<dyn FnOnce(&mut Connection) + Send>;
#[derive(Clone)]
pub struct Db {
    sender: Arc<mpsc::SyncSender<Job>>,
}

pub const MIGRATIONS: &[(&str, &str)] = &[
    ("001-core", include_str!("../migrations/001-core.sql")),
    (
        "002-learning",
        include_str!("../migrations/002-learning.sql"),
    ),
    (
        "004-coach-history",
        include_str!("../migrations/004-coach-history.sql"),
    ),
    (
        "003-learning-actions",
        include_str!("../migrations/003-learning-actions.sql"),
    ),
];

impl Db {
    pub fn open(path: &Path, queue: usize) -> Result<Self, Box<dyn std::error::Error>> {
        Self::open_with_cache(path, queue, 8192)
    }
    pub fn open_with_cache(
        path: &Path,
        queue: usize,
        cache_kib: usize,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        if !(1..=65536).contains(&cache_kib) {
            return Err("SQLite cache must be 1..=65536 KiB".into());
        }

        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(2))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;
            CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);")?;
        connection.pragma_update(None, "cache_size", -(cache_kib as i64))?;
        for (id, sql) in MIGRATIONS {
            let exists: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE id=?)",
                [id],
                |r| r.get(0),
            )?;
            if !exists {
                let tx = connection.transaction()?;
                tx.execute_batch(sql)?;
                tx.execute(
                    "INSERT INTO schema_migrations(id, applied_at) VALUES(?,?)",
                    rusqlite::params![id, crate::now_ms()],
                )?;
                tx.commit()?;
            }
        }
        let (sender, receiver) = mpsc::sync_channel::<Job>(queue);
        #[cfg(target_os = "linux")]
        let cache_path = path.to_owned();
        std::thread::Builder::new()
            .name("sqlite".into())
            .spawn(move || {
                #[cfg(target_os = "linux")]
                let mut last_release = std::time::Instant::now();
                for job in receiver {
                    job(&mut connection);
                    #[cfg(target_os = "linux")]
                    if last_release.elapsed() >= Duration::from_secs(1) {
                        if let Err(error) = release_file_cache(&mut connection, &cache_path) {
                            eprintln!("[dsa-api] SQLite file-cache release: {error}");
                        }
                        last_release = std::time::Instant::now();
                    }
                }
            })?;
        Ok(Self {
            sender: Arc::new(sender),
        })
    }

    pub async fn call<T, F>(&self, f: F) -> Result<T, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, ApiError> + Send + 'static,
    {
        let (sender, receiver) = oneshot::channel();
        self.sender
            .try_send(Box::new(move |db| {
                // Skip queued work when its request was cancelled before execution.
                if !sender.is_closed() {
                    let _ = sender.send(f(db));
                }
            }))
            .map_err(|e| match e {
                mpsc::TrySendError::Full(_) => ApiError::busy(),
                mpsc::TrySendError::Disconnected(_) => ApiError::internal("SQLite worker stopped"),
            })?;
        receiver.await.map_err(ApiError::internal)?
    }

    pub async fn backup(&self, path: std::path::PathBuf) -> Result<(), ApiError> {
        self.call(move |db| db.backup("main", path, None).map_err(ApiError::internal))
            .await
    }
}

/// SQLite's page-cache limit does not bound Linux's charged filesystem cache.
/// Run on the dedicated worker, after the current statement/transaction ended.
/// Checkpoint and sync before advising clean pages away; never discard user data.
#[cfg(target_os = "linux")]
fn release_file_cache(
    connection: &mut Connection,
    path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::fd::AsRawFd;
    connection.execute_batch("PRAGMA wal_checkpoint(PASSIVE);")?;
    let mut wal = path.as_os_str().to_os_string();
    wal.push("-wal");
    for file_path in [path.to_path_buf(), wal.into()] {
        let file = match std::fs::File::open(file_path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        // DONTNEED is advisory and ignores dirty pages. Flush first so the
        // kernel can release them without relying on container-limit reclaim.
        file.sync_data()?;
        // SAFETY: the descriptor belongs to a live File; offset/length zero
        // select the entire file. No pointers or ownership cross the FFI call.
        let result =
            unsafe { libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_DONTNEED) };
        if result != 0 {
            return Err(std::io::Error::from_raw_os_error(result).into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    #[test]
    fn file_cache_release_preserves_wal_data_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.sqlite");
        let mut db = Connection::open(&path).unwrap();
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE records(payload TEXT);")
            .unwrap();
        let payload = "durable payload ".repeat(100_000);
        db.execute("INSERT INTO records VALUES(?)", [&payload])
            .unwrap();
        release_file_cache(&mut db, &path).unwrap();
        let backup = dir.path().join("backup.sqlite");
        db.backup("main", &backup, None).unwrap();
        drop(db);
        for stored in [path, backup] {
            let reopened = Connection::open(stored).unwrap();
            let actual: String = reopened
                .query_row("SELECT payload FROM records", [], |row| row.get(0))
                .unwrap();
            assert_eq!(actual, payload);
            assert_eq!(
                reopened
                    .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                    .unwrap(),
                "ok"
            );
        }
    }
    #[tokio::test]
    async fn migration_restart_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        let db = Db::open(&path, 2).unwrap();
        db.call(|c| {
            c.execute(
                "INSERT INTO users VALUES('u','old@example.com','hash',1,1)",
                [],
            )
            .map_err(ApiError::internal)?;
            Ok(())
        })
        .await
        .unwrap();
        let backup = dir.path().join("backup.sqlite");
        db.backup(backup.clone()).await.unwrap();
        for file in [path, backup] {
            let reopened = Db::open(&file, 2).unwrap();
            let count: i64 = reopened
                .call(|c| {
                    c.query_row("SELECT count(*) FROM schema_migrations", [], |r| r.get(0))
                        .map_err(ApiError::internal)
                })
                .await
                .unwrap();
            assert_eq!(count, 4);
            let email: String = reopened
                .call(|c| {
                    c.query_row("SELECT email FROM users WHERE id='u'", [], |r| r.get(0))
                        .map_err(ApiError::internal)
                })
                .await
                .unwrap();
            assert_eq!(email, "old@example.com");
        }
    }
}
