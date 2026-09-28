import type {
  Action,
  ActionOutcome,
  DsaOp,
  GameSpec,
  GameState,
  MechanicId,
  PlayerFeedback,
  TurnPrompt,
  TurnTarget,
} from '@dsa/game-schema'
import { getProblem } from '@dsa/game-schema'

/**
 * Everything the play screen derives from the guidance contract.
 *
 * WHY THIS IS A PURE MODULE: `TurnPrompt` is the oracle-derived answer to "what
 * do I do next", and this file only decides how to DRAW it. It never decides
 * whether anything is right, and it never invents an instruction that is not in
 * the contract — where a value is missing it falls back to a state *fact*
 * (which slot the cursor is on, which objects the engine marked eliminated) and
 * says so, rather than guessing at the answer.
 *
 * The three questions the UI actually asks here:
 *
 *   1. Which board cells must I light up?            → `buildTargetMarkers`
 *   2. Where is the algorithm's search window?        → `deriveRangeWindow`
 *   3. How much work is left, as a number?           → `deriveWorkCountdown`
 *
 * Plus two degraded-mode builders (`fallbackTurnPrompt`, `fallbackFeedback`) so
 * the play screen still teaches while the API is on an older build that does not
 * send `turnPrompt` / `feedback` yet.
 */

// ------------------------------------------------------------------ targets

/**
 * One highlighted thing, resolved to whatever the board actually renders.
 *
 * `TurnTarget.id` is an object id in the current engine, but a target can also
 * name a slot (a destination for `moveObject`, a branch cell for `choosePath`).
 * Resolving to both means the highlight follows the *tile* whichever way the
 * id points, instead of silently lighting up nothing if the id is not an object.
 */
export interface TargetMarker {
  readonly target: TurnTarget
  readonly objectId: string | null
  readonly slotId: string | null
}

/**
 * Keyed by `TurnTarget.id` and, when the id is a slot, by that slot's occupant
 * as well — so a board cell can ask "am I a target?" with one map lookup on
 * either of its ids.
 */
export type TargetMarkers = ReadonlyMap<string, TargetMarker>

function slotOccupant(state: GameState, slotId: string): string | null {
  const slot = state.slots[slotId]
  if (slot?.occupantId && state.objects[slot.occupantId]) return slot.occupantId
  for (const object of Object.values(state.objects)) {
    if (object.slotId === slotId) return object.id
  }
  return null
}

/** Turn `TurnPrompt.targets` into lookup keys the board cells can query. */
export function buildTargetMarkers(prompt: TurnPrompt | null, state: GameState): TargetMarkers {
  const markers = new Map<string, TargetMarker>()
  if (!prompt) return markers
  for (const target of prompt.targets) {
    const isObject = Boolean(state.objects[target.id])
    const isSlot = Boolean(state.slots[target.id])
    const slotId = isSlot ? target.id : isObject ? (state.objects[target.id]?.slotId ?? null) : null
    const objectId = isObject ? target.id : isSlot ? slotOccupant(state, target.id) : null

    const marker: TargetMarker = { target, objectId, slotId }
    markers.set(target.id, marker)
    if (objectId && !markers.has(objectId)) markers.set(objectId, marker)
    if (slotId && !markers.has(slotId)) markers.set(slotId, marker)
  }
  return markers
}

/**
 * The first marker matching any of the candidate ids, in the order given.
 *
 * Callers pass what a cell knows about itself (its slot id first, then its
 * occupant's object id) so a single lookup covers both resolution paths.
 */
export function findMarker(
  markers: TargetMarkers,
  ...ids: readonly (string | null | undefined)[]
): TargetMarker | null {
  for (const id of ids) {
    if (!id) continue
    const hit = markers.get(id)
    if (hit) return hit
  }
  return null
}

/** Only the targets the learner should actually touch. */
export function actionableTargets(markers: TargetMarkers): TargetMarker[] {
  const seen = new Set<TurnTarget>()
  const out: TargetMarker[] = []
  for (const marker of markers.values()) {
    if (marker.target.role === 'excluded') continue
    if (seen.has(marker.target)) continue
    seen.add(marker.target)
    out.push(marker)
  }
  return out
}

