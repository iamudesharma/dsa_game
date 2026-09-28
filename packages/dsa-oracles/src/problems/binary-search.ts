/**
 * Binary search oracle — the deterministic proof of concept for the whole
 * oracle layer.
 *
 * Everything here is a pure function of the instance seed: no `Math.random`,
 * no clock, no I/O. Two calls with the same `BuildInstanceInput` must produce
 * byte-identical instances, and `applyAction` must never mutate its input, or
 * replays and the canonical post-game visualisation break.
 *
 * ---------------------------------------------------------------------------
 * CANONICAL LINE NUMBERING (shared by `code()`, `pseudocode()` and every
 * `TraceFrame.codeLine` this oracle emits)
 *
 *   1  function header / `def` / FUNCTION
 *   2      lo = 0
 *   3      hi = n - 1
 *   4  while (lo <= hi)
 *   5      mid = floor((lo + hi) / 2)
 *   6      if a[mid] === target -> return mid
 *   7      if a[mid] < target
 *   8          lo = mid + 1
 *   9      else
 *  10          hi = mid - 1
 *  11      end if
 *  12  end while
 *  13  return -1
 *  14  end function
 *
 * Python pads 11-14 with comments so `return -1` stays on line 13, and the
 * pseudocode fills the same slots with END IF / END WHILE / END FUNCTION. A
 * trace frame therefore highlights the *same statement* in every language.
 * ---------------------------------------------------------------------------
 *
 * RELATION CONVENTION (this trips people up, so it is pinned here once):
 * the `relation` of a `comparePair` is always read as `target REL middle`,
 * whatever order the two object ids were supplied in. When the middle element
 * is *lower* than the target, the correct declaration is `gt` ("the target is
 * greater than the thing I am holding"). Accepting both argument orders while
 * pinning the semantics keeps the mechanic forgiving about *which* card you
 * tap and strict about *what you claim*.
 *
 * Similarly, `choosePath` path ids describe the half that *survives*:
 * 'left' keeps indices `< mid` (`hi = mid - 1`, line 10) and 'right' keeps
 * indices `> mid` (`lo = mid + 1`, line 8).
 */

import type {
  Action,
  ActionOutcome,
  AnswerSummary,
  BuildInstanceInput,
  CodeLanguage,
  Complexity,
  DsaOp,
  GameObject,
  GameState,
  LegalActionDescriptor,
  Oracle,
  ProblemInstance,
  Relation,
  Slot,
  TraceFrame,
} from '@dsa/game-schema'
import {
  cloneState,
  dsaOpForAction,
  emptyProgress,
  getProblem,
  isActionType,
  linearSlots,
  makeRng,
  randInt,
} from '@dsa/game-schema'

const PROBLEM_ID = 'binary-search'

/** Difficulty curve. Overridable per call, always clamped to `instanceHints`. */
const DIFFICULTY_LENGTH: Readonly<Record<'easy' | 'medium' | 'hard', number>> = {
  easy: 8,
  medium: 12,
  hard: 16,
}

/**
 * A couple of wrong turns are recoverable so that one slip teaches instead of
 * ending the run. Losing the target from the window is fatal on its own and is
 * checked separately — that is the real consequence of a bad path choice.
 */
const MAX_WRONG_ANSWERS = 2

const OBJECT_PREFIX = 'v'
const TARGET_OBJECT_ID = 'target'

/** Bounds a single gameplay trace so a long session cannot grow unbounded. */
const HISTORY_LIMIT = 64

// ---------------------------------------------------------------------------
// Code listings
// ---------------------------------------------------------------------------

const LINE_SIGNATURE = 1
const LINE_LO_INIT = 2
const LINE_HI_INIT = 3
const LINE_MID = 5
const LINE_HIT = 6
const LINE_LT_TEST = 7
const LINE_LO_ASSIGN = 8
const LINE_HI_ASSIGN = 10
const LINE_RETURN_NOT_FOUND = 13
const CODE_LINE_COUNT = 14

/**
 * Statements 6 and 7 collapse a two-way branch into one line each, so the
 * JavaScript listing is the shortest form that still lines up with the
 * canonical numbering. Indentation is normalised to 2 spaces; the mapping
 * (and therefore every `codeLine`) is unchanged.
 */
const JS_LINES: readonly string[] = [
  'function binarySearch(a, target) {', // 1
  '  let lo = 0', // 2
  '  let hi = a.length - 1', // 3
  '  while (lo <= hi) {', // 4
  '    const mid = Math.floor((lo + hi) / 2)', // 5
  '    if (a[mid] === target) return mid', // 6
  '    if (a[mid] < target) {', // 7
  '      lo = mid + 1', // 8
  '    } else {', // 9
  '      hi = mid - 1', // 10
  '    }', // 11
  '  }', // 12
  '  return -1', // 13
  '}', // 14
]

/** Valid Python: lines 11-14 are comments, so `return -1` lands on 13. */
const PYTHON_LINES: readonly string[] = [
  'def binary_search(a, target):', // 1
  '    lo = 0', // 2
  '    hi = len(a) - 1', // 3
  '    while lo <= hi:', // 4
  '        mid = (lo + hi) // 2', // 5
  '        if a[mid] == target: return mid', // 6
  '        if a[mid] < target:', // 7
  '            lo = mid + 1', // 8
  '        else:', // 9
  '            hi = mid - 1', // 10
  '    # end while: the window is empty and no hit was recorded', // 11
  '    # a sentinel that can never be a real index', // 12
  '    return -1', // 13
  '    # end of function', // 14
]

const PSEUDO_LINES: readonly string[] = [
  'FUNCTION binarySearch(a, target)', // 1
  '    lo <- 0', // 2
  '    hi <- LENGTH(a) - 1', // 3
  '    WHILE lo <= hi', // 4
  '        mid <- FLOOR((lo + hi) / 2)', // 5
  '        IF a[mid] = target THEN RETURN mid', // 6
  '        IF a[mid] < target THEN', // 7
  '            lo <- mid + 1', // 8
  '        ELSE', // 9
  '            hi <- mid - 1', // 10
  '        END IF', // 11
  '    END WHILE', // 12
  '    RETURN -1', // 13
  'END FUNCTION', // 14
]

const LINES_BY_LANGUAGE: Readonly<Record<CodeLanguage, readonly string[]>> = {
  javascript: JS_LINES,
  // The JavaScript listing is already valid TypeScript.
  typescript: JS_LINES,
  python: PYTHON_LINES,
  // Not specialised yet: showing a listing in the wrong language beats
  // throwing inside a debrief render.
  java: JS_LINES,
  cpp: JS_LINES,
}

