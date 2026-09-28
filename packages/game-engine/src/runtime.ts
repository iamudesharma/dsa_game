/**
 * The deterministic game engine runtime.
 *
 * An oracle owns all the truth about a problem; the engine owns everything the
 * oracle deliberately does not do:
 *
 *   - safety rails   — a broken oracle must degrade into a clean `illegal`
 *                      outcome, never an unhandled 500,
 *   - replay integrity — exactly one trace frame per accepted action, always,
 *   - step accounting — `progress` is the engine's, not the oracle's,
 *   - isolation      — callers get their own deep copy; the engine never
 *                      hands out a reference it keeps using.
 *
 * Design rule: total by default (return a safe default rather than throw),
 * with exactly one exception — `init` fails loudly when the oracle lies about
 * its own instance contract, because a silently broken game teaches the wrong
 * lesson and that is worse than a startup error.
 */

import {
  ACTION_TO_MECHANIC,
  cloneState,
  dsaOpForAction,
  emptyProgress,
  getProblem,
  isActionType,
  isDsaOp,
} from '@dsa/game-schema'
import type {
  Action,
  ActionOutcome,
  ActionType,
  AnswerSummary,
  Complexity,
  Container,
  Cursor,
  Difficulty,
  DsaOp,
  GameObject,
  GameState,
  Link,
  MechanicId,
  Oracle,
  ProblemInstance,
  Progress,
  Slot,
  TraceFrame,
  Variables,
} from '@dsa/game-schema'

import { mapGameActionToCode, mistakeSummary, optimisationScore, traceCodeHighlights } from './telemetry.js'
import type { MistakeSummary, OptimisationScore, TermMapping } from './telemetry.js'

const ENGINE_TAG = '[game-engine]'

const FALLBACK_FEEDBACK = {
  correct: 'Good — that is exactly what the algorithm does here.',
  wrong: 'Not this time: the algorithm expects a different move here.',
  illegal: 'That move is not available right now.',
  broken: 'The game could not process that move, so nothing changed.',
} as const

const FALLBACK_ANSWER: AnswerSummary = { text: 'No answer was recorded.', value: null }
const FALLBACK_COMPLEXITY: Complexity = { time: 'unspecified', space: 'unspecified' }

export interface ApplyResult {
  state: GameState
  outcome: ActionOutcome
  /**
   * Non-fatal engine repairs applied to the oracle's return value (e.g. the
   * oracle appended three frames and we kept one). Safe to log, safe to show.
   */
  warnings: string[]
}

export interface DebriefStats {
  steps: number
  mistakes: number
  hintsUsed: number
  mistakesByMechanic: Record<string, number>
  /** Trace-derived breakdown of the same mistakes. */
  mistakeAnalysis: MistakeSummary
  /** How close the played line was to the canonical one. */
  optimisation: OptimisationScore
  /** Code lines the player actually executed, for the code view. */
  codeHighlights: number[]
  /** Heuristic game-term → algorithm-term rows for the mechanics used. */
  actionMapping: TermMapping[]
}

/**
 * The post-game payload the API returns. Deliberately "lite": the player-facing
 * prose (summary / actionMeaning / mapping) belongs to the spec, and the
 * LLM-classified misconception is attached by the service layer, so neither is
 * invented here.
 */
export interface DebriefLite {
  problemId: string
  phase: 'won' | 'lost'
  playedTrace: TraceFrame[]
  canonicalTrace: TraceFrame[]
  answer: AnswerSummary
  pseudocode: string[]
  code: { javascript: string[]; python: string[]; typescript: string[] }
  complexity: Complexity
  stats: DebriefStats
}

export interface GameRuntime {
  readonly oracle: Oracle
  init(seed: number, difficulty: Difficulty): GameState
  apply(state: GameState, action: Action): ApplyResult
  isWin(state: GameState): boolean
  debrief(state: GameState): DebriefLite
}

