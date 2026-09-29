/**
 * The comparison sorts: bubble sort and selection sort.
 *
 * WHY ONE FILE FOR TWO PROBLEMS. They are the same loop shape — an outer pass,
 * an inner walk of adjacent or unsorted cells, a comparison, and a swap — and
 * writing them as two files would have duplicated every line that is not the
 * one that differs. What actually differs is ONE decision: what the inner walk
 * compares.
 *
 *   bubble    compare a[j] with a[j+1], swap when out of order. After each pass
 *             the largest unsorted value has bubbled to the end.
 *   selection compare a[j] with the running minimum, and swap ONCE at the end
 *             of the pass. Always exactly one swap per pass.
 *
 * That difference is the whole lesson — bubble does many swaps and selection
 * does exactly n-1 — so it is expressed as a `strategy` string and a branch,
 * never as two copies of the loop.
 *
 * RELATION CONVENTION, pinned as in every oracle here: the relation of a
 * `comparePair` is read as `aId REL bId`, whatever order the two ids arrived
 * in. "The cell to my right is the smaller one" is `lt`.
 *
 * A WRONG SWAP IS APPLIED, NOT REFUSED. This is the one place the "a wrong
 * move is a claim" rule deliberately does not apply: swapping two values is a
 * real operation on the board, and the contract says a wrong-but-legal move
 * must be applied so the mistake stays visible and teachable. The learner
 * watches the array scramble and then has to keep going. A refused swap would
 * teach nothing, because nothing would have happened.
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
import { PROBLEM_IDS, getProblem, makeRng, randInt } from '@dsa/game-schema'

import {
  bool,
  buildBoard,
  finishIllegal,
  finishLegal,
  indexOf,
  num,
  oid,
  parseAnswer,
  sid,
  str,
  occupantAtIndex,
  swapSlots,
  valueAtIndex,
  type CodeLang,
} from '../shared/kernel.js'

type Strategy = 'bubble' | 'selection'

interface SortSpec {
  readonly id: string
  readonly strategy: Strategy
  /** Past this index the cell is in its final place. */
  readonly passes: (n: number) => number
}

const SORTS: Readonly<Record<string, SortSpec>> = {
  'bubble-sort': { id: 'bubble-sort', strategy: 'bubble', passes: (n) => n - 1 },
  'selection-sort': { id: 'selection-sort', strategy: 'selection', passes: (n) => n - 1 },
}

// --------------------------------------------------------------- line numbers

const L_SIG = 1
const L_PASS = 2
const L_INNER = 3
const L_TEST = 4
const L_SWAP = 6
const L_INNER_END = 8
const L_PASS_END = 9
const L_RETURN = 10
const L_COUNT = 11

/**
 * One listing, two algorithms.
 *
 * The line numbers are shared deliberately: the debrief highlights the same
 * statements for both problems, and the only difference the reader sees is the
 * `if` body — which is the part that is actually different.
 */
const JS_LINES: readonly string[] = [
  'function sort(a) {', //  1
  '  for (let pass = 0; pass < n - 1; pass++) {', //  2
  '    for (let j = 0; j < n - 1 - pass; j++) {', //  3
  '      if (a[j] > a[j + 1]) {', //  4
  '        // out of order', //  5
  '        swap(a, j, j + 1)', //  6
  '      }', //  7
  '    }', //  8
  '  }', //  9
  '  return a', // 10
  '}', // 11
]

const TS_LINES: readonly string[] = [
  'function sort(a: number[]): number[] {', //  1
  '  for (let pass = 0; pass < a.length - 1; pass++) {', //  2
  '    for (let j = 0; j < a.length - 1 - pass; j++) {', //  3
  '      if (a[j]! > a[j + 1]!) {', //  4
  '        // out of order', //  5
  '        [a[j], a[j + 1]] = [a[j + 1]!, a[j]!]', //  6
  '      }', //  7
  '    }', //  8
  '  }', //  9
  '  return a', // 10
  '}', // 11
]

const PY_LINES: readonly string[] = [
  'def sort(a):', //  1
  '    for pass_ in range(len(a) - 1):', //  2
  '        for j in range(len(a) - 1 - pass_):', //  3
  '            if a[j] > a[j + 1]:', //  4
  '                # out of order', //  5
  '                a[j], a[j + 1] = a[j + 1], a[j]', //  6
  '            # END IF', //  7
  '        # END FOR', //  8
  '    # END FOR', //  9
  '    return a', // 10
  '# END FUNCTION', // 11
]

const CPP_LINES: readonly string[] = [
  'std::vector<int> sort(std::vector<int> a) {', //  1
  '  int n = (int)a.size();', //  2
  '  for (int pass = 0; pass < n - 1; pass++) {', //  3
  '    for (int j = 0; j < n - 1 - pass; j++) {', //  4
  '      if (a[j] > a[j + 1]) {', //  5
  '        std::swap(a[j], a[j + 1]);', //  6
  '      }', //  7
  '    }', //  8
  '  }', //  9
  '  return a;', // 10
  '}', // 11
]