function listingFor(language: CodeLanguage): readonly string[] {
  return LINES_BY_LANGUAGE[language] ?? JS_LINES
}

/** The literal source line a `codeLine` points at. Never throws. */
function codeLineText(codeLine: number): string {
  return JS_LINES[codeLine - 1] ?? ''
}

/**
 * Rich, line-numbered listing for the debrief. Deliberately not part of the
 * `Oracle` interface, so it stays an extra export rather than widening the
 * contract every problem has to implement.
 */
export function annotatedCode(language: CodeLanguage): string[] {
  const notes: readonly string[] = [
    'function header: lo, hi, mid and the target are the only state we keep',
    'left edge of the live window',
    'right edge of the live window',
    'the loop runs while the window still holds at least one candidate',
    'the one element that splits the window in two',
    'hit: the target is at mid, so mid is the answer',
    'too small? then everything at or below mid is dead',
    'discard the left half (mid included)',
    'otherwise too large...',
    'discard the right half (mid included)',
    'end of the two-way branch',
    'window exhausted: the target is not in the array',
    'the "absent" sentinel, never a real index',
    'end of function',
  ]
  const head = [
    `// binary search — O(log n) time, O(1) space (${language})`,
    `// lines ${LINE_SIGNATURE}..${CODE_LINE_COUNT} are canonical and shared with every`,
    '// other language listing, so a trace frame points at the same statement',
    '// everywhere it is rendered.',
  ]
  const body = listingFor(language).map((line, i) => {
    const num = String(i + 1).padStart(2, ' ')
    const note = notes[i] ?? ''
    return note ? `${num} | ${line.padEnd(34)} // ${note}` : `${num} | ${line}`
  })
  return [...head, '', ...body]
}

// ---------------------------------------------------------------------------
// Internal bookkeeping
// ---------------------------------------------------------------------------

type PathDecision = 'left' | 'right' | 'found'

interface HistoryEntry {
  step: number
  kind: 'select' | 'compare' | 'path' | 'assign' | 'answer'
  index: number
  relation?: string
  path?: string
  correct: boolean
}

/**
 * `GameState.internal` is typed as flat scalars
 * (`Record<string, number | string | boolean | null>`), so the step history
 * lives there as a JSON string rather than an array. It stays plain JSON and
 * `structuredClone`-safe, which is all the state contract promises.
 */
interface BsInternal {
  lo: number
  hi: number
  /**
   * Current midpoint: the cell the player is expected to probe next. It is
   * seeded with the first probe so the very first `selectObject` is already
   * gradeable, and recomputed after every elimination. `-1` means the window
   * is empty, which can only happen on a run that has already been lost.
   */
  mid: number
  midChosen: boolean
  targetIndex: number
  found: boolean
  comparisons: number
  wrongAnswers: number
  /** JSON-encoded `HistoryEntry[]`. */
  history: string
  hasComparison: boolean
  /** '' when no comparison is pending, else 'lt' | 'eq' | 'gt'. */
  lastRelation: string
  /** The hit was reported; only `submitAnswer` is left. */
  terminated: boolean
  wrongPath: boolean
  answerValue: string
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function historyKind(value: unknown): HistoryEntry['kind'] {
  return value === 'compare' || value === 'path' || value === 'assign' || value === 'answer' ? value : 'select'
}

/** Defensive decode: internal is opaque to everything but this oracle. */
function readHistory(json: string): HistoryEntry[] {
  if (json === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: HistoryEntry[] = []
  for (const raw of parsed) {
    if (typeof raw !== 'object' || raw === null) continue
    const rec = raw as Record<string, unknown>
    const index = num(rec['index'], -1)
    if (index < 0) continue
    const entry: HistoryEntry = {
      step: num(rec['step'], 0),
      kind: historyKind(rec['kind']),
      index,
      correct: rec['correct'] === true,
    }
    if (typeof rec['relation'] === 'string') entry.relation = rec['relation']
    if (typeof rec['path'] === 'string') entry.path = rec['path']
    out.push(entry)
  }
  return out
}

function readInternal(state: GameState): BsInternal {
  const raw = state.internal
  return {
    lo: num(raw['lo'], 0),
    hi: num(raw['hi'], Math.max(0, state.instance.values.length - 1)),
    mid: num(raw['mid'], -1),
    midChosen: bool(raw['midChosen']),
    targetIndex: num(raw['targetIndex'], -1),
    found: bool(raw['found']),
    comparisons: num(raw['comparisons'], 0),
    wrongAnswers: num(raw['wrongAnswers'], 0),
    history: str(raw['history']),
    hasComparison: bool(raw['hasComparison']),
    lastRelation: str(raw['lastRelation']),
    terminated: bool(raw['terminated']),
    wrongPath: bool(raw['wrongPath']),
    answerValue: str(raw['answerValue']),
  }
}

function writeInternal(state: GameState, i: BsInternal): void {
  state.internal = {
    lo: i.lo,
    hi: i.hi,
    mid: i.mid,
    midChosen: i.midChosen,
    targetIndex: i.targetIndex,
    found: i.found,
    comparisons: i.comparisons,
    wrongAnswers: i.wrongAnswers,
    history: i.history,
    hasComparison: i.hasComparison,
    lastRelation: i.lastRelation,
    terminated: i.terminated,
    wrongPath: i.wrongPath,
    answerValue: i.answerValue,
  }
}

function pushHistory(i: BsInternal, entry: HistoryEntry): void {
  const all = readHistory(i.history)
  all.push(entry)
  i.history = JSON.stringify(all.length > HISTORY_LIMIT ? all.slice(-HISTORY_LIMIT) : all)
}

function valueAt(instance: ProblemInstance, index: number): number | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= instance.values.length) return undefined
  return instance.values[index]
}

function objectId(index: number): string {
  return `${OBJECT_PREFIX}${index}`
}

function parseObjectIndex(id: string): number | null {
  if (!id.startsWith(OBJECT_PREFIX)) return null
  const tail = id.slice(OBJECT_PREFIX.length)
  if (!/^\d+$/.test(tail)) return null
  return Number.parseInt(tail, 10)
}

function slotId(index: number): string {
  return `s${index}`
}

function isRelation(value: unknown): value is Relation {
  return value === 'lt' || value === 'eq' || value === 'gt'
}

/** Read as `target REL midValue`, per the file header. */
function relationFor(target: number, midValue: number): Relation {
  if (midValue < target) return 'gt'
  if (midValue > target) return 'lt'
  return 'eq'
}

