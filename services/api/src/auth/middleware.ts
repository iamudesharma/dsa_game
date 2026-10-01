/**
 * Auth middleware: resolves the caller from cookie or `Authorization: Bearer`.
 *
 * Cookie first (httpOnly, best when the web app and API share a host), bearer
 * second (robust when the page is on `localhost` and the API on `127.0.0.1`,
 * which browsers treat as different hosts). Either yields the same user.
 */

import { getDb, newId, nowMs } from '../db/index.js'
import { lookupSession, tokenFromAuthHeader, tokenFromCookieHeader } from './session.js'

export interface AuthUser {
  id: string
  email: string
}

export function getRequestIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip')?.trim() ||
    'unknown'
  )
}

export function resolveUser(c: {
  req: { header: (n: string) => string | undefined }
}): (AuthUser & { sessionId: string }) | null {
  const cookie = tokenFromCookieHeader(c.req.header('cookie'))
  const bearer = tokenFromAuthHeader(c.req.header('authorization'))
  const row = (cookie && lookupSession(cookie)) || (bearer && lookupSession(bearer)) || null
  if (!row) return null
  return { id: row.userId, email: row.email, sessionId: row.id }
}

export function createUser(email: string, passwordHash: string): AuthUser {
  const db = getDb()
  const id = newId('user')
  const now = nowMs()
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    email,
    passwordHash,
    now,
    now,
  )
  return { id, email }
}

export function findUserByEmail(email: string): (AuthUser & { passwordHash: string }) | null {
  const db = getDb()
  const row = db
    .prepare('SELECT id, email, password_hash AS passwordHash FROM users WHERE email = ?')
    .get(email) as (AuthUser & { passwordHash: string }) | null | undefined
  return row ?? null
}

/** Test hook: wipe users (cascades to sessions/resumes/targets/kits/progress). */
export function resetUsers(): void {
  const db = getDb()
  db.exec('DELETE FROM users; DELETE FROM sessions;')
}
