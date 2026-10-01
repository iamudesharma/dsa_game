/**
 * Kth largest with a size-k min-heap, played with real swaps.
 *
 * THE BOARD. One linear lane in two zones: slots [0, k) are the heap (a valid
 * min-heap from the first move — the generator heapifies the first k values
 * into place, and the player is told so), slots [k, n) are the unscanned
 * values. Every operation is physical: a replacement is a `swapPair` of the
 * scan cell with the root, and sift-down is `comparePair` + `swapPair` inside
 * the heap zone. The evicted minimum lands in the consumed scan cell — behind
 * the read pointer, exactly like move-zeroes' tail — so it is never read
 * again and the board never lies about what the algorithm still needs.
 *
 * OBJECT IDENTITY. A swap moves objects, not ids, so the plan tracks occupants
 * per slot (the sorts.ts approach): frames name the object currently in a
 * slot, and the reference values array `H` mirrors the board slot-for-slot.
 * Reading by id after a swap would grade against the wrong cell.
 */
import type {
  Action,
  ActionOutcome,
  BuildInstanceInput,
  Complexity,
  GameState,
  LegalActionDescriptor,
  Oracle,
  ProblemInstance,
  Relation,
  TraceFrame,
} from '@dsa/game-schema'
import {
  cloneState,
  dsaOpForAction,
  getProblem,
  linearSlots,
  makeRng,
  randInt,
  PROBLEM_IDS,
} from '@dsa/game-schema'
import {
  buildBoard,
  finishIllegal,
  indexOf,
  num,
  occupantAtIndex,
  oid,
  swapSlots,
  valueAtIndex,
  type CodeLang,
} from '../shared/kernel.js'

const PROBLEM_ID = 'kth-largest-heap' as const

function relation(a: number, b: number): Relation {
  return a < b ? 'lt' : a > b ? 'gt' : 'eq'
}

// ------------------------------------------------------------ heap arithmetic

function siftDown(a: number[], p: number, k: number): void {
  for (;;) {
    const left = 2 * p + 1
    const right = 2 * p + 2
    let smallest = p
    if (left < k && a[left]! < a[smallest]!) smallest = left
    if (right < k && a[right]! < a[smallest]!) smallest = right
    if (smallest === p) return
    const tmp = a[p]!
    a[p] = a[smallest]!
    a[smallest] = tmp
    p = smallest
  }
}

function heapify(a: number[], k: number): void {
  for (let p = Math.floor(k / 2) - 1; p >= 0; p--) siftDown(a, p, k)
}

/** K for the difficulty: the heap every game maintains. Always leaves scan values. */
function heapSize(n: number, difficulty: BuildInstanceInput['difficulty']): number {
  const want = difficulty === 'easy' ? 2 : difficulty === 'hard' ? 4 : 3
  return Math.max(2, Math.min(n - 1, want))
}

// ------------------------------------------------------------------ instance

function buildInstance(input: BuildInstanceInput): ProblemInstance {
  const meta = getProblem(PROBLEM_ID)
  if (!meta) throw new Error(`${PROBLEM_ID} is missing from the catalogue`)
  const { minLength, maxLength, valueRange } = meta.instanceHints
  const defaultLength =
    input.difficulty === 'easy' ? minLength : input.difficulty === 'hard' ? maxLength : Math.round((minLength + maxLength) / 2)
  const n = Math.max(4, Math.min(maxLength, Math.max(minLength, Math.trunc(input.length ?? defaultLength))))
  const rng = makeRng(input.seed)
  const [min, max] = valueRange ?? [1, 99]
  const pool: number[] = []
  while (pool.length < n) {
    const v = randInt(rng, min, max)
    if (!pool.includes(v)) pool.push(v)
  }
  const k = heapSize(n, input.difficulty)
  heapify(pool, k)
  return {
    problemId: PROBLEM_ID, seed: input.seed, values: pool, slots: linearSlots(n),
    extras: { difficulty: input.difficulty, k },
  }
}

function initState(instance: ProblemInstance): GameState {
  const k = num(instance.extras?.['k'], 3)
  const state = buildBoard({
    problemId: PROBLEM_ID,
    instance,
    variables: { i: k, k, heapMin: instance.values[0] ?? 0, n: instance.values.length },
  })
  state.internal = { planIndex: 0 }
  return state
}

// ---------------------------------------------------------------------- plan

interface HeapPlan {
  actions: Action[]
  answer: number
}

