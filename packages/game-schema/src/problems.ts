/**
 * The MVP problem registry: eleven problems across six topics, matching the
 * agreed scope exactly (3 arrays, 2 sorting, 2 stack, 1 queue, 1 binary
 * search, 2 linked list).
 *
 * `instanceHints` tells the instance generator how to build valid data
 * (e.g. "sorted, unique, target present") and `allowedMechanics` is the
 * hard constraint the LLM must respect.
 */

import type { MechanicId } from './mechanics.js'

export type DsaTopic = 'arrays' | 'sorting' | 'stack' | 'queue' | 'binary-search' | 'linked-list'

export const DSA_TOPICS: readonly DsaTopic[] = [
  'arrays',
  'sorting',
  'stack',
  'queue',
  'binary-search',
  'linked-list',
] as const

export const TOPIC_LABELS: Readonly<Record<DsaTopic, string>> = {
  arrays: 'Arrays',
  sorting: 'Sorting',
  stack: 'Stack',
  queue: 'Queue',
  'binary-search': 'Binary Search',
  'linked-list': 'Linked List',
}

export type Difficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'] as const

export interface ProblemMeta {
  id: string
  topic: DsaTopic
  title: string
  /** One sentence: what the player must internalise. */
  learningObjective: string
  /** The canonical algorithm, in plain words. */
  canonicalAlgorithm: string
  /** Strictly the mechanics the engine can render for this problem. */
  allowedMechanics: readonly MechanicId[]
  /**
   * The subset WITHOUT WHICH the problem cannot be completed.
   *
   * This exists because "allowed" and "sufficient" are different questions.
   * Taking the first N allowed mechanics looks reasonable and is not: for
   * binary search it yields selectObject/comparePair/submitAnswer, which omits
   * choosePath — the only way `lo` and `hi` move. The game then accepts moves
   * forever and can never be won. A generator that may drop a mechanic has to
   * be told which ones are load-bearing.
   */
  requiredMechanics: readonly MechanicId[]
  /** Constraints for `buildInstance`. */
  instanceHints: {
    minLength: number
    maxLength: number
    unique?: boolean
    sorted?: boolean
    /** A target guaranteed to exist. */
    targetGuaranteed?: boolean
    /** Value range, inclusive. */
    valueRange?: [number, number]
    /** For stack/queue problems: the token alphabet. */
    tokenAlphabet?: readonly string[]
  }
  complexity: { time: string; space: string }
  defaultDifficulty: Difficulty
}

