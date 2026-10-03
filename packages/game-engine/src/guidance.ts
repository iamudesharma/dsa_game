/**
 * Turns engine state into the two things a 12-15 year old actually needs:
 * what to do next, and what just happened.
 *
 * THE DESIGN PROBLEM. The oracle already knows both answers precisely — its
 * `legalActions` returns the exact action type and the exact object ids. But
 * those strings are written for a developer: "Choose index 3, the middle of
 * [0, 7]". Showing that to a learner spends their attention decoding notation
 * instead of learning the algorithm, which is Sweller's *extraneous* load. The
 * fix is to take the oracle's PRECISION and re-derive the WORDING from the
 * theme's own vocabulary.
 *
 * So: the oracle decides WHAT. This module decides HOW IT IS SAID, and it may
 * never contradict the oracle. Every claim about correctness still comes from
 * the engine; this file only chooses words and highlights.
 */

import { MECHANICS, isActionType, isDsaOp } from '@dsa/game-schema'
import type {
  ActionOutcome,
  DsaOp,
  GameSpec,
  GameState,
  LegalActionDescriptor,
  MechanicId,
  Oracle,
  TraceFrame,
} from '@dsa/game-schema'
import type {
  AlgorithmIndicator,
  LearnerBand,
  PlayerFeedback,
  TurnPrompt,
  TurnTarget,
} from '@dsa/game-schema'

/**
 * Why each operation matters, in plain language.
 *
 * Generic across problems on purpose: the theme's nouns come from the spec, and
 * anything problem-specific would have to be authored 11 times and would rot.
 * These are the operations, not the algorithms.
 */
const OPERATION_REASON: Readonly<Record<DsaOp, string>> = {
  read: 'Looking at one element is how the program checks a single value.',
  compare: 'A comparison tells the program which way to go next.',
  'choose-path': 'Throwing away part of the options is what makes the next step cheaper.',
  move: 'Moving an element puts it where the algorithm expects it to be.',
  insert: 'Adding a value keeps the collection usable for the next step.',
  swap: 'A swap puts two values in each other’s place.',
  push: 'Pushing adds a value on the end so it can be taken out again.',
  pop: 'Popping takes the most recent value back off.',
  traverse: 'Following a link is the only way to reach the next value.',
  link: 'Re-wiring the link changes where the traversal will go next.',
  assign: 'Saving a value means the program can use it again without recomputing.',
  terminate: 'Finishing is how the program reports its result.',
  unlink: 'Cutting a link removes that route from the structure.',
}

/** Imperative stems per mechanic, combined with the theme's action verb. */
const MECHANIC_INSTRUCTION: Readonly<Record<MechanicId, (verb: string, target: string) => string>> = {
  selectObject: (verb, target) => `${verb} ${target}.`,
  moveObject: (verb, target) => `${verb} ${target} to where it belongs.`,
  comparePair: (verb, target) => `${verb} ${target}.`,
  swapPair: (verb, target) => `${verb} ${target} and the other one.`,
  pushPop: (verb) => `${verb} the value on and off the stack.`,
  choosePath: (verb) => `${verb} the part worth keeping.`,
  traverseNode: (verb) => `${verb} the next one along.`,
  connectNodes: (verb) => `${verb} the two together.`,
  assignValue: (verb) => `${verb} the value down.`,
  submitAnswer: (verb) => `${verb} your answer.`,
}

export interface GuidanceInput {
  readonly state: GameState
  readonly oracle: Oracle
  readonly spec: GameSpec
  /** Pitch the language at this band. */
  readonly band?: LearnerBand
}

/**
 * Build the "your turn" instruction.
 *
 * Total by construction: an oracle without `legalActions`, a spec without a
 * matching mechanic binding, or an unrecognised action type all degrade to a
 * generic instruction rather than throwing. A blank board with no guidance is
 * the failure mode this whole module exists to prevent.
 */
