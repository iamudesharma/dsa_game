/**
 * Coach conversation state.
 *
 * WHY THIS IS SEPARATE FROM `store.ts`: a `GameSession` is the *game*, and its
 * lifetime is tied to play. A coach thread is the *conversation*, which starts
 * and stops independently — a learner can open a second thread mid-game to ask
 * a different question, or a first thread after twenty moves. Sharing one map
 * would mean a busy conversation could evict the game it is describing, so the
 * two get their own store with their own TTL and cap.
 *
 * The eviction style deliberately mirrors `store.ts` (idle TTL + a hard cap,
 * oldest-touched first) because it is the same operational problem: one process,
 * no persistence, paid upstream. Read past the cap and a learner's coach
 * forgets them mid-conversation, which reads as the coach being broken rather
 * than as a cache miss — hence the cap is generous relative to session count.
 *
 * THREADS ARE NOT IMMUTABLE, but every read hands back a fresh copy. `CoachTurn`
 * carries a `GuidancePromptSnapshot` that is a whole board, so leaking a
 * reference would let a caller mutate another thread's history; the contract
 * also says a coach turn can never mutate the game, and copying on read is what
 * makes that structurally true rather than a convention.
 */

import type { CoachThread, CoachTurn } from '@dsa/game-schema'

/** Mirrors `store.ts`'s generosity: fewer games than conversation turns. */
const MAX_THREADS = 400
const IDLE_TTL_MS = 1000 * 60 * 60 * 6
/** Turns retained per thread. Beyond this the budget's summary carries the rest. */
const MAX_TURNS_PER_THREAD = 200

export interface CoachThreadSummary {
  id: string
  title: string
  turnCount: number
  updatedAt: number
}

export interface CreateThreadInput {
  readonly gameId: string
  readonly problemId: string
  /** Optional client name for the switcher. */
  readonly title?: string
  /**
   * Injected so eviction and ordering are testable. Defaults to the wall clock
   * because a request handler has no better clock.
   */
  readonly now?: number
}

/** Mutable working copy; `toThread` projects the readonly public shape. */
interface ThreadRecord {
  id: string
  problemId: string
  gameId: string
  turns: CoachTurn[]
  summary: string | null
  spentTokens: number
  givenHints: string[]
  createdAt: number
  updatedAt: number
  lastAccessedAt: number
}

const threads = new Map<string, ThreadRecord>()
const byGame = new Map<string, Set<string>>()

let counter = 0

/** Same shape as `newGameId`, so ids are greppable by which game they belong to. */
export function newThreadId(gameId: string): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER
  const rand = Math.random().toString(36).slice(2, 8)
  return `thr-${gameId}-${Date.now().toString(36)}-${counter.toString(36)}${rand}`
}