/**
 * How loudly a target should be highlighted.
 *
 * THIS IS THE MOST IMPORTANT SUBTLETY IN THE WHOLE REDESIGN, and it comes from
 * reading what the engine actually puts in `targets`. For binary search's first
 * turn the oracle's `legalActions` returns EVERY element still inside the
 * `lo…hi` window as a legal `objectIds` option — not just the midpoint — and the
 * engine then tags the midpoint `role: 'current'` and the rest
 * `role: 'candidate'`.
 *
 * So a target list is not a list of "the things to touch". It is "everything
 * you are allowed to touch, with the one the algorithm wants marked". Puling
 * all of them identically would leave the learner exactly where the old UI left
 * them — reading a list — and would also be actively wrong, because it would
 * present eight equally-loud tiles for a question with one answer.
 *
 *   primary   — `current` / `target` / `answer`: the algorithm's choice. Loud.
 *   secondary — `candidate`: legal, but not the one. A quiet outline, so the
 *               set reads as "any of these is allowed" without competing.
 *   muted     — `excluded`: the engine has already ruled it out. No highlight
 *               at all; the recede treatment is the message.
 */
export type TargetStrength = 'primary' | 'secondary' | 'muted'

export function targetStrength(role: TurnTarget['role']): TargetStrength {
  switch (role) {
    case 'current':
    case 'target':
    case 'answer':
      return 'primary'
    case 'excluded':
      return 'muted'
    case 'candidate':
    default:
      return 'secondary'
  }
}

// ---------------------------------------------------------- branch choices

/**
 * The two halves of a narrowing search, derived from the window.
 *
 * WHY THIS IS NEEDED: `choosePath` is the move that makes a halving algorithm
 * fast, and for the board shapes these oracles actually produce — every object
 * sitting in a `kind: 'default'` slot — `BoardModel.pathOptions` is EMPTY. The
 * old renderer therefore rendered "This instance exposes no branches. Try the
 * other operations the spec lists", which made the decisive step of the
 * algorithm unreachable and left the game unwinnable through that control.
 *
 * The oracle accepts the literal path ids `'left'` and `'right'` (`lo`/`hi`
 * sides of the middle), so the two buttons are derived here from the window
 * rather than from slots, and LABELLED WITH THE INDICES THEY KEEP. Naming the
 * surviving range — "keep 0–2" — is the whole lesson of `lo = mid + 1` /
 * `hi = mid - 1`, and it is much more transferable than a cell you have to tap
 * and hope you understood.
 */
export interface BranchChoice {
  readonly pathId: 'left' | 'right'
  /** Human label naming the indices this side keeps. */
  readonly label: string
  /** The range kept, inclusive. */
  readonly from: number
  readonly to: number
  /** False when the side is empty, in which case the button is disabled. */
  readonly viable: boolean
}

export interface BranchChoices {
  /** The mid OBJECT id — `choosePath.fromId` must be an object, not a slot. */
  readonly fromId: string
  readonly mid: number
  readonly lo: number
  readonly hi: number
  readonly left: BranchChoice
  readonly right: BranchChoice
}

export function deriveBranchChoices(state: GameState): BranchChoices | null {
  const midSlotId = state.cursor.midSlotId
  if (!midSlotId) return null
  const slot = state.slots[midSlotId]
  if (!slot) return null

  const occupantId = slot.occupantId ?? Object.values(state.objects).find((o) => o.slotId === midSlotId)?.id
  if (!occupantId) return null

  const lo = typeof state.variables['lo'] === 'number' ? (state.variables['lo'] as number) : 0
  const hi = typeof state.variables['hi'] === 'number' ? (state.variables['hi'] as number) : slot.index
  const mid = slot.index

  const leftLo = lo
  const leftHi = mid - 1
  const rightLo = mid + 1
  const rightHi = hi

  return {
    fromId: occupantId,
    mid,
    lo,
    hi,
    left: {
      pathId: 'left',
      label: leftHi < leftLo ? 'nothing on the left' : `keep ${leftLo}–${leftHi}`,
      from: leftLo,
      to: leftHi,
      viable: leftHi >= leftLo,
    },
    right: {
      pathId: 'right',
      label: rightHi < rightLo ? 'nothing on the right' : `keep ${rightLo}–${rightHi}`,
      from: rightLo,
      to: rightHi,
      viable: rightHi >= rightLo,
    },
  }
}

// ------------------------------------------------------------- search window

