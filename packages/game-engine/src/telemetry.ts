/**
 * Telemetry: pure analysis over a played trace.
 *
 * The debrief screen and the Laya decision layer both need the same numbers,
 * so they live here as total, deterministic functions of the trace alone. No
 * clock, no randomness, no I/O: the same trace always yields the same report.
 *
 * Every function is written defensively over `TraceFrame[]` because the frames
 * come out of an oracle we do not own, and a malformed frame must degrade the
 * report rather than take down the post-game screen.
 */

import { ACTION_TO_DSA_OP, ACTION_TO_MECHANIC, isActionType, isDsaOp } from '@dsa/game-schema'
import type { ActionType, TraceFrame } from '@dsa/game-schema'

/** One game-term → algorithm-term row shown in the debrief mapping table. */
export interface TermMapping {
  gameTerm: string
  algorithmTerm: string
}

export interface MistakeSummary {
  total: number
  byMechanic: Record<string, number>
  byDsaOp: Record<string, number>
  /** Index of the first incorrect frame, or null when nothing went wrong. */
  firstMistakeAt: number | null
}

export interface OptimisationScore {
  /** 0..1, 1 when the player used the optimal number of steps. */
  score: number
  /** played.length / max(canonical.length, 1). */
  ratio: number
  /** Plain-language explanation of `score`. */
  note: string
}

/**
 * Buckets mistakes by mechanic and by DSA op, and reports when the first one
 * happened. A "mistake" is any frame the oracle marked `correct: false`.
 */
export function mistakeSummary(trace: TraceFrame[]): MistakeSummary {
  const byMechanic: Record<string, number> = {}
  const byDsaOp: Record<string, number> = {}
  let total = 0
  let firstMistakeAt: number | null = null

  const frames = framesOf(trace)
  for (let position = 0; position < frames.length; position++) {
    const frame = frames[position]
    if (frame === undefined || frame === null) continue
    if (frame.correct !== false) continue

    total += 1
    if (firstMistakeAt === null) {
      const declared = frame.index
      firstMistakeAt = typeof declared === 'number' && Number.isFinite(declared) ? declared : position
    }

    const mechanic = mechanicOfActionType(frame.action?.type)
    if (mechanic !== null) bump(byMechanic, mechanic)

    const op = dsaOpOf(frame)
    if (op !== null) bump(byDsaOp, op)
  }

  return { total, byMechanic, byDsaOp, firstMistakeAt }
}

/**
 * How close the player's line was to the canonical one, in steps.
 *
 * `score` is 1 for an optimal-length trace and decays as the player takes
 * more steps than the reference needs. It says nothing about *correctness* —
 * a player can win in more steps than the reference; that is a different
 * lesson and is reported by `mistakeSummary`.
 */
export function optimisationScore(played: TraceFrame[], canonical: TraceFrame[]): OptimisationScore {
  const used = framesOf(played).length
  const reference = framesOf(canonical).length
  const optimal = Math.max(reference, 1)
  const ratio = round3(used / optimal)
  const score = used <= optimal ? 1 : clamp01(round3(1 / ratio))

  const note =
    reference === 0
      ? `The oracle produced no reference trace, so this ${used}-step run is only compared against a single step.`
      : `${bandFor(ratio)} You took ${plural(used, 'step')}; the reference line needs ${plural(optimal, 'step')}.`

  return { score, ratio, note }
}

/**
 * Sorted, de-duplicated set of 1-based code lines the player actually reached.
 * Feeds the code-view highlighting so only executed lines are lit up.
 */
export function traceCodeHighlights(trace: TraceFrame[]): number[] {
  const lines = new Set<number>()
  for (const frame of framesOf(trace)) {
    const line = frame?.codeLine
    if (typeof line === 'number' && Number.isInteger(line) && line > 0) lines.add(line)
  }
  return [...lines].sort((a, b) => a - b)
}

