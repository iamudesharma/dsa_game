/**
 * SQLite persistence for accounts, resumes, targets, kits, and progress.
 *
 * Built on `node:sqlite` (no native deps, no external service) so the
 * loopback-only API stays self-contained. One file (`DSA_DB_PATH`, default
 * `run/dsa.db`), WAL mode, idempotent migrations.
 *
 * Resume/target/kit/progress payloads are Zod-validated JSON, not normalized
 * tables: every read loads the whole object and nothing needs relational
 * queries. Users/sessions stay normalized because they are security-critical.
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from './sqlite.js'
import type { SqliteDatabase } from './sqlite.js'

let db: SqliteDatabase | null = null
let dbPath = ''

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '001-core',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        user_agent TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
      CREATE TABLE IF NOT EXISTS resumes (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS targets (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interview_kits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_json TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        used_tier TEXT NOT NULL DEFAULT 'template',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kits_user ON interview_kits(user_id);
      CREATE TABLE IF NOT EXISTS progress (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        completed_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
]

function resolvePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSA_DB_PATH?.trim() || 'run/dsa.db'
}

export function getDbPath(): string {
  return dbPath
}

/** Open (or reuse) the database and run idempotent migrations. */
export function getDb(env: NodeJS.ProcessEnv = process.env): SqliteDatabase {
  const path = resolvePath(env)
  if (db && dbPath === path) return db
  if (db) {
    try {
      db.close()
    } catch {
      // ignore close errors on rotation
    }
    db = null
  }
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const handle = new DatabaseSync(path)
  handle.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  handle.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);')
  for (const m of MIGRATIONS) {
    const exists = handle.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(m.id) as unknown
    if (!exists) {
      handle.exec(m.sql)
      handle.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, Date.now())
    }
  }
  db = handle
  dbPath = path
  return handle
}

/** Test hook: close the shared handle so the next `getDb` reopens. */
export function closeDb(): void {
  if (db) {
    try {
      db.close()
    } catch {
      // ignore
    }
    db = null
    dbPath = ''
  }
}

export function nowMs(): number {
  return Date.now()
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
