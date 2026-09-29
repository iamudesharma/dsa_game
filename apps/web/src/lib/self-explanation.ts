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
  'sliding-window-max-sum': {
    retention:
      'When you slid the window one step, you added one value and dropped one value instead of re-adding everything. Why was that enough rather than not?',
    integration:
      'What stayed true about the best window sum you had recorded, from the first window to the last?',
  },
  'two-pointers-pair': {
    retention:
      'When the pair sum missed the target, you moved exactly one pointer. Why that pointer rather than the other one?',
    integration:
      'What stayed true about where the answer could still be every time you moved a pointer inward?',
  },
  'prefix-sum-range': {
    retention:
      'You answered the range query with one subtraction instead of re-adding the range. Why does prefix[r+1] − prefix[l] give the right total rather than not?',
    integration:
      'What stayed true about what prefix[i] held after each step of the build, from the first element to the last?',
  },
  'kadane-max-subarray': {
    retention:
      'Think of one step where you extended the running sum — or restarted it at the current value. Why extend there rather than restart, or the reverse?',
    integration:
      'What stayed true about the best sum you had seen so far, even while the running sum kept changing?',
  },
  'merge-intervals': {
    retention:
      'When the next interval started inside the running one, you extended the end instead of emitting. Why extend rather than emit — or the reverse?',
    integration:
      'What stayed true about the intervals already emitted, every time you moved to the next one?',
  },
  'next-greater-element': {
    retention:
      'When a new value arrived, you popped every smaller value off the stack before pushing. Why pop those rather than keep them?',
    integration:
      'What stayed true about the values left sitting on the stack, from the first element to the last?',
  },
  'rotated-search': {
    retention:
      'Think of one turn where you kept one half and discarded the other. How did you know that half was sorted — and why did that decide it rather than not?',
    integration:
      'From the first midpoint to the last, what stayed true about where the target could still be?',
  },
  'linked-list-cycle': {
    retention:
      'The fast pointer moved two links for every one of the slow pointer. Why does meeting prove a cycle, rather than just a coincidence?',
    integration:
      'What stayed true about the distance between the two pointers each round when a cycle was there — and when it was not?',
  },
  'frequency-count': {
    retention:
      'Each time you saw a value you bumped its count instead of rescanning the array. Why was the stored count trustworthy rather than not?',
    integration:
      'What stayed true about the counts map after every element, from the first to the last?',
  },
  'valid-anagram': {
    retention:
      'You added the first string and subtracted the second instead of sorting either one. Why does all-zeroes at the end mean anagram rather than not?',
    integration:
      'What stayed true about what a nonzero count meant, at any point in the game?',
  },
  'valid-palindrome': {
    retention:
      'You compared the outermost unchecked pair first. Why was one mismatch enough to decide the whole answer rather than not?',
    integration:
      'What stayed true about the pairs you had already checked, all the way toward the middle?',
  },
  'tree-traversals': {
    retention:
      'Preorder, inorder, and postorder visit the same nodes in different orders. Why did the node itself come exactly when it did on one of your visits rather than earlier or later?',
    integration:
      'No matter which of the three orders you played, what stayed true about when a parent was visited relative to its children?',
  },
  'bst-validate': {
    retention:
      'You compared each inorder value with its predecessor. Why does one descending pair disprove the whole tree rather than just that pair?',
    integration:
      'What stayed true about the inorder values you had already checked, right up until the answer was decided?',
  },
  'tree-level-order': {
    retention:
      'You dequeued from the front but enqueued at the back. Why that discipline rather than taking from wherever was convenient?',
    integration:
      'What stayed true about the order nodes left the queue, from the root down to the last level?',
  },
  'bst-search': {
    retention:
      'Think of one node where you descended left — or right. Why that child rather than the other one?',
    integration:
      'From the root to the target, what stayed true about where the target could still be at every node?',
  },
  'kth-largest-heap': {
    retention:
      'When a scan value beat the heap minimum you replaced the root and sifted down. Why replace rather than just remember the value — or the reverse?',
    integration:
      'What stayed true about the k values sitting in the heap zone after every step, from the first scan to the last?',
  },
  'num-islands': {
    retention:
      'When you started a flood on an unvisited land cell, why did that mean a new island rather than part of the previous one?',
    integration:
      'What stayed true about every cell your floods had already claimed, each time you started a new one?',
  },
  'max-area-island': {
    retention:
      'You measured each island as you claimed it instead of recounting at the end. Why was the running best trustworthy rather than not?',
    integration:
      'What stayed true about the largest area you had recorded, from the first island to the last?',
  },
  'rotting-oranges': {
    retention:
      'The wave rotted neighbours minute by minute rather than all at once. Why does the minute a cell rotted equal its distance rather than not?',
    integration:
      'What stayed true about the order cells rotted in, from minute zero to the last wave?',
  },
  'word-search': {
    retention:
      'When a path died you unmarked its cells instead of leaving them marked. Why was undoing necessary rather than optional?',
    integration:
      'What stayed true about the marked path every time you were one letter deeper?',
  },
  'union-find-connect': {
    retention:
      'When two roots differed you attached one under the other; when they matched you did nothing. Why attach there rather than not — or the reverse?',
    integration:
      'What stayed true about nodes that shared a root, from the first edge to the last?',
  },
  'climbing-stairs': {
    retention:
      'Each count was the sum of the two before it. Why add those two rather than count the paths from scratch?',
    integration:
      'What stayed true about what dp[i] meant after every step, from the ground to the top?',
  },
  'house-robber': {
    retention:
      'Think of one house where you took the money — or skipped it. Why take there rather than skip, or the reverse?',
    integration:
      'What stayed true about the best loot so far, even on the nights you skipped?',
  },
  'subsets': {
    retention:
      'For one element you explored both including it and excluding it. Why was the unmarking step necessary rather than optional?',
    integration:
      'What stayed true about the marked elements every time you went one level deeper?',
  },
  'permutations': {
    retention:
      'You tried every unused value in each open position. Why was freeing a value after its branch necessary rather than optional?',
    integration:
      'What stayed true about the used flags along any single root-to-leaf path?',
  },
  'jump-game': {
    retention:
      'You kept one running reach instead of rechecking every earlier cell. Why was that number trustworthy rather than not?',
    integration:
      'What stayed true about every index at or below the reach, the whole way through?',
  },
  'single-number': {
    retention:
      'Each fold cancelled at most one pair. Why does the survivor have to be the unpaired value rather than anything else?',
    integration:
      'What stayed true about the accumulator after every pair had cancelled, from the first fold to the last?',
  },
  'trie-prefix-search': {
    retention:
      'You followed one link per query letter instead of scanning all words. Why was following enough rather than not?',
    integration:
      'What stayed true about every word below the node you landed on?',
  },
  'network-delay-time': {
    retention:
      'Each round you settled the closest unsettled node instead of any other. Why was its distance final rather than still improvable?',
    integration:
      'What stayed true about every settled node, from the source to the last one?',
  },
  'coin-change': {
    retention:
      'For one amount you took one coin plus the best for the remainder instead of counting from scratch. Why was the stored remainder trustworthy rather than not?',
    integration:
      'What stayed true about what dp[x] meant after every amount, from zero to the target?',
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
