/**
 * `createDecisionEngine` — the whole decision layer, Laya-first with a
 * deterministic heuristic underneath.
 *
 * Failure policy, in one sentence: **Laya is an optimisation, never a
 * dependency.** The sidecar is a ~1 GB Python process that the developer may not
 * have started, and `decide()` is on the request path of a game that must work
 * anyway, so every path out of this file ends in a valid label.
 *
 * The four ways Laya's answer is thrown away, and why:
 *
 *  1. not enabled / `offline` / sidecar unreachable  → heuristics, no network
 *  2. the answer is not a key of `req.options`         → heuristics. A label is
 *     never invented and never snapped onto a "close enough" option.
 *  3. confidence below `MIN_CONFIDENCE`              → heuristics. Laya's
 *     README states both shipped checkpoints are over-confident as-is and that
 *     `laya-multilingual`, the one we pin, has **no fitted calibration
 *     temperatures at all**; it documents Khmer scoring 0.000 accuracy at 0.952
 *     confidence. An uncalibrated confidence number cannot be trusted to tell
 *     us when to trust the model.
 *  4. any thrown error, bad status, or unparseable body → heuristics.
 *
 * `decide()` never throws.
 */

import { isDsaOp, type DsaOp, type DecideRequest, type DecisionKind } from '@dsa/game-schema'
import {
  answerChoice,
  answerConfidence,
  answerDistribution,
  readLayaEnv,
  LayaClient,
  type LayaQuestion,
  type LayaSystemOneResponse,
} from './laya-client.js'
import {
  MISCONCEPTION_LABELS,
  constrainToKeys,
  difficulty,
  pickHint,
  pickTheme,
  routeProblem,
  tagMisconception,
  type MistakeSource,
} from './heuristics.js'
import {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  HEALTH_TTL_MS,
  MIN_CONFIDENCE,
  type DecisionEngine,
  type DecisionEngineOptions,
  type DecisionOutcome,
} from './types.js'

