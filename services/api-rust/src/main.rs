use dsa_api::{app, config::Config, AppState};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        if args.len() != 3 || args[0] != "--backup" {
            return Err("Usage: dsa-api [--backup SOURCE.sqlite DESTINATION.sqlite]".into());
        }
        let destination = std::path::Path::new(&args[2]);
        // Never silently overwrite a rollback snapshot.
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(destination)?;
        drop(file);
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let source = rusqlite::Connection::open_with_flags(
                &args[1],
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            let mut target = rusqlite::Connection::open(destination)?;
            let backup = rusqlite::backup::Backup::new(&source, &mut target)?;
            backup.run_to_completion(64, std::time::Duration::from_millis(50), None)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(destination);
        }
        result?;
        eprintln!("SQLite backup completed: {}", destination.display());
        return Ok(());
    }
    // Resolve the same root .env regardless of the caller's working directory.
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    dotenvy::from_path(root.join(".env")).ok();
    let mut config = Config::from_env().map_err(std::io::Error::other)?;
    if config.db_path != std::path::Path::new(":memory:") && config.db_path.is_relative() {
        config.db_path = root.join(&config.db_path);
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(config.workers)
        .max_blocking_threads(2)
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let state = AppState::new(config.clone())?;
        let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
        eprintln!(
            "[dsa-api] Rust migration preview listening on {}; migration incomplete",
            listener.local_addr()?
        );
        axum::serve(listener, app(state))
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;
        Ok(())
    })
}