export function deriveTurnPrompt(input: GuidanceInput): TurnPrompt {
  const { state, oracle, spec } = input

  if (state.phase !== 'playing') {
    return terminalPrompt(input)
  }

  const expected = expectedAction(state, oracle)
  // NOTE: `expected.type` is an ACTION type ("comparePair"), not a DsaOp
  // ("compare"). Testing it with isDsaOp always failed and silently fell back
  // to 'read', which made every turn advertise the wrong operation. The two
  // vocabularies are different sets even though mechanic ids and action types
  // happen to share names.
  const dsaOp: DsaOp =
    expected?.dsaOp ??
    (expected && isActionType(expected.type) ? opForActionType(expected.type) : fallbackOp(state, spec))

  const mechanic: MechanicId = expected
    ? (mechanicForType(expected.type) ?? 'selectObject')
    : fallbackMechanic(spec, dsaOp)

  const targets = buildTargets(state, spec, expected, mechanic)
  const indicator = buildIndicator(state, spec)
  const verb = spec.vocabulary.actionVerb
  const targetPhrase = describeTargets(targets, spec)

  const instruction = buildInstruction(expected, mechanic, verb, targetPhrase, spec)

  return {
    goal: firstSentence(spec.objective) || verb,
    instruction,
    mechanic,
    dsaOp,
    targets,
    ...(mechanic === 'assignValue' && expected?.options?.targetIds ? { assignmentTargetIds: expected.options.targetIds } : {}),
    ...(mechanic === 'submitAnswer' ? { answerTargetId: expected?.options?.objectIds?.[0] ?? 'answer' } : {}),
    reason: OPERATION_REASON[dsaOp] ?? 'This is one of the steps the program takes.',
    progress: indicator.progress,
    indicator,
    nudge: deriveNudge(state, mechanic),
  }
}

function terminalPrompt(input: GuidanceInput): TurnPrompt {
  const { state, spec } = input
  const won = state.phase === 'won'
  return {
    goal: won ? 'You finished the round.' : 'The round ended without a match.',
    instruction: won ? 'Look at what your moves did.' : 'See where the search went.',
    mechanic: 'submitAnswer',
    dsaOp: 'terminate',
    targets: [],
    reason: won
      ? 'The program found it because each of your moves threw away something it no longer needed.'
      : 'Every move that ruled out the right place also rules out the answer.',
    progress: 1,
    indicator: {
      label: 'search space',
      progress: 1,
      detail: won ? 'empty — the target was here' : 'empty — nothing left to check',
    },
    nudge: null,
  }
}

/** The action the oracle says is legal right now, if it tells us. */
function expectedAction(state: GameState, oracle: Oracle): LegalActionDescriptor | undefined {
  const legal = oracle.legalActions?.(state)
  if (!Array.isArray(legal) || legal.length === 0) return undefined
  // One legal action means the game is unambiguous, which is the common case
  // and the one worth explaining. Several means the learner has a real choice.
  return legal[0]
}

function mechanicForType(type: string): MechanicId | null {
  if (!isActionType(type)) return null
  // isActionType narrows to ActionType, which is exactly the MechanicId union:
  // the two are 1:1 by construction (see ACTION_TO_MECHANIC in the contract).
  return MECHANICS[type] ? type : null
}

function opForActionType(type: string): DsaOp {
  const id = mechanicForType(type)
  return id ? MECHANICS[id].op : 'read'
}

function fallbackMechanic(spec: GameSpec, dsaOp: DsaOp): MechanicId {
  const bound = spec.mechanics.find((m) => m.boundDsaOp === dsaOp)
  if (bound) return bound.id
  return spec.mechanics[0]?.id ?? 'selectObject'
}

/** When the oracle gives no hint, infer the operation from what has happened. */
function fallbackOp(state: GameState, spec: GameSpec): DsaOp {
  const used = new Set(state.trace.map((f) => f.dsaOp))
  const next = spec.mechanics.find((m) => !used.has(m.boundDsaOp))
  if (next) return next.boundDsaOp
  return spec.mechanics[spec.mechanics.length - 1]?.boundDsaOp ?? 'read'
}

