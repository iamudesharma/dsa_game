/**
 * Jump game: one running number (farthest reachable index) decides everything.
 *
 * Per index: select it, then record the new reach — uniformly, even when the
 * reach does not grow, so the rhythm is always read/record. Stepping beyond
 * the reach ends the run immediately with `false`; surviving to the last
 * index commits `true`.
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

const PROBLEM_ID = 'jump-game' as const

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

function reachable(values: readonly number[]): boolean {
  let reach = 0
  for (let i = 0; i < values.length; i++) {
    if (i > reach) return false
    reach = Math.max(reach, i + values[i]!)
  }
  return true
}

function buildInstance(input: BuildInstanceInput): ProblemInstance {
  const meta = getProblem(PROBLEM_ID)
  if (!meta) throw new Error(`${PROBLEM_ID} is missing from the catalogue`)
  const { minLength, maxLength, valueRange } = meta.instanceHints
  const defaultLength =
    input.difficulty === 'easy' ? minLength : input.difficulty === 'hard' ? maxLength : Math.round((minLength + maxLength) / 2)
  const n = Math.max(3, Math.min(maxLength, Math.max(minLength, Math.trunc(input.length ?? defaultLength))))
  const rng = makeRng(input.seed)
  const [min, max] = valueRange ?? [0, 4]
  const wantReachable = rng() >= 0.3
  const roll = (): number[] => {
    const v = Array.from({ length: n }, () => randInt(rng, min, max))
    v[n - 1] = 0
    return v
  }
  let values = roll()
  for (let attempt = 0; attempt < 12 && reachable(values) !== wantReachable; attempt++) values = roll()
  return { problemId: PROBLEM_ID, seed: input.seed, values, slots: linearSlots(n), extras: { difficulty: input.difficulty } }
}

function initState(instance: ProblemInstance): GameState {
  const state = buildBoard({ problemId: PROBLEM_ID, instance, variables: { i: 0, reach: 0, n: instance.values.length } })
  state.internal = { planIndex: 0 }
  return state
}

function actionsFor(instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  const v = instance.values
  let reach = 0
  for (let i = 0; i < v.length; i++) {
    if (i > reach) {
      actions.push({ type: 'submitAnswer', targetId: `v${Math.max(0, i - 1)}`, value: 'false' })
      return actions
    }
    actions.push({ type: 'selectObject', objectId: `v${i}` })
    reach = Math.max(reach, i + v[i]!)
    actions.push({ type: 'assignValue', targetId: 'reach', value: String(reach) })
  }
  actions.push({ type: 'submitAnswer', targetId: `v${v.length - 1}`, value: 'true' })
  return actions
}

function codeLine(action: Action): number {
  if (action.type === 'submitAnswer') return action.value === 'true' ? 7 : 4
  if (action.type === 'selectObject') return 3
  if (action.type === 'assignValue') return 5
  return 1
}

const LISTING: readonly string[] = [
  'function canJump(nums) {', // 1
  '  let reach = 0', // 2
  '  for (let i = 0; i < nums.length; i++) {', // 3
  '    if (i > reach) return false', // 4
  '    reach = Math.max(reach, i + nums[i])', // 5
  '  }', // 6
  '  return true', // 7
  '}', // 8
]

const PSEUDOCODE: readonly string[] = [
  'FUNCTION canJump(nums)',
  '    reach <- 0',
  '    FOR i FROM 0 TO LENGTH(nums) - 1',
  '        IF i > reach: RETURN false',
  '        reach <- max(reach, i + nums[i])',
  '    END FOR',
  '    RETURN true',
  'END FUNCTION',
]

function complexity(): Complexity {
  const meta = getProblem(PROBLEM_ID)!
  return { ...meta.complexity }
}

function answerSummary(state: GameState) {
  const ok = reachable(state.instance.values)
  return ok ? { text: 'the last index is reachable', value: 'true' } : { text: 'the run gets stuck', value: 'false' }
}

function legalActions(state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') return [{ type: next.type, label: 'Read how far this cell jumps', options: { objectIds: [next.objectId] } }]
  if (next.type === 'assignValue') return [{ type: next.type, label: 'Record the new farthest reach', expects: 'value' }]
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Commit reachable or stuck', expects: 'value', options: { objectIds: [next.targetId] } }]
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
      note = `Cell ${position} jumps ${next.objects[action.objectId]?.value ?? '?'} ahead.`
      break
    }
    case 'assignValue': {
      const numeric = Number(action.value)
      next.variables[action.targetId] = Number.isFinite(numeric) ? numeric : action.value
      feedback = `Farthest reach is now ${action.value}.`
      note = `Record reach = ${action.value}.`
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

export function createJumpGameOracle(): Oracle {
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
