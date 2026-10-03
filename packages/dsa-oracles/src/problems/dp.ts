/**
 * Dynamic programming as hand computation: the board shows the input, the
 * recurrence lives in `dp_*` variables, and every rung is select + record.
 *
 * WHY VARIABLES AND NOT BOARD CELLS. DP writes values that did not exist in
 * the input, and no mechanic rewrites an object label — `assignValue` records
 * into named slots, which is exactly what a DP table is. The visited trail on
 * the board (current/visited states) shows how far the table has been filled,
 * the same way flood-fill progress shows on a grid.
 *
 *   climbing-stairs  dp[0]=1, dp[1]=1, dp[i]=dp[i-1]+dp[i-2]. Cells are step
 *                    numbers 0..n; the player records each count and submits
 *                    dp[n] (= Fib(n+1)).
 *   house-robber     cells hold money. Per house: select, compare take
 *                    (money[i]+dp[i-2]) REL skip (dp[i-1]) — the Kadane-style
 *                    convention of comparing two computed quantities while
 *                    naming the cells involved — then assign dp[i].
 *   coin-change      cells are amounts 0..target, coins in extras (1 is always
 *                    included, so every amount is reachable). Per amount:
 *                    select + record dp[x] = 1 + min(dp[x-c]) — the
 *                    climbing-stairs shape, one rung at a time.
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
import { buildBoard, finishIllegal, indexOf, num, type CodeLang } from '../shared/kernel.js'

type DpId = 'climbing-stairs' | 'house-robber' | 'coin-change'

const IDS: readonly DpId[] = ['climbing-stairs', 'house-robber', 'coin-change']

function sized(metaId: DpId, input: BuildInstanceInput): number {
  const meta = getProblem(metaId)
  if (!meta) throw new Error(`${metaId} is missing from the catalogue`)
  const { minLength, maxLength } = meta.instanceHints
  const defaultLength =
    input.difficulty === 'easy' ? minLength : input.difficulty === 'hard' ? maxLength : Math.round((minLength + maxLength) / 2)
  return Math.max(minLength, Math.min(maxLength, Math.trunc(input.length ?? defaultLength)))
}

function relation(a: number, b: number): Relation {
  return a < b ? 'lt' : a > b ? 'gt' : 'eq'
}

function emptyProgress() {
  return { steps: 0, mistakes: 0, hintsUsed: 0, mistakesByMechanic: {} as Record<string, number> }
}

// ------------------------------------------------------------------ instances

function buildInstance(id: DpId, input: BuildInstanceInput): ProblemInstance {
  const n = sized(id, input)
  const rng = makeRng(input.seed)

  if (id === 'climbing-stairs') {
    // Cells are step numbers 0..n; the counts are computed by the player.
    const cells = Math.max(3, n)
    const values = Array.from({ length: cells }, (_, i) => i)
    return { problemId: id, seed: input.seed, values, slots: linearSlots(values.length), extras: { difficulty: input.difficulty } }
  }

  if (id === 'coin-change') {
    // Cells are amounts 0..target; denominations ride in extras. Coin 1 is
    // always present so every amount is reachable and the answer is a number.
    const amount = Math.max(5, n)
    const pool = [2, 3, 4, 5, 6]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
    }
    const extra = 1 + Math.floor(rng() * 2)
    const coins = [1, ...pool.slice(0, extra)].sort((a, b) => a - b)
    const values = Array.from({ length: amount + 1 }, (_, i) => i)
    return {
      problemId: id, seed: input.seed, values, slots: linearSlots(values.length),
      extras: { difficulty: input.difficulty, coins, amount },
    }
  }

  const len = Math.max(2, n)
  const values = Array.from({ length: len }, () => randInt(rng, 1, 20))
  return { problemId: id, seed: input.seed, values, slots: linearSlots(values.length), extras: { difficulty: input.difficulty } }
}

function stairsWays(stairs: number): number {
  let a = 1
  let b = 1
  for (let i = 2; i <= stairs; i++) {
    const c = a + b
    a = b
    b = c
  }
  return stairs === 0 ? a : b
}

function robberBest(values: readonly number[]): number {
  let prev2 = 0
  let prev1 = 0
  for (const m of values) {
    const cur = Math.max(m + prev2, prev1)
    prev2 = prev1
    prev1 = cur
  }
  return prev1
}

/** Fewest coins per amount 0..amount. Coin 1 keeps every entry finite. */
function fewestCoins(coins: readonly number[], amount: number): number[] {
  const dp = new Array<number>(amount + 1).fill(Number.MAX_SAFE_INTEGER)
  dp[0] = 0
  for (let x = 1; x <= amount; x++) {
    for (const c of coins) {
      if (c <= x) dp[x] = Math.min(dp[x]!, dp[x - c]! + 1)
    }
  }
  return dp
}

