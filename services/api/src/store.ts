/**
 * In-memory game session store.
 *
 * Guest scope: one process; owned sessions persist in SQLite. Sessions hold the oracle (so the
 * same deterministic engine drives the whole game), the LLM-authored spec,
 * and the current state. Undo is a bounded stack of prior states.
 *
 * If this ever needs to scale out, `GameSession` is the only shape that
 * matters — it is plain JSON apart from the oracle handle.
 */

import type { GameSpec } from '@dsa/game-schema'
import type { GameState } from '@dsa/game-schema'
import type { Oracle } from '@dsa/game-schema'
import { persistPractice, restorePractice } from './learning/store.js'

import { deleteThread as deleteCoachThread, listThreadIdsForGame as listCoachThreadIds } from './coach/threads.js'

export interface GameSession {
  userId?: string
  gameId: string
  problemId: string
  seed: number
  difficulty: 'easy' | 'medium' | 'hard'
  oracle: Oracle
  spec: GameSpec
  state: GameState
  undo: GameState[]
  /** Which provider tier produced `spec`. */
  usedTier: string
  createdAt: number
  lastAccessedAt: number
}

const UNDO_LIMIT = 25
const MAX_SESSIONS = 200
const IDLE_TTL_MS = 1000 * 60 * 60 * 3

const sessions = new Map<string, GameSession>()
const byProblem = new Map<string, Set<string>>()

let counter = 0

export function newGameId(problemId: string): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER
  const rand = Math.random().toString(36).slice(2, 8)
  return `${problemId}-${Date.now().toString(36)}-${counter.toString(36)}${rand}`
}

export function putSession(session: GameSession): void {
  sessions.set(session.gameId, session)
  let ids = byProblem.get(session.problemId)
  if (!ids) {
    ids = new Set()
    byProblem.set(session.problemId, ids)
  }
  ids.add(session.gameId)
  persistPractice(session)
  evictIfNeeded()
}

export function getSession(gameId: string): GameSession | undefined {
  const session = sessions.get(gameId) ?? restorePractice(gameId)
  if (!session) return undefined
  sessions.set(gameId, session)
  session.lastAccessedAt = Date.now()
  return session
}

export function pushUndo(session: GameSession, prior: GameState): void {
  session.undo.push(prior)
  if (session.undo.length > UNDO_LIMIT) session.undo.shift()
}

export function popUndo(session: GameSession): GameState | undefined {
  return session.undo.pop()
}

export function sessionCount(): number {
  return sessions.size
}

/** Drop the oldest sessions once we exceed MAX_SESSIONS, and idle ones past TTL. */
function evictIfNeeded(): void {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastAccessedAt > IDLE_TTL_MS) {
      dropSessionCascade(id)
    }
  }
  if (sessions.size <= MAX_SESSIONS) return
  const ordered = [...sessions.values()].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
  let excess = sessions.size - MAX_SESSIONS
  for (const session of ordered) {
    if (excess <= 0) break
    dropSessionCascade(session.gameId)
    excess -= 1
  }
}

/**
 * Drop a game, and every coach conversation that was describing it.
 *
 * WHY THIS CROSSES INTO THE COACH STORE: a coach thread is only meaningful
 * relative to the game it was asked about — its snapshots are past boards from
 * that game and nothing else. A thread that outlives its game is a thread whose
 * every piece of context is about a board nobody can see any more, so the coach
 * would answer confidently about nothing. Silently keeping it would be worse than
 * losing it, and the learner gets a clean "unknown game" 404 on the next question
 * rather than a plausible answer about a ghost.
 *
 * Called from the eviction paths only. Nothing else removes a session, so this is
 * the one place the two stores have to be kept in step.
 */
export function dropSessionCascade(gameId: string): void {
  for (const threadId of sessions.get(gameId)?.userId ? [] : listCoachThreadIds(gameId)) {
    deleteCoachThread(threadId)
  }
  const session = sessions.get(gameId)
  if (session === undefined) return
  drop(gameId, session)
}

function drop(gameId: string, session: GameSession): void {
  sessions.delete(gameId)
  const ids = byProblem.get(session.problemId)
  if (ids) {
    ids.delete(gameId)
    if (ids.size === 0) byProblem.delete(session.problemId)
  }
}

/** Test hook: wipe all sessions. */
export function resetStore(): void {
  sessions.clear()
  byProblem.clear()
  counter = 0
}