function wordFor(relation: string): string {
  if (relation === 'lt') return 'below'
  if (relation === 'gt') return 'above'
  if (relation === 'eq') return 'level with'
  return 'compared to'
}

function expectedMidOf(i: BsInternal): number | null {
  if (i.lo > i.hi) return null
  return Math.floor((i.lo + i.hi) / 2)
}

/** The window no longer contains the target, or too many turns were wasted. */
function isUnrecoverable(i: BsInternal): boolean {
  return (
    i.lo > i.hi || i.targetIndex < i.lo || i.targetIndex > i.hi || i.wrongAnswers > MAX_WRONG_ANSWERS
  )
}

// ---------------------------------------------------------------------------
// Instance construction
// ---------------------------------------------------------------------------

interface InstanceHints {
  minLength: number
  maxLength: number
  range: [number, number]
}

function hints(): InstanceHints {
  const meta = getProblem(PROBLEM_ID)
  if (!meta) throw new Error(`@dsa/dsa-oracles: problem "${PROBLEM_ID}" is missing from game-schema`)
  const [rangeMin, rangeMax] = meta.instanceHints.valueRange ?? [1, 99]
  return {
    minLength: meta.instanceHints.minLength,
    maxLength: meta.instanceHints.maxLength,
    range: [rangeMin, rangeMax],
  }
}

/**
 * n distinct values inside [min, max], ascending. A partial Fisher-Yates over
 * the whole range makes this a uniform random subset, then a sort fixes the
 * order. A range too small for n is widened deterministically rather than
 * allowed to emit duplicates — duplicates would break the sorted-and-unique
 * precondition the whole problem rests on.
 */
function buildSortedUnique(rng: () => number, n: number, range: [number, number]): number[] {
  const [min, declaredMax] = range
  const max = declaredMax - min + 1 < n ? min + 99 * n : declaredMax
  const pool: number[] = []
  for (let v = min; v <= max; v++) pool.push(v)
  for (let i = 0; i < n && i < pool.length; i++) {
    const j = i + randInt(rng, 0, pool.length - 1 - i)
    const a = pool[i]
    const b = pool[j]
    if (a === undefined || b === undefined) break
    pool[i] = b
    pool[j] = a
  }
  return pool.slice(0, n).sort((a, b) => a - b)
}

