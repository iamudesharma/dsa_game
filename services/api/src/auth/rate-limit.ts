/**
 * In-memory token-bucket rate limiter, keyed per IP and per email.
 *
 * Consistent with the existing in-memory stores (`store.ts`, coach threads):
 * one process, no persistence. Limits are deliberately generous — this is
 * abuse protection for auth and generation endpoints, not a quota system.
 */

export interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimit {
  allowed: boolean
  remaining: number
  resetAfterMs: number
}

/** Check-and-consume. `limit` attempts per `windowMs`. */
export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimit {
  const cur = buckets.get(key)
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetAfterMs: windowMs }
  }
  if (cur.count >= limit) {
    return { allowed: false, remaining: 0, resetAfterMs: Math.max(0, cur.resetAt - now) }
  }
  cur.count += 1
  return { allowed: true, remaining: limit - cur.count, resetAfterMs: Math.max(0, cur.resetAt - now) }
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear()
}

export const AUTH_IP_LIMIT = 30
export const AUTH_IP_WINDOW_MS = 10 * 60 * 1000
export const AUTH_EMAIL_LIMIT = 10
export const AUTH_EMAIL_WINDOW_MS = 10 * 60 * 1000
export const INTERVIEW_LIMIT = 20
export const INTERVIEW_WINDOW_MS = 60 * 60 * 1000