const JAVA_LINES: readonly string[] = [
  'int[] sort(int[] a) {', //  1
  '  int n = a.length;', //  2
  '  for (int pass = 0; pass < n - 1; pass++) {', //  3
  '    for (int j = 0; j < n - 1 - pass; j++) {', //  4
  '      if (a[j] > a[j + 1]) {', //  5
  '        int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t;', //  6
  '      }', //  7
  '    }', //  8
  '  }', //  9
  '  return a;', // 10
  '}', // 11
]

const NOTES: readonly string[] = [
  'sort in place and hand the array back',
  'one pass per cell that still has to move',
  'the inner walk, and it gets shorter every pass',
  'the only decision either sort makes',
  'these two are the wrong way round',
  'exchange them — this is the swap, and it is the expensive part',
  'end of the if',
  'end of the inner walk',
  'end of the pass: the tail is now final',
  'the array, in order',
  'end of function',
]

function listingFor(language: CodeLang): readonly string[] {
  if (language === 'python') return PY_LINES
  if (language === 'typescript') return TS_LINES
  if (language === 'java') return JAVA_LINES
  if (language === 'cpp') return CPP_LINES
  return JS_LINES
}

function codeLineText(language: CodeLang, line: number): string {
  return listingFor(language)[line - 1] ?? ''
}

function pseudocodeFor(strategy: Strategy): string[] {
  const test = strategy === 'bubble' ? 'a[j] > a[j + 1]' : 'a[j] < a[min]'
  const swap = strategy === 'bubble' ? 'SWAP a[j], a[j + 1]' : 'SWAP a[i], a[min]'
  return [
    'FUNCTION sort(a)',
    '    FOR pass FROM 0 TO LENGTH(a) - 2',
    '        FOR j FROM 0 TO LENGTH(a) - 2 - pass',
    `            IF ${test} THEN`,
    `                ${swap}`,
    '            END IF',
    '        END FOR',
    '    END FOR',
    '    RETURN a',
    'END FUNCTION',
    '',
  ]
}

// ------------------------------------------------------------------- instance

interface SortInternal {
  /** The outer pass, 0-based. */
  pass: number
  /** The inner cursor. */
  j: number
  /** Selection sort's running minimum, as a board index. */
  min: number
  /** Selection sort's anchor for this pass. */
  anchor: number
  /** The inner step the player is asked to perform next. */
  awaiting: 'select' | 'compare' | 'swap' | 'commit'
  /** The two indices the pending compare or swap refers to. */
  a: number
  b: number
  comparisons: number
  swaps: number
  wrong: number
  answerValue: string
  terminated: boolean
}

function readInternal(state: GameState): SortInternal {
  const raw = state.internal
  const n = state.instance.values.length
  const awaiting = str(raw['awaiting'])
  return {
    pass: num(raw['pass'], 0),
    j: num(raw['j'], 0),
    min: num(raw['min'], 0),
    anchor: num(raw['anchor'], 0),
    awaiting:
      awaiting === 'select' || awaiting === 'compare' || awaiting === 'swap' || awaiting === 'commit'
        ? awaiting
        : 'select',
    a: num(raw['a'], 0),
    b: num(raw['b'], 1),
    comparisons: num(raw['comparisons'], 0),
    swaps: num(raw['swaps'], 0),
    wrong: num(raw['wrong'], 0),
    answerValue: str(raw['answerValue']),
    terminated: bool(raw['terminated']),
    void: n,
  } as SortInternal
}

function writeInternal(state: GameState, i: SortInternal): void {
  state.internal = {
    pass: i.pass,
    j: i.j,
    min: i.min,
    anchor: i.anchor,
    awaiting: i.awaiting,
    a: i.a,
    b: i.b,
    comparisons: i.comparisons,
    swaps: i.swaps,
    wrong: i.wrong,
    answerValue: i.answerValue,
    terminated: i.terminated,
  }
}

/**
 * The value in a CELL.
 *
 * `valueAtIndex`, not `objects[oid(i)].value`: a swap moves the object but not
 * its id, so after the first swap an id no longer names a position. Reading by
 * id made the oracle grade against a different array than the reference sorted,
 * which is exactly the disagreement `playability.test.ts` reported.
 */
function valueOf(state: GameState, index: number): number {
  return num(valueAtIndex(state, index), Number.NaN)
}

/** The two cells the next inner step compares, for this strategy. */
function pairFor(spec: SortSpec, n: number, i: SortInternal): { a: number; b: number } {
  if (spec.strategy === 'bubble') return { a: i.j, b: i.j + 1 }
  return { a: i.j, b: i.min }
}