/**
 * The live search range, expressed in board indices.
 *
 * `lo` / `mid` / `hi` are slot ids, so the indices come straight from the slot
 * table. A cursor id that points at an object (some oracles do) is followed to
 * that object's slot rather than dropped, because a missing bracket is worse
 * than a late one.
 */
export interface RangeWindow {
  readonly has: boolean
  readonly loSlotId: string | null
  readonly midSlotId: string | null
  readonly hiSlotId: string | null
  readonly loIndex: number | null
  readonly midIndex: number | null
  readonly hiIndex: number | null
  /** `lo` has moved past `hi`: the search space is empty and the run is over. */
  readonly exhausted: boolean
}

const NO_WINDOW: RangeWindow = {
  has: false,
  loSlotId: null,
  midSlotId: null,
  hiSlotId: null,
  loIndex: null,
  midIndex: null,
  hiIndex: null,
  exhausted: false,
}

function slotIndexOf(state: GameState, id: string | undefined): number | null {
  if (!id) return null
  const direct = state.slots[id]
  if (direct) return direct.index
  const object = state.objects[id]
  if (object?.slotId) {
    const viaObject = state.slots[object.slotId]
    if (viaObject) return viaObject.index
  }
  return null
}

export function deriveRangeWindow(state: GameState): RangeWindow {
  const { loSlotId, midSlotId, hiSlotId } = state.cursor
  const loIndex = slotIndexOf(state, loSlotId)
  const hiIndex = slotIndexOf(state, hiSlotId)
  const midIndex = slotIndexOf(state, midSlotId)
  if (loIndex === null && hiIndex === null) return NO_WINDOW
  return {
    has: true,
    loSlotId: loSlotId ?? null,
    midSlotId: midSlotId ?? null,
    hiSlotId: hiSlotId ?? null,
    loIndex,
    midIndex,
    hiIndex,
    exhausted: loIndex !== null && hiIndex !== null && loIndex > hiIndex,
  }
}

/** Where a cell sits relative to the window: inside, at an edge, or ruled out. */
export type CellWindowRole = 'in-window' | 'window-start' | 'window-end' | 'outside' | 'none'

export function windowRoleFor(index: number, window: RangeWindow): CellWindowRole {
  if (!window.has || window.loIndex === null || window.hiIndex === null) return 'none'
  if (window.exhausted) return 'outside'
  if (index === window.loIndex) return 'window-start'
  if (index === window.hiIndex) return 'window-end'
  if (index > window.loIndex && index < window.hiIndex) return 'in-window'
  return 'outside'
}

// ------------------------------------------------------------------ countdown

/**
 * The work left, as countable numbers.
 *
 * The brief asks for complexity as a countdown of remaining comparisons rather
 * than the notation alone. That means two derived quantities:
 *
 *   - `remaining` = the algorithm's worst case on THIS board minus the
 *     comparisons already spent. The worst case comes from the problem's own
 *     declared `complexity.time`, so it is a forecast the learner can be
 *     measured against, not a number invented here.
 *   - `live` / `total` = how much of the board the algorithm has not thrown
 *     away. For a halving algorithm this is the real work left; for a linear
 *     one it never moves, which is itself the honest lesson (a linear scan does
 *     not get cheaper).
 *
 * THE UNIT MATTERS, and getting it wrong is a real bug rather than a rounding
 * nicety. A binary-search turn is THREE actions — select the middle, compare it,
 * choose a half — but the algorithm only ever performs ONE comparison. So
 * counting `progress.steps` against a `ceil(log2 n)` forecast runs the countdown
 * to zero after the first third of the run, and the screen then says "0
 * comparisons left" while the learner is still playing. Oracles that count
 * comparisons publish the count in `variables.comparisons`; `used` prefers that
 * and falls back to steps, and `unit` reports which one is on screen so the
 * label can never lie about it.
 *
 * `notation` is deliberately returned but NOT rendered during play — it is the
 * reward at the end of the run, not the motivation in the middle of it.
 */
export interface WorkCountdown {
  /** Elements the algorithm could still need to look at. */
  readonly live: number
  readonly total: number
  readonly discarded: number
  /** Comparisons counted by the oracle, or moves made when it does not count. */
  readonly used: number
  /** What `used` is measuring. The label follows this. */
  readonly unit: 'comparisons' | 'moves'
  /** Forecast worst case for this board, or null if we cannot compute one. */
  readonly worstCase: number | null
  /** `max(0, worstCase - used)`. */
  readonly remaining: number | null
  /** The problem's declared time complexity, e.g. `O(log n)`. */
  readonly notation: string | null
  /** How many steps a naive single-pass check would need here. */
  readonly linearCase: number
}