function buildInstruction(
  expected: LegalActionDescriptor | undefined,
  mechanic: MechanicId,
  verb: string,
  targetPhrase: string,
  spec: GameSpec,
): string {
  // Prefer the LLM's themed label for this mechanic — it was written in the
  // game's own voice. Fall back to a generated imperative.
  //
  // NEVER surface `expected.label` here. The oracle's label is written for a
  // developer and it names the position: binary search produces "Choose index 6,
  // the middle of [6, 7]" — and on the winning turn index 6 *is* the answer.
  // Routing that string to the learner would hand over the result on the last
  // move, which is the one thing this module exists to prevent. The parameter is
  // kept only to make the call site read well.
  const authored = spec.mechanics.find((m) => m.id === mechanic)?.label
  if (authored && authored.trim()) return authored.trim()
  void expected
  const build = MECHANIC_INSTRUCTION[mechanic]
  return build(capitalise(verb), targetPhrase)
}

function buildTargets(
  state: GameState,
  spec: GameSpec,
  expected: LegalActionDescriptor | undefined,
  mechanic: MechanicId,
): TurnTarget[] {
  const legal = expected?.options?.objectIds ?? []

  // "Legal" is not "do this". The oracle offers every in-window object for a
  // selection, so using that list directly highlighted the whole board, which
  // tells a learner nothing. When the mechanic is point-at-one, the algorithm's
  // own pointer is the recommendation and it wins over the legal set.
  if (mechanic === 'selectObject') {
    const pointed = objectAtCursor(state)
    if (pointed && (legal.length === 0 || legal.includes(pointed))) {
      const target = toTarget(state, spec, pointed, 'current')
      return target ? [target] : []
    }
  }

  if (mechanic === 'choosePath') {
    const branches = branchTargets(state, spec)
    if (branches.length > 0) return branches
  }

  if (legal.length > 0) {
    return legal
      .map((id) => toTarget(state, spec, id, roleFor(id, state, expected, mechanic)))
      .filter((t): t is TurnTarget => t !== null)
  }

  // No legal-action hint: fall back to the state itself, which is enough for
  // the pointer-driven mechanics.
  const midSlot = state.cursor.midSlotId
  const midId = midSlot ? occupantOfSlot(state, midSlot) : undefined
  if (midId) {
    const target = toTarget(state, spec, midId, 'current')
    return target ? [target] : []
  }
  const first = Object.values(state.objects)[0]
  if (!first) return []
  const candidate = toTarget(state, spec, first.id, 'candidate')
  return candidate ? [candidate] : []
}

/**
 * The two halves a learner can keep, as tappable targets.
 *
 * choosePath's legal action names only the current element, not the branches,
 * because a branch is not a board object — it is a decision. So the branches
 * are described in the object's own vocabulary ("weaker than beacon 25").
 *
 * The ids MUST be real board object ids. An earlier version minted synthetic
 * ones (`__branch_high_v3`) for the higher side: they parsed fine, validated
 * fine, and highlighted nothing at all, because no tile had that id. A target
 * that cannot be pointed at is worse than no target, so the higher side is
 * anchored to a real element above the mid.
 */
function branchTargets(state: GameState, spec: GameSpec): TurnTarget[] {
  const live = Object.values(state.objects).filter(
    (o) => o.kind !== 'target' && o.state !== 'eliminated' && o.value !== undefined,
  )
  if (live.length < 2) return []

  const midId = objectAtCursor(state)
  const mid = midId ? state.objects[midId] : undefined
  if (!mid || mid.value === undefined) return []

  const out: TurnTarget[] = [
    {
      id: mid.id,
      label: `${spec.vocabulary.lowerWord} than ${spec.vocabulary.object} ${mid.value}`,
      hint: `if the ${spec.vocabulary.target} is on the ${spec.vocabulary.lowerWord} side`,
      role: 'current',
    },
  ]

  const higher = live
    .filter((o) => (o.value ?? 0) > (mid.value ?? 0))
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0]
  const higherId = higher?.id ?? live[live.length - 1]?.id
  if (higherId) {
    out.push({
      id: higherId,
      label: `${spec.vocabulary.higherWord} than ${spec.vocabulary.object} ${mid.value}`,
      hint: `if the ${spec.vocabulary.target} is on the ${spec.vocabulary.higherWord} side`,
      role: 'candidate',
    })
  }
  return out
}