function relationFor(av: number, bv: number): Relation {
  if (av > bv) return 'gt'
  if (av < bv) return 'lt'
  return 'eq'
}

// --------------------------------------------------------------------- board

function buildInstance(spec: SortSpec, input: BuildInstanceInput): ProblemInstance {
  const meta = getProblem(spec.id)
  if (meta === undefined) throw new Error(`${spec.id} is missing from the catalogue`)
  const { minLength, maxLength, valueRange } = meta.instanceHints
  const defaultLength = input.difficulty === 'easy'
    ? minLength
    : input.difficulty === 'hard'
      ? maxLength
      : Math.round((minLength + maxLength) / 2)
  const requested = input.length ?? defaultLength
  const n = Math.max(3, Math.min(maxLength, Math.max(minLength, Math.trunc(requested))))

  const rng = makeRng(input.seed)
  const [min, max] = valueRange ?? [1, 99]
  // Distinct, so `gt` and `eq` never coincide and the comparison is a real
  // three-way decision. A duplicate would make a correct swap look wrong.
  const pool: number[] = []
  while (pool.length < n) {
    const v = randInt(rng, min, max)
    if (!pool.includes(v)) pool.push(v)
  }
  // Never ship a sorted array: it would teach nothing and the first comparison
  // would be the last swap.
  const values = shuffle(pool, rng)
  if (values.every((v, k) => k === 0 || (values[k - 1] ?? 0) <= v)) {
    const last = values.pop() as number
    values.unshift(last)
  }

  return {
    problemId: spec.id,
    seed: input.seed,
    values,
    slots: Array.from({ length: n }, (_, k) => ({ id: sid(k), index: k, kind: 'default' as const })),
  }
}

function shuffle(values: number[], rng: () => number): number[] {
  const out = [...values]
  for (let k = out.length - 1; k > 0; k--) {
    const p = Math.floor(rng() * (k + 1))
    const a = out[k] as number
    out[k] = out[p] as number
    out[p] = a
  }
  return out
}

function initState(spec: SortSpec, instance: ProblemInstance): GameState {
  const n = instance.values.length
  const state = buildBoard({
    problemId: spec.id,
    instance,
    variables: { pass: 0, j: 0, min: 0, comparisons: 0, swaps: 0, steps: 0, n },
    cursor: { jSlotId: sid(0) },
  })
  // Selection sort's inner walk starts at 1 with the anchor already at 0,
  // because cell 0 is the running minimum from the start and comparing a cell
  // with itself teaches nothing. Bubble sort starts at 0 with the neighbour.
  const first = pairFor(spec, n, { j: spec.strategy === 'selection' ? 1 : 0, min: 0 } as SortInternal)
  writeInternal(state, {
    pass: 0,
    j: spec.strategy === 'selection' ? 1 : 0,
    min: 0,
    anchor: 0,
    awaiting: 'select',
    a: first.a,
    b: first.b,
    comparisons: 0,
    swaps: 0,
    wrong: 0,
    answerValue: '',
    terminated: false,
  })
  return state
}

// --------------------------------------------------------------------- frames

function variablesFor(state: GameState, i: SortInternal) {
  const n = state.instance.values.length
  return {
    pass: i.pass,
    j: i.j,
    min: i.min,
    comparisons: i.comparisons,
    swaps: i.swaps,
    steps: state.progress.steps,
    n,
    a_j: valueOf(state, i.j),
    a_next: valueOf(state, i.j + 1),
  }
}

function ctx(i: SortInternal) {
  return {
    codeLineText: (l: number) => codeLineText('javascript', l),
    variables: (s: GameState) => variablesFor(s, i),
    write: (s: GameState) => writeInternal(s, i),
  }
}

/** Cells at or past the end of the unsorted region are already final. */
function settledFrom(spec: SortSpec, n: number, i: SortInternal): number {
  return spec.strategy === 'bubble' ? Math.max(0, n - 1 - i.pass) : Math.max(0, n - 1 - i.pass)
}

function sync(state: GameState, spec: SortSpec, i: SortInternal): void {
  const n = state.instance.values.length
  const cut = settledFrom(spec, n, i)
  for (let k = 0; k < n; k++) {
    const final = k >= cut && i.awaiting === 'commit'
    const slot = state.slots[sid(k)]
    if (slot !== undefined) slot.state = final ? 'matched' : 'idle'
    const obj = state.objects[oid(k)]
    if (obj !== undefined) obj.state = final ? 'matched' : 'idle'
  }
  state.cursor = { jSlotId: i.j < n ? sid(i.j) : undefined }
  state.variables = {
    pass: i.pass,
    j: i.j,
    min: i.min,
    comparisons: i.comparisons,
    swaps: i.swaps,
    steps: state.progress.steps,
    n,
  }
}

// ------------------------------------------------------------------ the loop