/**
 * Worst-case operation count for a board of `n` elements, from the declared
 * complexity. Returns null for anything it does not recognise, rather than
 * guessing — an unrecognised notation must hide the denominator, not lie.
 */
function worstCaseFor(notation: string, n: number): number | null {
  if (n <= 0) return null
  if (notation.includes('log')) return Math.max(1, Math.ceil(Math.log2(n)))
  if (notation.includes('n^2') || notation.includes('n²')) return (n * (n - 1)) / 2
  if (notation.includes('O(1)')) return 1
  if (notation.includes('n')) return Math.max(1, n - 1)
  return null
}

/**
 * The fraction of the ORIGINAL space still in play.
 *
 * When the space has been more than halved since the first turn, this is the
 * number worth showing, because "you just threw away more than half" is the
 * entire reason a binary search is fast and it is invisible in the notation.
 */
export function halvedRatio(state: GameState, live: number): number | null {
  const all = Object.values(state.objects).filter((o) => o.kind !== 'target')
  if (all.length === 0) return null
  return live / all.length
}

export function deriveWorkCountdown(state: GameState, prompt: TurnPrompt | null): WorkCountdown {
  // Same population the engine counts: the target object is the goal, not work.
  const all = Object.values(state.objects).filter((o) => o.kind !== 'target')
  const live = all.filter((o) => o.state !== 'eliminated' && o.state !== 'matched').length
  const total = all.length

  // Prefer the oracle's own comparison count so the countdown is measured in the
  // same unit as the complexity it is being held against.
  const rawComparisons = state.variables['comparisons']
  const counted = typeof rawComparisons === 'number' && Number.isFinite(rawComparisons) && rawComparisons >= 0
  const used = counted ? rawComparisons : state.progress.steps
  const unit: WorkCountdown['unit'] = counted ? 'comparisons' : 'moves'

  const declared = getProblem(state.problemId)?.complexity.time ?? null
  const worstCase = declared ? worstCaseFor(declared, total) : null

  void prompt

  return {
    live,
    total,
    discarded: Math.max(0, total - live),
    used,
    unit,
    worstCase,
    remaining: worstCase === null ? null : Math.max(0, worstCase - used),
    notation: declared,
    linearCase: Math.max(0, total - 1),
  }
}

// ----------------------------------------------------------------- indicator

/**
 * Turn `indicator.progress` into the two things the visual needs.
 *
 * The bar shows work REMAINING (0..1 filled by what is left) because a bar that
 * empties as you play reads as "you are running out" — the opposite of the
 * message. The engine's own `progress` is the fraction still in play, so the
 * bar is filled with exactly that and the countdown beneath it counts down the
 * operations.
 */
export function indicatorFill(prompt: TurnPrompt | null): number {
  if (!prompt) return 1
  const value = prompt.indicator.progress
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

/**
 * A key that changes only when the MOVE changes, so the reveal animation fires
 * once per turn instead of on every re-render.
 *
 * `step` is the engine's own operation count, which is what makes this a
 * reliable turn counter: the instruction text can legitimately repeat (two
 * consecutive reads of the same object read identically) and only the step
 * distinguishes them as separate turns.
 */
export function turnKey(prompt: TurnPrompt | null, step: number): string {
  if (!prompt) return `bare:${step}`
  return [
    step,
    prompt.mechanic,
    prompt.dsaOp,
    prompt.instruction,
    prompt.targets.map((t) => t.id).join(','),
  ].join('|')
}

// ------------------------------------------------------- expected-action ids

/**
 * The object ids the engine said it expected, in the order it listed them.
 *
 * `ActionOutcome.expected` is `Partial<Action>`, i.e. a partial of *some* union
 * member, so property access has to go through `in` narrowing. Used to point at
 * the consequence of a wrong move on the board rather than describing it in
 * prose the learner has to map back onto tiles.
 */
export function expectedObjectIds(expected: Partial<Action> | undefined): string[] {
  if (!expected) return []
  const ids: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) ids.push(value)
  }
  if ('objectId' in expected) push(expected.objectId)
  if ('aId' in expected) push(expected.aId)
  if ('bId' in expected) push(expected.bId)
  if ('fromId' in expected) push(expected.fromId)
  if ('pathId' in expected) push(expected.pathId)
  if ('fromNodeId' in expected) push(expected.fromNodeId)
  if ('toNodeId' in expected) push(expected.toNodeId)
  if ('targetId' in expected) push(expected.targetId)
  if ('toSlotId' in expected) push(expected.toSlotId)
  if ('objectIds' in expected && Array.isArray(expected.objectIds)) {
    for (const id of expected.objectIds) push(id)
  }
  return [...new Set(ids)]
}

