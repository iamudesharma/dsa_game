/**
 * Guidance fixtures. `deriveTurnPrompt` / `deriveFeedback` / `deJargon` are pure
 * functions of `{state, oracle, spec}` — no DB, no clock, no RNG, no provider —
 * so Node records what it produces and Rust replays it.
 *
 * Four blocks:
 *   `cases`     — the main sweep: every registered oracle x 3 difficulties, every
 *                 canonical move, six digests per move plus the terminal prompt.
 *   `bytes`     — RAW `JSON.stringify` strings for the seven wire shapes. Digests
 *                 are blind to key order (`stable()` sorts keys on both sides) and
 *                 `TurnPrompt` / `PlayerFeedback` are on the wire, so key order
 *                 needs its own evidence.
 *   `deJargon`  — the rule corpus, hashed with and without a spec.
 *   `synthetic` — doctored states, hand-authored outcomes and stub oracles for
 *                 the branches no canonical trace reaches.
 *
 * `stable()` keeps the `undefined` filter from `rust-hint-fixtures.ts:6`: a key
 * holding `undefined` and an absent key must hash identically.
 */
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { createGameRuntime } from '../packages/game-engine/src/index.js'
import { deJargon, deriveFeedback, deriveTurnPrompt } from '../packages/game-engine/src/guidance.js'
import { GameSpecSchema } from '../packages/game-schema/src/index.js'
import type { GameSpec, GameState } from '../packages/game-schema/src/index.js'

function stable(v: any): any {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    )
  return v
}
function hash(v: any) {
  return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')
}
/** The raw serialized string. Never a re-derived object: key order is on the wire. */
const raw = (v: unknown) => JSON.stringify(v)

/**
 * Copied verbatim from `packages/game-engine/src/guidance.test.ts:28-82`. It is
 * hand-authored rather than generated so guidance parity never becomes silently
 * conditional on `template::build` parity. Parsed once so a drifted copy fails
 * loudly here instead of feeding guidance a shape the schema rejects.
 */
function makeSpec(): GameSpec {
  return {
    specVersion: 1,
    problemId: 'binary-search',
    seed: 31337,
    language: 'en',
    objective: 'Find the wanted beacon by throwing away half of the row each time.',
    theme: {
      title: 'The Beacon Row',
      story: 'A row of beacons, sorted by strength. One is wanted.',
      genre: 'sci-fi',
      tone: 'calm',
    },
    visual: {
      palette: {
        background: '#0b1020',
        primary: '#7dd3fc',
        accent: '#c084fc',
        success: '#86efac',
        danger: '#fca5a5',
      },
      objectGlyphs: [],
    },
    vocabulary: {
      object: 'beacon',
      objectPlural: 'beacons',
      place: 'beacon row',
      actionVerb: 'check',
      target: 'wanted beacon',
      lowerWord: 'weaker',
      equalWord: 'matching',
      higherWord: 'stronger',
    },
    mechanics: [
      { id: 'selectObject', boundDsaOp: 'read', label: 'Check the middle beacon.' },
      { id: 'comparePair', boundDsaOp: 'compare', label: 'Check it against the wanted beacon.' },
      { id: 'choosePath', boundDsaOp: 'choose-path', label: 'Keep the side worth keeping.' },
      { id: 'submitAnswer', boundDsaOp: 'terminate', label: 'Commit the answer.' },
    ],
    narration: {
      intro: 'Find the wanted beacon.',
      hintPool: ['Look at the middle.', 'Compare it.', 'Throw away the other half.'],
      win: 'Found it.',
      lose: 'The row is empty.',
      correctFlavour: [],
    },
    debrief: {
      summary: 'You halved the row each time.',
      actionMeaning: {},
      mapping: [],
      codeLanguages: ['javascript'],
    },
    generatedBy: 'test',
  }
}
const SPEC = GameSpecSchema.parse(makeSpec())

/** Rejected by every oracle: an assignment to a target that does not exist. */
const INVALID = { type: 'assignValue', targetId: 'missing', value: 'wrong' }

const binary = ORACLES['binary-search']!
const rotated = ORACLES['rotated-search']!
const binaryRuntime = createGameRuntime(binary)
const BINARY_SEED = 31337
const binaryInitial = binaryRuntime.init(BINARY_SEED, 'easy')
const prompt = (state: GameState, spec: GameSpec = SPEC) => deriveTurnPrompt({ state, oracle: binary, spec })
const feedback = (state: GameState, outcome: any, frame: any, spec: GameSpec = SPEC) =>
  deriveFeedback({ state, oracle: binary, spec, outcome, frame })

// ------------------------------------------------------------ key-order shapes

/**
 * Byte cases taken from the real sweep, so the Rust side reproduces them with
 * the real oracle and no injection seam. Each entry is a predicate over the
 * *live* prompt object; the first swept state that matches is kept.
 */