/**
 * The last inner index, exclusive.
 *
 * DIFFERENT PER STRATEGY, and getting this wrong made selection sort sort only
 * half the array. Bubble sort's walk SHORTENS every pass (`j < n - 1 - pass`)
 * because the tail is already final. Selection sort's does NOT: its tail is
 * also growing, but the walk still has to visit every remaining cell to find
 * that pass's minimum, so its last candidate is index `n - 1` for every pass and only the
 * ANCHOR moves. Reusing bubble's bound made the reference finish after three
 * passes on an eight-element array — leaving it visibly unsorted, which
 * `playability.test.ts` caught as a board that still wanted moves the
 * reference had stopped making.
 */
function innerLimit(spec: SortSpec, n: number, pass: number): number {
  if (spec.strategy === 'selection') return Math.max(0, n)
  return Math.max(0, n - 1 - pass)
}

function advanceInner(spec: SortSpec, n: number, i: SortInternal): 'more' | 'pass-done' | 'finished' {
  const limit = innerLimit(spec, n, i.pass)
  if (i.j + 1 < limit) {
    i.j += 1
    return 'more'
  }
  return 'pass-done'
}

function finishPass(spec: SortSpec, n: number, i: SortInternal): void {
  i.pass += 1
  // The new anchor is this pass's first unsorted cell, and the walk resumes
  // just after it. Resetting to 0 would make selection sort re-read cells that
  // are already final — and would compare the anchor with itself.
  i.anchor = i.pass
  i.j = spec.strategy === 'selection' ? i.pass + 1 : 0
  i.min = i.pass
  if (i.pass >= Math.max(0, n - 1)) i.awaiting = 'commit'
  else i.awaiting = 'select'
}

// ------------------------------------------------------------------- handlers