export function createGameRuntime(oracle: Oracle): GameRuntime {
  // Named helper rather than a method reference: the runtime must survive being
  // destructured (`const { apply } = createGameRuntime(oracle)`).
  const isWinState = (state: GameState): boolean => {
    // Trust the state first: a finished game is a finished game even if the
    // oracle's predicate is confused, and an explicit 'lost' is never a win.
    if (state?.phase === 'won') return true
    if (state?.phase === 'lost') return false
    try {
      return oracle.isWin(cloneState(state)) === true
    } catch {
      return false
    }
  }

  return {
    oracle,

    init(seed: number, difficulty: Difficulty): GameState {
      // A broken instance must not reach a player: the whole lesson of e.g.
      // binary search rests on the array actually being sorted.
      const instance = oracle.buildInstance({ seed, difficulty })
      assertInstanceUsable(instance, oracle.problemId)
      return coerceGameState(oracle.initState(instance), { instance, seed, problemId: instance.problemId })
    },

    apply(state: GameState, action: Action): ApplyResult {
      // Cloning on the way IN means even a mutating oracle cannot corrupt the
      // caller's state, and the engine owns the copy it reasons about.
      const input = coerceGameState(state, {
        instance: state?.instance,
        seed: state?.seed,
        problemId: state?.problemId,
      })
      const progressBefore = input.progress

      if (!isActionType(action?.type)) {
        return rejectedTurn(
          input,
          progressBefore,
          null,
          `${FALLBACK_FEEDBACK.broken} (unknown action type: ${describeType(action)})`,
          [
            `oracle.applyAction was not called: unknown action type ${describeType(action)} is not in the mechanic catalog`,
          ],
        )
      }
      const actionType: ActionType = action.type

      let returned: unknown
      try {
        returned = oracle.applyAction(input, action)
      } catch (error) {
        return rejectedTurn(
          input,
          progressBefore,
          mechanicOf(actionType),
          `${FALLBACK_FEEDBACK.broken} ${errorMessage(error)}`,
          [`oracle "${oracle.problemId}" threw while applying ${actionType}: ${errorMessage(error)}`],
        )
      }

      const warnings: string[] = []
      const raw = asRecord(returned)
      if (raw === null) {
        warnings.push(`oracle "${oracle.problemId}" returned a non-object result; the move was treated as rejected`)
      }

      const next = isRecordLike(raw?.['nextState'])
        ? coerceGameState(raw?.['nextState'], { instance: input.instance, seed: input.seed, problemId: input.problemId })
        : // A result with no usable state leaves the board exactly as it was,
          // which is the same guarantee the throw path gives.
          cloneState(input)

      // Replay integrity: exactly one frame per accepted action.
      const appended = next.trace.length - input.trace.length
      if (appended === 1) {
        const kept = next.trace[next.trace.length - 1]
        next.trace = [...input.trace, normaliseFrame(oracle, kept, next.trace.length - 1, action)]
      } else if (appended < 1) {
        next.trace = [...input.trace, synthesiseFrame(oracle, input.trace.length, next.variables, action, raw !== null)]
        warnings.push(
          `oracle appended ${appended} trace frames; the engine synthesised 1 so the replay stays valid`,
        )
      } else {
        const last = next.trace[next.trace.length - 1]
        next.trace = [...input.trace, normaliseFrame(oracle, last, input.trace.length, action)]
        warnings.push(`oracle appended ${appended} trace frames; the engine kept the last 1 for replay integrity`)
      }

      const hardened = hardenOutcome(raw?.['outcome'], action, next.trace.length - 1)
      warnings.push(...hardened.warnings)
      const outcome = hardened.outcome
      outcome.won = outcome.won ?? next.phase === 'won'

      if (outcome.illegal === true) {
        // A rejected move ran no algorithm step, so it must not appear in the
        // replay either — otherwise the debrief would show a "wrong step" for a
        // mis-click. Dropping the frame also keeps the invariant that
        // progress.mistakes equals the number of incorrect frames in the trace.
        next.trace = input.trace.slice()
        outcome.traceStep = input.trace.length
      }

      // Step accounting belongs to the engine, not to the oracle. Only a move
      // the game actually evaluated counts as a mistake.
      next.progress = accumulateProgress(
        progressBefore,
        !outcome.correct && outcome.illegal !== true,
        mechanicOf(actionType),
      )

      return { state: next, outcome, warnings }
    },

    isWin(state: GameState): boolean {
      return isWinState(state)
    },

    debrief(state: GameState): DebriefLite {
      const safe = coerceGameState(state, {
        instance: state?.instance,
        seed: state?.seed,
        problemId: state?.problemId,
      })
      const playedTrace = safe.trace
      const canonicalTrace = safeCall(() => cloneFrames(oracle.canonicalTrace(safe, playedTrace)), [])
      const answer = safeCall(() => normaliseAnswer(oracle.answerSummary(safe)), FALLBACK_ANSWER)
      const pseudocode = safeCall(() => stringLines(oracle.pseudocode()), [])
      const code = {
        javascript: safeCall(() => stringLines(oracle.code('javascript')), []),
        python: safeCall(() => stringLines(oracle.code('python')), []),
        typescript: safeCall(() => stringLines(oracle.code('typescript')), []),
      }
      const complexity = safeCall(() => normaliseComplexity(oracle.complexity()), FALLBACK_COMPLEXITY)

      return {
        problemId: safe.problemId,
        phase: isWinState(safe) ? 'won' : 'lost',
        playedTrace,
        canonicalTrace,
        answer,
        pseudocode,
        code,
        complexity,
        stats: {
          steps: safe.progress.steps,
          mistakes: safe.progress.mistakes,
          hintsUsed: safe.progress.hintsUsed,
          mistakesByMechanic: { ...safe.progress.mistakesByMechanic },
          mistakeAnalysis: mistakeSummary(playedTrace),
          optimisation: optimisationScore(playedTrace, canonicalTrace),
          codeHighlights: traceCodeHighlights(playedTrace),
          actionMapping: mapGameActionToCode(playedTrace),
        },
      }
    },
  }
}

