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
 *
 * EVERY RUNG IS SCREENED. Rungs 1 and 2 return prose somebody wrote — a model,
 * or the template tier — and both of them shipped a spoiler. Rung 2 in
 * particular is *designed* to name the move, which on a windowed problem means
 * naming the position, which is the answer. `hint-safety.ts` is the check, and
 * it runs on the way out of every rung rather than on the way in to one, so a
 * rung added later cannot forget it. See that file for what is and is not
 * screened, and why the replacement for a rejected hint is a description of the
 * board rather than a refusal.
 */

import type { GameSpec, GameState, Oracle, Variables } from '@dsa/game-schema'

import { describeSearchWindow, findHintViolation, screenHint, type HintViolation } from './hint-safety.js'

export type HintSource = 'spec' | 'heuristic'

export interface HintResult {
  hint: string
  source: HintSource
  /** Which rung produced this hint; spec pool index, else hintsUsed so far. */
  index: number
  /**
   * Set when the authored text was rejected by `hint-safety` and the board
   * description was substituted. Present so the server can log WHICH rule
   * fired, and so a test can assert the substitution rather than infer it.
   */
  screened?: HintViolation
}

/** Last-resort text. Reachable only if the state itself is unusable. */
export const FALLBACK_HINT = 'Look at the highlighted region and make one decision.'

/** Variables beyond this many are summarised as "+N more" to keep hints short. */
const MAX_LISTED_VARIABLES = 6

export interface NextHintOptions {
  /**
   * Which pool entry the caller would rather serve, from the decision layer.
   *
   * The ordering of the pool is a fast local decision (Laya, or the keyword
   * heuristic) and it is genuinely better than counting: a hint ordered by the
   * operation the learner just got wrong beats the next one in a list. But the
   * decision layer picks an INDEX, never content — everything it selects is
   * still screened here, because "Laya chose it" is not a reason to trust that a
   * model's prose is free of a position.
   */
  readonly preferIndex?: number
}

/**
 * The next hint, guaranteed free of a position, a result, and the algorithm's
 * own notation.
 *
 * `nextHint` used to return whichever authored string the ladder reached. It
 * now returns whichever authored string the ladder reached *and that survives
 * `hint-safety`*, which is the guarantee `guardrails.ts` gives the coach and
 * which the hint path never had.
 */
export function nextHint(
  state: GameState,
  oracle: Oracle,
  spec?: GameSpec,
  options?: NextHintOptions,
): HintResult {
  const used = safeCount(state?.progress?.hintsUsed)
  try {
    const fromSpec = hintFromSpec(state, spec, used, options?.preferIndex)
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

function hintFromSpec(
  state: GameState,
  spec: GameSpec | undefined,
  used: number,
  preferIndex?: number,
): HintResult | null {
  const pool: unknown = spec?.narration?.hintPool
  if (!Array.isArray(pool)) return null

  // `preferIndex` is the decision layer's ordering; `used` is the ladder's own.
  // Either way the string that comes back is authored (a model, or the template
  // tier), so it is screened before it reaches a learner.
  const index = inRange(pool, preferIndex) ? (preferIndex as number) : used
  if (!inRange(pool, index)) return null
  const flavour = pool[index]
  if (typeof flavour !== 'string' || flavour.trim() === '') return null

  // The pool is FLAVOUR. It is not prefixed with a state dump.
  //
  // The prefix used to be `describeStateFacts(state)`, which prints the
  // algorithm's own bookkeeping verbatim — measured on a fresh binary-search
  // board, every single hint began:
  //
  //   "The algorithm is now tracking comparisons=0, found=false, hi=7, lo=0,
  //    mid=3, steps=0 (+1 more)."
  //
  // That is `lo=0`/`hi=7`/`mid=3` in exactly the notation `guidance.ts::deJargon`
  // exists to strip from learner-facing text, and `hint-safety.ts` rejects it as
  // a leak. So the two halves of this file were in direct contradiction: the
  // screen forbade the notation and the prefix emitted it on every request.
  // (The screen is applied below to the AUTHORED half, and `hintFromState` is
  // where the old wording lived, so this could not be caught by screening the
  // pool — the note was being added downstream of the check.)
  //
  // What a hint actually needs from the board is "where am I looking", and
  // `hint-safety.ts::describeSearchWindow` already says it in words with no
  // positions: "Four of the eight values are still in play." The ladder line is
  // the teaching; the window is the context. Nothing is lost by not printing the
  // variable table at a learner.
  return screened(state, flavour.trim(), 'spec', index)
}

function inRange(pool: readonly unknown[], index: number | undefined): boolean {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < pool.length
}

/**
 * Screen an authored hint, and report it if it was replaced.
 *
 * The ladder line is the TEACHING and it is what reaches the learner intact. A
 * rejected line is replaced wholesale by a description of the board, because
 * the point of a hint is the reason and `screenHint`'s fallback is the only
 * string here that is true by construction rather than by authorship.
 */
function screened(state: GameState, text: string, source: HintSource, index: number): HintResult {
  const violation = findHintViolation(text)
  if (violation === null) return { hint: text, source, index }
  return { hint: screenHint(text, state), source, index, screened: violation }
}

function hintFromOracle(state: GameState, oracle: Oracle, used: number): HintResult | null {
  if (typeof oracle?.legalActions !== 'function') return null
  const actions = oracle.legalActions(state)
  if (!Array.isArray(actions) || actions.length !== 1) return null
  const label = actions[0]?.label
  if (typeof label !== 'string' || label.trim() === '') return null

  // An oracle that leaves one legal move is telling us the answer, so its label
  // is the strongest hint available AND the most dangerous one. Binary search's
  // own label is "Choose index 6, the middle of [6, 7]", and on the final turn
  // index 6 IS the answer — `guardrails.ts` documents that exact case when it
  // declines to reuse the engine's instruction for the same reason. Screened
  // here for the same reason: the position is what must not travel.
  // Unprefixed on purpose. The oracle's label already names the move in full;
  // prefixing it with "the algorithm is now tracking best=1, i=1" would restate
  // the board and add notation to a string that is otherwise plain English.
  return screened(state, label.trim(), 'heuristic', used)
}

function hintFromState(state: GameState, used: number): HintResult | null {
  // The window in words, not `lo=0, hi=7, mid=3`.
  //
  // This rung used to print `variableLine(state)` — the algorithm's own variable
  // table — ahead of the sentence, on the theory that a factual prefix keeps an
  // authored hint honest. It is the same notation `hint-safety.ts` rejects, so
  // the two halves of this file contradicted each other: the screen forbade
  // `lo=` and this wrote `lo=` on every request that reached the bottom rung.
  // `describeSearchWindow` says the same thing with no positions and is derived
  // from the state, so it cannot be wrong about the board.
  const window = describeSearchWindow(state)
  if (window !== '') {
    return { hint: window, source: 'heuristic', index: used }
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
