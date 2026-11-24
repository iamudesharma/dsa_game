use dsa_api::{coach_store as store, config::Config, error::ApiError, AppState};
use serde_json::json;
#[tokio::test]
async fn owned_conversation_recovery_isolation_and_delete_preserve_game() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("coach.sqlite");
    let app = AppState::new(config.clone()).unwrap();
    app.db
        .call(|db| {
            for user in ["alice", "bob"] {
                db.execute(
                    "INSERT INTO users VALUES(?,?,?,1,1)",
                    rusqlite::params![user, format!("{user}@example.com"), "legacy"],
                )
                .map_err(ApiError::internal)?;
            }
            Ok(())
        })
        .await
        .unwrap();
    let mut record = store::new("owned-game", "binary-search", Some("alice"));
    let id = record["id"].as_str().unwrap().to_owned();
    for i in 0..205 {
        store::append(
            &mut record,
            json!({"id":format!("turn-{i}"),"role":if i%2==0{"learner"}else{"coach"},"text":"Visible board question","at":i,"approxTokens":3,"snapshot":{"targetValue":51,"board":[]}}),
        );
    }
    for i in 0..20 {
        store::remember(&mut record, &format!("hint-{i}"));
    }
    record["summary"] = json!("An earlier exchange");
    store::save(&app, &record).await.unwrap();
    assert_eq!(record["turns"].as_array().unwrap().len(), 200);
    assert_eq!(record["givenHints"].as_array().unwrap().len(), 12);
    assert_eq!(record["spentTokens"], 615);
    assert!(store::load(&app, &id, None).await.unwrap().is_none());
    assert!(store::load(&app, &id, Some("bob")).await.unwrap().is_none());
    let restarted = AppState::new(config).unwrap();
    let restored = store::load(&restarted, &id, Some("alice"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(store::public(&restored), store::public(&record));
    record["userId"] = json!("bob");
    assert!(store::save(&restarted, &record).await.is_err());
    assert!(!store::delete(&restarted, &id, Some("bob")).await.unwrap());
    assert!(store::delete(&restarted, &id, Some("alice")).await.unwrap());
    assert!(store::load(&restarted, &id, Some("alice"))
        .await
        .unwrap()
        .is_none());
}
#[tokio::test]
async fn guest_conversation_expires_with_game_without_durable_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("guest.sqlite");
    let app = AppState::new(config).unwrap();
    let state = dsa_api::runtime::init("binary-search", 7.0, "easy").unwrap();
    let problem = &dsa_api::reference()["problems"][0];
    let spec = dsa_api::template::build(problem, &state["instance"], 7.0, "easy", None).unwrap();
    let game = json!({"gameId":"guest-game","problemId":"binary-search","seed":7,"difficulty":"easy","state":state,"spec":spec,"undo":[],"usedTier":"template","createdAt":1,"lastAccessedAt":1});
    dsa_api::games::save(&app, &game).await.unwrap();
    let record = store::new("guest-game", "binary-search", None);
    let id = record["id"].as_str().unwrap();
    store::save(&app, &record).await.unwrap();
    assert!(store::load(&app, id, None).await.unwrap().is_some());
    app.cache.lock().unwrap().discard("game:guest-game");
    assert!(store::load(&app, id, None).await.unwrap().is_none());
    let count = app
        .db
        .call(|db| {
            db.query_row("SELECT count(*) FROM coach_history", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(ApiError::internal)
        })
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn legacy_node_coach_records_restore_without_format_changes() {
    let fixtures: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("fixtures/coach-store.json")).unwrap();
    assert_eq!(fixtures.len(), 45);
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("node-coach.sqlite");
    let app = AppState::new(config).unwrap();
    let rows = fixtures.clone();
    app.db
        .call(move |db| {
            db.execute(
                "INSERT INTO users VALUES('alice','alice@example.com','legacy',1,1)",
                [],
            )
            .map_err(ApiError::internal)?;
            for c in rows {
                let r = &c["record"];
                db.execute(
                    "INSERT INTO coach_history VALUES(?,'alice',?,?)",
                    rusqlite::params![
                        r["id"].as_str().unwrap(),
                        r["gameId"].as_str().unwrap(),
                        r.to_string()
                    ],
                )
                .map_err(ApiError::internal)?;
            }
            Ok(())
        })
        .await
        .unwrap();
    for c in fixtures {
        let id = c["record"]["id"].as_str().unwrap();
        let restored = store::load(&app, id, Some("alice")).await.unwrap().unwrap();
        assert_eq!(store::public(&restored), c["expected"]);
    }
}

#[tokio::test]
async fn owned_conversation_lists_page_in_sql_without_loading_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("paged.sqlite");
    let app = AppState::new(config).unwrap();
    app.db.call(|db|{db.execute("INSERT INTO users VALUES('alice','alice@example.com','hash',1,1)",[]).map_err(ApiError::internal)?;for i in 0..5{let r=json!({"id":format!("thread-{i}"),"gameId":"game-a","problemId":"binary-search","userId":"alice","turns":[{"id":"turn-a","role":"learner","text":"  A question\tabout the window  ","snapshot":{"ignored":"x".repeat(100_000)}}],"updatedAt":i});db.execute("INSERT INTO coach_history VALUES(?,'alice','game-a',?)",rusqlite::params![format!("thread-{i}"),r.to_string()]).map_err(ApiError::internal)?;}Ok(())}).await.unwrap();
    let page = store::list(&app, "game-a", Some("alice"), 1, 2)
        .await
        .unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(page[0]["id"], "thread-3");
    assert_eq!(page[1]["id"], "thread-2");
    assert_eq!(page[0]["title"], "A question about the window");
    assert_eq!(page[0]["turnCount"], 1);
    assert_eq!(app.cache.lock().unwrap().bytes(), 0);
    assert!(store::list(&app, "game-a", Some("bob"), 0, 2)
        .await
        .unwrap()
        .is_empty());
}

#[test]
fn metadata_cache_preserves_insertion_order_when_records_are_updated() {
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    let mut cache = dsa_api::cache::Cache::new(1024);
    let now = Instant::now();
    let ttl = Duration::from_secs(60);
    for text in ["b", "a", "c"] {
        assert!(cache.put(
            format!("coach:{text}"),
            Arc::from(text.as_bytes()),
            ttl,
            now
        ));
    }
    assert!(cache.put("coach:a".into(), Arc::from(&b"updated-a"[..]), ttl, now));
    let values = cache
        .payloads_prefix("coach:", now)
        .into_iter()
        .map(|b| String::from_utf8(b.to_vec()).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(values, ["b", "updated-a", "c"]);
}