// init() is the one place that refuses to paper over a broken oracle.

function assertInstanceUsable(instance: ProblemInstance, problemId: string): void {
  const rec = asRecord(instance)
  if (rec === null) {
    throw new Error(`${ENGINE_TAG} oracle "${problemId}" returned a non-object instance; expected a ProblemInstance.`)
  }
  const values = rec['values']
  if (!Array.isArray(values)) {
    throw new Error(`${ENGINE_TAG} oracle "${problemId}" returned an instance without a values[] array.`)
  }

  const id = typeof rec['problemId'] === 'string' ? rec['problemId'] : problemId
  const meta = getProblem(id)
  if (meta?.instanceHints.sorted !== true) return

  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1]
    const current = values[i]
    if (typeof previous !== 'number' || typeof current !== 'number' || previous > current) {
      throw new Error(
        `${ENGINE_TAG} oracle "${problemId}" produced values ${JSON.stringify(values)} which is not sorted, but problem "${meta.id}" declares instanceHints.sorted: true. Fix buildInstance — every algorithm for this problem assumes sorted input.`,
      )
    }
  }
}

// An outcome is what the client renders; it is never allowed to be partial.

function hardenOutcome(raw: unknown, action: Action, traceStep: number): { outcome: ActionOutcome; warnings: string[] } {
  const warnings: string[] = []
  const rec = asRecord(raw)
  // A result that is not an object at all is a rejection, not a wrong answer.
  const missing = rec === null

  const rawCorrect = rec?.['correct']
  const correct = typeof rawCorrect === 'boolean' ? rawCorrect : false
  if (rawCorrect !== undefined && typeof rawCorrect !== 'boolean') {
    warnings.push('oracle returned a non-boolean outcome.correct; treated the move as incorrect')
  }

  const illegal = missing || rec?.['illegal'] === true
  const won = typeof rec?.['won'] === 'boolean' ? rec['won'] : undefined

  const rawFeedback = rec?.['feedback']
  const feedback =
    typeof rawFeedback === 'string' && rawFeedback.trim() !== ''
      ? rawFeedback
      : missing
        ? FALLBACK_FEEDBACK.broken
        : illegal
          ? FALLBACK_FEEDBACK.illegal
          : correct
            ? FALLBACK_FEEDBACK.correct
            : FALLBACK_FEEDBACK.wrong

  const rawOp = rec?.['dsaOp']
  const dsaOp: DsaOp = isDsaOp(rawOp) ? rawOp : dsaOpForAction(action)

  const expected = normaliseExpected(rec?.['expected'])

  return {
    outcome: { correct, expected, feedback, dsaOp, traceStep: Math.max(traceStep, 0), illegal, won },
    warnings,
  }
}

