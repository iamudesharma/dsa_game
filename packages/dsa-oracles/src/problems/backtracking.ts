/**
 * Backtracking as choose / unchoose: the plan is the full decision trace,
 * including the undos. Marking and unmarking reuse `assignValue` (0/1 flags),
 * the same shape as word-search's path marking — the undo is what makes it
 * backtracking rather than plain DFS, and it is a first-class move here.
 *
 *   subsets       at each position: select, mark include (1), recurse, mark
 *                 exclude (0), recurse. Leaves are implicit; the final commit
 *                 is the whole enumeration in canonical DFS order.
 *   permutations  at each open position, try every unused value ascending:
 *                 select, mark used (1), recurse, unmark (0). Same shape, with
 *                 a `used_*` flag per value instead of per position.
 *
 * Submit values are the complete enumerations (digits concatenated, subsets
 * joined with `;`, empty subset as `∅`), in canonical DFS order — computed
 * independently in `answerText`, so plan and summary cannot disagree.
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

type BacktrackingId = 'subsets' | 'permutations'

const IDS: readonly BacktrackingId[] = ['subsets', 'permutations']

function sized(metaId: BacktrackingId, input: BuildInstanceInput): number {
  const meta = getProblem(metaId)
  if (!meta) throw new Error(`${metaId} is missing from the catalogue`)
  const { minLength, maxLength } = meta.instanceHints
  const defaultLength =
    input.difficulty === 'easy' ? minLength : input.difficulty === 'hard' ? maxLength : Math.round((minLength + maxLength) / 2)
  return Math.max(minLength, Math.min(maxLength, Math.trunc(input.length ?? defaultLength)))
}

function uniqueValues(n: number, rng: () => number): number[] {
  const values = new Set<number>()
  while (values.size < n) values.add(randInt(rng, 1, 9))
  return [...values]
}

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

// ------------------------------------------------------------------ instances

function buildInstance(id: BacktrackingId, input: BuildInstanceInput): ProblemInstance {
  const n = Math.max(2, Math.min(4, sized(id, input)))
  const rng = makeRng(input.seed)
  const values = uniqueValues(n, rng)
  return { problemId: id, seed: input.seed, values, slots: linearSlots(values.length), extras: { difficulty: input.difficulty } }
}

function initState(id: BacktrackingId, instance: ProblemInstance): GameState {
  const state = buildBoard({ problemId: id, instance, variables: { i: 0, n: instance.values.length } })
  state.internal = { planIndex: 0 }
  return state
}

// ---------------------------------------------------------------------- plans

function subsetStrings(values: readonly number[]): string[] {
  const out: string[] = []
  const path: number[] = []
  const dfs = (i: number): void => {
    if (i === values.length) {
      out.push(path.length === 0 ? '∅' : path.join(''))
      return
    }
    path.push(values[i]!)
    dfs(i + 1)
    path.pop()
    dfs(i + 1)
  }
  dfs(0)
  return out
}

function permutationStrings(values: readonly number[]): string[] {
  const out: string[] = []
  const used = new Array<boolean>(values.length).fill(false)
  const path: number[] = []
  const dfs = (): void => {
    if (path.length === values.length) {
      out.push(path.join(''))
      return
    }
    for (let j = 0; j < values.length; j++) {
      if (used[j]) continue
      used[j] = true
      path.push(values[j]!)
      dfs()
      path.pop()
      used[j] = false
    }
  }
  dfs()
  return out
}

function actionsFor(id: BacktrackingId, instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  const v = instance.values

  if (id === 'subsets') {
    const dfs = (i: number): void => {
      if (i === v.length) return
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      actions.push({ type: 'assignValue', targetId: `inc_${i}`, value: '1' })
      dfs(i + 1)
      actions.push({ type: 'assignValue', targetId: `inc_${i}`, value: '0' })
      dfs(i + 1)
    }
    dfs(0)
    actions.push({ type: 'submitAnswer', targetId: `v${v.length - 1}`, value: subsetStrings(v).join(';') })
    return actions
  }

  // permutations
  const used = new Array<boolean>(v.length).fill(false)
  const dfs = (): void => {
    if (used.every(Boolean)) return
    for (let j = 0; j < v.length; j++) {
      if (used[j]) continue
      actions.push({ type: 'selectObject', objectId: `v${j}` })
      actions.push({ type: 'assignValue', targetId: `used_${v[j]!}`, value: '1' })
      used[j] = true
      dfs()
      used[j] = false
      actions.push({ type: 'assignValue', targetId: `used_${v[j]!}`, value: '0' })
    }
  }
  dfs()
  actions.push({ type: 'submitAnswer', targetId: 'v0', value: permutationStrings(v).join(';') })
  return actions
}

// ------------------------------------------------------------------ metadata

function codeLine(id: BacktrackingId, action: Action): number {
  if (action.type === 'submitAnswer') return 9
  if (action.type === 'selectObject') return 4
  if (action.type === 'assignValue') return action.value === '1' ? 5 : 7
  return 1
}

function source(id: BacktrackingId): string[] {
  if (id === 'subsets') {
    return ['function subsets(a) {', '  const out = []', '  function dfs(i, path) {', '    if (i === a.length) { out.push([...path]); return }', '    path.push(a[i]); dfs(i + 1, path)', '    path.pop(); dfs(i + 1, path)', '    // the pop above is the backtrack: un-choose, then continue', '  }', '  dfs(0, []); return out', '}']
  }
  return ['function permute(a) {', '  const out = [], used = new Array(a.length).fill(false)', '  function dfs(path) {', '    if (path.length === a.length) { out.push([...path]); return }', '    for (let j = 0; j < a.length; j++) {', '      if (used[j]) continue', '      used[j] = true; path.push(a[j]); dfs(path)', '      used[j] = false; path.pop()', '    }', '  }', '  dfs([]); return out', '}']
}

function pseudocode(id: BacktrackingId): string[] {
  if (id === 'subsets') {
    return ['FUNCTION subsets(a)', '    dfs(0, [])', '    FUNCTION dfs(i, path)', '        IF i = LENGTH(a): EMIT path; RETURN', '        INCLUDE a[i]: mark, recurse', '        EXCLUDE a[i]: unmark, recurse', '    END FUNCTION', 'END FUNCTION']
  }
  return ['FUNCTION permute(a)', '    dfs([])', '    FUNCTION dfs(path)', '        IF path is full: EMIT path; RETURN', '        FOR each unused value in order', '            MARK used, recurse, UNMARK', '    END FOR', '    END FUNCTION', 'END FUNCTION']
}

function complexity(id: BacktrackingId): Complexity {
  const meta = getProblem(id)!
  return { ...meta.complexity }
}

function answerText(id: BacktrackingId, instance: ProblemInstance): { text: string; value: string | number } {
  const list = id === 'subsets' ? subsetStrings(instance.values) : permutationStrings(instance.values)
  return { text: `${list.length} ${id}: ${list.slice(0, 4).join(';')}${list.length > 4 ? ';…' : ''}`, value: list.join(';') }
}

// ------------------------------------------------------------------ gameplay

function legalActions(id: BacktrackingId, state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(id, state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') {
    const label = id === 'subsets' ? 'Decide this element: include or exclude' : 'Try this value in the open position'
    return [{ type: next.type, label, options: { objectIds: [next.objectId] } }]
  }
  if (next.type === 'assignValue') {
    const label = next.value === '1' ? 'Mark it and go deeper' : 'Unmark it — backtrack and try the other way'
    return [{ type: next.type, label, expects: 'value', options: { objectIds: [], targetIds: [next.targetId] } }]
  }
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Submit the full enumeration', expects: 'value', options: { objectIds: [next.targetId] } }]
  }
  return [{ type: next.type, label: 'Continue the algorithm.' }]
}

function context(id: BacktrackingId) {
  return {
    codeLineText: (line: number) => source(id)[line - 1] ?? '',
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

function applyAction(id: BacktrackingId, state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
  const step = num(state.internal['planIndex'], 0)
  const expected = actionsFor(id, state.instance)[step]
  const ctx = context(id)
  if (state.phase !== 'playing' || !expected || !sameAction(action, expected)) {
    return finishIllegal(state, action, {
      feedback: expected ? `The next algorithm step is ${expected.type}; follow the highlighted cell and try that operation.` : 'This game is already complete.',
      dsaOp: dsaOpForAction(action),
      codeLine: expected ? codeLine(id, expected) : 1,
      note: 'This action is not legal for the current algorithm step.',
      ...ctx,
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
      note = `Consider ${next.objects[action.objectId]?.label ?? action.objectId}.`
      break
    }
    case 'assignValue': {
      const numeric = Number(action.value)
      next.variables[action.targetId] = Number.isFinite(numeric) ? numeric : action.value
      feedback = action.value === '1' ? `${action.targetId} is marked — go deeper.` : `${action.targetId} is unmarked — backtrack and try the other way.`
      note = action.value === '1' ? 'Choose it for this branch.' : 'Un-choose it; the branch is done.'
      break
    }
    case 'submitAnswer': {
      next.phase = 'won'
      next.variables['answer'] = action.value
      feedback = 'Correct. The enumeration is complete.'
      note = 'Commit the result.'
      break
    }
    default:
      return finishIllegal(state, action, { feedback: 'This problem does not use that operation.', dsaOp: dsaOpForAction(action), codeLine: 1, note: 'Unsupported operation.', ...ctx })
  }

  next.progress.steps += 1
  const code = codeLine(id, action)
  const frame: TraceFrame = {
    index: next.trace.length,
    action,
    codeLine: code,
    codeLineText: source(id)[code - 1] ?? '',
    variables: { ...next.variables },
    pointers: { ...(current ? { current } : {}) },
    dsaOp,
    correct: true,
    note,
  }
  next.trace.push(frame)
  return { nextState: next, outcome: { correct: true, feedback, dsaOp, traceStep: frame.index, ...(next.phase === 'won' ? { won: true } : {}) } }
}

function canonicalTrace(id: BacktrackingId, state: GameState): TraceFrame[] {
  let current = initState(id, state.instance)
  const frames: TraceFrame[] = []
  for (const action of actionsFor(id, state.instance)) {
    const result = applyAction(id, current, action)
    if (result.outcome.illegal) break
    current = result.nextState
    const frame = current.trace[current.trace.length - 1]
    if (frame) frames.push(frame)
  }
  return frames
}

export function createBacktrackingOracle(id: BacktrackingId): Oracle {
  if (!IDS.includes(id)) throw new Error(`No backtracking oracle for ${id}`)
  return {
    problemId: id,
    buildInstance: (input) => buildInstance(id, input),
    initState: (instance) => initState(id, instance),
    legalActions: (state) => legalActions(id, state),
    applyAction: (state, action) => applyAction(id, state, action),
    isWin: (state) => state.phase === 'won',
    canonicalTrace: (state) => canonicalTrace(id, state),
    pseudocode: () => pseudocode(id),
    code: () => source(id),
    complexity: () => complexity(id),
    answerSummary: (state) => {
      const answer = answerText(id, state.instance)
      return { text: answer.text, value: answer.value }
    },
  }
}

export const createSubsetsOracle = (): Oracle => createBacktrackingOracle('subsets')
export const createPermutationsOracle = (): Oracle => createBacktrackingOracle('permutations')

/** Guard used by the registry test: every id must be in the catalogue. */
if (!IDS.every((id) => PROBLEM_IDS.includes(id))) throw new Error('a backtracking oracle id is not in PROBLEM_IDS')