export const PROBLEMS: readonly ProblemMeta[] = [
  {
    id: 'binary-search',
    allowedMechanics: ['selectObject', 'comparePair', 'choosePath', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'choosePath', 'submitAnswer'],

    topic: 'binary-search',
    title: 'Find the target in a sorted array',
    learningObjective:
      'Binary search halves the search space on every comparison: compute mid, compare, discard one half, repeat.',
    canonicalAlgorithm:
      'Set lo=0, hi=n-1. While lo<=hi compute mid=(lo+hi)/2. If a[mid]==target stop. If a[mid]<target set lo=mid+1 else set hi=mid-1. If lo>hi the target is absent.',
    allowedMechanics: ['selectObject', 'comparePair', 'choosePath', 'assignValue', 'submitAnswer'],
    instanceHints: { minLength: 8, maxLength: 16, unique: true, sorted: true, targetGuaranteed: true, valueRange: [1, 99] },
    complexity: { time: 'O(log n)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'array-max-min',
    allowedMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'submitAnswer'],

    topic: 'arrays',
    title: 'Find the maximum / minimum',
    learningObjective: 'A single linear scan keeps a running best value; it costs n-1 comparisons and no extra space.',
    canonicalAlgorithm:
      'Keep best = a[0]. For i from 1 to n-1, compare a[i] with best and update best when greater. best is the answer.',
    allowedMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'two-sum',
    allowedMechanics: ['selectObject', 'assignValue', 'comparePair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],

    topic: 'arrays',
    title: 'Two Sum',
    learningObjective: 'For each element compute the complement; a hash lookup turns a nested O(n^2) scan into one pass.',
    canonicalAlgorithm:
      'For i from 0 to n-1 compute need = target - a[i]. If need is already in the seen set, the answer is (indexOf(need), i). Otherwise insert a[i] into the set.',
    allowedMechanics: ['selectObject', 'assignValue', 'comparePair', 'submitAnswer'],
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [1, 40] },
    complexity: { time: 'O(n)', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'move-zeroes',
    allowedMechanics: ['moveObject', 'swapPair', 'selectObject', 'comparePair', 'assignValue'],
    requiredMechanics: ['selectObject', 'comparePair', 'moveObject', 'swapPair'],

    topic: 'arrays',
    title: 'Move zeroes to the end',
    learningObjective: 'A write pointer plus a read pointer relocates non-zero values in one pass, in O(1) extra space.',
    canonicalAlgorithm:
      'Keep write = 0. For read from 0 to n-1, if a[read] != 0 swap a[write] with a[read] (or assign) and increment write. Fill the tail with zeroes.',
    allowedMechanics: ['moveObject', 'swapPair', 'selectObject', 'comparePair', 'assignValue'],
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'bubble-sort',
    allowedMechanics: ['comparePair', 'swapPair', 'selectObject', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'swapPair', 'submitAnswer'],

    topic: 'sorting',
    title: 'Bubble Sort',
    learningObjective: 'Repeatedly compare adjacent pairs and swap inversions; the largest value bubbles to the end each pass.',
    canonicalAlgorithm:
      'For pass from 0 to n-2, for j from 0 to n-2-pass compare a[j] with a[j+1] and swap when a[j] > a[j+1].',
    allowedMechanics: ['comparePair', 'swapPair', 'selectObject', 'submitAnswer'],
    instanceHints: { minLength: 5, maxLength: 8, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n^2)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'selection-sort',
    allowedMechanics: ['selectObject', 'comparePair', 'swapPair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'swapPair', 'submitAnswer'],

    topic: 'sorting',
    title: 'Selection Sort',
    learningObjective: 'Scan the unsorted suffix for the minimum, then swap it into place; exactly n-1 swaps regardless of input.',
    canonicalAlgorithm:
      'For i from 0 to n-2, set min = i. For j from i+1 to n-1, if a[j] < a[min] set min = j. Swap a[i] with a[min].',
    allowedMechanics: ['selectObject', 'comparePair', 'swapPair', 'submitAnswer'],
    instanceHints: { minLength: 5, maxLength: 8, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n^2)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'valid-parentheses',
    allowedMechanics: ['pushPop', 'comparePair', 'submitAnswer'],
    requiredMechanics: ['pushPop', 'comparePair', 'submitAnswer'],

    topic: 'stack',
    title: 'Valid Parentheses',
    learningObjective: 'Pushing every opener and popping on each closer makes mismatches obvious at the top of the stack.',
    canonicalAlgorithm:
      'For each token: if it is an opener, push it. If it is a closer, pop and verify the popped opener is its match. At the end the stack must be empty.',
    allowedMechanics: ['pushPop', 'comparePair', 'submitAnswer'],
    instanceHints: { minLength: 6, maxLength: 10, tokenAlphabet: ['(', ')', '[', ']', '{', '}'] },
    complexity: { time: 'O(n)', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'stack-push-pop',
    allowedMechanics: ['pushPop', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['pushPop', 'assignValue', 'submitAnswer'],

    topic: 'stack',
    title: 'Stack push / pop simulation',
    learningObjective: 'A stack is LIFO: push adds to the top, pop removes from the top, and underflow is the only failure mode.',
    canonicalAlgorithm:
      'push(x): if size == capacity report full, else place x at top and increment top. pop(): if top < 0 report empty, else return the value at top and decrement top.',
    allowedMechanics: ['pushPop', 'assignValue', 'submitAnswer'],
    instanceHints: { minLength: 5, maxLength: 8, valueRange: [1, 99] },
    complexity: { time: 'O(1) per op', space: 'O(n)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'queue-operations',
    requiredMechanics: ['pushPop', 'assignValue', 'submitAnswer'],

    topic: 'queue',
    title: 'Basic queue operations',
    learningObjective: 'A queue is FIFO: enqueue at the rear, dequeue from the front, and front/rear wrap around in a circular buffer.',
    canonicalAlgorithm:
      'enqueue(x): if full report full, else place at rear and advance rear. dequeue(): if empty report empty, else return front and advance front.',
    allowedMechanics: ['pushPop', 'assignValue', 'submitAnswer'],
    instanceHints: { minLength: 5, maxLength: 8, valueRange: [1, 99] },
    complexity: { time: 'O(1) per op', space: 'O(n)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'linked-list-traversal',
    requiredMechanics: ['traverseNode', 'selectObject', 'submitAnswer'],

    topic: 'linked-list',
    title: 'Linked list traversal',
    learningObjective: 'There is no indexing: reaching position k means following k next pointers from the head.',
    canonicalAlgorithm:
      'current = head. For each step, read current.value, then current = current.next. Stop when current is null.',
    allowedMechanics: ['traverseNode', 'selectObject', 'assignValue', 'submitAnswer'],
    instanceHints: { minLength: 4, maxLength: 7, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'reverse-linked-list',
    requiredMechanics: ['traverseNode', 'connectNodes', 'selectObject', 'submitAnswer'],

    topic: 'linked-list',
    title: 'Reverse a linked list',
    learningObjective: 'Swapping prev and next while advancing rewires the list in one pass, then the new head is the old tail.',
    canonicalAlgorithm:
      'prev = null, current = head. While current is not null: next = current.next; current.next = prev; prev = current; current = next. The new head is prev.',
    allowedMechanics: ['traverseNode', 'connectNodes', 'selectObject', 'submitAnswer'],
    instanceHints: { minLength: 4, maxLength: 6, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'hard',
  },
] as const

export const PROBLEM_IDS = PROBLEMS.map((p) => p.id)

export function getProblem(id: string): ProblemMeta | undefined {
  return PROBLEMS.find((p) => p.id === id)
}

export function problemsByTopic(topic: DsaTopic): ProblemMeta[] {
  return PROBLEMS.filter((p) => p.topic === topic)
}