function toTarget(
  state: GameState,
  spec: GameSpec,
  objectId: string,
  role: TurnTarget['role'],
): TurnTarget | null {
  const object = state.objects[objectId]
  if (!object) return null
  const word = spec.vocabulary.object
  const label =
    object.kind === 'target'
      ? `the ${spec.vocabulary.target}`
      : object.value !== undefined
        ? `${word} ${object.value}`
        : object.label
  return { id: objectId, label, hint: roleHint(role, spec), role }
}

function roleHint(role: TurnTarget['role'], spec: GameSpec): string {
  switch (role) {
    case 'current':
      return 'the one the program is looking at'
    case 'target':
      return `the ${spec.vocabulary.target} to find`
    case 'excluded':
      return 'already ruled out'
    case 'answer':
      return 'where the answer goes'
    default:
      return 'pick this one'
  }
}

function roleFor(
  id: string,
  state: GameState,
  expected: LegalActionDescriptor | undefined,
  mechanic: MechanicId,
): TurnTarget['role'] {
  const object = state.objects[id]
  if (!object) return 'candidate'
  if (object.kind === 'target') return 'target'
  if (object.state === 'eliminated') return 'excluded'
  if (mechanic === 'submitAnswer') return 'answer'
  if (id === objectAtCursor(state)) return 'current'
  if (expected?.options?.objectIds?.[0] === id) return 'current'
  return 'candidate'
}

function objectAtCursor(state: GameState): string | undefined {
  const { midSlotId, iSlotId, jSlotId, bestObjectId, nodeId } = state.cursor
  const slot = midSlotId ?? iSlotId ?? jSlotId
  if (slot) return occupantOfSlot(state, slot)
  return bestObjectId ?? nodeId
}

function occupantOfSlot(state: GameState, slotId: string): string | undefined {
  const slot = state.slots[slotId]
  if (slot?.occupantId) return slot.occupantId
  return Object.values(state.objects).find((o) => o.slotId === slotId)?.id
}

function describeTargets(targets: readonly TurnTarget[], spec: GameSpec): string {
  if (targets.length === 0) return 'the board'
  if (targets.length === 1) return targets[0]!.label
  if (targets.length === 2) return `${targets[0]!.label} and ${targets[1]!.label}`
  return `one of the ${spec.vocabulary.objectPlural}`
}

/**
 * "How much is left", as a fraction and a human count.
 *
 * Expressed as surviving elements rather than lo/mid/hi, because a narrowing
 * window is the idea and `lo <= hi` is the notation.
 */
function buildIndicator(state: GameState, spec: GameSpec): AlgorithmIndicator {
  const all = Object.values(state.objects).filter((o) => o.kind !== 'target')
  if (all.length === 0) {
    return { label: spec.vocabulary.place, progress: 1, detail: 'nothing left' }
  }
  const lo = state.variables['lo'], hi = state.variables['hi']
  const live = all.filter(o => o.state !== 'eliminated' && o.state !== 'matched' && (state.problemId !== 'rotated-search' || typeof lo !== 'number' || typeof hi !== 'number' || (o.slotId && (state.slots[o.slotId]?.index ?? -1) >= lo && (state.slots[o.slotId]?.index ?? -1) <= hi)))
  const progress = all.length === 0 ? 0 : live.length / all.length
  return {
    label: `still in play in the ${spec.vocabulary.place}`,
    progress: Math.max(0, Math.min(1, progress)),
    detail: `${live.length} of ${all.length} ${all.length === 1 ? spec.vocabulary.object : spec.vocabulary.objectPlural} left`,
  }
}

/**
 * Nudge only after repeated trouble, and never scold.
 *
 * The tone is about the situation ("that half is gone"), not the person, and it
 * never says whether an action was right — the engine owns that.
 */