const PROMPT_SHAPES: [string, (p: any) => boolean][] = [
  // Shape 1 with neither optional key.
  ['playing-select', (p) => p.mechanic === 'selectObject' && p.targets.length === 1 && !('assignmentTargetIds' in p) && !('answerTargetId' in p)],
  // Rule 1 leg: mechanic and dsaOp agree, so `reason` is the compare text.
  ['playing-compare', (p) => p.mechanic === 'comparePair' && p.dsaOp === 'compare'],
  // Optional key 1 present and non-empty.
  ['playing-assign', (p) => Array.isArray(p.assignmentTargetIds) && p.assignmentTargetIds.length > 0],
  // Optional key 2 present and non-empty.
  ['playing-submit', (p) => typeof p.answerTargetId === 'string' && p.answerTargetId !== '' && p.answerTargetId !== 'answer'],
  // Optional key 2 hitting the `?? 'answer'` arm (the descriptor has no options).
  ['playing-submit-answer-fallback', (p) => p.answerTargetId === 'answer'],
  // The `expected.dsaOp` override: mechanic is NOT dsaOp.
  ['playing-compare-terminate', (p) => p.mechanic === 'choosePath' && p.dsaOp === 'terminate'],
  // Shape 4 with two targets, on a mechanic that is not `comparePair` so it does
  // not duplicate `playing-compare`.
  ['targets-two', (p) => p.targets.length === 2 && p.mechanic !== 'comparePair'],
]
const sweptShapes = new Map<string, { state: GameState; prompt: any; from: any }>()

// ------------------------------------------------------------------- main sweep

const cases: any[] = []
let playedStates = 0
for (const [id, oracle] of Object.entries(ORACLES)) {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const runtime = createGameRuntime(oracle)
    let state = runtime.init(7, difficulty)
    const moves: any[] = []
    for (const action of oracle.canonicalTrace(state).map((f) => f.action)) {
      // The rejected turn runs against the same board and the engine drops its
      // trace frame, so `frame: null` is genuinely reachable (the first move).
      const rejected = runtime.apply(state, INVALID as any)
      const staleFrame = state.trace.at(-1) ?? null
      const step = runtime.apply(state, action)
      const next = step.state
      const frame = next.trace.at(-1) ?? null
      const current = deriveTurnPrompt({ state, oracle, spec: SPEC })
      for (const [name, matches] of PROMPT_SHAPES) {
        if (!sweptShapes.has(name) && matches(current)) {
          sweptShapes.set(name, {
            state: structuredClone(state),
            prompt: current,
            from: { oracle: id, difficulty, move: moves.length },
          })
        }
      }
      moves.push({
        action,
        prompt: hash(current),
        feedback: hash(deriveFeedback({ state: next, oracle, spec: SPEC, outcome: step.outcome, frame })),
        feedbackNoFrame: hash(deriveFeedback({ state: next, oracle, spec: SPEC, outcome: step.outcome })),
        illegal: hash(deriveFeedback({ state: rejected.state, oracle, spec: SPEC, outcome: rejected.outcome, frame: null })),
        illegalStale: hash(deriveFeedback({ state: rejected.state, oracle, spec: SPEC, outcome: rejected.outcome, frame: staleFrame })),
      })
      state = next
      playedStates += 1
    }
    cases.push({ id, difficulty, moves, terminal: hash(deriveTurnPrompt({ state, oracle, spec: SPEC })), spec: SPEC })
  }
}
const missingShapes = PROMPT_SHAPES.filter(([name]) => !sweptShapes.has(name)).map(([name]) => name)

// --------------------------------------------------------------- byte fixtures

const bytes: any[] = []

// The swept prompt shapes. The state is embedded so the test need not re-walk
// the journey; `stateDigest` is what proves it fed guidance the board Node fed it.
for (const [name] of PROMPT_SHAPES) {
  const found = sweptShapes.get(name)
  if (!found) continue
  bytes.push({
    name,
    origin: 'swept',
    from: found.from,
    state: found.state,
    stateDigest: hash(found.state),
    spec: SPEC,
    prompt: raw(found.prompt),
  })
}

// `objects: {}` reaches `buildIndicator`'s `all.length === 0` branch (shape 3),
// which no canonical trace produces.
{
  const state = { ...structuredClone(binaryInitial), objects: {} }
  bytes.push({ name: 'indicator-empty', origin: 'doctored', state, stateDigest: hash(state), spec: SPEC, prompt: raw(prompt(state)) })
}
// Shape 2: the terminal prompt has neither optional key and a real null nudge.
for (const phase of ['won', 'lost']) {
  const state = { ...structuredClone(binaryInitial), phase }
  bytes.push({ name: `terminal-${phase}`, origin: 'doctored', state, stateDigest: hash(state), spec: SPEC, prompt: raw(prompt(state)) })
}

const midOf = (s: GameState) => Number(s.variables['mid'])
const selectMid = binaryRuntime.apply(binaryInitial, { type: 'selectObject', objectId: `v${midOf(binaryInitial)}` })

