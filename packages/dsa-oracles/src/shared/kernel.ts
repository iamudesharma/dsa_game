/**
 * Shared oracle plumbing.
 *
 * Every oracle needs the same four hundred lines of scaffolding: defensive
 * readers for the opaque `internal` bag, a `legal`/`illegal` outcome pair, a
 * trace-frame builder, code-line text lookup, and the multi-language listing
 * that keeps line numbers canonical across languages. `binary-search.ts` grew
 * all of it by hand, which was right for one oracle and wrong for eleven.
 *
 * WHAT MOVED HERE, and why it is safe:
 *
 *  - `readBag` / `writeBag` replace the per-oracle `readInternal`/`writeInternal`.
 *    `GameState.internal` is typed as flat scalars, so an oracle's own
 *    bookkeeping round-trips through a generic map. Each oracle still declares
 *    its own typed view on top; the point is that the *decoding* is written
 *    once and defensively, not ten times.
 *  - `finishLegal` / `finishIllegal` are the exact bodies of binary-search's
 *    `legal`/`illegal`, parameterised on the frame's `variables` and
 *    `eliminated` so an oracle supplies only what is specific to it.
 *  - `numberCode` builds a listing whose line numbers are identical in every
 *    language. That invariant is the whole reason a `TraceFrame.codeLine` can
 *    point at the same statement whichever language the client renders, and it
 *    is the one thing that must never be done per-language.
 *
 * WHAT DID NOT MOVE: the algorithms. Every oracle decides its own legality, its
 * own mistake handling, and its own canonical trace.
 */

import type { Action, ActionOutcome, DsaOp } from '@dsa/game-schema'
import type { GameObject, GameState, Slot, TraceFrame, Variables } from '@dsa/game-schema'
import { cloneState } from '@dsa/game-schema'

// ------------------------------------------------------------- bag accessors

