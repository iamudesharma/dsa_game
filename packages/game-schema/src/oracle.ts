/**
 * The `Oracle` interface — the contract between the deterministic engine and
 * each DSA problem implementation.
 *
 * An oracle owns ALL truth:
 *   - how to build a randomized instance,
 *   - which actions are legal right now,
 *   - whether an action is correct and what the algorithm expects instead,
 *   - the canonical trace frames, pseudocode, code and complexity.
 *
 * Oracles must be pure and deterministic. No LLM, no I/O, no Math.random —
 * use the `seed` from the instance so replays are reproducible.
 */

import type { Action } from './action.js'
import type { TraceFrame, Complexity } from './trace.js'
import type {
  ActionOutcome,
  Cursor,
  GameState,
  LinkedNodeSpec,
  ProblemInstance,
  Slot,
  Variables,
} from './state.js'

export type { Complexity }

/** What a problem's oracle needs to build its data. */
export interface BuildInstanceInput {
  seed: number
  difficulty: 'easy' | 'medium' | 'hard'
  /** Length override chosen by the difficulty curve. */
  length?: number
}

export type CodeLanguage = 'javascript' | 'typescript' | 'python' | 'java' | 'cpp'

export interface Oracle {
  readonly problemId: string

  /** Build a randomized, guaranteed-valid instance. Pure function of the input. */
  buildInstance(input: BuildInstanceInput): ProblemInstance

  /** Build the initial GameState for an instance. Must be a pure function. */
  initState(instance: ProblemInstance): GameState

  /**
   * Every action the player may legally attempt right now, with a short
   * label. Drives the UI's available controls. Optional but strongly
   * recommended: the engine validates independently regardless.
   */
  legalActions?(state: GameState): LegalActionDescriptor[]

  /**
   * Validate + apply an action. Must be pure: return a new state.
   *
   * Implementations must:
   *  - reject illegal actions (object does not exist, wrong phase, ...) with
   *    `illegal: true` and leave the state unchanged,
   *  - on a wrong-but-legal action, still apply the player's mistake to the
   *    state so the mistake is visible and teachable, and report the
   *    algorithm's expectation in `expected`,
   *  - append exactly one TraceFrame to `nextState.trace`,
   *  - update `nextState.internal` bookkeeping.
   */
  applyAction(state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome }

  /** Win condition. Pure. */
  isWin(state: GameState): boolean

  /**
   * The canonical, correct solution as trace frames. Used for:
   *  - the post-game algorithm visualisation,
   *  - progress hints,
   *  - tests.
   * `playedTrace` is the player's actual history; implementations may use it
   * to comment on it but must not depend on it for correctness.
   */
  canonicalTrace(state: GameState, playedTrace?: TraceFrame[]): TraceFrame[]

  /** Pseudocode lines, 1-indexed. `codeLine` in TraceFrame indexes this. */
  pseudocode(): string[]

  /** Real code, 1-indexed. `codeLine` in TraceFrame indexes this. */
  code(language: CodeLanguage): string[]

  complexity(): Complexity

  /** How the final state maps back to a canonical answer, for the debrief. */
  answerSummary(state: GameState): AnswerSummary
}

export interface LegalActionDescriptor {
  type: Action['type']
  label: string
  /** Object/container ids the player must choose from. */
  options?: { objectIds: string[]; containerIds?: string[] }
  /** Set when the player must supply a relation/value too. */
  expects?: 'relation' | 'value' | 'none'
}

export interface AnswerSummary {
  /** Human readable canonical answer, e.g. "index 7". */
  text: string
  /** Machine readable form for the client. */
  value?: string | number | null
  /** Optional extra rows, e.g. pair indices. */
  details?: { label: string; value: string | number }[]
}

/** Deterministic PRNG (mulberry32) so instances and any jitter are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  const item = arr[Math.floor(rng() * arr.length)]
  if (item === undefined) throw new Error('pick() from empty array')
  return item
}

/** Build `n` linear slots named s0..s{n-1}. */
export function linearSlots(n: number, prefix = 's'): Slot[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, index: i, kind: 'default' as const }))
}

/** Build a linked list spec of `n` nodes with unique values. */
export function buildListSpec(
  n: number,
  values: number[],
  prefix = 'n',
): LinkedNodeSpec[] {
  const nodes: LinkedNodeSpec[] = values.slice(0, n).map((value, i) => ({ id: `${prefix}${i}`, value }))
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (i < nodes.length - 1) node.nextId = nodes[i + 1]!.id
  }
  return nodes
}

/** Immutable-ish helpers for building cursors and variable snapshots. */
export function cursor(patch: Cursor): Cursor {
  return { ...patch }
}

export function vars(patch: Variables): Variables {
  return { ...patch }
}

/** Deep clone a plain-JSON state. All state fields are JSON-safe by contract. */
export function cloneState(state: GameState): GameState {
  return structuredClone(state)
}
