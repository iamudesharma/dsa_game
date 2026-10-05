CREATE TABLE IF NOT EXISTS learning_actions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, response_json TEXT, response_status INTEGER);