/**
 * Heuristic game-term → algorithm-term table for the mechanics the player
 * actually used, in first-use order. The LLM's own `debrief.mapping` rows are
 * complementary flavour; these rows exist even when the model returned none.
 */
export function mapGameActionToCode(trace: TraceFrame[]): TermMapping[] {
  const used: ActionType[] = []
  for (const frame of framesOf(trace)) {
    const type = frame?.action?.type
    if (!isActionType(type)) continue
    if (!used.includes(type)) used.push(type)
  }
  return used.map((type) => ({ ...MECHANIC_TERMS[type] }))
}

/** Game-mechanic wording for each action type. Keys are a fixed literal set. */
/**
 * The GAME side of these rows is deliberately neutral.
 *
 * An earlier version hardcoded a card/door/room metaphor here, which meant a
 * game themed as a mountain pass still told the player to "read a card" and
 * "pick one of two doors". Themed vocabulary is the generator's job — this
 * layer must not contradict it. So the game term names the interaction in plain
 * words, and the themed version comes from the spec's own mapping table.
 *
 * The ALGORITHM side is the factual half and has to be right. An earlier
 * version described `comparePair` as `if a[i] > best`, which is the max-finding
 * pattern and simply wrong for binary search, two sum, sorting and most other
 * problems. A wrong comparison taught here is worse than no row at all, so these
 * terms are kept deliberately generic and true of every problem.
 */
const MECHANIC_TERMS: Readonly<Record<ActionType, TermMapping>> = {
  selectObject: { gameTerm: 'the element you picked', algorithmTerm: 'a read of one element' },
  moveObject: { gameTerm: 'moving an element to a new position', algorithmTerm: 'a write into an array cell' },
  comparePair: {
    gameTerm: 'comparing two values',
    algorithmTerm: 'a comparison that decides which branch comes next',
  },
  swapPair: { gameTerm: 'exchanging two elements', algorithmTerm: 'a swap of two elements' },
  pushPop: { gameTerm: 'adding to / removing from a structure', algorithmTerm: 'a push or a pop (last in, first out)' },
  choosePath: {
    gameTerm: 'choosing which part of the space to keep',
    algorithmTerm: 'discarding part of the search space',
  },
  traverseNode: { gameTerm: 'moving to the next node', algorithmTerm: 'advancing a pointer: current = current.next' },
  connectNodes: { gameTerm: 'wiring two nodes together', algorithmTerm: 'assigning a next / prev pointer' },
  assignValue: { gameTerm: 'writing a value down', algorithmTerm: 'a variable assignment' },
  submitAnswer: { gameTerm: 'committing the final answer', algorithmTerm: 'returning a result / terminating' },
}

// Small helpers, all total.

function framesOf(trace: TraceFrame[] | null | undefined): TraceFrame[] {
  return Array.isArray(trace) ? trace : []
}

function mechanicOfActionType(type: unknown): string | null {
  if (typeof type !== 'string') return null
  // `hasOwnProperty` rather than a truthiness test: a broken oracle can send a
  // type that is not in the catalog and it must not become an `undefined` key.
  if (!Object.prototype.hasOwnProperty.call(ACTION_TO_MECHANIC, type)) return null
  return ACTION_TO_MECHANIC[type as ActionType]
}

function dsaOpOf(frame: TraceFrame): string | null {
  if (isDsaOp(frame.dsaOp)) return frame.dsaOp
  const type = frame.action?.type
  if (!isActionType(type)) return null
  return ACTION_TO_DSA_OP[type]
}

function bump(tally: Record<string, number>, key: string): void {
  tally[key] = (tally[key] ?? 0) + 1
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function bandFor(ratio: number): string {
  if (ratio <= 1) return 'That is exactly the optimal line.'
  if (ratio <= 1.25) return 'Very close to optimal.'
  if (ratio <= 1.5) return 'A few steps were wasted.'
  if (ratio <= 2) return 'Noticeably longer than it needed to be.'
  return 'Far longer than the algorithm requires.'
}