function normaliseExpected(value: unknown): Partial<Action> | undefined {
  const rec = asRecord(value)
  if (rec === null) return undefined
  if (!isActionType(rec['type'])) return undefined
  return rec as Partial<Action>
}

/**
 * A turn the oracle refused to play. The board is left exactly as it was, but
 * the turn still counts: the player did take an action, and a refused one is
 * still something the debrief should be able to talk about.
 */
function rejectedTurn(
  input: GameState,
  progressBefore: Progress,
  mechanic: MechanicId | null,
  feedback: string,
  warnings: string[],
): ApplyResult {
  const state = cloneState(input)
  // A rejected move is NOT a mistake. The board did not change and no
  // algorithm step ran, so it is not evidence of a misconception — counting
  // it would let mis-clicks and stale-state taps inflate mistakesByMechanic,
  // which is what drives the Laya misconception tag and the debrief's
  // "we noticed you..." line. Telling a learner they confuse pointers because
  // they mis-clicked is worse than saying nothing. The turn still counts as a
  // step so pacing and fumble-rate stay honest.
  state.progress = accumulateProgress(progressBefore, false, mechanic)
  return {
    state,
    outcome: {
      correct: false,
      feedback,
      dsaOp: mechanic === null ? 'read' : MECHANIC_OP[mechanic],
      traceStep: input.trace.length,
      illegal: true,
    },
    warnings,
  }
}

function accumulateProgress(
  before: Progress,
  countMistake: boolean,
  mechanic: MechanicId | null,
): Progress {
  const next: Progress = {
    ...emptyProgress(),
    steps: before.steps + 1,
    mistakes: before.mistakes,
    hintsUsed: before.hintsUsed,
    mistakesByMechanic: { ...before.mistakesByMechanic },
  }
  if (!countMistake) return next
  next.mistakes += 1
  if (mechanic !== null) {
    next.mistakesByMechanic[mechanic] = (next.mistakesByMechanic[mechanic] ?? 0) + 1
  }
  return next
}

// Replay integrity: the client can only step a trace that has no holes.

function synthesiseFrame(
  oracle: Oracle,
  index: number,
  variables: Variables,
  action: Action,
  oracleAnswered: boolean,
): TraceFrame {
  return {
    index,
    action,
    codeLine: 1,
    codeLineText: firstCodeLine(oracle, action),
    variables: { ...variables },
    pointers: {},
    dsaOp: dsaOpForAction(action),
    correct: oracleAnswered,
    note: oracleAnswered
      ? 'engine-synthesised frame: the oracle did not record this move'
      : 'engine-synthesised frame: the oracle rejected this move',
  }
}

function firstCodeLine(oracle: Oracle, action: Action): string {
  // The synthesized frame still has to point at *some* real source line, or the
  // code view would render an unresolvable highlight.
  const sources = [
    safeCall<string[]>(() => stringLines(oracle.pseudocode()), []),
    safeCall<string[]>(() => stringLines(oracle.code('javascript')), []),
  ]
  for (const source of sources) {
    const line = source[0]
    if (typeof line === 'string' && line !== '') return line
  }
  return `// ${ENGINE_TAG} no source available for ${action.type}`
}

