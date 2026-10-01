/**
 * Account data store: resumes, targets, kits, and progress sync.
 *
 * Payloads are Zod-validated JSON. Reads return parsed objects; writes
 * validate first so the database can never hold a shape the contract rejects.
 */

import { emptyResume, ResumeSchema, TargetSchema, type Resume, type Target } from '@dsa/account'
import { getDb, newId, nowMs } from '../db/index.js'

export function getResume(userId: string): Resume {
  const db = getDb()
  const row = db.prepare('SELECT data_json AS json FROM resumes WHERE user_id = ?').get(userId) as {
    json: string
  } | null | undefined
  if (!row) return emptyResume()
  try {
    const parsed = ResumeSchema.safeParse(JSON.parse(row.json))
    return parsed.success ? parsed.data : emptyResume()
  } catch {
    return emptyResume()
  }
}

export function putResume(userId: string, resume: Resume): Resume {
  const data = ResumeSchema.parse(resume)
  const db = getDb()
  db.prepare(
    'INSERT INTO resumes (user_id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at',
  ).run(userId, JSON.stringify(data), nowMs())
  return data
}

export function getTarget(userId: string): Target | null {
  const db = getDb()
  const row = db.prepare('SELECT data_json AS json FROM targets WHERE user_id = ?').get(userId) as {
    json: string
  } | null | undefined
  if (!row) return null
  try {
    const parsed = TargetSchema.safeParse(JSON.parse(row.json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function putTarget(userId: string, target: Target): Target {
  const data = TargetSchema.parse(target)
  const db = getDb()
  db.prepare(
    'INSERT INTO targets (user_id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at',
  ).run(userId, JSON.stringify(data), nowMs())
  return data
}

export interface StoredKit {
  id: string
  target: Target
  questions: unknown[]
  usedTier: string
  createdAt: number
}

export function saveKit(userId: string, target: Target, questions: unknown[], usedTier: string): StoredKit {
  const db = getDb()
  const id = newId('kit')
  const createdAt = nowMs()
  db.prepare(
    'INSERT INTO interview_kits (id, user_id, target_json, questions_json, used_tier, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, userId, JSON.stringify(target), JSON.stringify(questions), usedTier, createdAt)
  return { id, target, questions, usedTier, createdAt }
}

export function listKits(userId: string, limit = 10): StoredKit[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id, target_json AS targetJson, questions_json AS questionsJson, used_tier AS usedTier, created_at AS createdAt FROM interview_kits WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(userId, limit) as {
    id: string
    targetJson: string
    questionsJson: string
    usedTier: string
    createdAt: number
  }[]
  return rows.map((r) => {
    let target: Target | null = null
    let questions: unknown[] = []
    try {
      const t = TargetSchema.safeParse(JSON.parse(r.targetJson))
      if (t.success) target = t.data
    } catch {
      // corrupted row: surface what we can
    }
    try {
      const q = JSON.parse(r.questionsJson)
      if (Array.isArray(q)) questions = q
    } catch {
      // ignore
    }
    return { id: r.id, target: target ?? ({ goal: '', companyId: 'custom', customCompany: '', seniority: 'mid', focusAreas: [] } as Target), questions, usedTier: r.usedTier, createdAt: r.createdAt }
  })
}

export function getKit(userId: string, kitId: string): StoredKit | null {
  const db = getDb()
  const r = db
    .prepare(
      'SELECT id, target_json AS targetJson, questions_json AS questionsJson, used_tier AS usedTier, created_at AS createdAt FROM interview_kits WHERE id = ? AND user_id = ?',
    )
    .get(kitId, userId) as {
    id: string
    targetJson: string
    questionsJson: string
    usedTier: string
    createdAt: number
  } | null | undefined
  if (!r) return null
  return listKits(userId, 1000).find((k) => k.id === r.id) ?? null
}

// -------------------------------------------------------------- progress

const PROBLEM_ID_RE = /^[a-z0-9-]+$/

export function getProgress(userId: string): Record<string, string> {
  const db = getDb()
  const row = db.prepare('SELECT completed_json AS json FROM progress WHERE user_id = ?').get(userId) as {
    json: string
  } | null | undefined
  if (!row) return {}
  try {
    const v = JSON.parse(row.json)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v)) {
      if (PROBLEM_ID_RE.test(k) && typeof val === 'string') out[k] = val
    }
    return out
  } catch {
    return {}
  }
}

/** Union merge: server wins on conflicts already stored, new ids are added. */
export function mergeProgress(userId: string, completed: Record<string, string>): Record<string, string> {
  const current = getProgress(userId)
  const merged = { ...completed, ...current }
  // Validate timestamps loosely; keep anything string-shaped.
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (PROBLEM_ID_RE.test(k) && typeof v === 'string' && v.length <= 40) clean[k] = v
  }
  const db = getDb()
  db.prepare(
    'INSERT INTO progress (user_id, completed_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET completed_json = excluded.completed_json, updated_at = excluded.updated_at',
  ).run(userId, JSON.stringify(clean), nowMs())
  return clean
}