function planFor(instance: ProblemInstance): HeapPlan {
  const v = instance.values
  const n = v.length
  const k = num(instance.extras?.['k'], 3)
  // H mirrors the board slot-for-slot; occupants mirror object identity.
  const H = [...v]
  const occupants: string[] = v.map((_, s) => oid(s))
  const actions: Action[] = []

  const swap = (s1: number, s2: number): void => {
    const t = H[s1]!
    H[s1] = H[s2]!
    H[s2] = t
    const o = occupants[s1]!
    occupants[s1] = occupants[s2]!
    occupants[s2] = o
  }

  for (let i = k; i < n; i++) {
    actions.push({ type: 'selectObject', objectId: occupants[i]! })
    const rel = relation(H[i]!, H[0]!)
    actions.push({ type: 'comparePair', aId: occupants[i]!, bId: occupants[0]!, relation: rel })
    if (rel !== 'gt') continue
    // The scan value takes the root; the evicted minimum drops into the
    // consumed scan cell, behind the read pointer.
    actions.push({ type: 'swapPair', aId: occupants[i]!, bId: occupants[0]! })
    swap(i, 0)
    let p = 0
    for (;;) {
      const left = 2 * p + 1
      const right = 2 * p + 2
      let smallest = p
      if (left < k && H[left]! < H[smallest]!) smallest = left
      if (right < k && H[right]! < H[smallest]!) smallest = right
      if (smallest === p) break
      actions.push({ type: 'comparePair', aId: occupants[p]!, bId: occupants[smallest]!, relation: 'gt' })
      actions.push({ type: 'swapPair', aId: occupants[p]!, bId: occupants[smallest]! })
      swap(p, smallest)
      p = smallest
    }
  }
  actions.push({ type: 'submitAnswer', targetId: occupants[0]!, value: String(H[0]) })
  return { actions, answer: H[0]! }
}

function actionsFor(instance: ProblemInstance): Action[] {
  return planFor(instance).actions
}

// ------------------------------------------------------------------ metadata

function codeLine(action: Action): number {
  if (action.type === 'submitAnswer') return 10
  if (action.type === 'selectObject') return 4
  if (action.type === 'comparePair') return 5
  if (action.type === 'swapPair') return 6
  return 1
}

const LISTING: readonly string[] = [
  'function kthLargest(a, k) {', // 1
  '  const heap = a.slice(0, k)', // 2
  '  heapify(heap)', // 3
  '  for (let i = k; i < a.length; i++) {', // 4
  '    if (a[i] > heap[0]) {', // 5
  '      heap[0] = a[i]', // 6
  '      siftDown(heap, 0)', // 7
  '    }', // 8
  '  }', // 9
  '  return heap[0]', // 10
  '}', // 11
]

const PSEUDOCODE: readonly string[] = [
  'FUNCTION kthLargest(a, k)',
  '    heap <- first k values, heapified (minimum at the root)',
  '    FOR i FROM k TO LENGTH(a) - 1',
  '        IF a[i] > heap minimum',
  '            REPLACE the root with a[i] and SIFT DOWN',
  '    END FOR',
  '    RETURN the heap root',
  'END FUNCTION',
]

function complexity(): Complexity {
  const meta = getProblem(PROBLEM_ID)!
  return { ...meta.complexity }
}

function answerSummary(state: GameState) {
  // Brute force: the kth largest of the ORIGINAL values. Sorting a copy here
  // cannot disagree with the heap walk, because both answer the same question.
  const k = num(state.instance.extras?.['k'], 3)
  const ranked = [...state.instance.values].sort((a, b) => b - a)
  const answer = ranked[k - 1] ?? 0
  return {
    text: `kth largest (k=${k}) is ${answer}`,
    value: answer,
    details: [
      { label: 'k', value: k },
      { label: 'heap minimum', value: answer },
      { label: 'array length', value: state.instance.values.length },
    ],
  }
}

// ------------------------------------------------------------------ gameplay

function legalActions(state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') return [{ type: next.type, label: 'Read the next scan value', options: { objectIds: [next.objectId] } }]
  if (next.type === 'comparePair') {
    return [{ type: next.type, label: 'Is this value larger than the heap minimum?', options: { objectIds: [next.aId, next.bId] }, expects: 'relation' }]
  }
  if (next.type === 'swapPair') {
    return [{ type: next.type, label: 'Exchange with the heap root and restore the heap', options: { objectIds: [next.aId, next.bId] } }]
  }
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Report the kth largest value', expects: 'value', options: { objectIds: [next.targetId] } }]
  }
  return [{ type: next.type, label: 'Continue the algorithm.' }]
}

