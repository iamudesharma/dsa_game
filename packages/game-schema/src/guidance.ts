/**
 * The learner-facing guidance contract.
 *
 * DESIGN PROBLEM this solves: the play screen renders a generic board and a wall
 * of numbers, and expects a 12-15 year old to work out what to do next. That is
 * extraneous cognitive load (Sweller's term) — effort spent decoding the UI
 * instead of learning the algorithm.
 *
 * The fix is one first-class object the UI can render without interpreting game
 * internals: a `TurnPrompt` answers, in order:
 *   1. what am I trying to do?      (goal)
 *   2. what do I do right now?      (instruction + mechanic + what to tap)
 *   3. why does that matter?        (reason — the algorithm's intent)
 *   4. am I on track?               (progress + a nudge when off-track)
 *
 * Everything here is derived from the ORACLE, never from the LLM, because a
 * prompt that invents a goal would teach the wrong algorithm.
 */

import type { MechanicId, DsaOp } from './mechanics.js'

/** How strongly the UI should interrupt the player. */
export type NudgeTone = 'none' | 'gentle' | 'urgent'

/**
 * What the algorithm is doing right now, in the learner's terms. This is the
 * "indicator" the UI shows next to the board.
 */
export interface AlgorithmIndicator {
  /** e.g. "the part of the row you are searching" */
  readonly label: string
  /** 0..1 — how much of the original space is still in play. */
  readonly progress: number
  /** Human count, e.g. "4 of 8 still to check". */
  readonly detail: string
}

export interface TurnPrompt {
  /** One line: the objective in this theme's vocabulary. */
  readonly goal: string
  /** One imperative sentence: the single thing to do next. */
  readonly instruction: string
  /** The mechanic the player is about to use. */
  readonly mechanic: MechanicId
  /** The DSA operation this action represents, for the code preview. */
  readonly dsaOp: DsaOp
  /**
   * Concrete things the player can tap, by id. Empty when the mechanic needs
   * free input. The UI highlights exactly these — this is what turns "click
   * things" into an unambiguous instruction.
   */
  /** Oracle-owned destination for a final answer; may be a nonvisual result ID. */
  readonly answerTargetId?: string
  /** Nonvisual variables or board destinations accepting typed values this turn. */
  readonly assignmentTargetIds?: readonly string[]
  readonly targets: readonly TurnTarget[]
  /** Why this operation matters. Short, concrete, no jargon. */
  readonly reason: string
  /** 0..1 across the whole problem. */
  readonly progress: number
  readonly indicator: AlgorithmIndicator
  /** Set when the player has stalled or keeps erring. */
  readonly nudge: { readonly tone: NudgeTone; readonly message: string } | null
}

export interface TurnTarget {
  readonly id: string
  /** What to call this object in the theme ("the 51 stone"). */
  readonly label: string
  /** Why it is a target, in one short clause. */
  readonly hint: string
  readonly role: 'current' | 'candidate' | 'target' | 'excluded' | 'answer'
}

/**
 * Feedback shown immediately after an action.
 *
 * The research on educational games is consistent that EXPLANATORY feedback
 * ("here is why, and here is the next thing to think about") beats confirmatory
 * feedback ("correct!"). So `correct` carries a `teach` line, never just a tick.
 */
export interface PlayerFeedback {
  readonly verdict: 'correct' | 'wrong' | 'illegal'
  /** The headline. Short, concrete, never patronising. */
  readonly headline: string
  /** The algorithmic reason. Always present, even when correct. */
  readonly teach: string
  /** What to try instead, when wrong. Omitted when the answer is unambiguous. */
  readonly nextStep?: string
  /** Which code line this action ran, so the code view can highlight it. */
  readonly codeLine: number
  readonly codeLineText: string
  /** The operation that just happened, for the "you just did X" chip. */
  readonly didWhat: string
  /** Encouragement aimed at the STRATEGY, not the person. */
  readonly encourage?: string
}

/**
 * A learner profile, used to pitch language at the right level.
 *
 * Deliberately a band rather than an age: 12 and 15 want very different
 * vocabulary, and we do not want to store a birthday to derive one number.
 */
export type LearnerBand = 'newcomer' | 'explorer' | 'builder'

export const LEARNER_BANDS: readonly LearnerBand[] = ['newcomer', 'explorer', 'builder']

export interface LearnerProfile {
  readonly band: LearnerBand
  /** Display name or null; never required. */
  readonly name?: string | null
  /** Problems solved, used for the "keep going" arc. */
  readonly solved: number
}

/**
 * A flat, JSON-safe picture of "what the learner is looking at right now".
 *
 * The coach is a language model, so it cannot read our live `GameState` — but it
 * can absolutely reason over this, and a compact snapshot is both cheaper and
 * far less likely to confuse it than the full board. Every field is a plain
 * scalar so it can be embedded in a prompt without formatting surprises.
 */
export interface GuidancePromptSnapshot {
  readonly problemId: string
  readonly problemTitle: string
  /** The learner's board, in order. */
  readonly board: readonly { readonly label: string; readonly value: number | null }[]
  readonly targetLabel: string
  readonly targetValue: number | null
  /** Which board positions the algorithm currently cares about. */
  readonly lo: number | null
  readonly mid: number | null
  readonly hi: number | null
  /** Positions already ruled out, so the model can talk about progress. */
  readonly eliminated: readonly number[]
  readonly step: number
  readonly mistakes: number
  /** The most recent mistake, phrased without naming the answer. */
  readonly lastMistakeDsaOp: string | null
  readonly phase: 'playing' | 'won' | 'lost'
  /** The objective and the current instruction, already in theme vocabulary. */
  readonly goal: string
  readonly instruction: string
  /** The algorithm's complexity, so the coach can mention why it is fast. */
  readonly complexity: string
}
