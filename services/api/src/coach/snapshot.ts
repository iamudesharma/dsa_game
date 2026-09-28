/**
 * The board, flattened for a model that cannot read our live state.
 *
 * WHY A SNAPSHOT AT ALL: a `GameState` is a nested mutable object with slots,
 * objects, containers, links, cursor ids and an opaque `internal` bag. Handing
 * that to a language model is expensive (the board alone is hundreds of tokens
 * once serialised) and, worse, confusing: ids without positions, an `internal`
 * bag full of oracle bookkeeping that means nothing outside the oracle, and
 * `eliminated` markers that contradict the window. `GuidancePromptSnapshot` is
 * every field a scalar, in the order the learner would describe the board, which
 * makes prompts both cheaper and less likely to be misread.
 *
 * PURE, BY CONTRACT: the same (state, spec, oracle, turnPrompt) always produces
 * the same snapshot. The coach calls this on every turn while the game continues
 * underneath, and a snapshot that drifted between the build and the send would
 * make the coach describe a board the learner has already left.
 */

import { getProblem } from '@dsa/game-schema'
import type { GameSpec, GameObject, GameState, GuidancePromptSnapshot, Oracle, TurnPrompt } from '@dsa/game-schema'

export interface BuildSnapshotInput {
  readonly state: GameState
  readonly spec: GameSpec
  readonly oracle: Oracle
  readonly turnPrompt: TurnPrompt
}

/**
 * Total by design. A snapshot is a nicety attached to a question, so a malformed
 * state yields a sparser snapshot rather than a 500: the learner's question is
 * still worth answering even if we cannot describe the board perfectly.
 */
export function buildSnapshot(input: BuildSnapshotInput): GuidancePromptSnapshot {
  const { state, spec, oracle, turnPrompt } = input
  const values = Array.isArray(state.instance.values) ? state.instance.values : []
  const window = readBounds(state)

  return {
    problemId: state.problemId,
    // The CATALOGUE title, not the theme's: the field is `problemTitle`, and a
    // model reasoning about "Find the target in a sorted array" is reasoning about
    // the algorithm. The theme arrives through `goal`, `instruction` and
    // `targetLabel`, which are the fields the coach is meant to speak from.
    problemTitle: getProblem(oracle.problemId)?.title ?? oracle.problemId,
    board: values.map((value, index) => ({
      // The object's own label wins when the oracle has themed it; otherwise the
      // raw value, because a model's spatial reasoning is about VALUES and a
      // fabricated label would only add a translation it might get wrong.
      label: boardLabel(state, index, value),
      value: typeof value === 'number' && Number.isFinite(value) ? value : null,
    })),
    // The theme's word for the target, e.g. "the vault". This is the noun the
    // coach is expected to use when it talks about what is being hunted.
    targetLabel: spec.vocabulary.target.trim(),
    targetValue: finiteOrNull(state.instance.target),
    lo: window.lo,
    mid: window.mid,
    hi: window.hi,
    eliminated: collectEliminated(state, window),
    step: state.progress.steps,
    mistakes: state.progress.mistakes,
    lastMistakeDsaOp: lastMistakeOp(state),
    phase: state.phase,
    goal: turnPrompt.goal,
    instruction: turnPrompt.instruction,
    complexity: complexityLine(oracle, spec),
  }
}

/**
 * `lo` / `mid` / `hi` as BOARD INDICES, not slot ids.
 *
 * The state expresses the window twice: as `variables.lo/mid/hi` numbers, and as
 * `cursor.{lo,mid,hi}SlotId` pointer strings. Only the first is directly usable,
 * and the second has to go through the slot table to become a position — a model
 * reading `loSlotId: 's3'` learns the string, not the place, and would have to
 * guess. `variables` is therefore authoritative and the cursor is the fallback,
 * which also covers an oracle that moves its pointer before it updates its
 * variables.
 *
 * A slot's `index` is the position, not its id: ids are chosen by the oracle and
 * carry no ordering guarantee, so `s3` need not be the fourth slot. A missing or
 * malformed bound becomes `null`, which the prompt renders as "not applicable"
 * rather than as zero — a wrong position is worse than an absent one.
 */
function readBounds(state: GameState): { lo: number | null; mid: number | null; hi: number | null } {
  const variables = state.variables
  return {
    lo: intOrNull(variables['lo']) ?? slotPosition(state, state.cursor.loSlotId),
    mid: usableMid(intOrNull(variables['mid']) ?? slotPosition(state, state.cursor.midSlotId)),
    hi: intOrNull(variables['hi']) ?? slotPosition(state, state.cursor.hiSlotId),
  }
}

/** `-1` is the "window is empty" sentinel, never a real position. */
function usableMid(mid: number | null): number | null {
  if (mid === null) return null
  return mid >= 0 ? mid : null
}