// --------------------------------------------------------------------- states

function initState(id: DpId, instance: ProblemInstance): GameState {
  const amount = num(instance.extras?.['amount'], instance.values.length - 1)
  const variables: GameState['variables'] =
    id === 'climbing-stairs'
      ? { i: 0, n: instance.values.length - 1 }
      : id === 'coin-change'
        ? { i: 0, amount, n: instance.values.length }
        : { i: 0, dpPrev2: 0, dpPrev1: 0, n: instance.values.length }
  const state = buildBoard({ problemId: id, instance, variables })
  state.internal = { planIndex: 0 }
  return state
}

// ---------------------------------------------------------------------- plans

function actionsFor(id: DpId, instance: ProblemInstance): Action[] {
  const actions: Action[] = []
  const v = instance.values

  if (id === 'climbing-stairs') {
    const stairs = v.length - 1
    let a = 1
    let b = 1
    for (let i = 0; i <= stairs; i++) {
      const ways = i === 0 ? 1 : i === 1 ? 1 : a + b
      if (i >= 2) {
        const c = a + b
        a = b
        b = c
      }
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      actions.push({ type: 'assignValue', targetId: `dp_${i}`, value: String(ways) })
    }
    actions.push({ type: 'submitAnswer', targetId: `v${stairs}`, value: String(stairsWays(stairs)) })
    return actions
  }

  // house-robber
  if (id === 'house-robber') {
    let prev2 = 0
    let prev1 = 0
    for (let i = 0; i < v.length; i++) {
      const take = v[i]! + prev2
      const skip = prev1
      const rel = relation(take, skip)
      const cur = Math.max(take, skip)
      actions.push({ type: 'selectObject', objectId: `v${i}` })
      // `take REL skip`: the named cells are the house and (when it exists) the
      // house two doors down; the note carries the two computed quantities.
      actions.push({ type: 'comparePair', aId: `v${i}`, bId: `v${Math.max(0, i - 2)}`, relation: rel })
      actions.push({ type: 'assignValue', targetId: `dp_${i}`, value: String(cur) })
      prev2 = prev1
      prev1 = cur
    }
    actions.push({ type: 'submitAnswer', targetId: `v${v.length - 1}`, value: String(robberBest(v)) })
    return actions
  }

  // coin-change: one rung per amount, the climbing-stairs shape.
  const coinAmount = num(instance.extras?.['amount'], v.length - 1)
  const coinSet = (instance.extras?.['coins'] as number[] | undefined) ?? [1]
  const table = fewestCoins(coinSet, coinAmount)
  for (let x = 0; x <= coinAmount; x++) {
    actions.push({ type: 'selectObject', objectId: `v${x}` })
    actions.push({ type: 'assignValue', targetId: `dp_${x}`, value: String(table[x]) })
  }
  actions.push({ type: 'submitAnswer', targetId: `v${coinAmount}`, value: String(table[coinAmount]) })
  return actions
}

// ------------------------------------------------------------------ metadata

function codeLine(id: DpId, action: Action): number {
  if (action.type === 'submitAnswer') return id === 'coin-change' ? 8 : 7
  if (action.type === 'selectObject') return 3
  if (action.type === 'comparePair') return 5
  if (action.type === 'assignValue') return 6
  return 1
}

function source(id: DpId): string[] {
  if (id === 'climbing-stairs') {
    return ['function climbStairs(n) {', '  let a = 1, b = 1', '  for (let i = 2; i <= n; i++) {', '    const c = a + b', '    a = b; b = c', '  }', '  return n === 0 ? 1 : b', '}']
  }
  if (id === 'coin-change') {
    return ['function coinChange(coins, amount) {', '  dp = new Array(amount + 1).fill(∞); dp[0] = 0', '  for (let x = 1; x <= amount; x++) {', '    let best = ∞', '    for (const c of coins) if (c <= x) best = Math.min(best, dp[x - c] + 1)', '    dp[x] = best', '  }', '  return dp[amount]', '}']
  }
  return ['function rob(nums) {', '  let prev2 = 0, prev1 = 0', '  for (let i = 0; i < nums.length; i++) {', '    const take = nums[i] + prev2', '    const skip = prev1', '    const cur = Math.max(take, skip)', '    prev2 = prev1; prev1 = cur', '  }', '  return prev1', '}']
}