function deriveNudge(state: GameState, mechanic: MechanicId): TurnPrompt['nudge'] {
  const recent = state.trace.slice(-2)
  const consecutiveWrong = recent.length > 0 && recent.every((f) => !f.correct)
  const mistakes = state.progress.mistakes

  if (mistakes >= 4 && consecutiveWrong) {
    return {
      tone: 'urgent',
      message: 'Take a breath and read the highlighted ones only — the rest are already gone.',
    }
  }
  if (mistakes >= 2 && consecutiveWrong) {
    return {
      tone: 'gentle',
      message: 'Two in a row. Look at the one marked as the middle, and compare just that one.',
    }
  }
  if (consecutiveWrong) {
    return { tone: 'gentle', message: 'Not this time. Try the highlighted one.' }
  }
  void mechanic
  return null
}

// ------------------------------------------------------------------ feedback

export interface FeedbackInput extends GuidanceInput {
  readonly outcome: ActionOutcome
  /** The frame this action produced, when the engine recorded one. */
  readonly frame?: TraceFrame | undefined
}

/**
 * Explanatory feedback. The `teach` line is present on EVERY verdict, including
 * success, because "correct" alone teaches nothing and confirmatory feedback is
 * measurably weaker than explanatory feedback in educational games.
 */
export function deriveFeedback(input: FeedbackInput): PlayerFeedback {
  const { state, outcome, frame, oracle, spec } = input
  const dsaOp = frame?.dsaOp ?? opForActionType(outcome.dsaOp)
  const codeLine = frame?.codeLine ?? 1

  let codeLineText = frame?.codeLineText ?? ''
  if (!codeLineText) {
    try {
      codeLineText = oracle.code('javascript')[codeLine - 1] ?? ''
    } catch {
      codeLineText = ''
    }
  }

  if (outcome.illegal) {
    return {
      verdict: 'illegal',
      headline: 'That one is not available yet.',
      teach: 'The program has to do its steps in order, so this move does not apply right now.',
      nextStep: 'Follow the instruction at the top of the board.',
      codeLine,
      codeLineText,
      didWhat: 'nothing yet',
    }
  }

  if (!outcome.correct) {
    return {
      verdict: 'wrong',
      headline: headlineForWrong(dsaOp, spec),
      teach:
        deJargon(outcome.feedback, spec) ||
        OPERATION_REASON[dsaOp] ||
        'That was not the move the program wanted.',
      // The engine already knows the right move; showing it teaches, hiding it
      // just makes the learner guess again.
      nextStep: outcome.expected ? nextStepForExpected(outcome.expected, state, spec) : undefined,
      codeLine,
      codeLineText,
      didWhat: operationName(dsaOp, spec),
      encourage: 'Mistakes here are how the pattern shows up.',
    }
  }

  return {
    verdict: 'correct',
    headline: headlineForCorrect(dsaOp, spec),
    // `frame.note` is the oracle's own trace annotation — "mid = 3",
    // "keep right, window [4, 7]" — which is exactly the notation a learner
    // should not be reading. `outcome.feedback` is written for the player, so
    // it wins. The trace note is only a last resort.
    teach:
      deJargon(outcome.feedback, spec) ||
      OPERATION_REASON[dsaOp] ||
      (frame?.note ? deJargon(frame.note, spec) : '') ||
      'That is the move.',
    codeLine,
    codeLineText,
    didWhat: operationName(dsaOp, spec),
    encourage: encourageFor(state),
  }
}

/**
 * Strip the notation an oracle might leak into player-facing text.
 *
 * `window [4, 7]`, `mid = 3`, `Index 3`, `lo=0 hi=7` are the algorithm's
 * internals. The numbers are already on the board and the pointers are already
 * drawn, so repeating them in prose is pure extra reading. The relation codes
 * `lt / eq / gt` are worse than jargon — they are raw enum values, so they get
 * translated into the theme's own words, which the spec already supplies.
 */
