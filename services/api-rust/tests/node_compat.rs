use dsa_api::{
    auth::{token_hash, verify_password},
    db::{Db, MIGRATIONS},
    error::ApiError,
};

const NODE_HASH: &str = "scrypt$16384$8$1$AAECAwQFBgcICQoLDA0ODw==$5k1k3eQwEKXw/Mb4kZrOQJWXOirTV871RpKEdtBhVyF3R+syJhtjXaeAM0YB4S2SdEO3Bk+dmZYI1s1ubLzwfQ==";

#[test]
fn verifies_node_scrypt_fixture() {
    assert!(verify_password("password123", NODE_HASH));
    assert!(!verify_password("password124", NODE_HASH));
}

#[test]
fn migration_sql_matches_node_source() {
    let source = include_str!("../../api/src/db/index.ts");
    for (id, sql) in MIGRATIONS {
        let marker = format!("id: '{id}',");
        let remainder = source
            .split_once(&marker)
            .expect("migration missing from Node source")
            .1;
        let original = remainder
            .split_once("sql: `")
            .unwrap()
            .1
            .split('`')
            .next()
            .unwrap();
        assert_eq!(sql.trim(), original.trim(), "migration {id} drifted");
    }
}

#[tokio::test]
async fn existing_account_and_token_survive_rust_migrations() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    {
        // Emulate the original database, including Node's migration ledger.
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch(MIGRATIONS[0].1).unwrap();
        db.execute("INSERT INTO schema_migrations VALUES('001-core',1)", [])
            .unwrap();
        db.execute(
            "INSERT INTO users VALUES('old-user','existing@example.com',?,1,1)",
            [NODE_HASH],
        )
        .unwrap();
        db.execute(
            "INSERT INTO sessions VALUES('old-session','old-user',?,1,4102444800000,1,'node')",
            [token_hash("existing-long-session-token")],
        )
        .unwrap();
    }
    let db = Db::open(&path, 2).unwrap();
    let (password, token): (String,String) = db.call(|c| c.query_row("SELECT u.password_hash,s.token_hash FROM users u JOIN sessions s ON u.id=s.user_id", [], |r| Ok((r.get(0)?,r.get(1)?))).map_err(ApiError::internal)).await.unwrap();
    assert!(verify_password("password123", &password));
    assert_eq!(token, token_hash("existing-long-session-token"));
}
