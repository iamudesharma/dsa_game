/**
 * The deterministic hint ladder.
 *
 * A hint must ALWAYS be available: with no LLM tier, no Laya and no spec there
 * still has to be something useful to show. So hints are a pure function of
 * the state plus whatever optional oracle/spec affordances exist, and the
 * ladder degrades in three steps:
 *
 *   1. spec   — the LLM-authored `narration.hintPool`, prefixed with a
 *               factual line computed here (the pool is flavour and may be
 *               vague or subtly wrong; the prefix never is).
 *   2. oracle — an oracle that leaves exactly one legal move is telling us the
 *               answer, so its label is the hint.
 *   3. state  — a generic description of the window/pointers the algorithm is
 *               looking at. This path needs zero oracle support, so it only
 *               reads the generic `GameState` shape.
 *
 * Every path is total: no throws, never an empty string.
 */

import type { GameSpec, GameState, Oracle, Variables } from '@dsa/game-schema'

export type HintSource = 'spec' | 'heuristic'

export interface HintResult {
  hint: string
  source: HintSource
  /** Which rung produced this hint; spec pool index, else hintsUsed so far. */
  index: number
}

/** Last-resort text. Reachable only if the state itself is unusable. */
export const FALLBACK_HINT = 'Look at the highlighted region and make one decision.'

/** Variables beyond this many are summarised as "+N more" to keep hints short. */
const MAX_LISTED_VARIABLES = 6

export function nextHint(state: GameState, oracle: Oracle, spec?: GameSpec): HintResult {
  const used = safeCount(state?.progress?.hintsUsed)
  try {
    const fromSpec = hintFromSpec(state, spec, used)
    if (fromSpec !== null) return fromSpec

    const fromOracle = hintFromOracle(state, oracle, used)
    if (fromOracle !== null) return fromOracle

    const fromState = hintFromState(state, used)
    if (fromState !== null) return fromState
  } catch {
    // Deliberate: a hint is a nicety, never a reason to fail a request.
  }
  return { hint: FALLBACK_HINT, source: 'heuristic', index: used }
}

/** A new state with one more hint spent. Never mutates the input. */
export function incrementHintsUsed(state: GameState): GameState {
  try {
    const next = structuredClone(state)
    next.progress = {
      steps: safeCount(next.progress?.steps),
      mistakes: safeCount(next.progress?.mistakes),
      hintsUsed: safeCount(next.progress?.hintsUsed) + 1,
      mistakesByMechanic: { ...(next.progress?.mistakesByMechanic ?? {}) },
    }
    return next
  } catch {
    // A state we cannot clone cannot be extended safely either; hand back a
    // minimal object so the caller still sees the spent hint.
    return {
      ...state,
      progress: {
        steps: safeCount(state?.progress?.steps),
        mistakes: safeCount(state?.progress?.mistakes),
        hintsUsed: usedOf(state) + 1,
        mistakesByMechanic: { ...(state?.progress?.mistakesByMechanic ?? {}) },
      },
    } as GameState
  }
}

// Each rung is tried in order and may decline by returning null.

function hintFromSpec(state: GameState, spec: GameSpec | undefined, used: number): HintResult | null {
  const pool: unknown = spec?.narration?.hintPool
  if (!Array.isArray(pool) || used < 0 || used >= pool.length) return null
  const flavour = pool[used]
  if (typeof flavour !== 'string' || flavour.trim() === '') return null
  // The pool is authored prose; the first line is derived from the board so the
  // hint stays true even when the prose is vague.
  return { hint: `${describeStateFacts(state)}\n${flavour.trim()}`, source: 'spec', index: used }
}

function hintFromOracle(state: GameState, oracle: Oracle, used: number): HintResult | null {
  if (typeof oracle?.legalActions !== 'function') return null
  const actions = oracle.legalActions(state)
  if (!Array.isArray(actions) || actions.length !== 1) return null
  const label = actions[0]?.label
  if (typeof label !== 'string' || label.trim() === '') return null
  return { hint: label.trim(), source: 'heuristic', index: used }
}

function hintFromState(state: GameState, used: number): HintResult | null {
  const variables = variableLine(state)
  if (variables !== '') {
    const tail = hasWindow(state) ? 'the answer can only be inside that window.' : 'decide from those values.'
    return { hint: `${variables} — ${tail}`, source: 'heuristic', index: used }
  }

  const pointer = pointerLine(state)
  if (pointer !== '') {
    return {
      hint: `${pointer} — the algorithm is looking exactly here.`,
      source: 'heuristic',
      index: used,
    }
  }
  return null
}

// Factual lines, derived from the generic state shape only.

/**
 * One factual sentence about where the algorithm currently is. Used to prefix
 * spec-authored hints, and always returns a non-empty string.
 */
export function describeStateFacts(state: GameState): string {
  const variables = variableLine(state)
  if (variables !== '') return `The algorithm is now tracking ${variables}.`
  const pointer = pointerLine(state)
  if (pointer !== '') return `The algorithm cursor is on ${pointer}.`
  return 'Nothing has been examined yet, so start at the left of the range.'
}

/** `lo=0, hi=7, i=3` from `state.variables`, sorted for determinism. */
export function variableLine(state: GameState): string {
  const variables: Variables | undefined = state?.variables
  if (typeof variables !== 'object' || variables === null) return ''

  const pairs = Object.keys(variables)
    .sort()
    .map((key) => {
      const value = variables[key]
      return `${key}=${formatScalar(value)}`
    })
  if (pairs.length === 0) return ''

  const shown = pairs.slice(0, MAX_LISTED_VARIABLES)
  const hidden = pairs.length - shown.length
  return hidden > 0 ? `${shown.join(', ')} (+${hidden} more)` : shown.join(', ')
}

/** Human names for whatever the generic cursor points at, e.g. `s3 / card 7`. */
export function pointerLine(state: GameState): string {
  const cursor = state?.cursor as Record<string, unknown> | undefined
  if (typeof cursor !== 'object' || cursor === null) return ''

  const parts: string[] = []
  for (const field of CURSOR_FIELDS) {
    const id = cursor[field]
    if (typeof id !== 'string' || id === '') continue
    const label = labelForId(state, id)
    parts.push(label === null ? `${field}=${id}` : `${field}=${label}`)
  }
  return parts.slice(0, MAX_LISTED_VARIABLES).join(', ')
}

const CURSOR_FIELDS = [
  'midSlotId',
  'loSlotId',
  'hiSlotId',
  'iSlotId',
  'jSlotId',
  'bestObjectId',
  'nodeId',
  'prevNodeId',
] as const

// Small readers that tolerate a state that is not a state.

function hasWindow(state: GameState): boolean {
  const variables = state?.variables
  if (typeof variables !== 'object' || variables === null) return false
  return 'lo' in variables && 'hi' in variables
}

function labelForId(state: GameState, id: string): string | null {
  const slot = state?.slots?.[id]
  if (slot !== undefined) {
    const occupant = slot.occupantId
    const object = occupant === undefined ? undefined : state?.objects?.[occupant]
    if (object !== undefined && typeof object.label === 'string' && object.label !== '') return `${id} (${object.label})`
    if (typeof slot.label === 'string' && slot.label !== '') return `${id} (${slot.label})`
    return id
  }
  const object = state?.objects?.[id]
  if (object !== undefined && typeof object.label === 'string' && object.label !== '') return `${id} (${object.label})`
  return id
}

function formatScalar(value: number | string | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'unset'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'unset'
  return value === '' ? 'unset' : value
}

function usedOf(state: GameState): number {
  return safeCount(state?.progress?.hintsUsed)
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