function ctx() {
  return {
    codeLineText: (line: number) => LISTING[line - 1] ?? '',
    variables: (state: GameState) => ({ ...state.variables }),
    write: (_state: GameState) => {},
  }
}

function sameAction(a: Action, b: Action): boolean {
  const clean = (action: Action) => {
    const { actionId: _id, ...rest } = action
    return rest
  }
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b))
}

function valueOf(state: GameState, index: number): number {
  return num(valueAtIndex(state, index), Number.NaN)
}

function applyAction(state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  const step = num(state.internal['planIndex'], 0)
  const expected = actionsFor(state.instance)[step]
  if (state.phase !== 'playing' || !expected || !sameAction(action, expected)) {
    return finishIllegal(state, action, {
      feedback: expected ? `The next algorithm step is ${expected.type}; follow the highlighted item and try that operation.` : 'This game is already complete.',
      dsaOp: dsaOpForAction(action),
      codeLine: expected ? codeLine(expected) : 1,
      note: 'This action is not legal for the current algorithm step.',
      ...ctx(),
    })
  }

  const next = cloneState(state)
  next.internal['planIndex'] = step + 1
  let feedback = 'That is the next step in the algorithm.'
  let note = `${action.type} advances the algorithm.`
  let compare: string[] | undefined
  let current: string | undefined
  const dsaOp = dsaOpForAction(action)

  switch (action.type) {
    case 'selectObject': {
      next.selection = [action.objectId]
      if (next.objects[action.objectId]) next.objects[action.objectId]!.state = 'current'
      const position = indexOf(next, action.objectId)
      if (position >= 0) {
        next.variables['i'] = position
        if (next.slots[`s${position}`]) next.cursor.iSlotId = `s${position}`
      }
      current = action.objectId
      note = `Read ${next.objects[action.objectId]?.label ?? action.objectId}.`
      break
    }
    case 'comparePair': {
      next.selection = [action.aId, action.bId]
      compare = [action.aId, action.bId]
      note = action.relation === 'eq' ? 'The values match.' : `The relation is ${action.relation}.`
      break
    }
    case 'swapPair': {
      const a = indexOf(next, action.aId)
      const b = indexOf(next, action.bId)
      swapSlots(next, a, b)
      next.selection = [action.aId, action.bId]
      compare = [action.aId, action.bId]
      // The heap minimum always sits at the root, whatever just moved there.
      next.variables['heapMin'] = valueOf(next, 0)
      feedback = 'The larger value takes the heap; the heap property is restored.'
      note = 'Exchange and sift the heap back into shape.'
      break
    }
    case 'submitAnswer': {
      next.phase = 'won'
      next.variables['answer'] = action.value
      feedback = 'Correct. The algorithm is complete.'
      note = 'Commit the result.'
      break
    }
    default:
      return finishIllegal(state, action, { feedback: 'This problem does not use that operation.', dsaOp: dsaOpForAction(action), codeLine: 1, note: 'Unsupported operation.', ...ctx() })
  }

  next.progress.steps += 1
  const code = codeLine(action)
  const frame: TraceFrame = {
    index: next.trace.length,
    action,
    codeLine: code,
    codeLineText: LISTING[code - 1] ?? '',
    variables: { ...next.variables },
    pointers: { ...(current ? { current } : {}), ...(compare ? { compare } : {}) },
    dsaOp,
    correct: true,
    note,
  }
  next.trace.push(frame)
  return { nextState: next, outcome: { correct: true, feedback, dsaOp, traceStep: frame.index, ...(next.phase === 'won' ? { won: true } : {}) } }
}

function canonicalTrace(state: GameState): TraceFrame[] {
  let current = initState(state.instance)
  const frames: TraceFrame[] = []
  for (const action of actionsFor(state.instance)) {
    const result = applyAction(current, action)
    if (result.outcome.illegal) break
    current = result.nextState
    const frame = current.trace[current.trace.length - 1]
    if (frame) frames.push(frame)
  }
  return frames
}

// ------------------------------------------------------------------- export

export function createKthLargestHeapOracle(): Oracle {
  return {
    problemId: PROBLEM_ID,
    buildInstance,
    initState,
    legalActions,
    applyAction,
    isWin: (state) => state.phase === 'won',
    canonicalTrace,
    pseudocode: () => [...PSEUDOCODE],
    code: (_language: CodeLang) => [...LISTING],
    complexity,
    answerSummary,
  }
}

/** Guard used by the registry test: the id must be in the catalogue. */
if (!PROBLEM_IDS.includes(PROBLEM_ID)) throw new Error(`${PROBLEM_ID} is not in PROBLEM_IDS`)