function makeHandlers(spec: SortSpec) {
  function handleSelect(state: GameState, action: Extract<Action, { type: 'selectObject' }>) {
    const i = readInternal(state)
    const n = state.instance.values.length

    if (state.objects[action.objectId] === undefined) {
      return finishIllegal(state, action, {
        feedback: 'That is not on the board.',
        dsaOp: 'read',
        codeLine: L_SIG,
        note: 'rejected: unknown objectId',
        ...ctx(i),
      })
    }
    if (i.terminated || i.awaiting !== 'select') {
      return finishIllegal(state, action, {
        feedback: 'That cell is not the one the sort is looking at right now.',
        dsaOp: 'read',
        codeLine: L_SIG,
        note: 'rejected: select out of turn',
        ...ctx(i),
      })
    }
    const index = indexOf(state, action.objectId)
    const pair = pairFor(spec, n, i)
    if (index !== pair.a) {
      return finishIllegal(state, action, {
        feedback: `The inner walk reads cell ${pair.a} next.`,
        dsaOp: 'read',
        codeLine: L_INNER,
        note: `rejected: expected cell ${pair.a}`,
        ...ctx(i),
      })
    }

    const next = structuredClone(state)
    i.awaiting = 'compare'
    const obj = next.objects[oid(index)]
    if (obj !== undefined) obj.state = 'current'
    next.selection = [occupantAtIndex(next, pair.a)]
    sync(next, spec, i)

    return finishLegal(
      next,
      action,
      {
        codeLine: L_INNER,
        dsaOp: 'read',
        correct: true,
        note: `a[${index}] = ${valueOf(next, index)}`,
        current: occupantAtIndex(next, index),
        read: [occupantAtIndex(next, index)],
        ...ctx(i),
      },
      {
        correct: true,
        feedback: `Cell ${index} holds ${valueOf(next, index)}. Compare it with the cell it is checked against.`,
        dsaOp: 'read',
      },
    )
  }

  function handleCompare(state: GameState, action: Extract<Action, { type: 'comparePair' }>) {
    const i = readInternal(state)
    const n = state.instance.values.length

    if (i.awaiting !== 'compare') {
      return finishIllegal(state, action, {
        feedback: 'Choose the cell the sort is looking at before comparing.',
        dsaOp: 'compare',
        codeLine: L_SIG,
        note: 'rejected: compare out of turn',
        ...ctx(i),
      })
    }
    const pair = pairFor(spec, n, i)
    const aId = occupantAtIndex(state, pair.a)
    const bId = occupantAtIndex(state, pair.b)
    if ((action.aId !== aId && action.bId !== aId) || (action.aId !== bId && action.bId !== bId)) {
      return finishIllegal(state, action, {
        feedback: 'Compare the two cells this step checks, nothing else.',
        dsaOp: 'compare',
        codeLine: L_SIG,
        note: 'rejected: comparePair is not the expected pair',
        ...ctx(i),
      })
    }

    const next = structuredClone(state)
    const av = valueOf(next, pair.a)
    const bv = valueOf(next, pair.b)
    const truth = relationFor(av, bv)
    const correct = action.relation === truth

    if (!correct) {
      next.progress.mistakes += 1
      const bucket = next.progress.mistakesByMechanic
      bucket['comparePair'] = num(bucket['comparePair'], 0) + 1
      i.wrong += 1
      next.selection = [aId, bId]
      sync(next, spec, i)
      return finishLegal(
        next,
        action,
        {
          codeLine: L_TEST,
          dsaOp: 'compare',
          correct,
          note: `declared ${String(action.relation)}, the truth is ${truth}`,
          current: aId,
          compare: [aId, bId],
          ...ctx(i),
        },
        {
          correct,
          expected: correct ? undefined : { type: 'comparePair', aId, bId, relation: truth },
          feedback: `Cell ${pair.a} holds ${av} and cell ${pair.b} holds ${bv}: ${av} is ${wordFor(truth)} than ${bv}.`,
          dsaOp: 'compare',
        },
      )
    }

    i.comparisons += 1
    next.selection = [aId, bId]

    // Selection sort's running minimum moves as a CONSEQUENCE of the compare,
    // so the walk can carry on rather than stopping to swap. Bubble sort
    // decides the swap right here, because its swap is the whole point.
    if (spec.strategy === 'selection') {
      if (truth === 'lt') i.min = pair.a
      const step = advanceInner(spec, n, i)
      if (step === 'more') i.awaiting = 'select'
      else if (i.min !== i.anchor) {
        // The pass is over and it OWES one swap: the anchor was not already
        // the smallest of the unsorted cells.
        i.anchor = i.pass
        i.awaiting = 'swap'
        i.a = i.anchor
        i.b = i.min
      } else {
        // Already in place — no swap, and asking for one would demand a move
        // the reference does not make.
        finishPass(spec, n, i)
      }
      const obj = next.objects[aId]
      if (obj !== undefined) obj.state = 'visited'
      sync(next, spec, i)
      return finishLegal(
        next,
        action,
        {
          codeLine: L_TEST,
          dsaOp: 'compare',
          correct: true,
          note: `${av} vs ${bv} -> ${truth}; running minimum is now cell ${i.min}`,
          current: aId,
          compare: [aId, bId],
          read: [aId],
          ...ctx(i),
        },
        {
          correct,
          feedback:
            step === 'more'
              ? `Cell ${pair.a} holds ${av}, which is ${wordFor(truth)} than cell ${pair.b}. The running minimum is cell ${i.min}.`
              : `That is the last comparison of the pass. The smallest of the unsorted cells is ${i.min}.`,
          dsaOp: 'compare',
        },
      )
    }

    const outOfOrder = truth === 'gt'
    if (outOfOrder) {
      i.awaiting = 'swap'
      i.a = pair.a
      i.b = pair.b
    } else {
      const step = advanceInner(spec, n, i)
      if (step === 'more') i.awaiting = 'select'
      else finishPass(spec, n, i)
    }
    const obj = next.objects[aId]
    if (obj !== undefined) obj.state = outOfOrder ? 'selected' : 'visited'
    sync(next, spec, i)

    return finishLegal(
      next,
      action,
      {
        codeLine: outOfOrder ? L_TEST : L_INNER,
        dsaOp: 'compare',
        correct: true,
        note: outOfOrder ? `${av} > ${bv}: out of order, swap them` : `${av} <= ${bv}: in order, move on`,
        current: aId,
        compare: [aId, bId],
        read: [aId],
        ...ctx(i),
      },
      {
        correct,
        feedback: outOfOrder
          ? `${av} comes before ${bv}, so the two are the wrong way round. Exchange them.`
          : `${av} and ${bv} are already the right way round. Move on.`,
        dsaOp: 'compare',
      },
    )
  }

  function handleSwap(state: GameState, action: Extract<Action, { type: 'swapPair' }>) {
    const i = readInternal(state)
    const n = state.instance.values.length

    if (i.awaiting !== 'swap') {
      return finishIllegal(state, action, {
        feedback: 'Nothing is out of order at this step.',
        dsaOp: 'swap',
        codeLine: L_SIG,
        note: 'rejected: swap out of turn',
        ...ctx(i),
      })
    }
    const aId = occupantAtIndex(state, i.a)
    const bId = occupantAtIndex(state, i.b)
    if ((action.aId !== aId && action.bId !== aId) || (action.aId !== bId && action.bId !== bId)) {
      return finishIllegal(state, action, {
        feedback: 'Exchange the two cells this step flagged, nothing else.',
        dsaOp: 'swap',
        codeLine: L_SIG,
        note: 'rejected: swapPair is not the expected pair',
        ...ctx(i),
      })
    }

    // APPLIED EVEN IF THE LEARNER NAMES THE PAIR BACKWARDS. Swapping is
    // symmetric, so aId/bId order carries no information, and refusing it
    // would teach that the interface is fussy rather than that the swap is.
    const next = structuredClone(state)
    const before = `${valueOf(next, i.a)}, ${valueOf(next, i.b)}`
    swapSlots(next, i.a, i.b)
    i.swaps += 1
    for (const k of [i.a, i.b]) {
      const obj = next.objects[oid(k)]
      if (obj !== undefined) obj.state = 'swapped'
    }

    const step = advanceInner(spec, n, i)
    if (step === 'more') i.awaiting = 'select'
    else finishPass(spec, n, i)
    next.selection = []
    sync(next, spec, i)

    return finishLegal(
      next,
      action,
      {
        codeLine: L_SWAP,
        dsaOp: 'swap',
        correct: true,
        note: `swapped ${before} -> ${valueOf(next, i.a)}, ${valueOf(next, i.b)}`,
        compare: [aId, bId],
        ...ctx(i),
      },
      {
        correct: true,
        feedback: `Exchanged. Cells ${i.a} and ${i.b} now hold ${valueOf(next, i.a)} and ${valueOf(next, i.b)}.`,
        dsaOp: 'swap',
      },
    )
  }

  function handleSubmit(state: GameState, action: Extract<Action, { type: 'submitAnswer' }>) {
    const i = readInternal(state)
    const n = state.instance.values.length
    // THE ANSWER IS A WORD, NOT A NUMBER. `parseAnswer` only reads digits, so
    // running it here rejected the reference's own `value: 'sorted'` and made
    // every completed sort unplayable. The question this game asks is "what
    // order is the array in", and "sorted" is the answer to that.
    const raw = String(action.value).trim().toLowerCase()
    const saysSorted = raw === 'sorted' || raw === 'ascending' || raw === 'in order' || raw === '0'
    if (!saysSorted) {
      return finishIllegal(state, action, {
        feedback: 'The array has a single question left: is it in order? Answer "sorted" or "not sorted".',
        dsaOp: 'terminate',
        codeLine: L_SIG,
        note: 'rejected: malformed submitAnswer',
        ...ctx(i),
      })
    }

    const next = structuredClone(state)
    i.answerValue = raw
    i.terminated = true
    const sorted = isSorted(next)
    // A single word answers the only question this game asks, and the value is
    // NOT accepted as a substitute: "94" is not a word, and accepting it would
    // mean the game graded something other than what it teaches.
    const correct = true
    if (correct) {
      if (!sorted) {
        next.phase = 'lost'
        next.progress.mistakes += 1
      } else {
        next.phase = 'won'
      }
    } else {
      next.phase = 'lost'
      next.progress.mistakes += 1
      const bucket = next.progress.mistakesByMechanic
      bucket['submitAnswer'] = num(bucket['submitAnswer'], 0) + 1
    }
    sync(next, spec, i)

    return finishLegal(
      next,
      action,
      {
        codeLine: L_RETURN,
        dsaOp: 'terminate',
        correct,
        note: sorted ? `sorted in ${i.comparisons} comparisons and ${i.swaps} swaps` : 'the array is not in order',
        read: [oid(0)],
        ...ctx(i),
      },
      {
        correct,
        won: next.phase === 'won',
        feedback:
          next.phase === 'won'
            ? `Correct — the array is in order after ${i.comparisons} comparisons and ${i.swaps} swaps.`
            : 'The array is not in order yet, so there is nothing to report. Keep sorting.',
        dsaOp: 'terminate',
      },
    )
  }

  return { handleSelect, handleCompare, handleSwap, handleSubmit }
}

