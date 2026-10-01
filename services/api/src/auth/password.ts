/**
 * Password hashing with `node:crypto` scrypt — zero native deps.
 *
 * Stored form: `scrypt$N$r$p$saltB64$keyB64`. Verification is constant-time
 * over the derived key so a wrong password costs the same comparison work.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

function scryptKey(password: string, salt: Buffer, keyLen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLen, opts, (err, derived) => {
      if (err) reject(err)
      else resolve(derived as Buffer)
    })
  })
}

const N = 16384
const R = 8
const P = 1
const KEY_LEN = 64
const SALT_LEN = 16

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const key = await scryptKey(password, salt, KEY_LEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4]!, 'base64')
    expected = Buffer.from(parts[5]!, 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false
  let actual: Buffer
  try {
    actual = await scryptKey(password, salt, expected.length, { N: n, r, p })
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

const EMAIL_RE = /^[^\s@]{1,120}@[^\s@]{1,120}\.[^\s@]{2,24}$/

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}