function slotPosition(state: GameState, slotId: string | undefined): number | null {
  if (typeof slotId !== 'string' || slotId === '') return null
  const slot = state.slots[slotId]
  if (slot !== undefined && Number.isInteger(slot.index) && slot.index >= 0) return slot.index
  // Fall back to the id's own number only when the slot table has no entry. A
  // non-numeric id (a path id, a container id) yields null rather than NaN.
  const trailing = /(\d+)$/.exec(slotId)
  const parsed = trailing?.[1] === undefined ? NaN : Number.parseInt(trailing[1], 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

/**
 * Positions already ruled out, as numbers.
 *
 * Three sources, unioned, because different oracles express "ruled out"
 * differently and the coach is more useful with a slightly generous set than with
 * a set that is empty when it should not be:
 *
 *   1. the complement of [lo, hi] — exact for every window-based problem;
 *   2. the last trace frame's `pointers.eliminated` — the ORACLE's own record of
 *      what it discarded, which is the source the debrief replays, so a
 *      disagreement between this list and the replay would be a visible bug;
 *   3. objects flagged `state === 'eliminated'` — the renderer's view, and the
 *      only source for a problem that rules things out without a window.
 *
 * (1) and (2) agree for a window problem, so the union is a set, not a fudge. (3)
 * can only add positions the oracle itself marked dead.
 */
function collectEliminated(state: GameState, window: { lo: number | null; hi: number | null }): number[] {
  const out = new Set<number>()
  const total = state.instance.values.length

  if (window.lo !== null && window.hi !== null && window.lo >= 0 && window.hi >= 0) {
    for (let i = 0; i < total; i += 1) {
      if (i < window.lo || i > window.hi) out.add(i)
    }
  }

  const lastFrame = state.trace[state.trace.length - 1]
  for (const id of lastFrame?.pointers.eliminated ?? []) {
    const index = positionOf(id, state)
    if (index !== null) out.add(index)
  }

  for (const [id, object] of Object.entries(state.objects)) {
    if (object.state !== 'eliminated') continue
    const index = positionOf(id, state)
    if (index !== null) out.add(index)
  }

  return [...out].sort((a, b) => a - b)
}

/**
 * An object id to a board position.
 *
 * The oracle decides ids and the interface does not promise a scheme, so the
 * board position is read from the object itself where possible (`tags.index` is
 * the convention the mechanics catalog establishes) and only then guessed from the
 * id's shape. A path id like `left` has no digits and resolves to null.
 */
function positionOf(id: string, state: GameState): number | null {
  const tagged = tagIndex(state.objects[id])
  if (tagged !== null) return tagged

  const slot = Object.values(state.slots).find((candidate) => candidate.occupantId === id)
  if (slot !== undefined && Number.isInteger(slot.index) && slot.index >= 0) return slot.index

  const trailing = /(\d+)$/.exec(id)
  const parsed = trailing?.[1] === undefined ? NaN : Number.parseInt(trailing[1], 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function tagIndex(object: GameObject | undefined): number | null {
  const raw = object?.tags?.['index']
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null
}

/**
 * The label the learner actually reads on a cell.
 *
 * Preference order: the theme's own glyph for that value (so "the lantern" reads
 * as the lantern), then the object's own label when it is a WORD rather than a
 * bare number, then the number. Bare numbers are kept as labels on purpose — the
 * coach's whole job here is reasoning about values, and relabelling them would
 * cost tokens and invite the model to reason about the wrong thing.
 */
function boardLabel(state: GameState, index: number, value: number): string {
  const id = objectIdAt(state, index)
  const glyph = id === null ? undefined : state.objects[id]?.visual
  if (glyph?.kind === 'emoji' && glyph.glyph.trim() !== '') return glyph.glyph

  const object = id === null ? undefined : state.objects[id]
  const own = object?.label
  if (typeof own === 'string' && own.trim() !== '' && /[a-z]/i.test(own) && own.trim() !== 'target') {
    return own.trim()
  }
  return String(value)
}

function objectIdAt(state: GameState, index: number): string | null {
  const byTag = Object.entries(state.objects).find(([, object]) => object.tags?.['index'] === index)
  if (byTag !== undefined) return byTag[0]
  const bySlot = Object.values(state.slots).find((slot) => slot.index === index)?.occupantId
  if (bySlot !== undefined) return bySlot
  return null
}

/**
 * The most recent mistake, named by OPERATION rather than by answer.
 *
 * `lastMistakeDsaOp` is a `DsaOp` (`'choose-path'`, `'compare'`, ...), which is
 * precisely why the contract phrases the field as "phrased without naming the
 * answer". A model told "their last mistake was choosing a path" can coach the
 * decision; a model told "their last mistake was choosing the left half at index
 * 3" is being handed the algorithm.
 */
function lastMistakeOp(state: GameState): string | null {
  for (let i = state.trace.length - 1; i >= 0; i -= 1) {
    const frame = state.trace[i]
    // An `illegal` frame is a mis-click, not a misconception: the engine does not
    // count it as a mistake either, so the coach must not coach it.
    if (frame === undefined) continue
    if (frame.correct) continue
    if (frame.note.includes('rejected:')) continue
    return frame.dsaOp
  }
  return null
}

/**
 * The complexity, in the form a learner can be told.
 *
 * The oracle is preferred over the catalogue because the oracle is what actually
 * ran. It is `O(log n)` for binary search, and that is one of the most motivating
 * facts in the whole problem — but it is only safe to mention because a
 * complexity bound is a property of the METHOD and can never be the position of a
 * particular target.
 */
function complexityLine(oracle: Oracle, spec: GameSpec): string {
  try {
    const complexity = oracle.complexity()
    if (complexity !== undefined) {
      const time = complexity.time.trim()
      const space = complexity.space.trim()
      if (time !== '') return space === '' ? time : `${time} time, ${space} space`
    }
  } catch {
    // A broken oracle still leaves the catalogue's bound below.
  }
  const meta = getProblem(spec.problemId)
  if (meta === undefined) return 'unspecified'
  return `${meta.complexity.time} time, ${meta.complexity.space} space`
}

function intOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null
  return value
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