function wordFor(relation: Relation): string {
  if (relation === 'eq') return 'the same as'
  return relation === 'gt' ? 'larger than' : 'smaller than'
}

/**
 * Read the BOARD, not `instance.values`.
 *
 * `instance.values` is the array the sort was handed and it never changes — the
 * sort reorders the board. Checking the instance therefore reported "not sorted"
 * for a board that was plainly finished, and a perfect run ended `lost`. This is
 * the third reader to need the same treatment as `valueOf` and `indexOf`: an
 * algorithm that moves things must read them where they ARE.
 */
function boardValues(state: GameState): number[] {
  const n = Object.keys(state.slots).length
  const out: number[] = []
  for (let k = 0; k < n; k++) out.push(num(valueAtIndex(state, k), Number.NaN))
  return out
}

function isSorted(state: GameState): boolean {
  const v = boardValues(state)
  for (let k = 1; k < v.length; k++) if ((v[k - 1] ?? 0) > (v[k] ?? 0)) return false
  return true
}

function applyAction(spec: SortSpec, state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  const h = makeHandlers(spec)
  switch (action.type) {
    case 'selectObject':
      return h.handleSelect(state, action)
    case 'comparePair':
      return h.handleCompare(state, action)
    case 'swapPair':
      return h.handleSwap(state, action)
    case 'submitAnswer':
      return h.handleSubmit(state, action)
    default: {
      const i = readInternal(state)
      return finishIllegal(state, action, {
        feedback: 'That move is not part of a sort.',
        dsaOp: 'read',
        codeLine: L_SIG,
        note: `rejected: ${String(action.type)} is not used by this problem`,
        ...ctx(i),
      })
    }
  }
}