// Shape 5: illegal feedback has no `encourage`, and `frame` is genuinely absent.
{
  const rejected = binaryRuntime.apply(binaryInitial, INVALID as any)
  bytes.push({
    name: 'feedback-illegal',
    origin: 'runtime',
    state: rejected.state,
    stateDigest: hash(rejected.state),
    spec: SPEC,
    outcome: rejected.outcome,
    frame: null,
    feedback: raw(feedback(rejected.state, rejected.outcome, null)),
  })
}
// Shape 6: wrong feedback with a populated `nextStep` and a present `encourage`.
const wrongRelation = selectMid.state.instance.values[midOf(binaryInitial)]! < selectMid.state.instance.target! ? 'lt' : 'gt'
const wrong = binaryRuntime.apply(selectMid.state, {
  type: 'comparePair',
  aId: `v${midOf(binaryInitial)}`,
  bId: 'target',
  relation: wrongRelation,
})
bytes.push({
  name: 'feedback-wrong',
  origin: 'runtime',
  state: wrong.state,
  stateDigest: hash(wrong.state),
  spec: SPEC,
  outcome: wrong.outcome,
  frame: wrong.state.trace.at(-1),
  feedback: raw(feedback(wrong.state, wrong.outcome, wrong.state.trace.at(-1))),
})
// Same board with `outcome.expected` dropped: `nextStep: undefined` is an ABSENT
// key, which is the whole observable difference from `feedback-wrong`.
{
  const outcome = { ...wrong.outcome }
  delete outcome.expected
  bytes.push({
    name: 'feedback-wrong-no-next',
    origin: 'doctored-outcome',
    state: wrong.state,
    stateDigest: hash(wrong.state),
    spec: SPEC,
    outcome,
    frame: wrong.state.trace.at(-1),
    feedback: raw(feedback(wrong.state, outcome, wrong.state.trace.at(-1))),
  })
}
// Shape 7: correct feedback has no `nextStep` at all. `encourageFor` needs
// `steps > 2`, so the FIRST correct move is the absent-key case. The late case
// must itself be a CORRECT move, otherwise the shape under test is the wrong one.
{
  const trace = binary.canonicalTrace(binaryInitial).map((f) => f.action)
  const first = binaryRuntime.apply(binaryInitial, trace[0])
  bytes.push({
    name: 'feedback-correct-early',
    origin: 'runtime',
    state: first.state,
    stateDigest: hash(first.state),
    spec: SPEC,
    outcome: first.outcome,
    frame: first.state.trace.at(-1),
    feedback: raw(feedback(first.state, first.outcome, first.state.trace.at(-1))),
  })
  let walked = binaryInitial
  let late: ReturnType<typeof binaryRuntime.apply> | null = null
  for (const [index, action] of trace.entries()) {
    const applied = binaryRuntime.apply(walked, action)
    walked = applied.state
    if (index >= 3 && applied.outcome.correct === true && applied.outcome.illegal !== true) {
      late = applied
      break
    }
  }
  if (late === null) {
    throw new Error('no correct canonical move after the third step on the binary-search easy line')
  }
  if (late.state.progress.mistakes !== 0 || late.state.progress.steps <= 2) {
    throw new Error(`late correct state is not clean: steps=${late.state.progress.steps} mistakes=${late.state.progress.mistakes}`)
  }
  bytes.push({
    name: 'feedback-correct',
    origin: 'runtime',
    state: late.state,
    stateDigest: hash(late.state),
    spec: SPEC,
    outcome: late.outcome,
    frame: late.state.trace.at(-1),
    feedback: raw(feedback(late.state, late.outcome, late.state.trace.at(-1))),
  })
}
// The six rule-specific `deJargon` texts, byte-for-byte with and without a spec.
bytes.push({
  name: 'deJargon-bytes',
  origin: 'static',
  spec: SPEC,
  texts: ['mid=3', 'Choose index 2', 'keeping window [4, 7]', 'Index 3 is the midpoint of [0, 7].', 'gt declared, lt is the truth', 'the relation is "gt"'].map((text) => ({
    text,
    spec: raw(deJargon(text, SPEC)),
    bare: raw(deJargon(text)),
  })),
})

// ------------------------------------------------------------- deJargon corpus

const TEXT_CORPUS = [
  'That half is ruled out.',
  'mid=3',
  'mid\u00a0=3',
  'mid\u0085=3',
  'answer\ufeffis 5',
  '\ufeffInspect the remaining values.\ufeff',
  'Choose index 2',
  'Index 3 is the midpoint of [0, 7].',
  '[0, 7]',
  'keeping window [4, 7]',
  ' , hi=3',
  'i = 3',
  'lo>hi',
  // Rule 8 removes `mid=3`, leaving U+0085 alone, and the final `.trim()` must
  // KEEP it: Rust's `str::trim` strips it, `compat::trim` does not. This is the
  // only corpus entry that pins the final trim to the ECMAScript set.
  '\u0085mid=3',
  'the relation is "gt"',
  '"gt"',
  '"GT"',
  'gt declared, lt is the truth',
  '\u00fcber all',
  '\u00dfeta',
  '\u{1d518}nicode beacon',
  '',
]
const deJargonCases = TEXT_CORPUS.map((text) => ({
  text,
  spec: hash(deJargon(text, SPEC)),
  bare: hash(deJargon(text)),
  rawSpec: raw(deJargon(text, SPEC)),
  rawBare: raw(deJargon(text)),
}))

// ------------------------------------------------------------------ synthetic

const synthetic: any[] = []
const SYNTHETIC_INITIAL = binaryRuntime.init(31337, 'easy')

/**
 * Stub-oracle cases: the only Node evidence for the `??`/truthiness arms no
 * registered oracle reaches. Rust has no oracle-injection seam
 * (`derive_turn_prompt` calls `crate::oracle_plan::legal` directly, by design —
 * see guidance-plan §1.1), so these carry `rustEquivalent: null` and are the
 * Node-only half of the evidence.
 */