/** Fill in anything the oracle left out of a frame, without inventing facts. */
function normaliseFrame(
  oracle: Oracle,
  frame: TraceFrame | undefined,
  index: number,
  action: Action,
): TraceFrame {
  if (!isRecordLike(frame)) {
    return synthesiseFrame(oracle, index, {}, action, false)
  }
  const present = frame as TraceFrame
  const codeLine = asPositiveInt(present.codeLine) ?? 1
  const codeLineText =
    typeof present.codeLineText === 'string' && present.codeLineText.trim() !== ''
      ? present.codeLineText
      : (safeCall<string[]>(() => stringLines(oracle.pseudocode()), [])[codeLine - 1] ??
        safeCall<string[]>(() => stringLines(oracle.code('javascript')), [])[codeLine - 1] ??
        `// line ${codeLine}`)

  return {
    index,
    action: present.action ?? action,
    codeLine,
    codeLineText,
    variables: asVariables(present.variables),
    pointers: asPointers(present.pointers),
    dsaOp: isDsaOp(present.dsaOp) ? present.dsaOp : dsaOpForAction(action),
    correct: present.correct === true,
    note: typeof present.note === 'string' ? present.note : '',
  }
}

function asVariables(value: unknown): Variables {
  const out: Variables = {}
  const rec = asRecord(value)
  if (rec === null) return out
  for (const key of Object.keys(rec).sort()) {
    const entry = rec[key]
    if (entry === null) out[key] = null
    else if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') out[key] = entry
  }
  return out
}

function asPointers(value: unknown): TraceFrame['pointers'] {
  const rec = asRecord(value)
  if (rec === null) return {}
  const out: TraceFrame['pointers'] = {}
  const current = rec['current']
  if (typeof current === 'string') out.current = current
  for (const field of ['compare', 'eliminated', 'swapped', 'read'] as const) {
    const list = rec[field]
    if (!Array.isArray(list)) continue
    const ids = list.filter((id): id is string => typeof id === 'string')
    if (ids.length > 0) out[field] = ids
  }
  return out
}

// The engine's boundary clone. Deep copy and validation in one pass, because
// the engine never hands out a reference it keeps using and never trusts a
// field it has not looked at.
/**
 * The engine's boundary clone: deep-copies AND validates in one pass, so the
 * engine never hands out a reference it keeps using and never trusts a field
 * it has not looked at. Keys are emitted in sorted order so two equal states
 * always serialise identically.
 */
function coerceGameState(raw: unknown, fallback: { instance?: ProblemInstance; seed?: number; problemId?: string }): GameState {
  const rec = asRecord(raw)
  const instance = (rec?.['instance'] as ProblemInstance | undefined) ?? fallback.instance
  return {
    problemId: asString(rec?.['problemId']) ?? asString(fallback.problemId) ?? 'unknown',
    seed: asNumber(rec?.['seed']) ?? asNumber(fallback.seed) ?? 0,
    instance: instance ?? { problemId: 'unknown', seed: 0, values: [], slots: [] },
    objects: objectMap<GameObject>(rec?.['objects'], isRecordLike),
    slots: objectMap<Slot>(rec?.['slots'], isRecordLike),
    containers: objectMap<Container>(rec?.['containers'], isRecordLike),
    links: arrayOf<Link>(rec?.['links'], isRecordLike),
    selection: stringArray(rec?.['selection']),
    cursor: asCursor(rec?.['cursor']),
    variables: asVariables(rec?.['variables']),
    progress: asProgress(rec?.['progress']),
    phase: asPhase(rec?.['phase']),
    trace: arrayOf<TraceFrame>(rec?.['trace'], isRecordLike),
    internal: asInternal(rec?.['internal']),
  }
}

function asProgress(value: unknown): Progress {
  const rec = asRecord(value)
  if (rec === null) return emptyProgress()
  return {
    steps: asCount(rec['steps']),
    mistakes: asCount(rec['mistakes']),
    hintsUsed: asCount(rec['hintsUsed']),
    mistakesByMechanic: numberMap(rec['mistakesByMechanic']),
  }
}

function asCursor(value: unknown): Cursor {
  const rec = asRecord(value)
  if (rec === null) return {}
  const out: Record<string, string> = {}
  for (const key of CURSOR_KEYS) {
    const entry = rec[key]
    if (typeof entry === 'string' && entry !== '') out[key] = entry
  }
  return out as Cursor
}

