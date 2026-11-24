use dsa_api::{config::Config, error::ApiError, games, AppState};
use serde_json::{json, Value};
fn snapshot(owner: Option<&str>) -> Value {
    let state = dsa_api::runtime::init("binary-search", 7.0, "easy").unwrap();
    let problem = &dsa_api::reference()["problems"][0];
    let spec = dsa_api::template::build(problem, &state["instance"], 7.0, "easy", None).unwrap();
    let mut s = json!({"gameId":"game-a","problemId":"binary-search","seed":7,"difficulty":"easy","state":state,"spec":spec,"undo":[],"usedTier":"template","createdAt":1,"lastAccessedAt":1});
    if let Some(owner) = owner {
        s["userId"] = json!(owner);
    }
    s
}
#[tokio::test]
async fn owned_games_survive_eviction_restart_and_keep_reflections_and_completion_time() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("db");
    let app = AppState::new(config.clone()).unwrap();
    app.db
        .call(|db| {
            for id in ["alice", "bob"] {
                db.execute(
                    "INSERT INTO users VALUES(?,?,?,1,1)",
                    rusqlite::params![id, format!("{id}@example.com"), "hash"],
                )
                .map_err(ApiError::internal)?;
            }
            Ok(())
        })
        .await
        .unwrap();
    let mut s = snapshot(Some("alice"));
    games::save(&app, &s).await.unwrap();
    assert!(app.cache.lock().unwrap().bytes() > 0);
    assert!(games::load(&app, "game-a", Some("bob"))
        .await
        .unwrap()
        .is_none());
    assert!(games::load(&app, "game-a", None).await.unwrap().is_none());
    *app.cache.lock().unwrap() = dsa_api::cache::Cache::new(1);
    assert!(games::load(&app, "game-a", Some("alice"))
        .await
        .unwrap()
        .is_some());
    s["state"]["phase"] = json!("won");
    games::save(&app, &s).await.unwrap();
    let completed=app.db.call(|db|{db.execute("UPDATE practice_runs SET reflection_json='{}' WHERE game_id='game-a'",[]).map_err(ApiError::internal)?;db.query_row("SELECT json_extract(record_json,'$.completedAt') FROM practice_runs WHERE game_id='game-a'",[],|r|r.get::<_,i64>(0)).map_err(ApiError::internal)}).await.unwrap();
    games::save(&app, &s).await.unwrap();
    app.db.call(move |db| {let row:(i64,String)=db.query_row("SELECT json_extract(record_json,'$.completedAt'),reflection_json FROM practice_runs WHERE game_id='game-a'",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(ApiError::internal)?;assert_eq!(row,(completed,"{}".into()));Ok(())}).await.unwrap();
    let restarted = AppState::new(config).unwrap();
    let restored = games::load(&restarted, "game-a", Some("alice"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(restored["state"], s["state"]);
    s["userId"] = json!("bob");
    assert!(games::save(&restarted, &s).await.is_err());
}
#[tokio::test]
async fn guests_expire_without_durable_rows_and_undo_keeps_latest_twenty_five() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("db");
    let app = AppState::new(config).unwrap();
    let mut s = snapshot(None);
    games::save(&app, &s).await.unwrap();
    assert!(games::load(&app, "game-a", None).await.unwrap().is_some());
    app.cache
        .lock()
        .unwrap()
        .expire(std::time::Instant::now() + std::time::Duration::from_secs(10801));
    assert!(games::load(&app, "game-a", None).await.unwrap().is_none());
    let count = app
        .db
        .call(|db| {
            db.query_row("SELECT count(*) FROM practice_runs", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(ApiError::internal)
        })
        .await
        .unwrap();
    assert_eq!(count, 0);
    for i in 0..30 {
        games::push_undo(&mut s, json!({"index":i}));
    }
    assert_eq!(s["undo"].as_array().unwrap().len(), 25);
    assert_eq!(s["undo"][0]["index"], 5);
}

#[tokio::test]
async fn legacy_node_snapshots_restore_for_every_problem_and_difficulty() {
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/game-snapshots.json")).unwrap();
    assert_eq!(fixtures.len(), 135);
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("legacy.sqlite");
    let app = AppState::new(config).unwrap();
    let rows = fixtures.clone();
    app.db.call(move |db| {
        db.execute("INSERT INTO users VALUES('alice','alice@example.com','hash',1,1)", []).map_err(ApiError::internal)?;
        for snapshot in rows {
            db.execute("INSERT INTO practice_runs(game_id,user_id,record_json,snapshot_json) VALUES(?,'alice','{}',?)",rusqlite::params![snapshot["gameId"].as_str().unwrap(),snapshot.to_string()]).map_err(ApiError::internal)?;
        }
        Ok(())
    }).await.unwrap();
    for mut expected in fixtures {
        let id = expected["gameId"].as_str().unwrap().to_owned();
        let mut restored = games::load(&app, &id, Some("alice"))
            .await
            .unwrap()
            .unwrap();
        restored.as_object_mut().unwrap().remove("lastAccessedAt");
        expected.as_object_mut().unwrap().remove("lastAccessedAt");
        assert_eq!(restored, expected, "{id}");
    }
    // A malformed durable snapshot is unavailable, and its row is retained.
    app.cache.lock().unwrap().discard("game:binary-search-easy");
    app.db.call(|db| {
        db.execute("UPDATE practice_runs SET snapshot_json=json_set(snapshot_json,'$.state.progress.steps',-1) WHERE game_id='binary-search-easy'",[]).map_err(ApiError::internal)?;
        Ok(())
    }).await.unwrap();
    assert!(games::load(&app, "binary-search-easy", Some("alice"))
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        app.db
            .call(|db| db
                .query_row("SELECT count(*) FROM practice_runs", [], |r| r
                    .get::<_, u64>(0))
                .map_err(ApiError::internal))
            .await
            .unwrap(),
        135
    );
}

#[test]
fn game_mutation_admission_is_bounded_and_released_on_drop() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::from_env().unwrap();
    config.db_path = dir.path().join("admission.sqlite");
    config.admitted = 32;
    config.game_operations = 2;
    let app = AppState::new(config).unwrap();
    let a = games::lock_mutation(&app, "a").unwrap();
    assert!(games::lock_mutation(&app, "a").is_err());
    let b = games::lock_mutation(&app, "b").unwrap();
    let error = games::lock_mutation(&app, "c").err().unwrap();
    let response = axum::response::IntoResponse::into_response(error);
    assert_eq!(response.status(), axum::http::StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()["retry-after"], "1");
    assert_eq!(app.game_mutations.lock().unwrap().len(), 2);
    drop(a);
    let c = games::lock_mutation(&app, "c").unwrap();
    drop(b);
    drop(c);
    assert!(app.game_mutations.lock().unwrap().is_empty());
}