function buildInstance(input: BuildInstanceInput): ProblemInstance {
  const { minLength, maxLength, range } = hints()
  const requested = input.length ?? DIFFICULTY_LENGTH[input.difficulty] ?? minLength
  const n = Math.max(1, Math.min(maxLength, Math.max(minLength, Math.trunc(requested))))

  const rng = makeRng(input.seed)
  const values = buildSortedUnique(rng, n, range)

  // The lesson is the halving loop, so the target must not be findable on the
  // first probe — a lucky first hit teaches nothing and makes the game look
  // like a two-click affair. Among the remaining interior positions, vary the
  // choice so replaying the same problem does not feel identical.
  const targetIndex = pickTeachingTargetIndex(rng, n)
  const target = values[targetIndex] ?? values[0] ?? 0

  return {
    problemId: PROBLEM_ID,
    seed: input.seed,
    values,
    target,
    slots: linearSlots(n),
    extras: {
      targetIndex,
      lo: 0,
      hi: n - 1,
      mid: Math.floor((0 + (n - 1)) / 2),
      found: false,
      comparisons: 0,
      steps: 0,
      wrongAnswers: 0,
      // Seeding value only: the played history is runtime state and lives in
      // `GameState.internal`, never on the shared instance.
      history: [] as unknown[],
    },
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function instanceTargetIndex(instance: ProblemInstance): number {
  const fromExtras = num(instance.extras?.['targetIndex'], -1)
  if (fromExtras >= 0 && fromExtras < instance.values.length) return fromExtras
  if (instance.target === undefined) return -1
  return instance.values.indexOf(instance.target)
}

/**
 * How many comparisons binary search needs to reach `index` in an array of
 * length `n`. Used only by the instance generator.
 */
function stepsToFind(n: number, index: number): number {
  let lo = 0
  let hi = n - 1
  let steps = 0
  while (lo <= hi) {
    steps += 1
    const mid = Math.floor((lo + hi) / 2)
    if (mid === index) return steps
    if (mid < index) lo = mid + 1
    else hi = mid - 1
  }
  return steps
}

/**
 * Pick a target position that forces the player to actually narrow the window.
 *
 * Two rules, in order of importance:
 *  1. the position must take at least two comparisons to reach, otherwise the
 *     halving loop never runs and a two-click game passes for a strategy;
 *  2. the position is interior — `1..n-2` — because the first probe and the
 *     final cell are edge cases a player can stumble into without having
 *     understood anything.
 * Every survivor is equally likely, so the same problem still feels different
 * on a replay with a new seed.
 */
function pickTeachingTargetIndex(rng: () => number, n: number): number {
  if (n <= 2) return 0
  const interior: number[] = []
  const multiStep: number[] = []
  for (let index = 1; index < n - 1; index += 1) {
    interior.push(index)
    if (stepsToFind(n, index) >= 2) multiStep.push(index)
  }
  // Tiny arrays can have every interior position one probe away; the
  // interior positions are still better than an endpoint.
  const pool = multiStep.length > 0 ? multiStep : interior
  const chosen = pool[randInt(rng, 0, pool.length - 1)]
  return chosen ?? 0
}

function initState(instance: ProblemInstance): GameState {
  const values = instance.values
  const n = values.length
  const targetIndex = instanceTargetIndex(instance)
  const lastIndex = Math.max(0, n - 1)
  const target = instance.target ?? 0

  const objects: Record<string, GameObject> = {}
  const slots: Record<string, Slot> = {}

  for (let i = 0; i < n; i++) {
    const value = values[i] ?? 0
    const id = objectId(i)
    objects[id] = {
      id,
      kind: 'number',
      label: String(value),
      value,
      slotId: slotId(i),
      visual: { kind: 'text', text: String(value) },
      state: 'idle',
      tags: { index: i },
    }
    slots[slotId(i)] = { id: slotId(i), index: i, kind: 'default', occupantId: id, state: 'idle' }
  }

  objects[TARGET_OBJECT_ID] = {
    id: TARGET_OBJECT_ID,
    kind: 'target',
    label: 'target',
    value: target,
    visual: { kind: 'text', text: String(target) },
    state: 'idle',
  }

  // The first mid must exist before the player's first move, otherwise there
  // is no correct selection to make and the game cannot be won. The board can
  // therefore show the mid pointer from the very first frame.
  const firstMid = Math.floor((0 + lastIndex) / 2)

  const state: GameState = {
    problemId: PROBLEM_ID,
    seed: instance.seed,
    instance,
    objects,
    slots,
    containers: {},
    links: [],
    selection: [],
    cursor: { loSlotId: slotId(0), midSlotId: slotId(firstMid), hiSlotId: slotId(lastIndex) },
    variables: {
      lo: 0,
      mid: firstMid,
      hi: lastIndex,
      target,
      comparisons: 0,
      steps: 0,
      found: false,
    },
    progress: emptyProgress(),
    phase: 'playing',
    trace: [],
    internal: {},
  }

  writeInternal(state, {
    lo: 0,
    hi: lastIndex,
    mid: firstMid,
    midChosen: false,
    targetIndex,
    found: false,
    comparisons: 0,
    wrongAnswers: 0,
    history: '[]',
    hasComparison: false,
    lastRelation: '',
    terminated: false,
    wrongPath: false,
    answerValue: '',
  })

  return state
}

// ---------------------------------------------------------------------------
// Trace frames
// ---------------------------------------------------------------------------

function eliminatedIds(state: GameState, i: BsInternal): string[] {
  const out: string[] = []
  for (let k = 0; k < state.instance.values.length; k++) {
    if (k < i.lo || k > i.hi) out.push(objectId(k))
  }
  return out
}

interface FrameSpec {
  codeLine: number
  dsaOp: DsaOp
  correct: boolean
  note: string
  current?: string
  compare?: string[]
  read?: string[]
}

function makeFrame(state: GameState, action: Action, i: BsInternal, spec: FrameSpec): TraceFrame {
  return {
    index: state.trace.length,
    action,
    codeLine: spec.codeLine,
    codeLineText: codeLineText(spec.codeLine),
    variables: {
      lo: i.lo,
      mid: i.mid,
      hi: i.hi,
      target: state.instance.target ?? null,
      comparisons: i.comparisons,
      steps: state.progress.steps,
      found: i.found,
    },
    pointers: {
      current: spec.current,
      compare: spec.compare,
      read: spec.read,
      eliminated: eliminatedIds(state, i),
    },
    dsaOp: spec.dsaOp,
    correct: spec.correct,
    note: spec.note,
  }
}

// ---------------------------------------------------------------------------
// State mutations shared by the action handlers
// ---------------------------------------------------------------------------

function markEliminated(state: GameState, from: number, to: number): void {
  if (to < from) return
  for (let k = from; k <= to; k++) {
    const slot = state.slots[slotId(k)]
    if (slot && slot.state !== 'eliminated') slot.state = 'eliminated'
    const obj = state.objects[objectId(k)]
    if (obj && obj.state !== 'eliminated') obj.state = 'eliminated'
  }
}

/** Bring slot/object elimination markers in line with the live window. */
function syncWindow(state: GameState, i: BsInternal): void {
  const n = state.instance.values.length
  if (i.lo - 1 >= 0) markEliminated(state, 0, i.lo - 1)
  if (i.hi + 1 < n) markEliminated(state, i.hi + 1, n - 1)
}

function syncCursorAndVars(state: GameState, i: BsInternal): void {
  state.cursor = {
    loSlotId: i.lo >= 0 ? slotId(i.lo) : undefined,
    hiSlotId: i.hi >= 0 ? slotId(i.hi) : undefined,
    // The mid is always known, so the pointer tracks `variables.mid` and
    // `internal.mid` at all times. Gating it on `midChosen` would blank the
    // pointer on exactly the turn the player needs to see it.
    midSlotId: i.mid >= 0 ? slotId(i.mid) : undefined,
  }
  state.variables = {
    lo: i.lo,
    mid: i.mid,
    hi: i.hi,
    target: state.instance.target ?? null,
    comparisons: i.comparisons,
    steps: state.progress.steps,
    found: i.found,
  }
}

function noteMistake(state: GameState, mechanic: string): void {
  state.progress.mistakes += 1
  const bucket = state.progress.mistakesByMechanic
  bucket[mechanic] = num(bucket[mechanic], 0) + 1
}

/** End of turn bookkeeping: mirror the window, then check for a dead run. */
function applyEndOfTurn(state: GameState, i: BsInternal): void {
  syncWindow(state, i)
  syncCursorAndVars(state, i)
  if (isUnrecoverable(i) && state.phase === 'playing') state.phase = 'lost'
}

interface Rejection {
  feedback: string
  dsaOp: DsaOp
  codeLine: number
  note: string
}

function illegal(
  state: GameState,
  action: Action,
  r: Rejection,
): { nextState: GameState; outcome: ActionOutcome } {
  // Illegal means "this move never happened": the only permitted deltas are
  // the step counter and the single trace frame the contract requires.
  const next = cloneState(state)
  next.progress.steps += 1
  const index = next.trace.length
  next.trace.push(makeFrame(next, action, readInternal(next), {
    codeLine: r.codeLine,
    dsaOp: r.dsaOp,
    correct: false,
    note: r.note,
  }))
  return {
    nextState: next,
    outcome: { correct: false, illegal: true, feedback: r.feedback, dsaOp: r.dsaOp, traceStep: index },
  }
}

function legal(
  next: GameState,
  action: Action,
  i: BsInternal,
  spec: FrameSpec,
  outcome: Omit<ActionOutcome, 'traceStep'>,
): { nextState: GameState; outcome: ActionOutcome } {
  next.progress.steps += 1
  const index = next.trace.length
  next.trace.push(makeFrame(next, action, i, spec))
  writeInternal(next, i)
  return { nextState: next, outcome: { ...outcome, traceStep: index } }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function handleSelectObject(state: GameState, action: Extract<Action, { type: 'selectObject' }>) {
  const i = readInternal(state)
  const n = state.instance.values.length
  const target = state.instance.target ?? 0

  if (typeof action.objectId !== 'string' || state.objects[action.objectId] === undefined) {
    return illegal(state, action, {
      feedback: 'That object is not on the board.',
      dsaOp: 'read',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: unknown objectId',
    })
  }

  if (i.terminated) {
    return illegal(state, action, {
      feedback: 'The target is already located. Commit the index.',
      dsaOp: 'read',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: search already terminated',
    })
  }

  const next = cloneState(state)
  const correctMid = expectedMidOf(i)
  const correctId = correctMid === null ? '' : objectId(correctMid)

  // Selecting the target card itself is a legal-but-empty move: it can never
  // advance the algorithm, so it is graded as a mistake, not as an error.
  if (action.objectId === TARGET_OBJECT_ID) {
    noteMistake(next, 'selectObject')
    i.wrongAnswers += 1
    return legal(
      next,
      action,
      i,
      {
        codeLine: LINE_MID,
        dsaOp: 'read',
        correct: false,
        note: 'the target is the needle, not a candidate',
        current: TARGET_OBJECT_ID,
        read: [TARGET_OBJECT_ID],
      },
      {
        correct: false,
        expected: correctId === '' ? { type: 'selectObject' } : { type: 'selectObject', objectId: correctId },
        feedback: `The target ${target} is what you are hunting for, not a candidate to probe. Read the middle element of the window instead.`,
        dsaOp: 'read',
      },
    )
  }

  const picked = parseObjectIndex(action.objectId)
  if (picked === null || picked >= n) {
    return illegal(state, action, {
      feedback: 'That object is not part of the array.',
      dsaOp: 'read',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: objectId is not an array element',
    })
  }

  // Re-selecting the element already sitting at mid is a double-submit of the
  // same turn, not a new turn.
  if (i.midChosen && picked === i.mid) {
    return illegal(state, action, {
      feedback: `Index ${picked} is already the middle. Declare how it compares to the target.`,
      dsaOp: 'read',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: repeated selection of the current mid',
    })
  }

  const correct = picked === correctMid
  if (!correct) {
    noteMistake(next, 'selectObject')
    i.wrongAnswers += 1
  }

  // Adopt the player's pick even when it is off-centre: the whole point of
  // the mechanic is that they see where a bad probe leads. `mid` is
  // therefore the *current* probe, not a promise that it is the true one.
  i.mid = picked
  i.midChosen = true
  i.hasComparison = false
  i.lastRelation = ''

  next.selection = [action.objectId]
  const obj = next.objects[action.objectId]
  if (obj && obj.state !== 'eliminated') obj.state = 'selected'

  pushHistory(i, { step: next.progress.steps, kind: 'select', index: picked, correct })

  const value = valueAt(state.instance, picked) ?? 0
  return legal(
    next,
    action,
    i,
    {
      codeLine: LINE_MID,
      dsaOp: 'read',
      correct,
      note: correct ? `mid = ${picked}` : `mid should be ${correctMid}`,
      current: action.objectId,
      read: [action.objectId],
    },
    {
      correct,
      expected: correct ? undefined : { type: 'selectObject', objectId: correctId },
      feedback: correct
        ? `Index ${picked} is the midpoint of [${i.lo}, ${i.hi}]. It holds ${value}.`
        : `The midpoint of [${i.lo}, ${i.hi}] is index ${correctMid}, not ${picked}. Probing off-centre throws away the halving.`,
      dsaOp: 'read',
    },
  )
}

function handleComparePair(state: GameState, action: Extract<Action, { type: 'comparePair' }>) {
  const i = readInternal(state)
  const target = state.instance.target

  if (typeof action.aId !== 'string' || typeof action.bId !== 'string') {
    return illegal(state, action, {
      feedback: 'A comparison needs two objects.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: incomplete comparePair',
    })
  }
  if (state.objects[action.aId] === undefined || state.objects[action.bId] === undefined) {
    return illegal(state, action, {
      feedback: 'One of those objects is not on the board.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: unknown objectId in comparePair',
    })
  }
  if (!isRelation(action.relation)) {
    return illegal(state, action, {
      feedback: 'The relation must be lt, eq or gt.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: malformed relation',
    })
  }
  if (!i.midChosen || i.mid < 0) {
    return illegal(state, action, {
      feedback: 'Choose the middle element before comparing.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: compare before select',
    })
  }
  if (i.hasComparison) {
    return illegal(state, action, {
      feedback: 'That comparison is already on the record. Now choose which half to keep.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: comparison already recorded',
    })
  }
  if (target === undefined) {
    return illegal(state, action, {
      feedback: 'This instance has no target to compare against.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: instance without a target',
    })
  }

  const midObjId = objectId(i.mid)
  const touchesMid = action.aId === midObjId || action.bId === midObjId
  const touchesTarget = action.aId === TARGET_OBJECT_ID || action.bId === TARGET_OBJECT_ID
  if (!touchesMid || !touchesTarget) {
    return illegal(state, action, {
      feedback: 'Compare the middle element against the target, nothing else.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: comparePair is not mid-vs-target',
    })
  }

  const midValue = valueAt(state.instance, i.mid)
  if (midValue === undefined) {
    return illegal(state, action, {
      feedback: 'The middle element is no longer in the window.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: mid index out of range',
    })
  }

  const next = cloneState(state)
  const trueRelation = relationFor(target, midValue)
  const correct = action.relation === trueRelation

  if (!correct) {
    noteMistake(next, 'comparePair')
    i.wrongAnswers += 1
  } else {
    i.comparisons += 1
    i.hasComparison = true
    i.lastRelation = trueRelation
  }

  const obj = next.objects[midObjId]
  if (obj && correct) obj.state = 'visited'
  next.selection = [midObjId, TARGET_OBJECT_ID]

  pushHistory(i, { step: next.progress.steps, kind: 'compare', index: i.mid, relation: String(action.relation), correct })

  // A wrong comparison deliberately leaves lo/hi alone: the algorithm stays
  // put until the player reads the values correctly.
  return legal(
    next,
    action,
    i,
    {
      codeLine: trueRelation === 'eq' ? LINE_HIT : LINE_LT_TEST,
      dsaOp: 'compare',
      correct,
      note: `${String(action.relation)} declared, ${trueRelation} is the truth`,
      current: midObjId,
      compare: [midObjId, TARGET_OBJECT_ID],
      read: [midObjId],
    },
    {
      correct,
      expected: correct
        ? undefined
        : { type: 'comparePair', aId: midObjId, bId: TARGET_OBJECT_ID, relation: trueRelation },
      feedback: correct
        ? `Mid holds ${midValue} and the target is ${target}: the target is ${wordFor(trueRelation)} it, so "${trueRelation}" holds.`
        : `Mid holds ${midValue} and the target is ${target}, so the relation is "${trueRelation}" — the target is ${wordFor(trueRelation)} the middle. Nothing was discarded, read it again.`,
      dsaOp: 'compare',
    },
  )
}

/**
 * Resolve a `pathId` into a direction. 'left'/'right' are literal, 'found'/'eq'
 * mean "the hit is here", and a slot id means "keep the side of the middle
 * that still holds the target", which is what a tap-the-half UI sends.
 */
function resolvePathId(pathId: string, i: BsInternal, mid: number): PathDecision | null {
  if (pathId === 'left' || pathId === 'right') return pathId
  if (pathId === 'found' || pathId === 'eq') return 'found'
  if (pathId.startsWith('s') && /^\d+$/.test(pathId.slice(1))) {
    if (i.targetIndex === mid) return 'found'
    return i.targetIndex < mid ? 'left' : 'right'
  }
  return null
}

function handleChoosePath(state: GameState, action: Extract<Action, { type: 'choosePath' }>) {
  const i = readInternal(state)

  if (typeof action.fromId !== 'string' || state.objects[action.fromId] === undefined) {
    return illegal(state, action, {
      feedback: 'That object is not on the board.',
      dsaOp: 'choose-path',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: unknown objectId in choosePath',
    })
  }
  if (!i.midChosen || i.mid < 0) {
    return illegal(state, action, {
      feedback: 'Choose the middle element first.',
      dsaOp: 'choose-path',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: choosePath before select',
    })
  }
  if (!i.hasComparison) {
    return illegal(state, action, {
      feedback: 'Compare first — the comparison is what tells you which half survives.',
      dsaOp: 'choose-path',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: choosePath before compare',
    })
  }

  const midObjId = objectId(i.mid)
  if (action.fromId !== midObjId) {
    return illegal(state, action, {
      feedback: 'Branches are taken from the middle element.',
      dsaOp: 'choose-path',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: choosePath fromId is not the mid',
    })
  }

  const decision = resolvePathId(String(action.pathId), i, i.mid)
  if (decision === null) {
    return illegal(state, action, {
      feedback: 'Choose left, right, or the hit itself.',
      dsaOp: 'choose-path',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: unresolvable pathId',
    })
  }

  const next = cloneState(state)
  const correctPath: PathDecision =
    i.lastRelation === 'eq' ? 'found' : i.targetIndex < i.mid ? 'left' : 'right'
  const correct = decision === correctPath
  const decidedAt = i.mid
  const midValue = valueAt(state.instance, i.mid) ?? 0

  if (!correct) {
    noteMistake(next, 'choosePath')
    i.wrongAnswers += 1
    i.wrongPath = true
  }

  if (decision === 'found') {
    const obj = next.objects[midObjId]
    if (obj) obj.state = 'matched'
    i.terminated = true
  } else if (decision === 'left') {
    // Nothing from mid+1 up to the old hi can hold the target any more.
    markEliminated(next, i.mid + 1, i.hi)
    i.hi = i.mid - 1
  } else {
    markEliminated(next, i.lo, i.mid - 1)
    i.lo = i.mid + 1
  }

  // The turn is over either way: a new turn needs a fresh select + compare.
  i.midChosen = false
  i.hasComparison = false
  i.lastRelation = ''
  const nextMid = expectedMidOf(i)
  i.mid = nextMid === null ? -1 : nextMid
  next.selection = []

  pushHistory(i, { step: next.progress.steps, kind: 'path', index: decidedAt, path: decision, correct })
  applyEndOfTurn(next, i)

  const dsaOp: DsaOp = decision === 'found' ? 'terminate' : 'choose-path'
  return legal(
    next,
    action,
    i,
    {
      codeLine: decision === 'found' ? LINE_HIT : decision === 'left' ? LINE_HI_ASSIGN : LINE_LO_ASSIGN,
      dsaOp,
      correct,
      note: correct
        ? decision === 'found'
          ? `found at ${midObjId}`
          : `keep ${decision}, window [${i.lo}, ${i.hi}]`
        : `kept ${decision}, the target left the window`,
      current: decision === 'found' ? midObjId : undefined,
      compare: [midObjId, TARGET_OBJECT_ID],
    },
    {
      correct,
      expected: correct ? undefined : { type: 'choosePath', fromId: midObjId, pathId: correctPath },
      feedback: correct
        ? decision === 'found'
          ? `Index ${i.mid} holds ${midValue} — that is the target. Commit the answer.`
          : `Keeping the ${decision} half: the window is [${i.lo}, ${i.hi}], ${Math.max(0, i.hi - i.lo + 1)} element(s) left.`
        : `That half never held the target, and index ${i.targetIndex} has just been ruled out. The window is [${i.lo}, ${i.hi}] and the search is over.`,
      dsaOp,
      won: false,
    },
  )
}

function handleAssignValue(state: GameState, action: Extract<Action, { type: 'assignValue' }>) {
  const i = readInternal(state)
  const n = state.instance.values.length

  if (action.targetId !== 'lo' && action.targetId !== 'mid' && action.targetId !== 'hi') {
    return illegal(state, action, {
      feedback: 'Only lo, mid and hi can be assigned here.',
      dsaOp: 'assign',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: unknown assignValue target',
    })
  }
  const parsed = Number.parseInt(String(action.value).trim(), 10)
  if (!Number.isInteger(parsed)) {
    return illegal(state, action, {
      feedback: 'That value is not a whole number.',
      dsaOp: 'assign',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: malformed assignValue',
    })
  }
  if (parsed < 0 || parsed > n - 1) {
    return illegal(state, action, {
      feedback: `Indices run from 0 to ${n - 1}.`,
      dsaOp: 'assign',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: assignValue outside the array',
    })
  }

  const next = cloneState(state)
  // Before the first select, `mid` is still uncomputed; grade against the
  // midpoint the algorithm would compute rather than against the sentinel.
  const liveMid = i.mid >= 0 ? i.mid : expectedMidOf(i) ?? 0
  const expected = action.targetId === 'lo' ? i.lo : action.targetId === 'mid' ? liveMid : i.hi
  const orderingOk =
    action.targetId === 'lo'
      ? parsed <= i.hi
      : action.targetId === 'hi'
        ? parsed >= i.lo
        : parsed >= i.lo && parsed <= i.hi
  const correct = orderingOk && parsed === expected

  if (correct) {
    if (action.targetId === 'lo') i.lo = parsed
    else if (action.targetId === 'hi') i.hi = parsed
    // Moving a bound by hand invalidates the pending turn: the window changed.
    i.midChosen = false
    i.hasComparison = false
    i.lastRelation = ''
    const recomputed = expectedMidOf(i)
    i.mid = action.targetId === 'mid' ? parsed : recomputed === null ? -1 : recomputed
  } else {
    // Unlike the other three actions, a wrong assignment is reported but NOT
    // applied. `assignValue` is the optional power-user shortcut, so the
    // window must never end up in a shape the algorithm itself could not
    // produce (lo > hi + 1, say) just because someone typed a number.
    noteMistake(next, 'assignValue')
    i.wrongAnswers += 1
  }

  pushHistory(i, { step: next.progress.steps, kind: 'assign', index: parsed, path: action.targetId, correct })
  applyEndOfTurn(next, i)

  const codeLine =
    action.targetId === 'lo' ? LINE_LO_INIT : action.targetId === 'hi' ? LINE_HI_INIT : LINE_MID
  const assignedObject = next.objects[objectId(parsed)]
  return legal(
    next,
    action,
    i,
    {
      codeLine,
      dsaOp: 'assign',
      correct,
      note: correct ? `${action.targetId} = ${parsed}` : `${action.targetId} should be ${expected}`,
      current: action.targetId === 'mid' && assignedObject ? objectId(parsed) : undefined,
    },
    {
      correct,
      expected: correct ? undefined : { type: 'assignValue', targetId: action.targetId, value: String(expected) },
      feedback: correct
        ? `${action.targetId} is now ${parsed}.`
        : `${action.targetId} should be ${expected}; the window is [${i.lo}, ${i.hi}] with mid ${i.mid}.`,
      dsaOp: 'assign',
    },
  )
}

/**
 * Accept both readings of the answer, because "index 7" and "the value 62" are
 * the same question for a player who just pointed at a cell. Cell ids such as
 * `v7` / `s7` are accepted too.
 */
function parseAnswer(raw: string): number | null {
  const text = String(raw).trim().toLowerCase()
  const match = text.match(/-?\d+/)
  if (!match || match.index === undefined) return null
  const value = Number.parseInt(match[0], 10)
  return Number.isInteger(value) ? value : null
}

function handleSubmitAnswer(state: GameState, action: Extract<Action, { type: 'submitAnswer' }>) {
  const i = readInternal(state)
  const n = state.instance.values.length
  const target = state.instance.target

  const submitted = parseAnswer(String(action.value))
  if (submitted === null) {
    return illegal(state, action, {
      feedback: 'Submit a whole number — the index of the target, or the target value itself.',
      dsaOp: 'terminate',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: malformed submitAnswer',
    })
  }
  if (target === undefined || i.targetIndex < 0) {
    return illegal(state, action, {
      feedback: 'This instance has no target to report.',
      dsaOp: 'terminate',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: instance without a target',
    })
  }

  const next = cloneState(state)
  i.answerValue = String(submitted)
  const asIndex = submitted === i.targetIndex && submitted >= 0 && submitted < n
  const asValue = submitted === target
  const correct = asIndex || asValue
  const winner = next.objects[objectId(i.targetIndex)]

  if (correct) {
    i.found = true
    next.phase = 'won'
    if (winner) winner.state = 'revealed'
  } else {
    noteMistake(next, 'submitAnswer')
    i.wrongAnswers += 1
    next.phase = 'lost'
  }
  i.terminated = true
  next.selection = []

  pushHistory(i, { step: next.progress.steps, kind: 'answer', index: submitted, correct })
  // Sync the window first, then decide: a committed win must never be undone
  // by the mistake check that exists for `choosePath`/`assignValue`.
  applyEndOfTurn(next, i)
  next.phase = correct ? 'won' : 'lost'

  return legal(
    next,
    action,
    i,
    {
      codeLine: LINE_RETURN_NOT_FOUND,
      dsaOp: 'terminate',
      correct,
      note: correct ? `target is at index ${i.targetIndex}` : `submitted ${submitted}, truth is index ${i.targetIndex}`,
      current: objectId(i.targetIndex),
      read: [objectId(i.targetIndex), TARGET_OBJECT_ID],
    },
    {
      correct,
      expected: correct ? undefined : { type: 'submitAnswer', targetId: action.targetId, value: String(i.targetIndex) },
      feedback: correct
        ? `Correct — the target ${target} sits at index ${i.targetIndex}, reached in ${i.comparisons} comparison(s).`
        : `The target ${target} is at index ${i.targetIndex}, not ${submitted}. ${i.comparisons} comparison(s) were not enough to pin it down.`,
      dsaOp: 'terminate',
      won: correct,
    },
  )
}

// Derived from the catalogue so the oracle can never accept a mechanic the
// problem does not declare.
const ALLOWED_ACTION_TYPES: ReadonlySet<string> = new Set(
  (getProblem(PROBLEM_ID)?.allowedMechanics ?? []).filter(isActionType),
)

function applyAction(state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  // A non-object action is outside the contract but must not throw: the
  // debrief renders whatever frame comes back.
  const move: Action =
    typeof action === 'object' && action !== null ? action : { type: 'selectObject', objectId: '' }

  if (!isActionType(move.type) || !ALLOWED_ACTION_TYPES.has(move.type)) {
    return illegal(state, move, {
      feedback: `${String(move.type)} is not a move in this problem.`,
      dsaOp: isActionType(move.type) ? dsaOpForAction(move) : 'read',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: action type not allowed for this problem',
    })
  }
  if (state.phase !== 'playing') {
    return illegal(state, move, {
      feedback: 'The run is already over.',
      dsaOp: dsaOpForAction(move),
      codeLine: LINE_SIGNATURE,
      note: `rejected: phase is ${state.phase}`,
    })
  }

  switch (move.type) {
    case 'selectObject':
      return handleSelectObject(state, move)
    case 'comparePair':
      return handleComparePair(state, move)
    case 'choosePath':
      return handleChoosePath(state, move)
    case 'assignValue':
      return handleAssignValue(state, move)
    case 'submitAnswer':
      return handleSubmitAnswer(state, move)
    default:
      return illegal(state, move, {
        feedback: 'That move is not handled here.',
        dsaOp: dsaOpForAction(move),
        codeLine: LINE_SIGNATURE,
        note: 'rejected: unhandled action type',
      })
  }
}

// ---------------------------------------------------------------------------
// Win condition, canonical trace, reporting
// ---------------------------------------------------------------------------

function isWin(state: GameState): boolean {
  return state.phase === 'won' || state.internal['found'] === true
}

/**
 * The correct run, simulated in isolation over the instance. Deliberately
 * reads none of the player's bookkeeping: the canonical visualisation must
 * show the ideal search even after a disastrous game.
 */
function canonicalTrace(state: GameState, playedTrace?: TraceFrame[]): TraceFrame[] {
  const instance = state.instance
  const values = instance.values
  const target = instance.target
  const n = values.length
  const frames: TraceFrame[] = []
  const truthIndex = instanceTargetIndex(instance)

  const vars = (lo: number, mid: number, hi: number, comparisons: number) => ({
    lo,
    mid,
    hi,
    target: target ?? null,
    comparisons,
  })

  if (target === undefined) {
    frames.push({
      index: 0,
      action: { type: 'submitAnswer', targetId: 'answer', value: '-1' },
      codeLine: LINE_RETURN_NOT_FOUND,
      codeLineText: codeLineText(LINE_RETURN_NOT_FOUND),
      variables: vars(0, -1, n - 1, 0),
      pointers: { eliminated: [] },
      dsaOp: 'terminate',
      correct: true,
      note: 'no target on this instance',
    })
    return frames
  }

  let lo = 0
  let hi = n - 1
  let comparisons = 0
  let answer = -1
  const eliminated = new Set<string>()

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const midId = objectId(mid)
    const midValue = values[mid] ?? 0
    // `relation` reads target-vs-mid, so 'gt' means the mid is too small and
    // the right half survives.
    const relation = relationFor(target, midValue)

    frames.push({
      index: frames.length,
      action: { type: 'selectObject', objectId: midId },
      codeLine: LINE_MID,
      codeLineText: codeLineText(LINE_MID),
      variables: vars(lo, mid, hi, comparisons),
      pointers: { current: midId, read: [midId], eliminated: [...eliminated] },
      dsaOp: 'read',
      correct: true,
      note: `mid = ${mid} (window ${lo}..${hi})`,
    })

    frames.push({
      index: frames.length,
      action: { type: 'comparePair', aId: midId, bId: TARGET_OBJECT_ID, relation },
      codeLine: relation === 'eq' ? LINE_HIT : LINE_LT_TEST,
      codeLineText: codeLineText(relation === 'eq' ? LINE_HIT : LINE_LT_TEST),
      variables: vars(lo, mid, hi, comparisons),
      pointers: { current: midId, compare: [midId, TARGET_OBJECT_ID], eliminated: [...eliminated] },
      dsaOp: 'compare',
      correct: true,
      note: `a[${mid}] = ${midValue} vs target ${target} -> ${relation}`,
    })

    if (relation === 'eq') {
      answer = mid
      break
    }

    comparisons += 1
    if (relation === 'gt') {
      // Target sits above mid, so the left half (lo..mid) dies and lo jumps
      // past it. A Set keeps the pointer list free of repeats when a later
      // window re-covers ground a previous step had already dropped.
      for (let k = lo; k <= mid; k++) eliminated.add(objectId(k))
      lo = mid + 1
    } else {
      // Target sits below mid, so the right half (mid..hi) dies.
      for (let k = mid; k <= hi; k++) eliminated.add(objectId(k))
      hi = mid - 1
    }

    frames.push({
      index: frames.length,
      action: { type: 'choosePath', fromId: midId, pathId: relation === 'gt' ? 'right' : 'left' },
      codeLine: relation === 'gt' ? LINE_LO_ASSIGN : LINE_HI_ASSIGN,
      codeLineText: codeLineText(relation === 'gt' ? LINE_LO_ASSIGN : LINE_HI_ASSIGN),
      variables: vars(lo, mid, hi, comparisons),
      pointers: { current: midId, eliminated: [...eliminated] },
      dsaOp: 'choose-path',
      correct: true,
      note: `${relation === 'gt' ? 'lo' : 'hi'} = ${relation === 'gt' ? lo : hi}, window ${lo}..${hi}`,
    })
  }

  const found = answer >= 0 && answer === truthIndex
  const finalFrame: TraceFrame = {
    index: frames.length,
    action: { type: 'submitAnswer', targetId: 'answer', value: String(answer) },
    codeLine: LINE_RETURN_NOT_FOUND,
    codeLineText: codeLineText(LINE_RETURN_NOT_FOUND),
    variables: vars(lo, -1, hi, comparisons),
    pointers: { current: found ? objectId(truthIndex) : undefined, eliminated: [...eliminated] },
    dsaOp: 'terminate',
    correct: true,
    note: found ? `found: target ${target} at index ${truthIndex}` : 'target absent from the array',
  }

  // `playedTrace` is commentary only: it may add a note, never a frame and
  // never a change of correctness.
  const mistakes = (playedTrace ?? []).filter((f) => f.correct === false).length
  frames.push(
    mistakes > 0
      ? { ...finalFrame, note: `${finalFrame.note} (player made ${mistakes} misstep(s))` }
      : finalFrame,
  )

  return frames
}

function legalActions(state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const i = readInternal(state)
  const mid = expectedMidOf(i)

  if (i.terminated) {
    return [{ type: 'submitAnswer', label: 'Commit the index of the target', expects: 'value' }]
  }
  if (!i.midChosen) {
    const inWindow: string[] = []
    for (let k = Math.max(0, i.lo); k <= Math.min(state.instance.values.length - 1, i.hi); k++) {
      inWindow.push(objectId(k))
    }
    return [
      {
        type: 'selectObject',
        label: mid === null ? 'Choose the middle element' : `Choose index ${mid}, the middle of [${i.lo}, ${i.hi}]`,
        options: { objectIds: inWindow },
        expects: 'none',
      },
    ]
  }
  if (!i.hasComparison) {
    return [
      {
        type: 'comparePair',
        label: 'Declare how the middle compares to the target',
        options: { objectIds: [objectId(i.mid), TARGET_OBJECT_ID] },
        expects: 'relation',
      },
    ]
  }
  return [
    {
      type: 'choosePath',
      label: i.lastRelation === 'eq' ? 'Report the hit' : 'Keep the half that can still hold the target',
      options: { objectIds: [objectId(i.mid)] },
      expects: 'none',
    },
  ]
}

function answerSummary(state: GameState): AnswerSummary {
  const i = readInternal(state)
  const targetIndex = i.targetIndex >= 0 ? i.targetIndex : instanceTargetIndex(state.instance)
  return {
    text: `index ${targetIndex}`,
    value: targetIndex,
    details: [
      { label: 'target', value: state.instance.target ?? 0 },
      { label: 'comparisons', value: i.comparisons },
      { label: 'array length', value: state.instance.values.length },
    ],
  }
}

function complexity(): Complexity {
  return {
    time: 'O(log n)',
    space: 'O(1)',
    best: 'O(1)',
    worst: 'O(log n)',
    average: 'O(log n)',
    note: 'Every comparison halves the search space.',
  }
}

export function createBinarySearchOracle(): Oracle {
  return {
    problemId: PROBLEM_ID,
    buildInstance,
    initState,
    legalActions,
    applyAction,
    isWin,
    canonicalTrace,
    pseudocode: () => [...PSEUDO_LINES],
    code: (language: CodeLanguage) => [...listingFor(language)],
    complexity,
    answerSummary,
  }
}