export function createThread(input: CreateThreadInput): CoachThread {
  const now = input.now ?? Date.now()
  const id = newThreadId(input.gameId)
  const record: ThreadRecord = {
    id,
    problemId: input.problemId,
    gameId: input.gameId,
    turns: [],
    summary: null,
    spentTokens: 0,
    givenHints: [],
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
  threads.set(id, record)
  indexThread(id, input.gameId)
  evictIfNeeded(now)
  return toThread(record)
}

export function getThread(threadId: string, now: number = Date.now()): CoachThread | undefined {
  const record = threads.get(threadId)
  if (!record) return undefined
  record.lastAccessedAt = now
  return toThread(record)
}

export function threadExists(threadId: string): boolean {
  return threads.has(threadId)
}

/**
 * Append one turn and fold its cost into the thread total.
 *
 * `approxTokens` is taken from the turn rather than recomputed here, because the
 * caller is the only place that knows whether a snapshot was attached. Trimming
 * to `MAX_TURNS_PER_THREAD` is the last line of defence: the budget already
 * decides what is *sent*, this only bounds what is *retained*, so a thread that
 * is never sent cannot grow without limit.
 */
export function appendTurn(threadId: string, turn: CoachTurn, now: number = Date.now()): CoachThread | undefined {
  const record = threads.get(threadId)
  if (!record) return undefined
  record.turns = [...record.turns, turn]
  if (record.turns.length > MAX_TURNS_PER_THREAD) {
    record.turns = record.turns.slice(-MAX_TURNS_PER_THREAD)
  }
  record.spentTokens += Math.max(0, Math.trunc(turn.approxTokens))
  record.updatedAt = now
  record.lastAccessedAt = now
  return toThread(record)
}

/** Record the rolling summary of what fell out of the window. */
export function setThreadSummary(threadId: string, summary: string | null, now: number = Date.now()): void {
  const record = threads.get(threadId)
  if (!record) return
  record.summary = summary === null || summary.trim() === '' ? null : summary
  record.updatedAt = now
  record.lastAccessedAt = now
}

/**
 * Hints already given, newest last, so the coach does not repeat itself.
 * Bounded because a long thread would otherwise make the prompt grow linearly
 * with the number of hints — a third axis of unbounded growth the token budget
 * would have to absorb for no teaching benefit.
 */
export function rememberHint(threadId: string, hint: string, now: number = Date.now()): void {
  const record = threads.get(threadId)
  if (!record) return
  const hints = [...record.givenHints, hint]
  record.givenHints = hints.slice(-12)
  record.updatedAt = now
  record.lastAccessedAt = now
}

export function deleteThread(threadId: string): boolean {
  const record = threads.get(threadId)
  if (!record) return false
  threads.delete(threadId)
  const ids = byGame.get(record.gameId)
  if (ids) {
    ids.delete(threadId)
    if (ids.size === 0) byGame.delete(record.gameId)
  }
  return true
}

/** Most recently updated first, so the client can default to the live one. */
export function listThreadsForGame(gameId: string): CoachThreadSummary[] {
  const ids = byGame.get(gameId)
  if (!ids) return []
  const out: CoachThreadSummary[] = []
  for (const id of ids) {
    const record = threads.get(id)
    if (!record) continue
    out.push({
      id: record.id,
      title: threadTitle(record),
      turnCount: record.turns.length,
      updatedAt: record.updatedAt,
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Raw ids for one game, for the session store's eviction cascade.
 *
 * Exposed separately from `listThreadsForGame` because the cascade wants the
 * minimum — ids, no titles — and because it must not count as "access" the way a
 * real read does. Dropping a game should not make its threads look recently used.
 */
export function listThreadIdsForGame(gameId: string): string[] {
  const ids = byGame.get(gameId)
  return ids === undefined ? [] : [...ids]
}

export function coachThreadCount(): number {
  return threads.size
}

function threadTitle(record: ThreadRecord): string {
  if (record.turns.length === 0) return 'New question'
  // The learner's own first words are the best possible title, and they need no
  // model call to produce.
  const first = record.turns.find((t) => t.role === 'learner')
  const source = first?.text ?? ''
  const trimmed = source.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return 'New question'
  return trimmed.length <= 48 ? trimmed : `${trimmed.slice(0, 47)}…`
}

function indexThread(threadId: string, gameId: string): void {
  let ids = byGame.get(gameId)
  if (!ids) {
    ids = new Set()
    byGame.set(gameId, ids)
  }
  ids.add(threadId)
}

function toThread(record: ThreadRecord): CoachThread {
  return {
    id: record.id,
    problemId: record.problemId,
    gameId: record.gameId,
    turns: [...record.turns],
    summary: record.summary,
    spentTokens: record.spentTokens,
    givenHints: [...record.givenHints],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Drop idle threads, then the least-recently-touched until under the cap. */
function evictIfNeeded(now: number): void {
  for (const [id, record] of threads) {
    if (now - record.lastAccessedAt > IDLE_TTL_MS) drop(id, record)
  }
  if (threads.size <= MAX_THREADS) return
  const ordered = [...threads.values()].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
  let excess = threads.size - MAX_THREADS
  for (const record of ordered) {
    if (excess <= 0) break
    drop(record.id, record)
    excess -= 1
  }
}

function drop(id: string, record: ThreadRecord): void {
  threads.delete(id)
  const ids = byGame.get(record.gameId)
  if (ids) {
    ids.delete(id)
    if (ids.size === 0) byGame.delete(record.gameId)
  }
}

/** Test hook: wipe all threads. Mirrors `resetStore`. */
export function resetThreads(): void {
  threads.clear()
  byGame.clear()
  counter = 0
}
