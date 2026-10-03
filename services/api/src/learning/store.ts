import { PROBLEMS, GameSpecSchema, DSA_OPS } from '@dsa/game-schema'
import { getOracle } from '@dsa/dsa-oracles'
import { z } from 'zod'
import {
  ChatMessageSchema,
  PracticeRecordSchema,
  type LearningThread,
  type LearningMessage,
  type LearningDashboard,
  type PracticeRecord,
} from '@dsa/account'
import { getDb, newId } from '../db/index.js'
import { getProgress } from '../account/store.js'
import { ActionBodySchema } from '../validate.js'
import type { GameSession } from '../store.js'

const scalar = z.union([z.number(), z.string(), z.boolean(), z.null()])
const count = z.number().int().nonnegative()
const objectState = z.enum([
  'idle',
  'selected',
  'eliminated',
  'matched',
  'swapped',
  'locked',
  'current',
  'visited',
  'revealed',
])
const slot = z
  .object({
    id: z.string(),
    index: z.number().int(),
    kind: z.enum(['default', 'target', 'left', 'right', 'mid', 'sink', 'source']),
    occupantId: z.string().optional(),
    label: z.string().optional(),
    state: objectState.optional(),
    meta: z.record(z.string(), scalar).optional(),
  })
  .strict()
const instance = z
  .object({
    problemId: z.string(),
    seed: z.number(),
    values: z.array(z.number()),
    target: z.number().optional(),
    tokens: z.array(z.string()).optional(),
    list: z
      .array(
        z
          .object({
            id: z.string(),
            value: z.number(),
            nextId: z.string().optional(),
            prevId: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    slots: z.array(slot),
    extras: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
const StoredStateSchema = z
  .object({
    problemId: z.string(),
    seed: z.number(),
    instance,
    objects: z.record(
      z.string(),
      z
        .object({
          id: z.string(),
          kind: z.string(),
          label: z.string(),
          value: z.number().optional(),
          slotId: z.string().optional(),
          x: z.number().optional(),
          y: z.number().optional(),
          visual: z.object({ kind: z.string() }).passthrough().optional(),
          state: objectState,
          tags: z.record(z.string(), scalar).optional(),
        })
        .strict(),
    ),
    slots: z.record(z.string(), slot),
    containers: z.record(
      z.string(),
      z
        .object({
          id: z.string(),
          kind: z.string(),
          order: z.array(z.string()),
          capacity: z.number().optional(),
          label: z.string().optional(),
        })
        .strict(),
    ),
    links: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(['next', 'prev']) }).strict()),
    selection: z.array(z.string()),
    cursor: z.record(z.string(), z.string()),
    variables: z.record(z.string(), scalar),
    progress: z
      .object({
        steps: count,
        mistakes: count,
        hintsUsed: count,
        mistakesByMechanic: z.record(z.string(), count),
      })
      .strict(),
    phase: z.enum(['playing', 'won', 'lost']),
    trace: z.array(
      z
        .object({
          index: count,
          action: ActionBodySchema.shape.action,
          codeLine: count,
          codeLineText: z.string(),
          variables: z.record(z.string(), scalar),
          pointers: z
            .object({
              current: z.string().optional(),
              compare: z.array(z.string()).optional(),
              eliminated: z.array(z.string()).optional(),
              swapped: z.array(z.string()).optional(),
              read: z.array(z.string()).optional(),
            })
            .strict(),
          dsaOp: z.enum(DSA_OPS),
          correct: z.boolean(),
          note: z.string(),
        })
        .strict(),
    ),
    internal: z.record(z.string(), scalar),
  })
  .strict()
const SnapshotSchema = z
  .object({
    userId: z.string().min(1),
    gameId: z.string(),
    problemId: z.string(),
    seed: z.number(),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    spec: GameSpecSchema,
    state: StoredStateSchema,
    undo: z.array(StoredStateSchema).max(25),
    usedTier: z.string(),
    createdAt: z.number(),
    lastAccessedAt: z.number(),
  })
  .strict()
export function persistPractice(session: GameSession): void {
  if (!session.userId) return
  const record: PracticeRecord = {
    gameId: session.gameId,
    problemId: session.problemId,
    difficulty: session.difficulty,
    seed: session.seed,
    startedAt: session.createdAt,
    updatedAt: Date.now(),
    completedAt: session.state.phase === 'won' ? Date.now() : null,
    outcome: session.state.phase,
    steps: session.state.progress.steps,
    mistakes: session.state.progress.mistakes,
    hints: session.state.progress.hintsUsed,
    mistakesByMechanic: session.state.progress.mistakesByMechanic,
  }
  const old = getDb()
    .prepare('SELECT record_json FROM practice_runs WHERE game_id = ?')
    .get(session.gameId) as { record_json: string } | undefined
  if (old) {
    const prior = PracticeRecordSchema.parse(JSON.parse(old.record_json))
    if (prior.completedAt && record.completedAt) record.completedAt = prior.completedAt
  }
  const { oracle: _, ...snapshot } = session
  getDb()
    .prepare(
      'INSERT INTO practice_runs(game_id,user_id,record_json,snapshot_json) VALUES(?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET record_json=excluded.record_json,snapshot_json=excluded.snapshot_json',
    )
    .run(
      session.gameId,
      session.userId,
      JSON.stringify(record),
      JSON.stringify(SnapshotSchema.parse(snapshot)),
    )
}
export function restorePractice(id: string): GameSession | undefined {
  const row = getDb().prepare('SELECT user_id,snapshot_json FROM practice_runs WHERE game_id = ?').get(id) as
    { user_id: string; snapshot_json: string } | undefined
  if (!row) return
  try {
    const snapshot = SnapshotSchema.parse(JSON.parse(row.snapshot_json))
    if (snapshot.userId !== row.user_id || snapshot.gameId !== id) return
    const spec = GameSpecSchema.parse(snapshot.spec)
    const oracle = getOracle(snapshot.problemId)
    if (!oracle || spec.problemId !== snapshot.problemId) return
    const state = StoredStateSchema.parse(snapshot.state) as unknown as GameSession['state']
    if (state.problemId !== snapshot.problemId || state.seed !== snapshot.seed) return
    return { ...snapshot, spec, state, undo: snapshot.undo as unknown as GameSession['undo'], oracle }
  } catch {
    return
  }
}
export function practiceRecords(userId: string): PracticeRecord[] {
  const rows = getDb().prepare('SELECT record_json FROM practice_runs WHERE user_id = ?').all(userId) as {
    record_json: string
  }[]
  return rows
    .map((r) => PracticeRecordSchema.parse(JSON.parse(r.record_json)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
export function dashboard(userId: string, now = Date.now()): LearningDashboard {
  const records = practiceRecords(userId)
  const completed = { ...getProgress(userId) }
  for (const r of records) if (r.completedAt) completed[r.problemId] = new Date(r.completedAt).toISOString()
  const intervals = [1, 3, 7, 14]
  const reviews = PROBLEMS.flatMap((p) => {
    const wins = records
      .filter((r) => r.problemId === p.id && r.completedAt)
      .sort((a, b) => a.completedAt! - b.completedAt!)
    if (!wins.length) return []
    let stage = 0
    for (const win of wins.slice(1))
      stage = win.mistakes === 0 && win.hints === 0 ? Math.min(3, stage + 1) : 0
    return [
      { problemId: p.id, stage, dueAt: wins[wins.length - 1]!.completedAt! + intervals[stage]! * 86400000 },
    ]
  }).sort((a, b) => a.dueAt - b.dueAt)
  const topics = [...new Set(PROBLEMS.map((p) => p.topic))].map((topic) => {
    const ps = PROBLEMS.filter((p) => p.topic === topic)
    const rs = records.filter((r) => ps.some((p) => p.id === r.problemId))
    return {
      topic,
      completed: ps.filter((p) => completed[p.id]).length,
      total: ps.length,
      attempts: rs.length,
      mistakes: rs.reduce((n, r) => n + r.mistakes, 0),
      hints: rs.reduce((n, r) => n + r.hints, 0),
    }
  })
  const due = reviews.find((r) => r.dueAt <= now)
  const ongoing = records.find((r) => r.outcome === 'playing')
  const unseen = PROBLEMS.find((p) => !completed[p.id])
  const recommendation = due
    ? { problemId: due.problemId, reason: 'This problem is due for a scheduled review.' }
    : ongoing
      ? { problemId: ongoing.problemId, action: 'resume' as const, gameId: ongoing.gameId, reason: 'You have an unfinished practice run for this problem.' }
      : unseen
        ? { problemId: unseen.id, reason: 'Try a problem you have not completed yet.' }
        : reviews[0]
          ? { problemId: reviews[0].problemId, reason: 'Revisit a completed problem with a fresh instance.' }
          : null
  return { records, completed, reviews, topics, recommendation }
}
export function listThreads(userId: string, search = ''): LearningThread[] {
  return getDb()
    .prepare(
      'SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM learning_threads WHERE user_id=? AND (instr(lower(title),lower(?))>0 OR EXISTS(SELECT 1 FROM learning_messages WHERE thread_id=learning_threads.id AND instr(lower(data_json),lower(?))>0)) ORDER BY updated_at DESC, id DESC',
    )
    .all(userId, search, search) as unknown as LearningThread[]
}
export function thread(userId: string, id: string): LearningThread | null {
  return (
    (getDb()
      .prepare(
        'SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM learning_threads WHERE user_id=? AND id=?',
      )
      .get(userId, id) as unknown as LearningThread) ?? null
  )
}
export function createThread(userId: string): LearningThread {
  const t = { id: newId('chat'), title: 'New conversation', createdAt: Date.now(), updatedAt: Date.now() }
  getDb()
    .prepare('INSERT INTO learning_threads VALUES(?,?,?,?,?)')
    .run(t.id, userId, t.title, t.createdAt, t.updatedAt)
  return t
}
export function messages(threadId: string): LearningMessage[] {
  const rows = getDb()
    .prepare('SELECT data_json FROM learning_messages WHERE thread_id=? ORDER BY rowid')
    .all(threadId) as { data_json: string }[]
  return rows.map((r) => ChatMessageSchema.parse(JSON.parse(r.data_json)))
}
export function saveMessage(threadId: string, m: LearningMessage): void {
  const data = ChatMessageSchema.parse(m)
  getDb()
    .prepare(
      'INSERT INTO learning_messages VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json',
    )
    .run(m.id, threadId, m.requestId, JSON.stringify(data))
  getDb().prepare('UPDATE learning_threads SET updated_at=? WHERE id=?').run(Date.now(), threadId)
}
export function recoverInterrupted(): void {
  const rows = getDb().prepare('SELECT thread_id,data_json FROM learning_messages').all() as {
    thread_id: string
    data_json: string
  }[]
  for (const r of rows) {
    const m = ChatMessageSchema.parse(JSON.parse(r.data_json))
    if (m.status === 'streaming') saveMessage(r.thread_id, { ...m, status: 'interrupted' })
  }
}
