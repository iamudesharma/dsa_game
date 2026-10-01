/**
 * Session tokens: 32 random bytes on the wire, SHA-256 hash at rest.
 *
 * The raw token is returned once (signup/login) and never stored. Lookup and
 * revocation use the hash, so a database read never yields a usable session.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getDb, newId, nowMs } from '../db/index.js'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const COOKIE_NAME = 'dsa_session'

export interface SessionRow {
  id: string
  userId: string
  tokenHash: string
  createdAt: number
  expiresAt: number
  lastSeenAt: number
  userAgent: string
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createSession(userId: string, userAgent = '', ttlMs = SESSION_TTL_MS): { id: string; token: string; expiresAt: number } {
  const db = getDb()
  const token = mintToken()
  const id = newId('sess')
  const now = nowMs()
  const expiresAt = now + ttlMs
  db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, userId, hashToken(token), now, expiresAt, now, userAgent.slice(0, 300))
  return { id, token, expiresAt }
}

export function lookupSession(token: string): (SessionRow & { email: string }) | null {
  if (!token || token.length < 16) return null
  const db = getDb()
  const hash = hashToken(token)
  const row = db
    .prepare(
      `SELECT s.id AS id, s.user_id AS userId, s.token_hash AS tokenHash,
              s.created_at AS createdAt, s.expires_at AS expiresAt,
              s.last_seen_at AS lastSeenAt, s.user_agent AS userAgent,
              u.email AS email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hash) as (SessionRow & { email: string }) | null | undefined
  if (!row) return null
  // Constant-time compare on the stored hash so a forged token costs the same.
  const a = Buffer.from(row.tokenHash, 'utf8')
  const b = Buffer.from(hash, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (row.expiresAt <= nowMs()) {
    try {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id)
    } catch {
      // expiry cleanup is best-effort
    }
    return null
  }
  try {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowMs(), row.id)
  } catch {
    // last-seen is best-effort
  }
  return row
}

export function revokeSession(token: string): boolean {
  if (!token) return false
  const db = getDb()
  try {
    const res = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    return Number(res.changes) > 0
  } catch {
    return false
  }
}

export function revokeUserSessions(userId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

/** Test hook: wipe sessions (and optionally users). */
export function resetSessions(): void {
  const db = getDb()
  db.exec('DELETE FROM sessions;')
}

export function sessionCookie(token: string, expiresAt: number): string {
  const maxAge = Math.max(1, Math.floor((expiresAt - nowMs()) / 1000))
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function tokenFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === COOKIE_NAME) {
      const v = part.slice(i + 1).trim()
      return v || null
    }
  }
  return null
}

export function tokenFromAuthHeader(header: string | null | undefined): string | null {
  if (!header) return null
  const m = header.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() || null
}
