/**
 * Single number: XOR cancels pairs, so folding the array leaves the survivor.
 *
 * Pairs plus one single, shuffled. Per value: select it, fold it into the
 * `xor` accumulator. The trace reads as the cancellation happening live, and
 * the commit is the value that never cancelled.
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
import { buildBoard, finishIllegal, indexOf, num, type CodeLang } from '../shared/kernel.js'

const PROBLEM_ID = 'single-number' as const

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

function buildInstance(input: BuildInstanceInput): ProblemInstance {
  const meta = getProblem(PROBLEM_ID)
  if (!meta) throw new Error(`${PROBLEM_ID} is missing from the catalogue`)
  const { minLength, maxLength, valueRange } = meta.instanceHints
  const defaultLength =
    input.difficulty === 'easy' ? minLength : input.difficulty === 'hard' ? maxLength : Math.round((minLength + maxLength) / 2)
  let n = Math.max(minLength, Math.min(maxLength, Math.trunc(input.length ?? defaultLength)))
  // XOR needs pairs plus one: the board length is always odd.
  if (n % 2 === 0) n = n + 1 <= maxLength ? n + 1 : n - 1
  const rng = makeRng(input.seed)
  const [min, max] = valueRange ?? [1, 30]
  const pool = new Set<number>()
  while (pool.size < (n - 1) / 2 + 1) pool.add(randInt(rng, min, max))
  const distinct = [...pool]
  const single = distinct[distinct.length - 1]!
  const values: number[] = [single]
  for (const v of distinct.slice(0, -1)) values.push(v, v)
  // Fisher-Yates with the same rng, so the shuffle is deterministic.
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = values[i]!
    values[i] = values[j]!
    values[j] = t
  }
  return { problemId: PROBLEM_ID, seed: input.seed, values, slots: linearSlots(n), extras: { difficulty: input.difficulty } }
}

function initState(instance: ProblemInstance): GameState {
  const state = buildBoard({ problemId: PROBLEM_ID, instance, variables: { i: 0, xor: 0, n: instance.values.length } })
  state.internal = { planIndex: 0 }
  return state
}

function actionsFor(instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  const v = instance.values
  let acc = 0
  for (let i = 0; i < v.length; i++) {
    acc ^= v[i]!
    actions.push({ type: 'selectObject', objectId: `v${i}` })
    actions.push({ type: 'assignValue', targetId: 'xor', value: String(acc) })
  }
  actions.push({ type: 'submitAnswer', targetId: `v${v.indexOf(acc)}`, value: String(acc) })
  return actions
}

function codeLine(action: Action): number {
  if (action.type === 'submitAnswer') return 6
  if (action.type === 'selectObject') return 3
  if (action.type === 'assignValue') return 4
  return 1
}

const LISTING: readonly string[] = [
  'function singleNumber(nums) {', // 1
  '  let acc = 0', // 2
  '  for (const v of nums) {', // 3
  '    acc ^= v', // 4
  '  }', // 5
  '  return acc', // 6
  '}', // 7
]

const PSEUDOCODE: readonly string[] = [
  'FUNCTION singleNumber(nums)',
  '    acc <- 0',
  '    FOR each value v',
  '        acc <- acc XOR v (pairs cancel to zero)',
  '    END FOR',
  '    RETURN acc',
  'END FUNCTION',
]

function complexity(): Complexity {
  const meta = getProblem(PROBLEM_ID)!
  return { ...meta.complexity }
}

function answerSummary(state: GameState) {
  // Brute-forced fold, independent of the plan.
  let acc = 0
  for (const v of state.instance.values) acc ^= v
  return { text: `the single number is ${acc}`, value: acc }
}

function legalActions(state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') return [{ type: next.type, label: 'Fold the next value in', options: { objectIds: [next.objectId] } }]
  if (next.type === 'assignValue') return [{ type: next.type, label: 'Record the accumulator', expects: 'value' }]
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Commit the survivor', expects: 'value', options: { objectIds: [next.targetId] } }]
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

function applyAction(state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  const step = num(state.internal['planIndex'], 0)
  const expected = actionsFor(state.instance)[step]
  if (state.phase !== 'playing' || !expected || !sameAction(action, expected)) {
    return finishIllegal(state, action, {
      feedback: expected ? `The next algorithm step is ${expected.type}; follow the highlighted cell and try that operation.` : 'This game is already complete.',
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
      note = `Fold in ${next.objects[action.objectId]?.label ?? action.objectId}.`
      break
    }
    case 'assignValue': {
      const numeric = Number(action.value)
      next.variables[action.targetId] = Number.isFinite(numeric) ? numeric : action.value
      feedback = `Accumulator is now ${action.value}.`
      note = `acc XOR value = ${action.value}.`
      break
    }
    case 'submitAnswer': {
      next.phase = 'won'
      next.variables['answer'] = action.value
      feedback = 'Correct. Only the unpaired value survived.'
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
    pointers: { ...(current ? { current } : {}) },
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

export function createSingleNumberOracle(): Oracle {
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