// ------------------------------------------------------------------- demo

/**
 * The one action a demonstration can safely play, if any.
 *
 * WORKED EXAMPLE, THEN FADING: a first-time learner is shown one step before
 * being asked for one. But a demonstration must not fabricate a move — and most
 * mechanics are NOT determined by the prompt alone: a comparison still needs a
 * relation, a branch still needs a side, an assignment still needs a value. Only
 * `selectObject` on a single non-excluded target is fully specified by the
 * contract, so only that is ever auto-played. Every other mechanic gets a guided
 * highlight walkthrough instead, and the learner makes the move. Letting the
 * engine validate even this one action means the demonstration can never claim a
 * result the engine did not produce.
 */
export function demoActionFor(prompt: TurnPrompt | null, state: GameState): Action | null {
  if (!prompt) return null
  if (prompt.mechanic !== 'selectObject') return null
  if (prompt.targets.length !== 1) return null
  const target = prompt.targets[0]
  if (!target) return null
  if (target.role === 'excluded') return null
  if (!state.objects[target.id]) return null
  return { type: 'selectObject', objectId: target.id }
}

// ------------------------------------------------------------ degraded mode

/**
 * Copy for the operation "why this matters", used only when the API has not sent
 * `turnPrompt` yet. Deliberately duplicated rather than imported: the engine's
 * table is not on the web's dependency surface, and this is presentation copy in
 * a fallback path. It is operation-level (never answer-level), which is what
 * makes it safe to show without the oracle behind it.
 */
const FALLBACK_REASON: Readonly<Record<DsaOp, string>> = {
  read: 'Looking at one element is how the program checks a single value.',
  compare: 'A comparison tells the program which way to go next.',
  'choose-path': 'Throwing away options you do not need is what makes the next step cheaper.',
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

function firstSentence(value: string): string {
  const match = value.match(/^[^.!?]+[.!?]?/)
  return (match?.[0] ?? value).trim()
}

/**
 * A `TurnPrompt` assembled from state alone, for an API build that does not send
 * one.
 *
 * It is built from FACTS the state already asserts — the slot the cursor is on,
 * which objects the engine marked eliminated, which operation the last action
 * was — and it never says whether anything is right. If even those are missing
 * it falls back to "read the board", which is always a legal thing to do.
 */
export function fallbackTurnPrompt(state: GameState, spec: GameSpec): TurnPrompt {
  const all = Object.values(state.objects).filter((o) => o.kind !== 'target')
  const live = all.filter((o) => o.state !== 'eliminated' && o.state !== 'matched')
  const total = Math.max(1, all.length)
  const progress = all.length === 0 ? 1 : live.length / total

  if (state.phase !== 'playing') {
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
      indicator: { label: 'search space', progress: 1, detail: won ? 'empty' : 'nothing left to check' },
      nudge: null,
    }
  }

  const binding = spec.mechanics[0]
  const mechanic: MechanicId = binding?.id ?? 'selectObject'
  const dsaOp: DsaOp = binding?.boundDsaOp ?? 'read'

  // Prefer the object the engine's own cursor is on; that is a state fact, not
  // a judgement about the answer.
  const cursorId = state.cursor.midSlotId ?? state.cursor.iSlotId ?? state.cursor.nodeId
  const occupantId = cursorId
    ? (state.slots[cursorId]?.occupantId ?? Object.values(state.objects).find((o) => o.slotId === cursorId)?.id)
    : undefined
  const focused = occupantId ? state.objects[occupantId] : live[0]
  const word = spec.vocabulary.object
  const targetLabel = focused
    ? focused.kind === 'target'
      ? `the ${spec.vocabulary.target}`
      : focused.value !== undefined
        ? `${word} ${focused.value}`
        : focused.label
    : `a ${word}`

  return {
    goal: firstSentence(spec.objective) || `Find the ${spec.vocabulary.target}.`,
    instruction: binding?.label?.trim() || `Read ${targetLabel}.`,
    mechanic,
    dsaOp,
    targets: focused ? [{ id: focused.id, label: targetLabel, hint: 'the one the program is looking at', role: 'current' }] : [],
    reason: FALLBACK_REASON[dsaOp] ?? 'This is one of the steps the program takes.',
    progress,
    indicator: {
      label: `still in play in the ${spec.vocabulary.place}`,
      progress,
      detail: `${live.length} of ${all.length} ${all.length === 1 ? word : spec.vocabulary.objectPlural} left`,
    },
    nudge: nudgeFromProgress(state),
  }
}

