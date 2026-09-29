/**
 * Find the maximum / minimum — a single linear scan with a running best.
 *
 * THE ALGORITHM. One pass. Compare the next element with the best seen so far
 * and keep the better one. `n-1` comparisons, one variable, no extra space.
 *
 * WHY `wantMax` IS A PARAMETER AND NOT A SEPARATE PROBLEM. The catalogue entry
 * is "Find the maximum / minimum" and the learning objective is the scan, not
 * the direction. Two oracles differing only in a comparison would teach one
 * thing twice, so the mode is chosen by seed and the player is told which they
 * are playing. It also makes the comparison the ONLY interesting decision,
 * which is the point.
 *
 * RELATION CONVENTION, pinned here because it trips people up: the relation of
 * a `comparePair` is always read as `probed REL best`, whatever order the two
 * object ids arrived in. "The value I am holding is above the running best" is
 * `gt`. Accepting both argument orders keeps the mechanic forgiving about
 * which tile was tapped and strict about the claim, which is the right way
 * round.
 *
 * A WRONG COMPARISON DOES NOT MOVE THE ALGORITHM. It is a claim about two
 * numbers, not a move, so applying it would leave the running best holding
 * something the algorithm could never have chosen. The mistake is counted, the
 * truth is reported, and the same comparison is re-offered.
 */

import type {
  Action,
  ActionOutcome,
  BuildInstanceInput,
  Complexity,
  DsaOp,
  GameObject,
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
  markRange,
  num,
  oid,
  parseAnswer,
  sid,
  str,
  swapSlots,
  type Bag,
  type CodeLang,
} from '../shared/kernel.js'

const PROBLEM_ID = 'array-max-min'

// --------------------------------------------------------------- line numbers

const LINE_SIGNATURE = 1
const LINE_BEST_INIT = 2
const LINE_LOOP = 3
const LINE_TEST = 4
const LINE_UPDATE = 6
const LINE_RETURN = 9
const LINE_COUNT = 10

const JS_LINES: readonly string[] = [
  'function findExtreme(a, wantMax) {', //  1
  '  let best = 0', //  2
  '  for (let i = 1; i < a.length; i++) {', //  3
  '    const isBetter = wantMax ? a[i] > a[best] : a[i] < a[best]', //  4
  '    if (isBetter) {', //  5
  '      best = i', //  6
  '    }', //  7
  '  }', //  8
  '  return best', //  9
  '}', // 10
]

const TS_LINES: readonly string[] = [
  'function findExtreme(a: number[], wantMax: boolean): number {', //  1
  '  let best = 0', //  2
  '  for (let i = 1; i < a.length; i++) {', //  3
  '    const isBetter = wantMax ? a[i]! > a[best]! : a[i]! < a[best]!', //  4
  '    if (isBetter) {', //  5
  '      best = i', //  6
  '    }', //  7
  '  }', //  8
  '  return best', //  9
  '}', // 10
]

const PY_LINES: readonly string[] = [
  'def find_extreme(a, want_max):', //  1
  '    best = 0', //  2
  '    for i in range(1, len(a)):', //  3
  '        is_better = a[i] > a[best] if want_max else a[i] < a[best]', //  4
  '        if is_better:', //  5
  '            best = i', //  6
  '        # END IF', //  7
  '    # END FOR', //  8
  '    return best', //  9
  '# END FUNCTION', // 10
]

const CPP_LINES: readonly string[] = [
  'int findExtreme(const std::vector<int>& a, bool wantMax) {', //  1
  '  int best = 0;', //  2
  '  for (int i = 1; i < (int)a.size(); i++) {', //  3
  '    bool isBetter = wantMax ? a[i] > a[best] : a[i] < a[best];', //  4
  '    if (isBetter) {', //  5
  '      best = i;', //  6
  '    }', //  7
  '  }', //  8
  '  return best;', //  9
  '}', // 10
]

const JAVA_LINES: readonly string[] = [
  'int findExtreme(int[] a, boolean wantMax) {', //  1
  '  int best = 0;', //  2
  '  for (int i = 1; i < a.length; i++) {', //  3
  '    boolean isBetter = wantMax ? a[i] > a[best] : a[i] < a[best];', //  4
  '    if (isBetter) {', //  5
  '      best = i;', //  6
  '    }', //  7
  '  }', //  8
  '  return best;', //  9
  '}', // 10
]

