/**
 * A deliberately small, in-repo test double for the `Oracle` contract.
 *
 * The real oracles live in `@dsa/dsa-oracles`, which the engine must not
 * depend on (that package is built separately and the engine has to work with
 * any oracle at all). So the engine tests carry their own oracle: a four
 * element "find the index of the maximum" scan, the smallest problem that
 * still exercises comparisons, a running pointer, a mistake branch and a
 * terminal answer.
 *
 * It also supports every way a real oracle can misbehave, because those paths
 * are half of what the engine exists to handle:
 *   - `throwOnApply` — blows up instead of returning
 *   - `frames: 'none' | 'three'` — appends the wrong number of trace frames
 *   - `legalActions: 'absent' | 'single' | 'normal'` — the three states of the
 *     optional affordance the hint ladder is supposed to degrade through.
 */

import { cloneState, emptyProgress, makeRng, randInt } from '@dsa/game-schema'
import type {
  Action,
  ActionOutcome,
  AnswerSummary,
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

import type { GameRuntime } from '../runtime.js'

export const FAKE_PROBLEM_ID = 'array-max-min'
export const FAKE_VALUE_COUNT = 4

export interface FakeOracleOptions {
  /** Overrides the declared problem id (used to exercise the sorted guard). */
  problemId?: string
  /** Overrides the generated values. */
  values?: number[]
  /** How `legalActions` should present itself. */
  legalActions?: 'absent' | 'single' | 'normal'
  /** How many trace frames one `applyAction` appends. */
  frames?: 'one' | 'none' | 'three'
  /** How (and whether) `applyAction` breaks its own contract. */
  malform?: 'none' | 'throw' | 'bare-outcome' | 'garbage-result'
}

const PSEUDOCODE = [
  'best = 0',
  'i = 1',
  'while i < n:',
  '  if a[i] > a[best]:',
  '    best = i',
  '  i = i + 1',
  'return best',
]

const CODE: Readonly<Record<CodeLanguage, readonly string[]>> = {
  javascript: [
    'function findMaxIndex(a) {',
    '  let best = 0;',
    '  for (let i = 1; i < a.length; i++)',
    '    if (a[i] > a[best]) {',
    '      best = i;',
    '    }',
    '  return best;',
  ],
  typescript: [
    'export function findMaxIndex(a: number[]): number {',
    '  let best = 0;',
    '  for (let i = 1; i < a.length; i++)',
    '    if (a[i] > a[best]) {',
    '      best = i;',
    '    }',
    '  return best;',
  ],
  python: [
    'def find_max_index(a):',
    '    best = 0',
    '    for i in range(1, len(a)):',
    '        if a[i] > a[best]:',
    '            best = i',
    '    # exactly one comparison per element after the first',
    '    return best',
  ],
  java: [
    'public static int findMaxIndex(int[] a) {',
    '    int best = 0;',
    '    for (int i = 1; i < a.length; i++)',
    '        if (a[i] > a[best]) {',
    '            best = i;',
    '        }',
    '    return best;',
  ],
  cpp: [
    'int findMaxIndex(const std::vector<int>& a) {',
    '    int best = 0;',
    '    for (int i = 1; i < (int)a.size(); i++)',
    '        if (a[i] > a[best]) {',
    '            best = i;',
    '        }',
    '    return best;',
  ],
}

const LINE_LOOP = 3
const LINE_COMPARE = 4
const LINE_UPDATE = 5
const LINE_RETURN = 7

export function makeFakeOracle(options: FakeOracleOptions = {}): Oracle {
  const problemId = options.problemId ?? FAKE_PROBLEM_ID
  const frameMode = options.frames ?? 'one'
  const legalMode = options.legalActions ?? 'normal'

  const base: Oracle = {
    problemId,

    buildInstance({ seed }) {
      const values = options.values ?? distinctValues(makeRng(seed), FAKE_VALUE_COUNT)
      return {
        problemId,
        seed,
        values,
        slots: values.map((_value, index) => ({
          id: `s${index}`,
          index,
          kind: 'default' as const,
          occupantId: `o${index}`,
        })),
      }
    },

    initState(instance) {
      const objects: Record<string, GameObject> = {}
      const slots: Record<string, Slot> = {}
      instance.values.forEach((value, index) => {
        const objectId = `o${index}`
        objects[objectId] = {
          id: objectId,
          kind: 'number',
          label: String(value),
          value,
          slotId: `s${index}`,
          state: index === 0 ? 'current' : 'idle',
        }
        slots[`s${index}`] = { id: `s${index}`, index, kind: 'default', occupantId: objectId }
      })
      return {
        problemId: instance.problemId,
        seed: instance.seed,
        instance,
        objects,
        slots,
        containers: {},
        links: [],
        selection: [],
        cursor: { bestObjectId: 'o0', iSlotId: 's1' },
        variables: { n: instance.values.length, i: 1, best: instance.values[0] ?? 0 },
        progress: emptyProgress(),
        phase: 'playing',
        trace: [],
        internal: { i: 1, bestId: 'o0', compared: 0, mistakes: 0, submitted: false, correct: false },
      }
    },

    applyAction(state, action) {
      const malform = options.malform ?? 'none'
      if (malform === 'throw') {
        throw new Error('fake oracle exploded on purpose')
      }
      if (malform === 'garbage-result') {
        return undefined as unknown as { nextState: GameState; outcome: ActionOutcome }
      }
      // Rejecting an illegal action must leave the state untouched, so the
      // original object (not a clone) is handed back.
      if (state.phase !== 'playing') {
        return { nextState: state, outcome: rejected('The run is already over.') }
      }

      const next = cloneState(state)
      const result =
        action.type === 'selectObject'
          ? selectObject(next, action)
          : action.type === 'comparePair'
            ? comparePair(next, action)
            : action.type === 'submitAnswer'
              ? submitAnswer(next, action)
              : ({ nextState: state, outcome: rejected('That mechanic is not part of this problem.') } as const)

      if (malform === 'bare-outcome') {
        // Feedback, dsaOp and the rest are simply absent.
        return { nextState: result.nextState, outcome: { correct: result.outcome.correct } as ActionOutcome }
      }
      return result
    },

    isWin(state) {
      return state.phase === 'won' || state.internal['correct'] === true
    },

    canonicalTrace(state) {
      // Derived only from the instance, never from the player's bookkeeping, so
      // it stays the reference solution even after a mistaken run.
      const values = state.instance.values
      let best = 0
      const frames: TraceFrame[] = []
      for (let i = 1; i < values.length; i++) {
        const relation = compareNumbers(values[i] ?? 0, values[best] ?? 0)
        const previousBest = best
        if (relation === 'gt') best = i
        frames.push(
          buildFrame(
            state,
            frames.length,
            { type: 'comparePair', aId: `o${i}`, bId: `o${previousBest}`, relation },
            relation === 'gt' ? LINE_UPDATE : LINE_COMPARE,
            relation === 'gt' ? 'compare, then update best' : 'compare only',
            relation === 'gt',
          ),
        )
      }
      frames.push(
        buildFrame(
          state,
          frames.length,
          { type: 'submitAnswer', targetId: `o${best}`, value: String(best) },
          LINE_RETURN,
          'return the index of the best',
          true,
        ),
      )
      return frames
    },

    pseudocode() {
      return [...PSEUDOCODE]
    },

    code(language) {
      return [...(CODE[language] ?? CODE.javascript)]
    },

    complexity(): Complexity {
      return { time: 'O(n)', space: 'O(1)', note: 'one comparison per element after the first' }
    },

    answerSummary(state): AnswerSummary {
      const best = bestIdOf(state) ?? 'o0'
      const index = indexOfId(state, best)
      return {
        text: `index ${index} (value ${valueOf(state, best) ?? 0})`,
        value: index,
        details: [
          { label: 'best object', value: best },
          { label: 'comparisons', value: countOf(state.internal, 'compared') },
        ],
      }
    },
  }

  if (legalMode === 'absent') return base

  return {
    ...base,
    legalActions(state): LegalActionDescriptor[] {
      if (legalMode === 'single') {
        return [
          { type: 'comparePair', label: 'Compare the highlighted card with your running best', expects: 'relation' },
        ]
      }
      const i = countOf(state.internal, 'i')
      if (i >= state.instance.values.length) {
        return [{ type: 'submitAnswer', label: 'Commit your answer', expects: 'value' }]
      }
      const candidate = `o${i}`
      return [
        { type: 'selectObject', label: 'Read the next card', options: { objectIds: [candidate] } },
        {
          type: 'comparePair',
          label: 'Compare it with your running best',
          expects: 'relation',
          options: { objectIds: [candidate, bestIdOf(state) ?? 'o0'] },
        },
      ]
    },
  }

  function selectObject(
    next: GameState,
    action: Extract<Action, { type: 'selectObject' }>,
  ): { nextState: GameState; outcome: ActionOutcome } {
    if (!hasObject(next, action.objectId)) {
      return { nextState: next, outcome: rejected('That card is not on the board.') }
    }
    next.internal['selected'] = action.objectId
    mark(next, action.objectId, 'revealed')
    return commit(
      next,
      action,
      {
        correct: true,
        feedback: `You read the card showing ${valueOf(next, action.objectId) ?? 0}.`,
        dsaOp: 'read',
        illegal: false,
      },
      LINE_COMPARE,
      `read ${action.objectId}`,
    )
  }

  function comparePair(
    next: GameState,
    action: Extract<Action, { type: 'comparePair' }>,
  ): { nextState: GameState; outcome: ActionOutcome } {
    const { aId, bId, relation } = action
    if (aId === bId || !hasObject(next, aId) || !hasObject(next, bId)) {
      return { nextState: next, outcome: rejected('Compare two different cards.') }
    }
    const best = bestIdOf(next)
    if (best === null) {
      return { nextState: next, outcome: rejected('No running best yet — read the first card.') }
    }
    const i = countOf(next.internal, 'i')
    if (i >= next.instance.values.length) {
      return { nextState: next, outcome: rejected('Every card has been compared already.') }
    }

    // The player may name the pair in either order; the algorithm always reads
    // it as (candidate, running best).
    const candidate = aId === best ? bId : aId
    const truth = relationBetween(next, candidate, best)
    const correct = relation === truth
    const candidateValue = valueOf(next, candidate) ?? 0

    if (truth === 'gt' || !correct) {
      // A correct 'gt' is the update branch. A wrong relation takes that branch
      // anyway, because the mistake has to be applied and visible.
      next.internal['bestId'] = candidate
    }
    next.internal['i'] = i + 1
    next.internal['compared'] = countOf(next.internal, 'compared') + 1
    next.internal['mistakes'] = countOf(next.internal, 'mistakes') + (correct ? 0 : 1)
    next.variables = { ...next.variables, i: i + 1, best: valueOf(next, bestIdOf(next) ?? best) ?? 0 }
    next.cursor = {
      ...next.cursor,
      iSlotId: `s${Math.min(i + 1, next.instance.values.length - 1)}`,
      bestObjectId: bestIdOf(next) ?? best,
    }
    mark(next, candidate, correct ? 'visited' : 'locked')
    mark(next, bestIdOf(next) ?? best, 'current')
    next.selection = [candidate, best]

    return commit(
      next,
      action,
      {
        correct,
        expected: correct ? undefined : { type: 'comparePair', aId: candidate, bId: best, relation: truth },
        feedback: correct
          ? `Correct: ${candidateValue} really is ${relation} your running best.`
          : `Not this time: ${candidateValue} against your best is "${truth}", not "${relation}".`,
        dsaOp: 'compare',
        illegal: false,
      },
      bestIdOf(next) === best ? LINE_COMPARE : LINE_UPDATE,
      `${candidateValue} ${relation} best`,
    )
  }

  function submitAnswer(
    next: GameState,
    action: Extract<Action, { type: 'submitAnswer' }>,
  ): { nextState: GameState; outcome: ActionOutcome } {
    if (action.targetId.trim() === '') {
      return { nextState: next, outcome: rejected('Name what you are answering for.') }
    }
    const best = bestIdOf(next) ?? 'o0'
    const compared = countOf(next.internal, 'compared')
    const total = next.instance.values.length
    if (compared < total - 1) {
      const pending = `o${Math.min(countOf(next.internal, 'i'), total - 1)}`
      return commit(
        next,
        action,
        {
          correct: false,
          expected: { type: 'comparePair', aId: pending, bId: best },
          feedback: 'You still have cards you never compared — a scan cannot skip ahead.',
          dsaOp: 'terminate',
          illegal: false,
        },
        LINE_LOOP,
        'tried to stop before the scan finished',
      )
    }

    next.internal['submitted'] = true
    const submitted = Number(action.value)
    const correctIndex = indexOfId(next, best)
    if (Number.isInteger(submitted) && submitted === correctIndex) {
      next.phase = 'won'
      next.internal['correct'] = true
      mark(next, best, 'matched')
      return commit(
        next,
        action,
        {
          correct: true,
          feedback: `Correct: index ${correctIndex} holds the largest card.`,
          dsaOp: 'terminate',
          illegal: false,
          won: true,
        },
        LINE_RETURN,
        'return the index of the best',
      )
    }

    return commit(
      next,
      action,
      {
        correct: false,
        expected: { type: 'selectObject', objectId: largestIdOf(next) },
        feedback: 'That is not where your running best ended up — look for the largest card again.',
        dsaOp: 'terminate',
        illegal: false,
      },
      LINE_COMPARE,
      'answered with the wrong index',
    )
  }

  /** Appends 1, 0 or 3 frames depending on how this oracle is configured. */
  function commit(
    next: GameState,
    action: Action,
    outcome: Omit<ActionOutcome, 'traceStep'>,
    codeLine: number,
    note: string,
  ): { nextState: GameState; outcome: ActionOutcome } {
    const built = buildFrame(next, next.trace.length, action, codeLine, note, outcome.correct)
    if (frameMode === 'none') {
      next.trace = [...next.trace]
    } else if (frameMode === 'three') {
      next.trace = [
        ...next.trace,
        built,
        { ...built, index: built.index + 1, note: `${note} (spurious #2)` },
        { ...built, index: built.index + 2, note: `${note} (spurious #3)` },
      ]
    } else {
      next.trace = [...next.trace, built]
    }
    const settled: ActionOutcome = { ...outcome, traceStep: next.trace.length - 1 }
    return { nextState: next, outcome: settled }
  }
}

function buildFrame(
  state: GameState,
  index: number,
  action: Action,
  codeLine: number,
  note: string,
  correct: boolean,
): TraceFrame {
  const dsaOp: DsaOp = action.type === 'comparePair' ? 'compare' : action.type === 'submitAnswer' ? 'terminate' : 'read'
  const current = bestIdOf(state) ?? undefined
  const pointers: TraceFrame['pointers'] =
    action.type === 'comparePair'
      ? { current, compare: [action.aId, action.bId] }
      : action.type === 'selectObject'
        ? { current, read: [action.objectId] }
        : { current }
  return {
    index,
    action,
    codeLine,
    codeLineText: PSEUDOCODE[codeLine - 1] ?? '',
    variables: { ...state.variables },
    pointers,
    dsaOp,
    correct,
    note,
  }
}

function rejected(feedback: string): ActionOutcome {
  return { correct: false, feedback, dsaOp: 'read', traceStep: -1, illegal: true }
}

function hasObject(state: GameState, objectId: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.objects, objectId)
}