export function createDecisionEngine(opts: DecisionEngineOptions = {}): DecisionEngine {
  const env = readLayaEnv()

  const offline = opts.offline ?? false
  // `enabled` is the operator's switch (`LAYA_ENABLED`). `offline` is a hard
  // override, so it also clears the switch: with `offline: true` the engine
  // reports itself disabled rather than "enabled but unreachable", because that
  // is what the caller means.
  const enabled = (opts.enabled ?? env.enabled) && !offline
  const model = opts.model ?? env.model ?? DEFAULT_MODEL
  const timeoutMs = opts.timeoutMs ?? env.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const minConfidence = opts.minConfidence ?? MIN_CONFIDENCE

  const client = new LayaClient({
    baseUrl: opts.baseUrl ?? env.baseUrl,
    model,
    timeoutMs,
    apiKey: env.apiKey,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  })

  // --- health cache -------------------------------------------------------
  // Probing on every decide() would turn a 1.5s timeout into a per-request
  // stall every time the sidecar is down. One probe per HEALTH_TTL_MS is
  // enough: the answer to "is it up" is stable over 15 seconds, and the cost of
  // being wrong for 15s is 15 seconds of heuristic decisions that are known to
  // be correct-but-blunt.
  let healthCheckedAt = 0
  let healthOk = false
  let healthInFlight: Promise<boolean> | null = null

  let disposed = false
  const logged = new Set<string>()

  function logOnce(key: string, message: string): void {
    if (logged.has(key)) return
    logged.add(key)
    // eslint-disable-next-line no-console -- the brief requires a one-time log;
    // the decision layer is also a library, so this stays a single line.
    console.warn(`[decision-layer] ${message}`)
  }

  async function isAvailable(): Promise<boolean> {
    if (!enabled || disposed) return false
    const now = Date.now()
    if (now - healthCheckedAt < HEALTH_TTL_MS) return healthOk
    // Collapse concurrent probes: a burst of decides() on a cold sidecar must
    // not open 20 sockets.
    if (healthInFlight) return healthInFlight
    healthInFlight = client
      .health()
      .then((ok) => {
        healthOk = ok
        healthCheckedAt = Date.now()
        if (!ok) logOnce('health', `laya sidecar not reachable at ${client.endpoint}; using heuristics.`)
        return ok
      })
      .catch(() => {
        healthOk = false
        healthCheckedAt = Date.now()
        return false
      })
      .finally(() => {
        healthInFlight = null
      })
    return healthInFlight
  }

  /**
   * One `choice` question, named after the DecisionKind.
   *
   * `choice` is the right primitive for all five kinds: each of them answers
   * "which of these fixed keys", which is exactly a `choice` question with a
   * `{ key: description }` criteria object. There is no case here for `score`
   * or `noul`; they are in the client because Laya supports them, not because
   * this contract needs them.
   */
  function buildQuestions(req: DecideRequest): Record<string, LayaQuestion> {
    const criteria: Record<string, string> = {}
    for (const [key, description] of Object.entries(req.options)) {
      criteria[key] = description
    }
    return {
      [req.kind]: {
        type: 'choice',
        instructions: req.instructions,
        criteria,
      },
    }
  }

  async function decide(req: DecideRequest): Promise<DecisionOutcome> {
    if (disposed || !(await isAvailable())) {
      return heuristicFor(req)
    }

    let res: LayaSystemOneResponse | null = null
    try {
      res = await client.systemOne({ state: req.stateText, questions: buildQuestions(req) })
    } catch (err) {
      // LayaClient is already non-throwing; this is belt-and-braces for a
      // future edit and for a fetchImpl that misbehaves.
      logOnce('decide', `laya request failed (${describeError(err)}); using heuristics.`)
      res = null
    }

    const answer = res?.answers[req.kind]
    if (!answer) {
      logOnce('decide', `laya returned no answer for '${req.kind}'; using heuristics.`)
      return heuristicFor(req)
    }

    const choice = answerChoice(answer)
    if (choice === null) {
      logOnce('decide', `laya answer for '${req.kind}' had no choice; using heuristics.`)
      return heuristicFor(req)
    }
    if (!Object.prototype.hasOwnProperty.call(req.options, choice)) {
      // (2) Never invent a label.
      logOnce('decide', `laya returned '${choice}' which is not in the option set; using heuristics.`)
      return heuristicFor(req)
    }

    const confidence = answerConfidence(answer)
    if (confidence === null || confidence < minConfidence) {
      // (3) The confidence gate. See the file header.
      logOnce(
        'decide',
        `laya confidence ${confidence ?? 'n/a'} below gate ${minConfidence} for '${req.kind}'; using heuristics.`,
      )
      return heuristicFor(req)
    }

    const distribution = answerDistribution(answer)
    return {
      choice,
      confidence,
      source: 'laya',
      ...(distribution ? { distribution } : {}),
    }
  }

  async function dispose(): Promise<void> {
    disposed = true
    healthOk = false
    healthCheckedAt = 0
    healthInFlight = null
  }

  return {
    isEnabled: () => enabled,
    isAvailable,
    decide,
    dispose,
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

// ------------------------------------------------------------- heuristics
//
// `DecideRequest` carries only `(kind, stateText, options, instructions)`, but
// the real heuristics want structured inputs (a trace, a hint pool, counters).
// The adapters below reconstruct those from `stateText` using a small, explicit,
// line/field convention, and the API agent is free to bypass them entirely by
// importing the heuristic functions directly when it holds structured data.
//
//   key=value   or   key: value      e.g. `steps=18 mistakes=3 hintsUsed=1`
//   <dsaOp> <verdict>                 for `tag-misconception`, one per line:
//       mistake / wrong / ! / x / incorrect   counts as a mistake
//       ok / correct / good / ✓              does not
//
// Anything else in `stateText` is ignored by the structural parsers and passed
// to Laya verbatim.

/** Reads `steps=18`, `steps: 18` and `steps 18` alike. */
function readCount(text: string, names: readonly string[]): number | null {
  for (const name of names) {
    const match = new RegExp(`\\b${name}\\b\\D{0,3}(\\d+)`, 'i').exec(text)
    const raw = match?.[1]
    if (raw === undefined) continue
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

const MISTAKE_MARKERS = ['mistake', 'wrong', 'incorrect', '!', 'x', 'bad', 'fail']
const OK_MARKERS = ['ok', 'correct', 'good', '✓', 'right', 'pass']

/** Extract the mistake ops from a line-oriented stateText, in order. */
export function parseTraceOps(stateText: string): DsaOp[] {
  const ops: DsaOp[] = []
  for (const line of stateText.split(/[\n;]+/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const parts = trimmed.split(/[\s,|]+/).filter((p) => p.length > 0)
    if (parts.length < 2) continue
    const head = parts[0]
    if (head === undefined) continue
    const headClean = head.replace(/[():,.-]/g, '').toLowerCase()
    if (!isDsaOp(headClean)) continue
    const verdict = parts.slice(1).join(' ').toLowerCase()
    if (MISTAKE_MARKERS.some((m) => verdict.includes(m))) {
      ops.push(headClean)
    } else if (OK_MARKERS.some((m) => verdict.includes(m))) {
      // Explicitly correct: not a mistake.
    }
  }
  return ops
}

const HINT_COUNT_NAMES = ['hintsused', 'hints_used', 'hints used', 'hints', 'hintcount']
const MISTAKE_COUNT_NAMES = ['mistakes', 'mistake', 'errors', 'error', 'wronganswers']
const STEP_COUNT_NAMES = ['steps', 'step', 'moves', 'moves taken', 'turns', 'actions']

/**
 * Bridge from `(DecideRequest)` to the right heuristic for its kind. The
 * result is always constrained to `req.options` so the api-types invariant
 * ("choice is a key of the provided options") holds on the heuristic path too.
 */
export function heuristicFor(req: DecideRequest): DecisionOutcome {
  const optionKeys = Object.keys(req.options)
  const text = req.stateText

  let outcome: DecisionOutcome
  switch (req.kind) {
    case 'route-problem': {
      outcome = routeProblem(text, optionKeys.length > 0 ? optionKeys : undefined)
      break
    }
    case 'pick-theme': {
      outcome = pickTheme(optionKeys, text)
      break
    }
    case 'pick-hint': {
      // `options` is the hint pool, keyed by ordinal (`"0"`, `"1"`, ...). The
      // keys are preserved verbatim so the caller gets a pool index back, not
      // prose. Numeric keys sort numerically; anything else sorts after, in
      // insertion order, which is stable.
      const pool = [...optionKeys].sort((a, b) => {
        const na = Number.parseInt(a, 10)
        const nb = Number.parseInt(b, 10)
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
        if (Number.isFinite(na)) return -1
        if (Number.isFinite(nb)) return 1
        return 0
      })
      const hintsUsed = readCount(text, HINT_COUNT_NAMES) ?? 0
      const lastOp = readLastMistakeOp(text)
      const picked = pickHint(pool, hintsUsed, lastOp)
      const index = pool.indexOf(picked.choice)
      const key = index >= 0 ? pool[index] : pool[0]
      outcome = { ...picked, choice: key ?? '' }
      break
    }
    case 'tag-misconception': {
      // Only the mistake ops survive the text round trip; `MistakeSource` is the
      // structural minimum `tagMisconception` needs, so no frame is fabricated.
      const frames: MistakeSource[] = parseTraceOps(text).map((op) => ({ dsaOp: op, correct: false }))
      outcome = tagMisconception(frames)
      break
    }
    case 'difficulty': {
      const steps = readCount(text, STEP_COUNT_NAMES) ?? 0
      const mistakes = readCount(text, MISTAKE_COUNT_NAMES) ?? 0
      const hintsUsed = readCount(text, HINT_COUNT_NAMES) ?? 0
      outcome = difficulty(steps, mistakes, hintsUsed)
      break
    }
    default: {
      // Unreachable for a well-typed DecideKind; a runtime `decide()` on a
      // hand-built request must still not throw.
      outcome = { choice: '', confidence: 0, source: 'heuristic' }
    }
  }

  if (optionKeys.length === 0) return outcome
  const constrained = constrainToKeys(outcome.choice, req.options, preferenceFor(req.kind))
  if (constrained === null) return { ...outcome, confidence: 0 }
  return constrained === outcome.choice ? outcome : { ...outcome, choice: constrained }
}

function preferenceFor(kind: DecisionKind): readonly string[] {
  if (kind === 'difficulty') return ['easy', 'medium', 'hard']
  if (kind === 'tag-misconception') return MISCONCEPTION_LABELS
  return []
}

/** `lastMistakeDsaOp=<op>` in the stateText, if present and valid. */
function readLastMistakeOp(text: string): string | undefined {
  const match = /\blastmistake(?:dsa)?op\b\D{0,3}([a-z-]+)/i.exec(text)
  const raw = match?.[1]?.toLowerCase()
  return raw !== undefined && isDsaOp(raw) ? raw : undefined
}