/** Read a number out of the opaque bag, falling back rather than throwing. */
export function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function bool(value: unknown): boolean {
  return value === true
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The flat-scalar bag type `GameState.internal` is contractually limited to. */
export type Bag = Record<string, number | string | boolean | null>

// ----------------------------------------------------------------- code text

/**
 * A canonical listing: one array of statements, in a fixed order, where the
 * index in the array IS the line number.
 *
 * Languages that need padding (Python's block rules will not keep `return -1`
 * on line 13 otherwise) do it by filling the unused slots with comments or
 * `END IF` markers rather than by reordering, because reordering is what would
 * break the cross-language correspondence.
 */
export interface CanonicalListing {
  /** Line 1 is the signature. */
  readonly lines: readonly string[]
  /** Same length as `lines`; index 0 documents line 1. */
  readonly notes: readonly string[]
  /** Real source for each language, or `null` to use `lines` verbatim. */
  readonly perLanguage?: Readonly<Partial<Record<CodeLang, readonly string[]>>>
}

export type CodeLang = 'javascript' | 'typescript' | 'python' | 'java' | 'cpp'

/**
 * `codeLineText(line)` for a listing, in whichever language is rendered.
 *
 * Kept per-listing rather than global so two oracles never share a line map.
 */
export function codeTextFor(listing: CanonicalListing, language: string, line: number): string {
  const custom = listing.perLanguage?.[language as CodeLang]
  const source = custom ?? listing.lines
  return source[line - 1] ?? ''
}

// ------------------------------------------------------------------- outcome

export interface FrameSpec {
  codeLine: number
  dsaOp: DsaOp
  correct: boolean
  note: string
  current?: string
  compare?: string[]
  read?: string[]
  eliminated?: string[]
}

export interface Rejection {
  feedback: string
  dsaOp: DsaOp
  codeLine: number
  note: string
}

/** The extra fields every frame builder needs, whichever rung produced it. */
interface FrameContext {
  readonly codeLineText: (line: number) => string
  readonly variables: (s: GameState) => Variables
  /**
   * Persist the oracle's decoded bookkeeping bag onto the state.
   *
   * REQUIRED, and its absence is silent. An oracle reads `internal` into a
   * typed view, mutates that view, and hands it to `finishLegal` — but the
   * view is a COPY, so without this call every field reverts on the next turn.
   * The symptom is not a wrong value, it is an INFINITE GAME: the cursor never
   * advances, the same cell is re-read forever, and no assertion about the
   * data ever fails. That is exactly the bug the first version of
   * `array-max-min` had, and it is why this is not optional.
   */
  readonly write: (s: GameState) => void
}

export type FrameRequest = FrameSpec & FrameContext
export type RejectionRequest = Rejection & FrameContext

/**
 * A rejected move: it never happened, so the only deltas are the step counter
 * and the single trace frame the contract requires.
 */
export function finishIllegal(
  state: GameState,
  action: Action,
  spec: RejectionRequest,
): { nextState: GameState; outcome: ActionOutcome } {
  const next = cloneState(state)
  next.progress.steps += 1
  const index = next.trace.length
  next.trace.push(buildFrame(next, action, spec, index))
  return {
    nextState: next,
    outcome: { correct: false, illegal: true, feedback: spec.feedback, dsaOp: spec.dsaOp, traceStep: index },
  }
}

/** An applied move: one step, one frame, the outcome the client renders. */
export function finishLegal(
  next: GameState,
  action: Action,
  spec: FrameRequest,
  outcome: Omit<ActionOutcome, 'traceStep'>,
): { nextState: GameState; outcome: ActionOutcome } {
  next.progress.steps += 1
  const index = next.trace.length
  next.trace.push(buildFrame(next, action, spec, index))
  // AFTER the frame: the frame records the variables as they were when the
  // move was made, and only then does the decoded view become the new truth.
  spec.write(next)
  return { nextState: next, outcome: { ...outcome, traceStep: index } }
}

function buildFrame(
  state: GameState,
  action: Action,
  spec: FrameRequest | RejectionRequest,
  index: number,
): TraceFrame {
  const frame = spec as FrameSpec
  return {
    index,
    action,
    codeLine: spec.codeLine,
    codeLineText: spec.codeLineText(spec.codeLine),
    variables: spec.variables(state),
    pointers: {
      current: frame.current,
      compare: frame.compare,
      read: frame.read,
      eliminated: frame.eliminated,
    },
    dsaOp: spec.dsaOp,
    correct: 'correct' in spec ? spec.correct : false,
    note: spec.note,
  }
}

// ------------------------------------------------------------------ progress

export function emptyProgressShape() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

/**
 * Record a wrong-but-legal move.
 *
 * A mistake is counted, bucketed by mechanic, and the move is STILL APPLIED by
 * the caller — the brief is that a wrong move has to stay visible and
 * teachable, so the learner can see the consequence rather than being told
 * "no" and returned to an unchanged board.
 */
export function noteMistake(state: GameState, mechanic: string): void {
  state.progress.mistakes += 1
  const bucket = state.progress.mistakesByMechanic
  bucket[mechanic] = num(bucket[mechanic], 0) + 1
}

// ----------------------------------------------------------------- the board

export interface BoardOptions {
  readonly problemId: string
  readonly instance: GameState['instance']
  /** `values` become `number` objects in `s0..s{n-1}`; `tokens` become `token` objects. */
  readonly kind?: 'number' | 'token'
  readonly objectPrefix?: string
  readonly slotPrefix?: string
  /** Extra objects that live off the board (a target, a sentinel, ...). */
  readonly extras?: readonly GameObject[]
  readonly containers?: GameState['containers']
  readonly links?: GameState['links']
  readonly variables?: Variables
  readonly cursor?: GameState['cursor']
  readonly internal?: Bag
}

/**
 * A linear board of `n` cells, one object per slot, tagged with its index.
 *
 * `tags.index` is the convention the client and the coach read a position from
 * (`coach/snapshot.ts::positionOf` checks it before guessing from an id), so
 * every object here carries it.
 */
export function buildBoard(options: BoardOptions): GameState {
  const { instance } = options
  const kind = options.kind ?? 'number'
  const op = options.objectPrefix ?? 'v'
  const sp = options.slotPrefix ?? 's'
  const values = kind === 'token' ? (instance.tokens ?? []) : instance.values
  const n = values.length

  const objects: Record<string, GameObject> = {}
  const slots: Record<string, Slot> = {}

  for (let i = 0; i < n; i++) {
    const raw = values[i]
    const id = `${op}${i}`
    const label = raw === undefined ? '' : String(raw)
    objects[id] = {
      id,
      kind: kind === 'token' ? 'token' : 'number',
      label,
      value: kind === 'token' ? undefined : num(raw, 0),
      slotId: `${sp}${i}`,
      visual: { kind: 'text', text: label },
      state: 'idle',
      tags: { index: i },
    }
    slots[`${sp}${i}`] = { id: `${sp}${i}`, index: i, kind: 'default', occupantId: id, state: 'idle' }
  }

  for (const extra of options.extras ?? []) objects[extra.id] = extra

  return {
    problemId: options.problemId,
    seed: instance.seed,
    instance,
    objects,
    slots,
    containers: options.containers ?? {},
    links: options.links ?? [],
    selection: [],
    cursor: options.cursor ?? {},
    variables: options.variables ?? {},
    progress: emptyProgressShape(),
    phase: 'playing',
    trace: [],
    internal: options.internal ?? {},
  }
}

/** Object id for a board index, given the prefix the board was built with. */
export function oid(index: number, prefix = 'v'): string {
  return `${prefix}${index}`
}

export function sid(index: number, prefix = 's'): string {
  return `${prefix}${index}`
}

/**
 * The index an object OCCUPIES, or -1.
 *
 * The SLOT TABLE is the authority on position, not `tags.index`. A tag says
 * which cell an object was BUILT for, and it is not updated by a swap — so
 * reading the tag first made the sort oracles ask for cell 3, be handed the
 * object that used to be in cell 3, and reject it as out of turn. The tag is
 * only a fallback for an object that is in no slot at all.
 */
export function indexOf(state: GameState, objectId: string): number {
  if (state.objects[objectId] === undefined) return -1
  for (const slot of Object.values(state.slots)) {
    if (slot.occupantId === objectId) return slot.index
  }
  return num(state.objects[objectId]?.tags?.['index'], -1)
}

/**
 * The value in a CELL, read through the slot table.
 *
 * NOT `objects[oid(i)].value`. That reads by IDENTITY, and an id stops being a
 * position the moment anything moves: `swapSlots` exchanges the objects between
 * slots but leaves their ids alone, so after one swap `v3` is sitting in cell 4
 * and `objects['v3'].value` is no longer what the learner sees in cell 3.
 *
 * Every algorithm that reorders its array hits this, and it fails QUIETLY: the
 * comparisons keep returning a valid `lt`/`eq`/`gt` so nothing throws, they are
 * just answers about the wrong cells, and the reference solution and the grading
 * disagree about a sort that looks correct in every other respect. The first
 * version of the sort oracles read by id and so sorted a copy of the array
 * rather than the board.
 */
export function valueAtIndex(
  state: GameState,
  index: number,
  slotPrefix = 's',
  objectPrefix = 'v',
): number | undefined {
  const occupant = state.slots[sid(index, slotPrefix)]?.occupantId
  if (occupant !== undefined) return state.objects[occupant]?.value
  // No slot table entry (a linked list, a stack): the id is the best available
  // reading when nothing has moved.
  return state.objects[oid(index, objectPrefix)]?.value
}

/** The object currently in a cell, whatever its id happens to be. */
export function occupantAtIndex(state: GameState, index: number, slotPrefix = 's'): string {
  return state.slots[sid(index, slotPrefix)]?.occupantId ?? oid(index)
}

/**
 * Swap the objects in two slots, keeping every derived view consistent.
 *
 * The object CARRIES its slot id, so a swap has to move both directions: put
 * the right occupant in each slot and put the right slot on each object. A
 * half-applied swap leaves the board disagreeing with itself, and every
 * comparison after it grades against the wrong cell.
 */
export function swapSlots(state: GameState, a: number, b: string | number, slotPrefix = 's'): void {
  const bi = typeof b === 'number' ? b : indexOfSlot(state, b, slotPrefix)
  if (a === bi || a < 0 || bi < 0) return
  const sa = state.slots[sid(a, slotPrefix)]
  const sb = state.slots[sid(bi, slotPrefix)]
  if (!sa || !sb) return
  const occupantA = sa.occupantId
  const occupantB = sb.occupantId
  if (occupantA !== undefined) {
    state.slots[sid(bi, slotPrefix)] = { ...sb, occupantId: occupantA }
    const obj = state.objects[occupantA]
    if (obj) obj.slotId = sid(bi, slotPrefix)
  }
  if (occupantB !== undefined) {
    state.slots[sid(a, slotPrefix)] = { ...sa, occupantId: occupantB }
    const obj = state.objects[occupantB]
    if (obj) obj.slotId = sid(a, slotPrefix)
  }
}

export function indexOfSlot(state: GameState, slotId: string, prefix = 's'): number {
  const slot = state.slots[slotId]
  if (slot !== undefined) return slot.index
  const trailing = /(\d+)$/.exec(slotId)
  const parsed = trailing?.[1] === undefined ? Number.NaN : Number.parseInt(trailing[1], 10)
  return Number.isInteger(parsed) ? parsed : -1
}

/** The value in a cell, or `undefined` for a token cell. */
export function valueAt(state: GameState, index: number, objectPrefix = 'v'): number | undefined {
  return state.objects[oid(index, objectPrefix)]?.value
}

/** Mark a half-open range of cells as out of play. */
export function markRange(state: GameState, from: number, to: number, slotPrefix = 's', objectPrefix = 'v'): void {
  if (to < from) return
  for (let k = from; k <= to; k++) {
    const slot = state.slots[sid(k, slotPrefix)]
    if (slot && slot.state !== 'eliminated') slot.state = 'eliminated'
    const obj = state.objects[oid(k, objectPrefix)]
    if (obj && obj.state !== 'eliminated') obj.state = 'eliminated'
  }
}

/**
 * Parse a submitted answer leniently.
 *
 * Accepts a bare number, a number inside prose, and a cell id like `v7` — the
 * player just pointed at a cell, so "the fourth one" and "index 4" are the
 * same answer and rejecting one of them teaches nothing.
 */
export function parseAnswer(raw: string): number | null {
  const text = String(raw).trim().toLowerCase()
  const match = /-?\d+/.exec(text)
  if (match === null) return null
  const value = Number.parseInt(match[0], 10)
  return Number.isInteger(value) ? value : null
}