function stubLegalCase(name: string, legalActions: any, extra: Record<string, unknown> = {}) {
  const oracle = { ...binary, legalActions }
  let entry: any
  try {
    const built = deriveTurnPrompt({ state: SYNTHETIC_INITIAL, oracle: oracle as any, spec: SPEC })
    entry = { prompt: raw(built), promptDigest: hash(built) }
  } catch (error) {
    entry = { threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
  synthetic.push({ name, state: SYNTHETIC_INITIAL, spec: SPEC, oracleStub: true, rustEquivalent: null, ...extra, ...entry })
}

stubLegalCase('stub-legal-undefined', undefined)
stubLegalCase('stub-legal-empty', () => [])
stubLegalCase('stub-legal-not-an-array', () => 'not-an-array')
stubLegalCase('stub-legal-throws', () => {
  throw new Error('guidance probe')
})
stubLegalCase('stub-answer-target-null', () => [{ type: 'submitAnswer', label: 'x', options: { objectIds: ['null'] } }], {
  keys: ['answerTargetId', 'targets'],
})
stubLegalCase('stub-assignment-targets-empty', () => [{ type: 'assignValue', label: 'x', options: { objectIds: ['v0'], targetIds: [] } }], {
  keys: ['assignmentTargetIds'],
})
stubLegalCase('stub-answer-target-empty-string', () => [{ type: 'submitAnswer', label: 'x', options: { objectIds: [''] } }], {
  keys: ['answerTargetId'],
})
// A throwing `oracle.code('javascript')` degrades `codeLineText` to '' — the same
// observable the Rust port reaches with an unregistered `problemId`.
{
  const outcome = { correct: true, feedback: 'ok', dsaOp: 'read', traceStep: 0 }
  const frame = { dsaOp: 'read', codeLine: 1, codeLineText: '', note: '' }
  const thrown = deriveFeedback({ state: SYNTHETIC_INITIAL, oracle: { ...binary, code: () => { throw new Error('guidance probe') } } as any, spec: SPEC, outcome, frame })
  synthetic.push({
    name: 'stub-code-throws',
    state: SYNTHETIC_INITIAL,
    spec: SPEC,
    oracleStub: true,
    rustEquivalent: null,
    codeLineText: thrown.codeLineText,
    feedback: raw(thrown),
  })
}

/** A throwing `legalActions` propagates; Node does not guard it. Rust reaches
 *  the same contract with `problemId: 7`, which panics in `oracle_plan::legal`. */
synthetic.push({
  name: 'throwing-legal-actions',
  state: SYNTHETIC_INITIAL,
  spec: SPEC,
  rustEquivalent: 'panic',
  problemId: 7,
  note: 'Rust reaches the Node "throws" contract with a numeric problemId; oracle_plan::legal unwraps as_str().',
})
/** A throwing `oracle.code('javascript')` degrades to ''. Rust reaches it with
 *  an unregistered problemId, which panics inside `oracle_plan::code`. */
synthetic.push({
  name: 'code-lookup-panics',
  state: { ...SYNTHETIC_INITIAL, problemId: 'guidance-probe' },
  spec: SPEC,
  rustEquivalent: 'code-line',
  frame: { dsaOp: 'read', codeLine: 1, codeLineText: '', note: '' },
  outcome: { correct: true, feedback: 'ok', dsaOp: 'read', traceStep: 0 },
})
/**
 * A board whose legal-action list is empty. Node gets that from a stub oracle;
 * Rust reaches it with an unregistered `problemId` AND an `internal.planIndex`
 * past the end of the plan — `oracle_plan::legal` falls through to its planned
 * branch, `plan_index` defaults to 0 and `plan.get(0)` succeeds, so a renamed
 * `problemId` alone still yields a `selectObject` descriptor. guidance-plan §1.1
 * assumed otherwise; `tests/guidance.rs` guards the correction.
 */
const NO_LEGAL = {
  ...SYNTHETIC_INITIAL,
  problemId: 'guidance-probe',
  internal: { ...SYNTHETIC_INITIAL.internal, planIndex: 1000000 },
}
synthetic.push({
  name: 'no-legal-actions',
  state: NO_LEGAL,
  spec: SPEC,
  rustEquivalent: 'digest',
  prompt: raw(deriveTurnPrompt({ state: NO_LEGAL as GameState, oracle: { ...binary, legalActions: () => [] } as any, spec: SPEC })),
})
/** Rotated search with a stale `cursor.iSlotId`: the only coverage of the
 *  `legal.includes(pointed)` miss in `buildTargets`. */
{
  const rotatedSpec = { ...SPEC, problemId: 'rotated-search' }
  const state = createGameRuntime(rotated).init(31337, 'hard') as GameState
  state.cursor.iSlotId = Object.values(state.slots).find((s: any) => s.index === 0)!.id
  synthetic.push({
    name: 'rotated-search-stale-cursor',
    state,
    spec: rotatedSpec,
    rustEquivalent: 'digest',
    prompt: raw(deriveTurnPrompt({ state, oracle: rotated, spec: rotatedSpec })),
  })
}
/** `state.objects['constructor']` resolves to `Object.prototype.constructor`:
 *  truthy, with every field `undefined`, which `nextStepForExpected` turns into
 *  client-visible prose. */
synthetic.push({
  name: 'prototype-member-next-step',
  state: SYNTHETIC_INITIAL,
  spec: SPEC,
  rustEquivalent: 'feedback',
  outcome: { correct: false, feedback: 'nope', dsaOp: 'read', expected: { type: 'selectObject', objectId: 'constructor' }, traceStep: 0, illegal: false },
  frame: null,
  feedback: raw(
    feedback(SYNTHETIC_INITIAL, { correct: false, feedback: 'nope', dsaOp: 'read', expected: { type: 'selectObject', objectId: 'constructor' }, traceStep: 0, illegal: false }, null),
  ),
})
/** `objects: {}` reaches `buildIndicator`'s `all.length === 0` branch. */
synthetic.push({
  name: 'objects-empty-indicator',
  state: { ...SYNTHETIC_INITIAL, objects: {} },
  spec: SPEC,
  rustEquivalent: 'digest',
  prompt: raw(prompt({ ...SYNTHETIC_INITIAL, objects: {} })),
})
/** A non-`MechanicId` `mechanics[].id` with an empty label makes Node's
 *  `MECHANIC_INSTRUCTION[mechanic]` undefined, so it throws a TypeError. Rust
 *  must not panic; it substitutes `selectObject`'s instruction. The mechanic id
 *  only flows through `fallbackMechanic` when `expected` is `undefined`, so this
 *  needs an empty legal set — Node gets one from the stub, Rust from the
 *  `no-legal-actions` state above. */
{
  const spec = { ...SPEC, mechanics: [{ id: 'banana', boundDsaOp: 'read', label: '' }] }
  const oracle = { ...binary, legalActions: () => [] }
  let entry: any
  try {
    entry = { prompt: raw(deriveTurnPrompt({ state: NO_LEGAL as GameState, oracle: oracle as any, spec: spec as any })) }
  } catch (error) {
    entry = { threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
  synthetic.push({ name: 'unknown-mechanic-id', state: NO_LEGAL, spec, oracleStub: true, rustEquivalent: 'substitute', ...entry })
}
/** `codeLine` outside the array: 0, -1 and 1.5 all index to `undefined`. */
for (const codeLine of [0, -1, 1.5]) {
  const outcome = { correct: true, feedback: 'ok', dsaOp: 'read', traceStep: 0 }
  const frame = { dsaOp: 'read', codeLine, codeLineText: '', note: '' }
  synthetic.push({
    name: `code-line-${codeLine}`,
    state: SYNTHETIC_INITIAL,
    spec: SPEC,
    rustEquivalent: 'feedback',
    codeLine,
    frame,
    outcome,
    feedback: raw(feedback(SYNTHETIC_INITIAL, outcome, frame)),
  })
}
/** `capitalise` on a non-ASCII `actionVerb`, reachable because the empty
 *  authored label forces the generated instruction. Raw only (D1). */
for (const [name, verb] of [
  ['sharp-s-action-verb', '\u00df\u00e4h'],
  ['astral-action-verb', '\u{1d518}\u00efcode'],
] as [string, string][]) {
  const spec = { ...SPEC, mechanics: [{ id: 'selectObject', boundDsaOp: 'read', label: '' }], vocabulary: { ...SPEC.vocabulary, actionVerb: verb } }
  synthetic.push({
    name,
    state: SYNTHETIC_INITIAL,
    spec,
    rustEquivalent: 'digest',
    prompt: raw(prompt(SYNTHETIC_INITIAL, spec as any)),
    instruction: raw(prompt(SYNTHETIC_INITIAL, spec as any).instruction),
  })
}

// ---------------------------------------------------------------- gap branches

/**
 * The committed sweep never reaches twelve branches of `guidance.ts`, because the
 * canonical traces produce no `wrong` verdict at all and no nudge ever fires:
 * across all 3,247 played states the verdicts are `{correct: 6494, illegal: 6494}`
 * and `nudge` is always `null`. A mutation run confirmed the consequence — twelve
 * injected defects survived, each a player-visible string or a guard-order change
 * in one of these branches.
 *
 * Every case below is constructed so BOTH runtimes can compute it WITHOUT an
 * oracle-injection seam: only `progress.mistakes`, `trace`, `outcome` and `frame`
 * are doctored, never the board and never the oracle. `rustEquivalent` says
 * whether Rust replays the recorded string or only records it.
 */
const gaps: any[] = []
function gap(name: string, kind: 'prompt' | 'feedback', input: any) {
  const out =
    kind === 'prompt'
      ? deriveTurnPrompt({ state: input.state, oracle: input.oracle ?? binary, spec: input.spec })
      : deriveFeedback({
          state: input.state,
          oracle: input.oracle ?? binary,
          spec: input.spec,
          outcome: input.outcome,
          frame: input.frame,
        })
  gaps.push({ name, kind, rustEquivalent: 'digest', ...input, output: raw(out) })
}

/** The board Node really produced, with only the two nudge inputs doctored. */
function nudgeState(mistakes: number, recent: any[]) {
  const state = structuredClone(binaryInitial)
  state.trace = recent
  state.progress.mistakes = mistakes
  return state
}
const WRONG = [{ correct: false }, { correct: false }]
const RIGHT = [{ correct: true }, { correct: true }]
// Authored labels cleared, so `buildInstruction` must use the generated imperative.
const NO_LABELS = { ...SPEC, mechanics: SPEC.mechanics.map((m: any) => ({ ...m, label: '' })) }

// A state with NO legal actions, reached without an injection seam: an
// unregistered `problemId` plus an `internal.planIndex` past the end of the plan,
// which makes `oracle_plan::legal` return `[]`. Node needs a stub for this; see
// `no-legal-actions` in the `synthetic` block.
const NO_LEGAL_STATE = (() => {
  const state = structuredClone(binaryInitial) as any
  state.problemId = 'guidance-probe'
  state.internal.planIndex = 1000000
  return state
})()
/**
 * `fallbackMechanic` walks `spec.mechanics` looking for `boundDsaOp === dsaOp`,
 * and `fallbackOp` looks for the first mechanic whose `boundDsaOp` is not already
 * in the trace. With a one-mechanic spec both resolve to that mechanic only when
 * its `boundDsaOp` matches what `fallbackOp` produced — so the state must ALSO have
 * the mechanic's op in its trace, otherwise `fallbackOp` picks the same mechanic
 * but `fallbackMechanic` then has to find it by op and would fall to
 * `mechanics[0].id` instead. Seeding the trace with the single mechanic's op makes
 * the two agree and the recorded `mechanic` unambiguous.
 */
function noLegalStateFor(boundDsaOp: string) {
  const state = structuredClone(NO_LEGAL_STATE) as any
  state.trace = [{ correct: true, dsaOp: boundDsaOp }]
  return state
}
// A state whose real descriptor is a `comparePair`, so `mechanicForType` resolves.
const SELECTED_COMPARE = binaryRuntime.apply(binaryInitial, {
  type: 'selectObject',
  objectId: `v${Number(binaryInitial.variables['mid'])}`,
}).state

// ---- deriveNudge: all three arms plus the two clearing conditions ---------
gap('nudge-urgent', 'prompt', { state: nudgeState(4, WRONG), spec: SPEC })
gap('nudge-gentle-two', 'prompt', { state: nudgeState(2, WRONG), spec: SPEC })
gap('nudge-gentle-plain', 'prompt', { state: nudgeState(1, WRONG), spec: SPEC })
gap('nudge-cleared-by-one-correct', 'prompt', { state: nudgeState(4, [WRONG[0], RIGHT[0]]), spec: SPEC })
gap('nudge-single-wrong-frame', 'prompt', { state: nudgeState(4, [WRONG[0]]), spec: SPEC })
// Truthiness, not `!== true`: a truthy non-boolean `correct` clears the streak.
gap('nudge-truthy-correct', 'prompt', { state: nudgeState(9, [{ correct: 1 }, { correct: 'x' }]), spec: SPEC })
gap('nudge-falsy-correct', 'prompt', { state: nudgeState(9, [{ correct: 0 }, { correct: '' }]), spec: SPEC })

// ---- headlineForWrong's choose-path arm, and three operationName arms ------
for (const [name, dsaOp] of [
  ['feedback-wrong-choose-path', 'choose-path'],
  ['feedback-didwhat-move', 'move'],
  ['feedback-didwhat-insert', 'insert'],
  ['feedback-didwhat-unlink', 'unlink'],
] as [string, string][]) {
  gap(name, 'feedback', {
    state: binaryInitial,
    spec: SPEC,
    outcome: { correct: false, feedback: 'wrong side', dsaOp, traceStep: 1, illegal: false },
    frame: { dsaOp, codeLine: 1, codeLineText: 'let lo = 0', note: '' },
  })
}

// ---- nextStepForExpected: the relation arm, the fallback, and the empty id -
for (const [name, relation] of [
  ['feedback-nextstep-relation', 'gt'],
  ['feedback-nextstep-relation-lt', 'lt'],
  ['feedback-nextstep-relation-eq', 'eq'],
] as [string, string][]) {
  gap(name, 'feedback', {
    state: binaryInitial,
    spec: SPEC,
    outcome: {
      correct: false,
      feedback: 'wrong side',
      dsaOp: 'compare',
      traceStep: 1,
      illegal: false,
      expected: { type: 'comparePair', bId: 'target', relation },
    },
    frame: { dsaOp: 'compare', codeLine: 1, codeLineText: 'let lo = 0', note: '' },
  })
}
gap('feedback-nextstep-fallback', 'feedback', {
  state: binaryInitial,
  spec: SPEC,
  outcome: { correct: false, feedback: 'wrong side', dsaOp: 'compare', traceStep: 1, illegal: false, expected: { type: 'comparePair', bId: 'target' } },
  frame: { dsaOp: 'compare', codeLine: 1, codeLineText: 'let lo = 0', note: '' },
})
// `if (objectId)` is truthiness, so `''` falls through to the relation arm.
gap('feedback-nextstep-empty-objectid', 'feedback', {
  state: binaryInitial,
  spec: SPEC,
  outcome: {
    correct: false,
    feedback: 'wrong side',
    dsaOp: 'compare',
    traceStep: 1,
    illegal: false,
    expected: { type: 'comparePair', objectId: '', relation: 'eq' },
  },
  frame: { dsaOp: 'compare', codeLine: 1, codeLineText: 'let lo = 0', note: '' },
})

// ---- teach: the OPERATION_REASON arm, the frame.note arm, both finals -----
// An op that is not in OPERATION_REASON forces the chain to its end.
gap('feedback-teach-fallback-correct', 'feedback', {
  state: binaryInitial,
  spec: SPEC,
  outcome: { correct: true, feedback: '', dsaOp: 'compare', traceStep: 1 },
  frame: { dsaOp: 'not-an-op', codeLine: 1, codeLineText: 'let lo = 0', note: '' },
})
gap('feedback-teach-fallback-wrong', 'feedback', {
  state: binaryInitial,
  spec: SPEC,
  outcome: { correct: false, feedback: '', dsaOp: 'compare', traceStep: 1, illegal: false },
  frame: { dsaOp: 'not-an-op', codeLine: 1, codeLineText: 'let lo = 0', note: '' },
})
// `frame.note` as the LAST resort: empty player text AND an unknown op.
gap('feedback-teach-from-note', 'feedback', {
  state: binaryInitial,
  spec: SPEC,
  outcome: { correct: true, feedback: '', dsaOp: 'compare', traceStep: 1 },
  frame: { dsaOp: 'not-an-op', codeLine: 1, codeLineText: 'let lo = 0', note: 'mid = 3, keep right, window [4, 7]' },
})
// The OPERATION_REASON middle arm: a real op with no player text.
gap('feedback-teach-operation-reason', 'feedback', {
  state: binaryInitial,
  spec: SPEC,
  outcome: { correct: true, feedback: '', dsaOp: 'compare', traceStep: 1 },
  frame: { dsaOp: 'compare', codeLine: 1, codeLineText: 'let lo = 0', note: '' },
})

// ---- MECHANIC_INSTRUCTION.moveObject and friends -------------------------
// `buildInstruction` only reaches the generated imperative when the spec has a
// matching mechanic with an EMPTY label, and only when `mechanic` is the one
// under test. `selectObject`/`comparePair` come from a real `selectObject` legal
// descriptor; the other four are driven through `NO_LEGAL`, which leaves
// `mechanic` to `fallbackMechanic` — i.e. the spec's own binding order.
const NO_LEGAL_ORACLE = { ...binary, legalActions: () => [] }
for (const [name, id, boundDsaOp] of [
  ['move-object', 'moveObject', 'move'],
  ['swap-pair', 'swapPair', 'swap'],
  ['push-pop', 'pushPop', 'push'],
  ['traverse-node', 'traverseNode', 'traverse'],
  ['connect-nodes', 'connectNodes', 'link'],
  ['assign-value', 'assignValue', 'assign'],
  ['submit-answer', 'submitAnswer', 'terminate'],
] as [string, string, string][]) {
  // Node needs the stub `oracle` so its `expected` is undefined too; Rust gets the
  // same `undefined` from `NO_LEGAL_STATE`'s unregistered `problemId`. Both sides
  // therefore reach `fallbackOp` and `fallbackMechanic`, which is what makes this
  // pair comparable — the caller invariant in `guidance.rs` applies: these states
  // and specs belong to the oracle that produced them.
  gap(`instruction-${name}`, 'prompt', {
    state: noLegalStateFor(boundDsaOp),
    oracle: NO_LEGAL_ORACLE,
    spec: { ...SPEC, objective: 'Find it.', mechanics: [{ id, boundDsaOp, label: '' }] },
  })
}
// The remaining two arms, through a real descriptor and a real spec binding.
gap('instruction-select-object', 'prompt', { state: binaryInitial, spec: NO_LABELS })
gap('instruction-compare-pair', 'prompt', {
  state: SELECTED_COMPARE,
  spec: NO_LABELS,
})

// ---- fallbackOp's LAST-mechanic arm --------------------------------------
// `expected` must be undefined AND every mechanic's `boundDsaOp` must already be
// in the trace, so `find` fails and the last mechanic wins. Rust reaches the
// undefined `expected` from `NO_LEGAL`'s out-of-range `planIndex` — no seam.
{
  const state = structuredClone(NO_LEGAL_STATE)
  state.trace = SPEC.mechanics.map((m: any) => ({ correct: true, dsaOp: m.boundDsaOp }))
  const built = deriveTurnPrompt({ state: state as GameState, oracle: { ...binary, legalActions: () => [] } as any, spec: SPEC })
  gaps.push({
    name: 'fallback-op-last-mechanic',
    kind: 'prompt',
    rustEquivalent: 'digest',
    state,
    spec: SPEC,
    problemId: 'guidance-probe',
    output: raw(built),
    dsaOp: built.dsaOp,
    mechanic: built.mechanic,
  })
}

// ---- describeTargets with three or more targets: NODE-ONLY --------------
// Three or more targets need a legal descriptor with four `objectIds` on a
// non-`selectObject`, non-`choosePath` mechanic. No registered oracle emits that,
// and Rust has no oracle-injection seam, so this is RECORDED, NOT REPLAYED. The
// arm's string is pinned in Rust by
// `describe_targets_renders_an_absent_label_as_undefined`.
{
  const state = structuredClone(binaryInitial) as any
  state.objects.v0.state = 'live'
  state.objects.v1.state = 'live'
  state.objects.v2.state = 'live'
  state.cursor.midSlotId = ''
  state.cursor.iSlotId = ''
  state.cursor.jSlotId = ''
  const stub = {
    ...binary,
    legalActions: () => [{ type: 'comparePair', label: 'x', options: { objectIds: ['v0', 'v1', 'v2', 'v3'] } }],
  }
  let entry: any
  try {
    entry = { output: raw(deriveTurnPrompt({ state, oracle: stub as any, spec: NO_LABELS })) }
  } catch (error) {
    entry = { threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
  gaps.push({ name: 'describe-three-targets-node-only', kind: 'prompt', rustEquivalent: null, state, spec: NO_LABELS, oracleStub: true, ...entry })
}

// ---------------------------------------------------------------------- write

/**
 * Committed expected counts, with the drift from `guidance-plan.md` §5.1 and its
 * reason. The plan required the migrator to state any drift rather than absorb
 * it silently.
 */
const counts = {
  cases: { expected: 135, note: '45 oracles x 3 difficulties. Plan §5.1 value.' },
  playedStates: { expected: 3247, note: 'One canonical-trace move per played state, seed 7. Plan §5.1 value; a shrink would be a failure to investigate.' },
  deJargon: {
    expected: 22,
    planned: 21,
    drift: 'COVERAGE WIN: added "\\u0085mid=3". Rule 8 strips `mid=3`, leaving U+0085, and the final ECMAScript `.trim()` must KEEP it. Rust `str::trim` strips it, `compat::trim` does not, so this is the only corpus entry that pins the final trim to the ECMAScript set — the direct justification for the `compat::trim` dependency.',
  },
  synthetic: {
    expected: 20,
    planned: 15,
    drift: 'COVERAGE WIN: five cases the plan did not enumerate. `stub-code-throws` (Node throwing `oracle.code` degrades `codeLineText`); `throwing-legal-actions` (the Rust panic contract); `code-lookup-panics` (Rust panicking `oracle_plan::code` degrades to `""`); `no-legal-actions` (the reachable Rust stand-in for the plan\'s stub cases 1-3, whose plan assumption that a renamed `problemId` alone yields `[]` is false); and `sharp-s-action-verb` + `astral-action-verb` as two cases where the plan had one.',
  },
  bytes: { expected: 16, note: 'Plan §5.1 value. Seven are sourced from the real sweep rather than stub oracles, because Rust has no oracle-injection seam: playing-select, playing-compare, playing-assign, playing-submit, playing-submit-answer-fallback, playing-compare-terminate, targets-two.' },
  gaps: {
    expected: 31,
    planned: 20,
    drift: 'NEW BLOCK, not in the plan at all. The 20 cases are the independent VALIDATE-stage re-capture (run/rust-opencode/recapture/validate-gap-cases.json) for branches the canonical sweep never reaches: no `wrong` verdict and no nudge ever occur in 3,247 played states. Eleven added here. Two are the `!f.correct` truthiness arms (nudge-truthy-correct, nudge-falsy-correct). Nine are the MECHANIC_INSTRUCTION arms: a mutation changing moveObject WEAKENED wording survived when only one case existed, because the spec it used still resolved `selectObject`, so all nine arms are now driven explicitly — two through a real legal descriptor (select-object, compare-pair) and seven through the no-legal-actions state, whose `fallbackMechanic` resolves whatever single mechanic the spec binds. 30 are replayed in Rust; ONE, describe-three-targets-node-only, is recorded rather than replayed because three or more targets need a legal descriptor no registered oracle emits.',
  },
}
/** What this run actually captured, so the table above is checked rather than decorative. */
const actual = {
  cases: cases.length,
  playedStates,
  deJargon: deJargonCases.length,
  synthetic: synthetic.length,
  bytes: bytes.length,
  gaps: gaps.length,
} as Record<string, number>

for (const [name, v] of Object.entries(counts) as [string, any][]) {
  if (v.planned === undefined) {
    if (v.expected !== actual[name]) throw new Error(`count ${name}: expected ${v.expected}, captured ${actual[name]}`)
    continue
  }
  if (v.expected !== actual[name]) {
    throw new Error(`count ${name}: committed ${v.expected}, captured ${actual[name]}`)
  }
  console.log(`COUNT DRIFT ${name}: planned ${v.planned}, committed ${v.expected} — ${v.drift}`)
}

await writeFile(
  new URL('../services/api-rust/tests/fixtures/guidance.json', import.meta.url),
  JSON.stringify({ counts, cases, deJargon: deJargonCases, synthetic, bytes, gaps }) + '\n',
)
console.log(
  `Captured ${cases.length} guidance journeys across ${playedStates} played states ` +
    `(${deJargonCases.length} deJargon texts, ${synthetic.length} synthetic, ${bytes.length} byte cases, ` +
    `${gaps.length} gap-branch cases)`,
)
if (missingShapes.length) console.log(`Swept prompt shapes not reached on the canonical traces: ${missingShapes.join(', ')}`)