const CURSOR_KEYS = [
  'nodeId',
  'prevNodeId',
  'loSlotId',
  'midSlotId',
  'hiSlotId',
  'iSlotId',
  'jSlotId',
  'bestObjectId',
] as const

function asInternal(value: unknown): GameState['internal'] {
  const rec = asRecord(value)
  const out: GameState['internal'] = {}
  if (rec === null) return out
  for (const key of Object.keys(rec).sort()) {
    const entry = rec[key]
    if (entry === null) out[key] = null
    else if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') out[key] = entry
  }
  return out
}

// Small readers that tolerate input an oracle got wrong.

function mechanicOf(actionType: ActionType): MechanicId | null {
  return ACTION_TO_MECHANIC[actionType]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecordLike(value) ? (value as Record<string, unknown>) : null
}

function isRecordLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectMap<T>(value: unknown, isValid: (entry: unknown) => boolean): Record<string, T> {
  const out: Record<string, T> = {}
  const rec = asRecord(value)
  if (rec === null) return out
  for (const key of Object.keys(rec).sort()) {
    const entry = rec[key]
    if (isValid(entry)) out[key] = entry as T
  }
  return out
}

function arrayOf<T>(value: unknown, isValid: (entry: unknown) => boolean): T[] {
  if (!Array.isArray(value)) return []
  return value.filter(isValid) as T[]
}

function stringArray(value: unknown): string[] {
  return arrayOf(value, (entry) => typeof entry === 'string')
}

function numberMap(value: unknown): Record<string, number> {
  return objectMap<number>(value, (entry) => typeof entry === 'number' && Number.isFinite(entry))
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function asPhase(value: unknown): GameState['phase'] {
  return value === 'won' || value === 'lost' || value === 'playing' ? value : 'playing'
}

function describeType(action: Action): string {
  const type = asRecord(action)?.['type']
  return typeof type === 'string' ? JSON.stringify(type) : typeof type
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return 'unknown oracle error'
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function cloneFrames(frames: TraceFrame[]): TraceFrame[] {
  if (!Array.isArray(frames)) return []
  return arrayOf<TraceFrame>(frames, isRecordLike)
    .map((frame) => safeCall<TraceFrame>(() => structuredClone(frame), frame))
}

function stringLines(lines: unknown): string[] {
  if (!Array.isArray(lines)) return []
  return lines.filter((line): line is string => typeof line === 'string')
}

function normaliseAnswer(answer: AnswerSummary): AnswerSummary {
  const rec = asRecord(answer)
  const text = rec?.['text']
  return {
    text: typeof text === 'string' && text.trim() !== '' ? text : FALLBACK_ANSWER.text,
    value: (rec?.['value'] as AnswerSummary['value']) ?? null,
    details: Array.isArray(rec?.['details'])
      ? arrayOf<{ label: string; value: string | number }>(rec?.['details'], isRecordLike).map((row) => ({
          label: asString(row.label) ?? '',
          value: typeof row.value === 'number' ? row.value : (asString(row.value) ?? ''),
        }))
      : [],
  }
}

function normaliseComplexity(complexity: Complexity): Complexity {
  const rec = asRecord(complexity)
  return {
    time: asString(rec?.['time']) ?? FALLBACK_COMPLEXITY.time,
    space: asString(rec?.['space']) ?? FALLBACK_COMPLEXITY.space,
    best: asString(rec?.['best']),
    worst: asString(rec?.['worst']),
    average: asString(rec?.['average']),
    note: asString(rec?.['note']),
  }
}

const MECHANIC_OP: Readonly<Record<MechanicId, DsaOp>> = {
  selectObject: 'read',
  moveObject: 'move',
  comparePair: 'compare',
  swapPair: 'swap',
  pushPop: 'push',
  choosePath: 'choose-path',
  traverseNode: 'traverse',
  connectNodes: 'link',
  assignValue: 'assign',
  submitAnswer: 'terminate',
}