const NOTES: readonly string[] = [
  'best starts at the first cell, which is the answer until something beats it',
  'the running best: an index, not a value',
  'start at 1 — cell 0 is already the best',
  'the whole algorithm is this one comparison',
  'a better value was found',
  'keep it, and forget everything before it',
  'end of the if',
  'end of the loop — that was n-1 comparisons',
  'the index of the extreme, not the value',
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

const PSEUDOCODE: readonly string[] = [
  'FUNCTION findExtreme(a, wantMax)',
  '    best <- 0',
  '    FOR i FROM 1 TO LENGTH(a) - 1',
  '        isBetter <- wantMax ? a[i] > a[best] : a[i] < a[best]',
  '        IF isBetter THEN',
  '            best <- i',
  '        END IF',
  '    END FOR',
  '    RETURN best',
  'END FUNCTION',
]

// ------------------------------------------------------------------- instance

interface ExtInternal {
  i: number
  best: number
  /**
   * The scan has read every cell.
   *
   * NOT derived from `i`, and that is the point. `i` ends ON the last cell
   * rather than one past it, so the cursor still shows where the scan stopped
   * — which means `i + 1 >= n` is true for the whole of the final cell, not
   * only after it. Deriving "done" from that made the board offer
   * `submitAnswer` one cell early, stranding the last comparison with no way to
   * make it. A separate flag says what it means.
   */
  done: boolean
  picked: boolean
  compared: boolean
  comparisons: number
  wrong: number
  wantMax: boolean
  answerValue: string
  terminated: boolean
}

function readInternal(state: GameState): ExtInternal {
  const raw = state.internal
  return {
    i: num(raw['i'], 1),
    best: num(raw['best'], 0),
    done: bool(raw['done']),
    picked: bool(raw['picked']),
    compared: bool(raw['compared']),
    comparisons: num(raw['comparisons'], 0),
    wrong: num(raw['wrong'], 0),
    wantMax: bool(raw['wantMax']),
    answerValue: str(raw['answerValue']),
    terminated: bool(raw['terminated']),
  }
}

function writeInternal(state: GameState, i: ExtInternal): void {
  const bag: Bag = {
    i: i.i,
    best: i.best,
    done: i.done,
    picked: i.picked,
    compared: i.compared,
    comparisons: i.comparisons,
    wrong: i.wrong,
    wantMax: i.wantMax,
    answerValue: i.answerValue,
    terminated: i.terminated,
  }
  state.internal = bag
}

function hints() {
  const problem = getProblem(PROBLEM_ID)
  if (problem === undefined) throw new Error(`${PROBLEM_ID} is missing from the catalogue`)
  return problem.instanceHints
}

/** `true` when `a` beats `b` under the current mode. */
function beats(a: number, b: number, wantMax: boolean): boolean {
  return wantMax ? a > b : a < b
}

function relationOf(candidate: number, incumbent: number, wantMax: boolean): Relation {
  if (candidate > incumbent) return 'gt'
  if (candidate < incumbent) return 'lt'
  return 'eq'
}

function valueOf(state: GameState, index: number): number {
  return num(state.objects[oid(index)]?.value, Number.NaN)
}

// --------------------------------------------------------------------- board

function buildInstance(input: BuildInstanceInput): ProblemInstance {
  const { minLength, maxLength, valueRange } = hints()
  const lo = minLength
  const hi = maxLength
  const defaultLength = input.difficulty === 'easy' ? lo : input.difficulty === 'hard' ? hi : Math.round((lo + hi) / 2)
  const requested = input.length ?? defaultLength
  const n = Math.max(2, Math.min(hi, Math.max(lo, Math.trunc(requested))))

  const rng = makeRng(input.seed)
  const [min, max] = valueRange ?? [1, 99]
  const values: number[] = []
  for (let k = 0; k < n; k++) values.push(randInt(rng, min, max))

  // The extreme must be unique, or the answer would be ambiguous and the
  // "keep the better one" rule would have a tie to break. One slot is emptied
  // of collisions by nudging the array until the extreme appears exactly once.
  const wantMax = rng() < 0.5
  const extreme = wantMax ? Math.max(...values) : Math.min(...values)
  const count = values.filter((v) => v === extreme).length
  if (count > 1) {
    const spot = values.lastIndexOf(extreme)
    const replacement = randInt(rng, min, max)
    values[spot] = replacement === extreme ? replacement + 1 : replacement
  }

  return {
    problemId: PROBLEM_ID,
    seed: input.seed,
    values,
    target: wantMax ? Math.max(...values) : Math.min(...values),
    slots: Array.from({ length: n }, (_, k) => ({ id: sid(k), index: k, kind: 'default' as const })),
    extras: { wantMax },
  }
}

function initState(instance: ProblemInstance): GameState {
  const wantMax = instance.extras?.['wantMax'] !== false
  const n = instance.values.length
  const extras: GameObject[] = [
    {
      id: 'mode',
      kind: 'target',
      label: wantMax ? 'the largest' : 'the smallest',
      visual: { kind: 'text', text: wantMax ? 'max' : 'min' },
      state: 'idle',
      tags: { mode: true },
    },
  ]

  const state = buildBoard({
    problemId: PROBLEM_ID,
    instance,
    extras,
    variables: { i: 1, best: 0, comparisons: 0, steps: 0, wantMax: wantMax ? 1 : 0, n },
    cursor: { iSlotId: sid(1), bestObjectId: oid(0) },
  })

  writeInternal(state, {
    i: 1,
    best: 0,
    done: false,
    picked: false,
    compared: false,
    comparisons: 0,
    wrong: 0,
    wantMax,
    answerValue: '',
    terminated: false,
  })
  return state
}

// --------------------------------------------------------------------- frames

function variablesFor(state: GameState, i: ExtInternal) {
  const n = state.instance.values.length
  return {
    i: i.i,
    best: i.best,
    comparisons: i.comparisons,
    steps: state.progress.steps,
    n,
    a_i: valueOf(state, i.i),
    a_best: valueOf(state, i.best),
  }
}

/**
 * The three context fields every `finish*` call needs, bound to one view.
 *
 * Bundled so the `write` cannot be left off. Reading `internal` produces a
 * COPY, so a handler that mutates the view and never persists it reverts
 * every field on the next turn — which shows up as an infinite game (the
 * cursor never advances) rather than as a wrong value, and is invisible to any
 * assertion about the data. The first draft of this oracle had exactly that
 * bug and stalled on 500 steps with every value correct.
 */
function ctx(i: ExtInternal) {
  return {
    codeLineText: (l: number) => codeLineText('javascript', l),
    variables: (s: GameState) => variablesFor(s, i),
    write: (s: GameState) => writeInternal(s, i),
  }
}

function eliminatedBefore(state: GameState, i: ExtInternal): string[] {
  // Everything the cursor has passed is decided: a value already compared and
  // not kept can never be the extreme.
  const out: string[] = []
  for (let k = 1; k < i.i; k++) if (k !== i.best) out.push(oid(k))
  void state
  return out
}

function sync(state: GameState, i: ExtInternal): void {
  const n = state.instance.values.length
  if (i.best >= 0 && i.best < n) markRange(state, 1, Math.max(1, i.i - 1))
  state.cursor = {
    iSlotId: i.i < n ? sid(i.i) : undefined,
    bestObjectId: oid(i.best),
  }
  state.variables = {
    i: i.i,
    best: i.best,
    comparisons: i.comparisons,
    steps: state.progress.steps,
    wantMax: i.wantMax ? 1 : 0,
    n,
  }
}

// ------------------------------------------------------------------- handlers

function handleSelect(state: GameState, action: Extract<Action, { type: 'selectObject' }>) {
  const i = readInternal(state)
  const n = state.instance.values.length

  if (state.objects[action.objectId] === undefined) {
    return finishIllegal(state, action, {
      feedback: 'That is not on the board.',
      dsaOp: 'read',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: unknown objectId',
      ...ctx(i),
    })
  }
  if (i.terminated) {
    return finishIllegal(state, action, {
      feedback: 'The run is over. Commit the answer.',
      dsaOp: 'read',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: after the run ended',
      ...ctx(i),
    })
  }
  if (i.compared) {
    return finishIllegal(state, action, {
      feedback: 'That value has already been compared. Move on to the next one.',
      dsaOp: 'read',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: comparison already recorded',
      ...ctx(i),
    })
  }

  const index = indexOf(state, action.objectId)
  if (index !== i.i) {
    return finishIllegal(state, action, {
      feedback: `The scan looks at one cell at a time, in order. The next one is cell ${i.i}.`,
      dsaOp: 'read',
      codeLine: LINE_LOOP,
      note: `rejected: expected cell ${i.i}`,
      ...ctx(i),
    })
  }

  const next = structuredClone(state)
  i.picked = true
  const obj = next.objects[oid(index)]
  if (obj !== undefined) obj.state = 'current'
  next.selection = [oid(index)]
  sync(next, i)

  return finishLegal(
    next,
    action,
    {
      codeLine: LINE_LOOP,
      dsaOp: 'read',
      correct: true,
      note: `a[${index}] = ${valueOf(next, index)}`,
      current: oid(index),
      read: [oid(index)],
      eliminated: eliminatedBefore(next, i),
      ...ctx(i),
    },
    {
      correct: true,
      feedback: `Cell ${index} holds ${valueOf(next, index)}. Compare it with the running best.`,
      dsaOp: 'read',
    },
  )
}

function handleCompare(state: GameState, action: Extract<Action, { type: 'comparePair' }>) {
  const i = readInternal(state)
  const n = state.instance.values.length

  if (!i.picked) {
    return finishIllegal(state, action, {
      feedback: 'Choose the next cell before comparing it.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: compare before select',
      ...ctx(i),
    })
  }
  if (i.compared) {
    return finishIllegal(state, action, {
      feedback: 'That comparison is already on the record. Pick the next cell.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: comparison already recorded',
      ...ctx(i),
    })
  }

  const probeId = oid(i.i)
  const bestId = oid(i.best)
  const touchesProbe = action.aId === probeId || action.bId === probeId
  const touchesBest = action.aId === bestId || action.bId === bestId
  if (!touchesProbe || !touchesBest) {
    return finishIllegal(state, action, {
      feedback: 'Compare the cell you just picked against the running best, nothing else.',
      dsaOp: 'compare',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: comparePair is not probe-vs-best',
      ...ctx(i),
    })
  }

  const next = structuredClone(state)
  const probe = valueOf(next, i.i)
  const incumbent = valueOf(next, i.best)
  const truth = relationOf(probe, incumbent, i.wantMax)
  const correct = action.relation === truth

  if (correct) {
    i.comparisons += 1
    if (beats(probe, incumbent, i.wantMax)) i.best = i.i
    const probeObj = next.objects[probeId]
    if (probeObj !== undefined) probeObj.state = i.best === i.i ? 'matched' : 'visited'
    // The loop advances HERE, because a linear scan has no separate "which way
    // do I go" move — the comparison is the whole body. `requiredMechanics` is
    // `selectObject, comparePair, submitAnswer` for exactly that reason, and
    // it is why an earlier version of this oracle stalled forever: the cursor
    // was never moved, so it kept re-reading the same cell.
    i.compared = false
    i.picked = false
    afterCorrectCompare(next, i)
  } else {
    next.progress.mistakes += 1
    const bucket = next.progress.mistakesByMechanic
    bucket['comparePair'] = num(bucket['comparePair'], 0) + 1
    i.wrong += 1
  }
  next.selection = [probeId, bestId]
  sync(next, i)

  const updated = correct && i.best === i.i
  return finishLegal(
    next,
    action,
    {
      codeLine: updated ? LINE_UPDATE : LINE_TEST,
      dsaOp: 'compare',
      correct,
      note: correct
        ? updated
          ? `a[${i.i}] = ${probe} beats a[${i.best}] — best moves`
          : `a[${i.i}] = ${probe} does not beat the running best`
        : `declared ${String(action.relation)}, the truth is ${truth}`,
      current: probeId,
      compare: [probeId, bestId],
      read: [probeId],
      eliminated: eliminatedBefore(next, i),
      ...ctx(i),
    },
    {
      correct,
      expected: correct ? undefined : { type: 'comparePair', aId: probeId, bId: bestId, relation: truth },
      feedback: correct
        ? updated
          ? `${probe} is ${i.wantMax ? 'larger' : 'smaller'} than ${incumbent}, so the running best moves to cell ${i.i}.`
          : `${probe} does not beat ${incumbent}, so the best stays at cell ${i.best}.`
        : `Cell ${i.i} holds ${probe} and the best holds ${incumbent}: ${probe} is ${relationWord(truth, i.wantMax)}.`,
      dsaOp: 'compare',
    },
  )
}

function relationWord(relation: Relation, wantMax: boolean): string {
  if (relation === 'eq') return 'the same'
  const higher = relation === 'gt'
  if (wantMax) return higher ? 'the larger one' : 'the smaller one'
  return higher ? 'the smaller one' : 'the larger one'
}

/** Advance the cursor, called after a correct comparison. */
function afterCorrectCompare(state: GameState, i: ExtInternal): void {
  const n = state.instance.values.length
  if (i.i + 1 < n) {
    i.i += 1
    i.picked = false
  } else {
    // Finished. `i` stays on the last cell so the board still shows where the
    // cursor ended, and `done` is what closes the scan — NOT `i + 1 >= n`,
    // which is already true for the final cell itself.
    i.picked = false
    i.done = true
  }
}

function handleAssign(state: GameState, action: Extract<Action, { type: 'assignValue' }>) {
  const i = readInternal(state)
  const n = state.instance.values.length
  const parsed = parseAnswer(String(action.value))
  if (parsed === null) {
    return finishIllegal(state, action, {
      feedback: 'Type a whole number — the index of the cell you think is the best.',
      dsaOp: 'assign',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: malformed assignValue',
      ...ctx(i),
    })
  }
  if (parsed < 0 || parsed >= n) {
    return finishIllegal(state, action, {
      feedback: `There is no cell ${parsed}. The board runs from 0 to ${n - 1}.`,
      dsaOp: 'assign',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: assignValue out of range',
      ...ctx(i),
    })
  }

  const next = structuredClone(state)
  // Only meaningful while a comparison is outstanding: "the best moves to this
  // cell" is a restatement of the relation the player is about to declare, and
  // it replaces it. Outside that window there is no pending decision, so the
  // move is refused rather than silently ignored.
  const pending = i.picked && !i.compared
  const correct = pending && parsed === i.best

  if (correct) {
    i.comparisons += 1
    i.best = parsed
    i.compared = false
    i.picked = false
    afterCorrectCompare(next, i)
    const obj = next.objects[oid(parsed)]
    if (obj !== undefined) obj.state = 'matched'
  } else {
    // Reported, never applied: typing a number must not be able to put the
    // running best somewhere the algorithm could not have chosen.
    next.progress.mistakes += 1
    const bucket = next.progress.mistakesByMechanic
    bucket['assignValue'] = num(bucket['assignValue'], 0) + 1
    i.wrong += 1
  }
  sync(next, i)

  return finishLegal(
    next,
    action,
    {
      codeLine: correct ? LINE_UPDATE : LINE_BEST_INIT,
      dsaOp: 'assign',
      correct,
      note: correct ? `best = ${parsed}` : `best is ${i.best}, not ${parsed}`,
      current: oid(parsed),
      eliminated: eliminatedBefore(next, i),
      ...ctx(i),
    },
    {
      correct,
      expected: correct ? undefined : { type: 'assignValue', targetId: 'best', value: String(i.best) },
      feedback: correct
        ? `The running best is cell ${parsed}.`
        : pending
          ? `Cell ${i.i} holds ${valueOf(next, i.i)} and the best holds ${valueOf(next, i.best)}, so the best is cell ${i.best}.`
          : 'Pick a cell first, then record which one becomes the best.',
      dsaOp: 'assign',
    },
  )
}

function handleSubmit(state: GameState, action: Extract<Action, { type: 'submitAnswer' }>) {
  const i = readInternal(state)
  const n = state.instance.values.length
  const submitted = parseAnswer(String(action.value))
  if (submitted === null) {
    return finishIllegal(state, action, {
      feedback: 'Submit a whole number — the index of the cell you think holds the answer.',
      dsaOp: 'terminate',
      codeLine: LINE_SIGNATURE,
      note: 'rejected: malformed submitAnswer',
      ...ctx(i),
    })
  }

  const next = structuredClone(state)
  i.answerValue = String(submitted)
  const finished = i.comparisons >= Math.max(0, n - 1)
  const correct = submitted === i.best
  i.terminated = true

  if (correct) {
    next.phase = 'won'
    const obj = next.objects[oid(submitted)]
    if (obj !== undefined) obj.state = 'matched'
  } else {
    next.phase = 'lost'
    next.progress.mistakes += 1
    const bucket = next.progress.mistakesByMechanic
    bucket['submitAnswer'] = num(bucket['submitAnswer'], 0) + 1
  }
  sync(next, i)
  void finished

  return finishLegal(
    next,
    action,
    {
      codeLine: LINE_RETURN,
      dsaOp: 'terminate',
      correct,
      note: correct
        ? `returned ${submitted}`
        : `returned ${submitted}, the answer is ${i.best}`,
      current: oid(submitted),
      read: [oid(submitted)],
      eliminated: eliminatedBefore(next, i),
      ...ctx(i),
    },
    {
      correct,
      won: correct,
      expected: correct ? undefined : { type: 'submitAnswer', targetId: 'best', value: String(i.best) },
      feedback: correct
        ? `Correct — cell ${submitted} holds ${valueOf(next, submitted)}, the ${i.wantMax ? 'largest' : 'smallest'} value, after ${i.comparisons} comparisons.`
        : `Cell ${submitted} holds ${valueOf(next, submitted)}; the ${i.wantMax ? 'largest' : 'smallest'} value is at cell ${i.best}.`,
      dsaOp: 'terminate',
    },
  )
}

function applyAction(state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  switch (action.type) {
    case 'selectObject':
      return handleSelect(state, action)
    case 'comparePair':
      return handleCompare(state, action)
    case 'assignValue':
      return handleAssign(state, action)
    case 'submitAnswer':
      return handleSubmit(state, action)
    default: {
      const fresh = readInternal(state)
      return finishIllegal(state, action, {
        feedback: 'That move is not part of a linear scan.',
        dsaOp: 'read',
        codeLine: LINE_SIGNATURE,
        note: `rejected: ${String(action.type)} is not used by this problem`,
        ...ctx(fresh),
      })
    }
  }
}

// ------------------------------------------------------------------- answers

function isWin(state: GameState): boolean {
  return state.phase === 'won'
}

function answerIndex(state: GameState): number {
  const values = state.instance.values
  if (values.length === 0) return -1
  const wantMax = state.instance.extras?.['wantMax'] !== false
  let best = 0
  for (let k = 1; k < values.length; k++) {
    if (beats(values[k] ?? 0, values[best] ?? 0, wantMax)) best = k
  }
  return best
}

function answerSummary(state: GameState) {
  const index = answerIndex(state)
  const values = state.instance.values
  const wantMax = state.instance.extras?.['wantMax'] !== false
  const i = readInternal(state)
  return {
    text: `index ${index} (${wantMax ? 'the largest' : 'the smallest'} value, ${values[index] ?? '?'})`,
    value: index,
    details: [
      { label: 'index', value: index },
      { label: 'value', value: values[index] ?? '' },
      { label: 'comparisons', value: i.comparisons },
      { label: 'array length', value: values.length },
    ],
  }
}

function complexity(): Complexity {
  return { time: 'O(n)', space: 'O(1)', best: 'O(n)', average: 'O(n)', worst: 'O(n)' }
}

// ------------------------------------------------------------ canonical trace

/**
 * The reference solution, REGENERATED FROM THE CURRENT STATE.
 *
 * Resuming rather than replaying from zero is what lets the debrief show "your
 * run against the reference" for a game already half over, and it is what the
 * driver in `playability.test.ts` follows. A fresh state has `i = 1, best = 0`,
 * so a complete run is the same shape.
 */
function canonicalTrace(state: GameState): TraceFrame[] {
  const values = state.instance.values
  const wantMax = state.instance.extras?.['wantMax'] !== false
  const n = values.length
  const frames: TraceFrame[] = []
  const live = readInternal(state)
  let best = live.best
  let comparisons = live.comparisons
  const start = Math.max(1, live.i)

  const vars = (i: number, cmp: number) => ({
    i,
    best,
    comparisons: cmp,
    steps: frames.length,
    n,
    a_i: values[i] ?? 0,
    a_best: values[best] ?? 0,
  })

  const settled: string[] = []
  for (let k = 1; k < start; k++) if (k !== best) settled.push(oid(k))

  for (let i = start; i < n; i++) {
    frames.push({
      index: frames.length,
      action: { type: 'selectObject', objectId: oid(i) },
      codeLine: LINE_LOOP,
      codeLineText: codeLineText('javascript', LINE_LOOP),
      variables: vars(i, comparisons),
      pointers: { current: oid(i), read: [oid(i)], eliminated: [...settled] },
      dsaOp: 'read',
      correct: true,
      note: `a[${i}] = ${values[i]}`,
    })

    const relation = relationOf(values[i] ?? 0, values[best] ?? 0, wantMax)
    frames.push({
      index: frames.length,
      action: { type: 'comparePair', aId: oid(i), bId: oid(best), relation },
      codeLine: LINE_TEST,
      codeLineText: codeLineText('javascript', LINE_TEST),
      variables: vars(i, comparisons),
      pointers: { current: oid(i), compare: [oid(i), oid(best)], read: [oid(i)], eliminated: [...settled] },
      dsaOp: 'compare',
      correct: true,
      note: `a[${i}] = ${values[i]} vs best a[${best}] = ${values[best]} -> ${relation}`,
    })

    comparisons += 1
    const improves = relation === 'eq' ? false : wantMax ? relation === 'gt' : relation === 'lt'
    if (!improves) {
      settled.push(oid(i))
      continue
    }
    // NO SEPARATE FRAME FOR `best = i`. A correct compare is ONE player move
    // that reports LINE_UPDATE and updates the best internally, so a second
    // frame here would describe a move the game never asks for — and
    // `playability.test.ts` failed on exactly that, finding the oracle offering
    // `selectObject` where the reference played `assignValue`.
    settled.push(oid(best))
    best = i
  }

  frames.push({
    index: frames.length,
    action: { type: 'submitAnswer', targetId: 'best', value: String(best) },
    codeLine: LINE_RETURN,
    codeLineText: codeLineText('javascript', LINE_RETURN),
    variables: vars(Math.max(0, n - 1), comparisons),
    pointers: { current: oid(best), read: [oid(best)], eliminated: [...settled] },
    dsaOp: 'terminate',
    correct: true,
    note: `return ${best}`,
  })

  return frames
}

// ----------------------------------------------------------------- controls

function legalActions(state: GameState): LegalActionDescriptor[] {
  const i = readInternal(state)
  const n = state.instance.values.length

  if (i.terminated) {
    return [{ type: 'submitAnswer', label: 'Return the index of the best cell', expects: 'value' }]
  }
  if (i.compared) {
    return [{ type: 'selectObject', label: 'Look at the next cell', options: { objectIds: [oid(i.i + 1)] } }]
  }
  if (i.picked) {
    return [
      {
        type: 'comparePair',
        label: 'Is the value you are holding above or below the running best?',
        options: { objectIds: [oid(i.i), oid(i.best)] },
        expects: 'relation',
      },
    ]
  }
  // THE SCAN IS OVER ONCE THE CURSOR IS ON THE LAST CELL and nothing is
  // pending. Offering `selectObject` here meant the board asked for a cell
  // that had already been read and the round could never be committed — which
  // `playability.test.ts` found by replaying the reference and watching the
  // oracle still ask for a move at the point the reference was submitting.
  if (i.done) {
    return [{ type: 'submitAnswer', label: 'Return the index of the best cell', expects: 'value' }]
  }
  return [{ type: 'selectObject', label: 'Look at the next cell', options: { objectIds: [oid(i.i)] } }]
}

// ------------------------------------------------------------------- export

export function createArrayMaxMinOracle(): Oracle {
  return {
    problemId: PROBLEM_ID,
    buildInstance,
    initState,
    legalActions,
    applyAction,
    isWin,
    canonicalTrace,
    pseudocode: () => [...PSEUDOCODE],
    code: (language: CodeLang) => [...listingFor(language)],
    complexity,
    answerSummary,
  }
}

/** Guard used by the registry test: the id must be in the catalogue. */
if (!PROBLEM_IDS.includes(PROBLEM_ID)) throw new Error(`${PROBLEM_ID} is not in PROBLEM_IDS`)

export const ARRAY_MAX_MIN_LINES = {
  signature: LINE_SIGNATURE,
  bestInit: LINE_BEST_INIT,
  loop: LINE_LOOP,
  test: LINE_TEST,
  update: LINE_UPDATE,
  return: LINE_RETURN,
  count: LINE_COUNT,
}

void swapSlots