function mark(state: GameState, objectId: string, marker: GameObject['state']): void {
  const object = state.objects[objectId]
  if (object === undefined) return
  state.objects[objectId] = { ...object, state: marker }
}

export function bestIdOf(state: GameState): string | null {
  const value = state.internal['bestId']
  return typeof value === 'string' ? value : null
}

export function indexOfId(state: GameState, objectId: string): number {
  const slotId = state.objects[objectId]?.slotId
  if (slotId !== undefined) {
    const slot = state.slots[slotId]
    if (slot !== undefined) return slot.index
  }
  const digits = /(\d+)$/.exec(objectId)
  return digits?.[1] === undefined ? -1 : Number(digits[1])
}

export function relationBetween(state: GameState, aId: string, bId: string): Relation {
  return compareNumbers(valueOf(state, aId) ?? 0, valueOf(state, bId) ?? 0)
}

function largestIdOf(state: GameState): string {
  let largest = Number.NEGATIVE_INFINITY
  let id = 'o0'
  for (const [objectId, object] of Object.entries(state.objects)) {
    const value = object.value
    if (value === undefined || value <= largest) continue
    largest = value
    id = objectId
  }
  return id
}

function valueOf(state: GameState, objectId: string): number | undefined {
  return state.objects[objectId]?.value
}