function nudgeFromProgress(state: GameState): TurnPrompt['nudge'] {
  const recent = state.trace.slice(-2)
  const consecutiveWrong = recent.length > 0 && recent.every((f) => !f.correct)
  if (!consecutiveWrong) return null
  if (state.progress.mistakes >= 4) {
    return { tone: 'urgent', message: 'Take a breath and read the highlighted ones only — the rest are already gone.' }
  }
  if (state.progress.mistakes >= 2) {
    return { tone: 'gentle', message: 'Two in a row. Look at the one marked as the middle, and compare just that one.' }
  }
  return { tone: 'gentle', message: 'Not this time. Try the highlighted one.' }
}

/**
 * A `PlayerFeedback` assembled from an `ActionOutcome`, for an API build that
 * does not send one. `teach` is always populated — explanatory feedback on
 * success is the whole point, and falling back to a bare "correct" would undo
 * the redesign exactly when the API is oldest.
 */
export function fallbackFeedback(outcome: ActionOutcome, state: GameState, spec: GameSpec): PlayerFeedback {
  const frame = state.trace[outcome.traceStep] ?? state.trace[state.trace.length - 1]
  const dsaOp = frame?.dsaOp ?? outcome.dsaOp
  const word = spec.vocabulary.objectPlural

  const didWhat: Record<DsaOp, string> = {
    compare: `compared two ${word}`,
    'choose-path': `kept part of the ${spec.vocabulary.place}`,
    read: `read one ${spec.vocabulary.object}`,
    terminate: 'finished the search',
    swap: 'swapped two values',
    push: 'pushed a value',
    pop: 'popped a value',
    traverse: 'followed a link',
    link: 'wired two nodes',
    assign: 'saved a value',
    move: 'moved a value',
    insert: 'inserted a value',
    unlink: 'cut a link',
  }

  if (outcome.illegal) {
    return {
      verdict: 'illegal',
      headline: 'That one is not available yet.',
      teach: 'The program has to do its steps in order, so this move does not apply right now.',
      nextStep: 'Follow the instruction at the top of the board.',
      codeLine: frame?.codeLine ?? 1,
      codeLineText: frame?.codeLineText ?? '',
      didWhat: 'nothing yet',
    }
  }

  if (!outcome.correct) {
    return {
      verdict: 'wrong',
      headline: 'Not this one.',
      teach: outcome.feedback || FALLBACK_REASON[dsaOp] || 'That was not the move the program wanted.',
      nextStep: outcome.expected ? 'The program wanted a different move — the ringed tiles are the ones it named.' : undefined,
      codeLine: frame?.codeLine ?? 1,
      codeLineText: frame?.codeLineText ?? '',
      didWhat: didWhat[dsaOp] ?? 'made a move',
    }
  }

  return {
    verdict: 'correct',
    headline: dsaOp === 'choose-path' ? 'Half the board gone.' : 'Right move.',
    teach: frame?.note || outcome.feedback || FALLBACK_REASON[dsaOp] || 'That is the move.',
    codeLine: frame?.codeLine ?? 1,
    codeLineText: frame?.codeLineText ?? '',
    didWhat: didWhat[dsaOp] ?? 'made a move',
  }
}

/** Narrow a possibly-missing contract value, for callers that must not crash. */
export function asFeedback(value: unknown, outcome: ActionOutcome, state: GameState, spec: GameSpec): PlayerFeedback {
  if (value && typeof value === 'object' && typeof (value as PlayerFeedback).teach === 'string') {
    return value as PlayerFeedback
  }
  return fallbackFeedback(outcome, state, spec)
}
