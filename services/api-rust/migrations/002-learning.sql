CREATE TABLE IF NOT EXISTS practice_runs (game_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, record_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, reflection_json TEXT);
    CREATE INDEX IF NOT EXISTS idx_practice_user ON practice_runs(user_id);
    CREATE TABLE IF NOT EXISTS learning_threads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_learning_user ON learning_threads(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS learning_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES learning_threads(id) ON DELETE CASCADE, request_id TEXT NOT NULL, data_json TEXT NOT NULL, UNIQUE(thread_id, request_id, id));
    CREATE TABLE IF NOT EXISTS learning_actions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, response_json TEXT, response_status INTEGER);
    CREATE TABLE IF NOT EXISTS study_plans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id, request_id));
