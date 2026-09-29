import { getProblem, PROBLEM_IDS } from '@dsa/game-schema'

/**
 * The debrief's self-explanation prompts (R2.1) and the echo bridge (R2.2).
 *
 * Retrieval practice is the strongest single learning lever in the literature
 * (Roediger & Karpicke 2006: 61% retained after a week vs 40% for rereading),
 * and fading plus a principle-elicitation prompt gives medium-to-large effects
 * on far transfer at no extra time on task (Atkinson, Renkl & Merrill 2003).
 * The debrief was a reread; these two free-response prompts make it a re-ask.
 *
 * Deliberately client-side and deterministic:
 * - the prompts are a pure function of `problemId`, written in the ALGORITHM's
 *   vocabulary (the generation effect disappears for anomalous material, so a
 *   theme-vocabulary prompt would be the wrong prompt);
 * - answers are never sent anywhere and never scored — not by the server, and
 *   especially not by an LLM. The echo bridge holds the learner's own words
 *   against the catalogue's `learningObjective`, which is deterministic text.
 * - there is intentionally no multiple choice anywhere here (Roediger et
 *   al. 2009: unfeedbacked MCQ increases false recognition).
 */

export interface SelfExplanationPrompts {
  /** Retention: why this way rather than the other way. */
  retention: string
  /** Integration: what stayed true the whole time (transfer). */
  integration: string
}

const PROMPTS: Record<string, SelfExplanationPrompts> = {
  'binary-search': {
    retention:
      'Think of one turn where you kept one half of the range and let the other half go. Why that half rather than the other one?',
    integration:
      'From the first comparison to the last, what stayed true about where the target could still be?',
  },
  'array-max-min': {
    retention:
      'Think of one step where you updated the running best — or chose to keep it. Why was that the right call rather than the opposite?',
    integration:
      'What stayed true about the best value you had seen so far, from the first element to the last?',
  },
  'two-sum': {
    retention:
      'When you checked whether the complement was already seen, why that complement rather than any other value?',
    integration:
      'What stayed true about the values you had already stored each time you moved to the next element?',
  },
  'move-zeroes': {
    retention:
      'When you moved a nonzero value into the write position — or left a zero where it was — why that choice rather than the opposite?',
    integration:
      'What stayed true about everything before the write pointer, the whole way through?',
  },
  'bubble-sort': {
    retention:
      'Think of one pair you swapped — or left alone. Why swap those two rather than leave them?',
    integration: 'What stayed true about the end of the array after each full pass?',
  },
  'selection-sort': {
    retention:
      'When you picked a new minimum from the unsorted part — or kept the current one — why that element rather than another?',
    integration:
      'What stayed true about everything before position i, from the first pass to the last?',
  },
  'valid-parentheses': {
    retention:
      'Think of one closer you matched against the top of the stack. Why did that pair belong together rather than not?',
    integration:
      'What stayed true about the openers still on the stack every time the brackets balanced so far?',
  },
  'stack-push-pop': {
    retention:
      'When you pushed a value — or popped one off — why was that the move rather than the opposite?',
    integration:
      'What stayed true about the order values come back out, no matter what order they went in?',
  },
  'queue-operations': {
    retention:
      'When you added a value at the rear — or took one from the front — why that end of the line rather than the other?',
    integration:
      'What stayed true about the order values leave in, from the first removal to the last?',
  },
  'linked-list-traversal': {
    retention:
      'Each step you followed one link forward. Why was moving to the next node the move, rather than stopping where you were?',
    integration:
      'What stayed true about the nodes you had already counted, all the way to null?',
  },
  'reverse-linked-list': {
    retention:
      'Before you rewired a pointer, you saved the next node first. Why was saving it necessary rather than optional?',
    integration:
      'What stayed true about the part of the list behind you — the part already reversed — at every step?',
  },
}

/** Generic fallback for a problem id the catalogue does not know yet. */
const FALLBACK_PROMPTS: SelfExplanationPrompts = {
  retention:
    'Think of one move you made where the opposite move was also available. Why yours rather than the opposite?',
  integration: 'From the first move to the last, what stayed true the whole time?',
}

export function selfExplanationPrompts(problemId: string): SelfExplanationPrompts {
  return PROMPTS[problemId] ?? FALLBACK_PROMPTS
}

/** Every catalogue problem has a first-party prompt pair. */
export function selfExplanationCoverage(): { covered: string[]; missing: string[] } {
  const covered = PROBLEM_IDS.filter((id) => PROMPTS[id] !== undefined)
  return { covered, missing: PROBLEM_IDS.filter((id) => PROMPTS[id] === undefined) }
}

export interface ReflectionAnswers {
  retention: string
  integration: string
  skipped: boolean
}

export function emptyReflections(): ReflectionAnswers {
  return { retention: '', integration: '', skipped: false }
}

/**
 * An answer counts when the learner produced words, not when they produced the
 * RIGHT words. The generation effect survives failing to generate correctly
 * (Hirschman & Bjork 1988) — a wrong attempt is still retrieval practice, so
 * nothing here judges correctness.
 */
export function reflectionsAnswered(answers: ReflectionAnswers): boolean {
  return answers.retention.trim().length > 0 && answers.integration.trim().length > 0
}

/**
 * The R2.2 echo bridge: the learner's own words, held against the deterministic
 * learning objective — never against LLM prose, which could disagree with the
 * oracle.
 */
export function echoBridge(problemId: string): string {
  const objective = getProblem(problemId)?.learningObjective
  return objective
    ? `Hold your answer against the idea this problem is built to teach: ${objective}`
    : 'Hold your answer against the idea this problem is built to teach.'
}

// ------------------------------------------------------------------ storage

const KEY_PREFIX = 'play-the-algorithms:self-explanation:v1:'

export function reflectionKey(gameId: string): string {
  return `${KEY_PREFIX}${gameId}`
}

type PickStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readReflections(storage: PickStorage, gameId: string): ReflectionAnswers | null {
  let raw: string | null = null
  try {
    raw = storage.getItem(reflectionKey(gameId))
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    const retention = typeof record['retention'] === 'string' ? record['retention'] : ''
    const integration = typeof record['integration'] === 'string' ? record['integration'] : ''
    return { retention, integration, skipped: record['skipped'] === true }
  } catch {
    return null
  }
}

/** Persisted locally only: a reflection is never sent to the server. */
export function saveReflections(storage: PickStorage, gameId: string, answers: ReflectionAnswers): boolean {
  try {
    storage.setItem(
      reflectionKey(gameId),
      JSON.stringify({ retention: answers.retention, integration: answers.integration, skipped: answers.skipped }),
    )
    return true
  } catch {
    return false
  }
}