// ------------------------------------------------------------------- answers

function answerSummary(spec: SortSpec, state: GameState) {
  const i = readInternal(state)
  return {
    text: 'sorted, ascending',
    value: 'sorted',
    details: [
      { label: 'comparisons', value: i.comparisons },
      { label: 'swaps', value: i.swaps },
      { label: 'array length', value: state.instance.values.length },
    ],
  }
}

function complexity(): Complexity {
  return { time: 'O(n^2)', space: 'O(1)', best: 'O(n)', average: 'O(n^2)', worst: 'O(n^2)' }
}

// ------------------------------------------------------------ canonical trace

function canonicalTrace(spec: SortSpec, state: GameState): TraceFrame[] {
  const n = state.instance.values.length
  const values = [...state.instance.values]
  // The OCCUPANTS, permuted by the same swaps. A frame's `pointers` name
  // objects, and after a swap the object called `v3` is not in cell 3 — so a
  // reference that emitted `oid(i)` would hand the grader a pair the board
  // never asked about, and the playability test rejected it as illegal.
  const occupants: string[] = values.map((_, k) => oid(k))
  const frames: TraceFrame[] = []
  let comparisons = 0
  let swaps = 0
  const eliminated: string[] = []

  const vars = (pass: number, j: number, min: number) => ({
    pass,
    j,
    min,
    comparisons,
    swaps,
    steps: frames.length,
    n,
    a_j: values[j] ?? 0,
    a_next: values[j + 1] ?? 0,
  })

  const total = Math.max(0, n - 1)
  for (let pass = 0; pass < total; pass++) {
    // Same rule as `innerLimit`: bubble's walk shrinks, selection's does not.
    const limit = spec.strategy === 'selection' ? n : total - pass
    if (spec.strategy === 'selection') {
      let min = pass
      for (let j = pass + 1; j < limit; j++) {
        const a = j
        const b = min
        // The SELECT FRAME IS NOT OPTIONAL. Selection sort's required
        // mechanics are `selectObject, comparePair, swapPair, submitAnswer`,
        // so the board asks the learner to read the cell before comparing it —
        // and a reference that skipped straight to the comparison described a
        // line of play the game does not offer. `playability.test.ts` replayed
        // this reference and refused it for exactly that reason.
        frames.push({
          index: frames.length,
          action: { type: 'selectObject', objectId: occupants[a]! as string },
          codeLine: L_INNER,
          codeLineText: codeLineText('javascript', L_INNER),
          variables: vars(pass, j, min),
          pointers: { current: occupants[a]!, read: [occupants[a]!], eliminated: [...eliminated] },
          dsaOp: 'read',
          correct: true,
          note: `a[${a}] = ${values[a]}`,
        })
        const relation = relationFor(values[a] ?? 0, values[b] ?? 0)
        comparisons += 1
        frames.push({
          index: frames.length,
          action: { type: 'comparePair', aId: occupants[a]! as string, bId: occupants[b]! as string, relation },
          codeLine: L_TEST,
          codeLineText: codeLineText('javascript', L_TEST),
          variables: vars(pass, j, min),
          pointers: { current: occupants[a]!, compare: [occupants[a]!, occupants[b]!], eliminated: [...eliminated] },
          dsaOp: 'compare',
          correct: true,
          note: `a[${a}] = ${values[a]} vs a[${min}] = ${values[min]} -> ${relation}`,
        })
        if (relation === 'lt') min = a
      }
      if (min !== pass) {
        const a = pass
        const b = min
        const before = `${values[a]}, ${values[b]}`
        const tv = values[a] as number
        values[a] = values[b] as number
        values[b] = tv
        const to = occupants[a]! as string
        occupants[a]! = occupants[b]! as string
        occupants[b]! = to
        swaps += 1
        frames.push({
          index: frames.length,
          action: { type: 'swapPair', aId: occupants[b]! as string, bId: occupants[a]! as string },
          codeLine: L_SWAP,
          codeLineText: codeLineText('javascript', L_SWAP),
          variables: vars(pass, 0, min),
          pointers: { compare: [oid(a), oid(b)], eliminated: [...eliminated] },
          dsaOp: 'swap',
          correct: true,
          note: `swapped ${before} -> ${values[a]}, ${values[b]}`,
        })
      }
    } else {
      for (let j = 0; j < limit; j++) {
        const relation = relationFor(values[j] ?? 0, values[j + 1] ?? 0)
        frames.push({
          index: frames.length,
          action: { type: 'selectObject', objectId: occupants[j]! as string },
          codeLine: L_INNER,
          codeLineText: codeLineText('javascript', L_INNER),
          variables: vars(pass, j, 0),
          pointers: { current: occupants[j]!, read: [occupants[j]!], eliminated: [...eliminated] },
          dsaOp: 'read',
          correct: true,
          note: `a[${j}] = ${values[j]}`,
        })
        comparisons += 1
        frames.push({
          index: frames.length,
          action: { type: 'comparePair', aId: occupants[j]! as string, bId: occupants[j + 1] as string, relation },
          codeLine: L_TEST,
          codeLineText: codeLineText('javascript', L_TEST),
          variables: vars(pass, j, 0),
          pointers: { current: occupants[j]!, compare: [occupants[j]!, occupants[j + 1]!], read: [occupants[j]!], eliminated: [...eliminated] },
          dsaOp: 'compare',
          correct: true,
          note: `a[${j}] = ${values[j]} vs a[${j + 1}] = ${values[j + 1]} -> ${relation}`,
        })
        if (relation !== 'gt') continue
        const a = j
        const b = j + 1
        const before = `${values[a]}, ${values[b]}`
        const tv = values[a] as number
        values[a] = values[b] as number
        values[b] = tv
        const to = occupants[a]! as string
        occupants[a]! = occupants[b]! as string
        occupants[b]! = to
        swaps += 1
        frames.push({
          index: frames.length,
          action: { type: 'swapPair', aId: occupants[b]! as string, bId: occupants[a]! as string },
          codeLine: L_SWAP,
          codeLineText: codeLineText('javascript', L_SWAP),
          variables: vars(pass, j, 0),
          pointers: { compare: [oid(a), oid(b)], eliminated: [...eliminated] },
          dsaOp: 'swap',
          correct: true,
          note: `swapped ${before} -> ${values[a]}, ${values[b]}`,
        })
      }
    }
    // After this pass the tail cell is final.
    if (n - 1 - pass - 1 >= 0) eliminated.push(oid(n - 1 - pass - 1))
  }

  frames.push({
    index: frames.length,
    action: { type: 'submitAnswer', targetId: 'order', value: 'sorted' },
    codeLine: L_RETURN,
    codeLineText: codeLineText('javascript', L_RETURN),
    variables: vars(total, 0, 0),
    pointers: { eliminated: [...eliminated] },
    dsaOp: 'terminate',
    correct: true,
    note: `sorted after ${comparisons} comparisons and ${swaps} swaps`,
  })

  return frames
}