function pseudocode(id: DpId): string[] {
  if (id === 'climbing-stairs') {
    return ['FUNCTION climbStairs(n)', '    dp[0] <- 1, dp[1] <- 1', '    FOR i FROM 2 TO n', '        dp[i] <- dp[i-1] + dp[i-2]', '    END FOR', '    RETURN dp[n]', 'END FUNCTION']
  }
  if (id === 'coin-change') {
    return ['FUNCTION coinChange(coins, amount)', '    dp[0] <- 0, rest <- ∞', '    FOR x FROM 1 TO amount', '        best <- min over coins c <= x of (dp[x-c] + 1)', '        dp[x] <- best', '    END FOR', '    RETURN dp[amount]', 'END FUNCTION']
  }
  return ['FUNCTION rob(nums)', '    prev2 <- 0, prev1 <- 0', '    FOR each house i', '        take <- money[i] + prev2', '        skip <- prev1', '        cur <- max(take, skip); shift prev2, prev1', '    END FOR', '    RETURN prev1', 'END FUNCTION']
}

function complexity(id: DpId): Complexity {
  const meta = getProblem(id)!
  return { ...meta.complexity }
}

function answerText(id: DpId, instance: ProblemInstance): { text: string; value: string | number } {
  if (id === 'climbing-stairs') {
    const answer = stairsWays(instance.values.length - 1)
    return { text: `${answer} ways to climb ${instance.values.length - 1} stairs`, value: answer }
  }
  if (id === 'coin-change') {
    const amount = num(instance.extras?.['amount'], instance.values.length - 1)
    const coins = (instance.extras?.['coins'] as number[] | undefined) ?? [1]
    const answer = fewestCoins(coins, amount)[amount]!
    return { text: `${answer} coins for amount ${amount} with [${coins.join(', ')}]`, value: answer }
  }
  const answer = robberBest(instance.values)
  return { text: `max loot ${answer}`, value: answer }
}

// ------------------------------------------------------------------ gameplay

function legalActions(id: DpId, state: GameState): LegalActionDescriptor[] {
  if (state.phase !== 'playing') return []
  const next = actionsFor(id, state.instance)[num(state.internal['planIndex'], 0)]
  if (!next) return []
  if (next.type === 'selectObject') return [{ type: next.type, label: 'Read the next step', options: { objectIds: [next.objectId] } }]
  if (next.type === 'comparePair') {
    return [{ type: next.type, label: 'Robbing here plus two doors down, versus skipping — which is larger?', options: { objectIds: [next.aId, next.bId] }, expects: 'relation' }]
  }
  if (next.type === 'assignValue') return [{ type: next.type, label: 'Record the table value', expects: 'value', options: { objectIds: [], targetIds: [next.targetId] } }]
  if (next.type === 'submitAnswer') {
    return [{ type: next.type, label: 'Submit the result', expects: 'value', options: { objectIds: [next.targetId] } }]
  }
  return [{ type: next.type, label: 'Continue the algorithm.' }]
}

function context(id: DpId) {
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

function applyAction(id: DpId, state: GameState, action: Action): { nextState: GameState; outcome: ActionOutcome } {
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
    case 'assignValue': {
      const numeric = Number(action.value)
      next.variables[action.targetId] = Number.isFinite(numeric) ? numeric : action.value
      if (id === 'house-robber' && action.targetId.startsWith('dp_') && Number.isFinite(numeric)) {
        next.variables['dpPrev2'] = num(next.variables['dpPrev1'], 0)
        next.variables['dpPrev1'] = numeric
      }
      feedback = `${action.targetId} now records ${action.value}.`
      note = `Store ${action.value} in ${action.targetId}.`
      break
    }
    case 'comparePair': {
      next.selection = [action.aId, action.bId]
      compare = [action.aId, action.bId]
      note = action.relation === 'eq' ? 'Take and skip tie.' : `Take is ${action.relation === 'gt' ? 'better' : 'worse'} than skip.`
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
    pointers: { ...(current ? { current } : {}), ...(compare ? { compare } : {}) },
    dsaOp,
    correct: true,
    note,
  }
  next.trace.push(frame)
  return { nextState: next, outcome: { correct: true, feedback, dsaOp, traceStep: frame.index, ...(next.phase === 'won' ? { won: true } : {}) } }
}

function canonicalTrace(id: DpId, state: GameState): TraceFrame[] {
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

export function createDpOracle(id: DpId): Oracle {
  if (!IDS.includes(id)) throw new Error(`No DP oracle for ${id}`)
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

export const createClimbingStairsOracle = (): Oracle => createDpOracle('climbing-stairs')
export const createHouseRobberOracle = (): Oracle => createDpOracle('house-robber')
export const createCoinChangeOracle = (): Oracle => createDpOracle('coin-change')

/** Guard used by the registry test: every id must be in the catalogue. */
if (!IDS.every((id) => PROBLEM_IDS.includes(id))) throw new Error('a DP oracle id is not in PROBLEM_IDS')