export function deJargon(text: string, spec?: GameSpec): string {
  let out = text
  if (spec) {
    const words: Record<string, string> = {
      lt: spec.vocabulary.lowerWord,
      eq: spec.vocabulary.equalWord,
      gt: spec.vocabulary.higherWord,
    }
    // Only quoted or standalone codes, so "target" is not mangled.
    out = out.replace(/"(lt|eq|gt)"/g, (_m, code: string) => `"${words[code] ?? code}"`)
    out = out.replace(
      /\bthe relation is (lt|eq|gt)\b/gi,
      (_m, code: string) => `it is ${words[code.toLowerCase()] ?? code}`,
    )
    out = out.replace(
      /\b(lt|eq|gt) declared\b/gi,
      (_m, code: string) => `${words[code.toLowerCase()] ?? code} declared`,
    )
  }
  return out
    .replace(/\bwindow\s*\[[^\]]*\]/gi, 'the rest of the board')
    .replace(/\bthe midpoint of \[[^\]]*\]/gi, 'the middle of what is left')
    .replace(/\bmidpoint of \[[^\]]*\]/gi, 'the middle of what is left')
    .replace(/\bindex\s+(-?\d+)\b/gi, 'position $1')
    .replace(/\b(lo|hi|mid|i|j)\s*=\s*-?\d+/gi, '')
    .replace(/\[\s*-?\d+\s*,\s*-?\d+\s*\]/g, 'what is left')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .replace(/^[\s,;.]+/, '')
    .trim()
}

function headlineForCorrect(dsaOp: DsaOp, spec: GameSpec): string {
  switch (dsaOp) {
    case 'compare':
      return 'Compared.'
    case 'choose-path':
      return 'Half the board gone.'
    case 'read':
      return 'Locked on.'
    case 'terminate':
      return `Found the ${spec.vocabulary.target}.`
    default:
      return 'Right move.'
  }
}

function headlineForWrong(dsaOp: DsaOp, spec: GameSpec): string {
  switch (dsaOp) {
    case 'compare':
      return 'Not what the program sees.'
    case 'choose-path':
      return `That threw away the ${spec.vocabulary.target}.`
    default:
      return 'Not this one.'
  }
}

function nextStepForExpected(
  expected: Partial<Record<string, unknown>> | undefined,
  state: GameState,
  spec: GameSpec,
): string | undefined {
  if (!expected) return undefined
  const type = expected['type']
  if (typeof type !== 'string' || !isActionType(type)) return undefined
  const objectId =
    typeof expected['objectId'] === 'string'
      ? expected['objectId']
      : typeof expected['aId'] === 'string'
        ? (expected['aId'] as string)
        : undefined
  if (objectId) {
    const object = state.objects[objectId]
    if (object) {
      const label =
        object.kind === 'target'
          ? `the ${spec.vocabulary.target}`
          : object.value !== undefined
            ? `${spec.vocabulary.object} ${object.value}`
            : object.label
      return `The program wanted ${label}.`
    }
  }
  if (typeof expected['relation'] === 'string') {
    const map: Record<string, string> = {
      lt: spec.vocabulary.lowerWord,
      eq: spec.vocabulary.equalWord,
      gt: spec.vocabulary.higherWord,
    }
    const relation = expected['relation']
    const word = map[relation] ?? relation
    return `The program saw them as ${word}.`
  }
  return 'The program wanted a different one.'
}

function operationName(dsaOp: DsaOp, spec: GameSpec): string {
  switch (dsaOp) {
    case 'compare':
      return `compared two ${spec.vocabulary.objectPlural}`
    case 'choose-path':
      return `kept part of the ${spec.vocabulary.place}`
    case 'read':
      return `read one ${spec.vocabulary.object}`
    case 'terminate':
      return 'finished the search'
    case 'swap':
      return 'swapped two values'
    case 'push':
      return 'pushed a value'
    case 'pop':
      return 'popped a value'
    case 'traverse':
      return 'followed a link'
    case 'link':
      return 'wired two nodes'
    case 'assign':
      return 'saved a value'
    case 'move':
      return 'moved a value'
    case 'insert':
      return 'inserted a value'
    case 'unlink':
      return 'cut a link'
    default:
      return 'made a move'
  }
}

function encourageFor(state: GameState): string | undefined {
  if (state.progress.steps <= 2) return undefined
  if (state.progress.mistakes === 0) return 'No wrong turns yet — that halving is doing its job.'
  return undefined
}

// -------------------------------------------------------------------- helpers

function capitalise(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Do'
  return trimmed[0]!.toUpperCase() + trimmed.slice(1)
}

function firstSentence(value: string): string {
  const match = value.match(/^[^.!?]+[.!?]?/)
  return (match?.[0] ?? value).trim()
}