function countOf(bag: Record<string, number | string | boolean | null>, key: string): number {
  const value = bag[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function compareNumbers(a: number, b: number): Relation {
  if (a < b) return 'lt'
  if (a > b) return 'gt'
  return 'eq'
}

function distinctValues(rng: () => number, count: number): number[] {
  const out: number[] = []
  for (let attempt = 0; out.length < count && attempt < 500; attempt++) {
    const value = randInt(rng, 1, 9)
    if (!out.includes(value)) out.push(value)
  }
  for (let value = 1; out.length < count; value++) {
    if (!out.includes(value)) out.push(value)
  }
  return out
}

/**
 * Drive a runtime to a win using only what a correct player can see: the
 * values on the board and the running best the engine reports back.
 */
export function playOptimalGame(
  runtime: GameRuntime,
  seed = 7,
  difficulty: 'easy' | 'medium' | 'hard' = 'easy',
): GameState {
  let state = runtime.init(seed, difficulty)
  const total = state.instance.values.length
  for (let i = 1; i < total; i++) {
    const best = bestIdOf(state) ?? 'o0'
    const candidate = `o${i}`
    const result = runtime.apply(state, {
      type: 'comparePair',
      aId: candidate,
      bId: best,
      relation: relationBetween(state, candidate, best),
    })
    if (!result.outcome.correct) {
      throw new Error(`playOptimalGame produced a wrong comparison: ${result.outcome.feedback}`)
    }
    state = result.state
  }
  const best = bestIdOf(state) ?? 'o0'
  const answer = runtime.apply(state, { type: 'submitAnswer', targetId: best, value: String(indexOfId(state, best)) })
  if (answer.state.phase !== 'won') {
    throw new Error(`playOptimalGame did not win: ${answer.outcome.feedback}`)
  }
  return answer.state
}
