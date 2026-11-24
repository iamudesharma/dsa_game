#[test]
fn native_backup_command_preserves_wal_data_and_refuses_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.sqlite");
    let target = dir.path().join("rollback.sqlite");
    let db = rusqlite::Connection::open(&source).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('durable legacy data');").unwrap();
    let backup = || {
        std::process::Command::new(env!("CARGO_BIN_EXE_dsa-api"))
            .arg("--backup")
            .arg(&source)
            .arg(&target)
            .output()
            .unwrap()
    };
    assert!(backup().status.success());
    let restored = rusqlite::Connection::open(&target).unwrap();
    assert_eq!(
        restored
            .query_row("SELECT value FROM proof", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "durable legacy data"
    );
    assert_eq!(
        restored
            .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert!(!backup().status.success());
    assert_eq!(
        restored
            .query_row("SELECT count(*) FROM proof", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}