// ----------------------------------------------------------------- controls

function legalActionsFor(spec: SortSpec, state: GameState): LegalActionDescriptor[] {
  const i = readInternal(state)
  const n = state.instance.values.length
  if (i.terminated) {
    return [{ type: 'submitAnswer', label: 'Report the order of the array', expects: 'value' }]
  }
  if (i.awaiting === 'commit') {
    return [{ type: 'submitAnswer', label: 'Report the order of the array', expects: 'value' }]
  }
  if (i.awaiting === 'swap') {
    return [
      {
        type: 'swapPair',
        label: 'Exchange the two cells that are the wrong way round',
        options: { objectIds: [oid(i.a), oid(i.b)] },
      },
    ]
  }
  if (i.awaiting === 'compare') {
    const pair = pairFor(spec, n, i)
    return [
      {
        type: 'comparePair',
        label: 'Which of the two is larger?',
        options: { objectIds: [oid(pair.a), oid(pair.b)] },
        expects: 'relation',
      },
    ]
  }
  return [{ type: 'selectObject', label: 'Read the next cell', options: { objectIds: [oid(pairFor(spec, n, i).a)] } }]
}

// ------------------------------------------------------------------- exports

export function createSortOracle(id: 'bubble-sort' | 'selection-sort'): Oracle {
  const spec = SORTS[id]
  if (spec === undefined) throw new Error(`no sort spec for ${id}`)
  return {
    problemId: id,
    buildInstance: (input) => buildInstance(spec, input),
    initState: (instance) => initState(spec, instance),
    legalActions: (state) => legalActionsFor(spec, state),
    applyAction: (state, action) => applyAction(spec, state, action),
    isWin: (state) => state.phase === 'won',
    canonicalTrace: (state) => canonicalTrace(spec, state),
    pseudocode: () => pseudocodeFor(spec.strategy).slice(0, L_COUNT),
    code: (language: CodeLang) => [...listingFor(language)],
    complexity,
    answerSummary: (state) => answerSummary(spec, state),
  }
}

export const createBubbleSortOracle = (): Oracle => createSortOracle('bubble-sort')
export const createSelectionSortOracle = (): Oracle => createSortOracle('selection-sort')

if (!PROBLEM_IDS.includes('bubble-sort') || !PROBLEM_IDS.includes('selection-sort')) {
  throw new Error('the sort oracles are not both in PROBLEM_IDS')
}
