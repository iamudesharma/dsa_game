/**
 * The problem registry: twenty-two problems across eight topics.
 *
 * Scope follows the awesome-leetcode-resources fundamentals list: the original
 * six topics (3 arrays, 2 sorting, 2 stack, 1 queue, 1 binary search,
 * 2 linked list) plus the highest-yield gaps — array patterns (sliding window,
 * two pointers, prefix sum, Kadane, intervals), monotonic stack, rotated
 * binary search, linked-list cycle detection, hash-table frequency counting,
 * anagrams, and palindrome checking.
 *
 * `instanceHints` tells the instance generator how to build valid data
 * (e.g. "sorted, unique, target present") and `allowedMechanics` is the
 * hard constraint the LLM must respect.
 */

import type { MechanicId } from './mechanics.js'

export type DsaTopic =
  | 'arrays'
  | 'sorting'
  | 'stack'
  | 'queue'
  | 'binary-search'
  | 'linked-list'
  | 'hash-table'
  | 'strings'

export const DSA_TOPICS: readonly DsaTopic[] = [
  'arrays',
  'sorting',
  'stack',
  'queue',
  'binary-search',
  'linked-list',
  'hash-table',
  'strings',
] as const

export const TOPIC_LABELS: Readonly<Record<DsaTopic, string>> = {
  arrays: 'Arrays',
  sorting: 'Sorting',
  stack: 'Stack',
  queue: 'Queue',
  'binary-search': 'Binary Search',
  'linked-list': 'Linked List',
  'hash-table': 'Hash Table',
  strings: 'Strings',
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
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'two-sum',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'arrays',
    title: 'Two Sum',
    learningObjective: 'For each element compute the complement; a hash lookup turns a nested O(n^2) scan into one pass.',
    canonicalAlgorithm:
      'For i from 0 to n-1 compute need = target - a[i]. If need is already in the seen set, the answer is (indexOf(need), i). Otherwise insert a[i] into the set.',
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [1, 40] },
    complexity: { time: 'O(n)', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'move-zeroes',
    allowedMechanics: ['selectObject', 'comparePair', 'swapPair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'swapPair', 'submitAnswer'],

    topic: 'arrays',
    title: 'Move zeroes to the end',
    learningObjective: 'A write pointer plus a read pointer relocates non-zero values in one pass, in O(1) extra space.',
    canonicalAlgorithm:
      'Keep write = 0. For read from 0 to n-1, if a[read] != 0 swap a[write] with a[read] (or assign) and increment write. Fill the tail with zeroes.',
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
    instanceHints: { minLength: 5, maxLength: 8, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n^2)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'valid-parentheses',
    allowedMechanics: ['selectObject', 'pushPop', 'comparePair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'pushPop', 'comparePair', 'submitAnswer'],

    topic: 'stack',
    title: 'Valid Parentheses',
    learningObjective: 'Pushing every opener and popping on each closer makes mismatches obvious at the top of the stack.',
    canonicalAlgorithm:
      'For each token: if it is an opener, push it. If it is a closer, pop and verify the popped opener is its match. At the end the stack must be empty.',
    instanceHints: { minLength: 6, maxLength: 10, tokenAlphabet: ['(', ')', '[', ']', '{', '}'] },
    complexity: { time: 'O(n)', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'stack-push-pop',
    allowedMechanics: ['selectObject', 'pushPop', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'pushPop', 'submitAnswer'],

    topic: 'stack',
    title: 'Stack push / pop simulation',
    learningObjective: 'A stack is LIFO: push adds to the top, pop removes from the top, and underflow is the only failure mode.',
    canonicalAlgorithm:
      'push(x): if size == capacity report full, else place x at top and increment top. pop(): if top < 0 report empty, else return the value at top and decrement top.',
    instanceHints: { minLength: 5, maxLength: 8, valueRange: [1, 99] },
    complexity: { time: 'O(1) per op', space: 'O(n)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'queue-operations',
    allowedMechanics: ['selectObject', 'pushPop', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'pushPop', 'submitAnswer'],

    topic: 'queue',
    title: 'Basic queue operations',
    learningObjective: 'A queue is FIFO: enqueue at the rear, dequeue from the front, and front/rear wrap around in a circular buffer.',
    canonicalAlgorithm:
      'enqueue(x): if full report full, else place at rear and advance rear. dequeue(): if empty report empty, else return front and advance front.',
    instanceHints: { minLength: 5, maxLength: 8, valueRange: [1, 99] },
    complexity: { time: 'O(1) per op', space: 'O(n)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'linked-list-traversal',
    allowedMechanics: ['traverseNode', 'submitAnswer'],
    requiredMechanics: ['traverseNode', 'submitAnswer'],

    topic: 'linked-list',
    title: 'Linked list traversal',
    learningObjective: 'There is no indexing: reaching position k means following k next pointers from the head.',
    canonicalAlgorithm:
      'current = head. For each step, read current.value, then current = current.next. Stop when current is null.',
    instanceHints: { minLength: 4, maxLength: 7, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'reverse-linked-list',
    allowedMechanics: ['connectNodes', 'submitAnswer'],
    requiredMechanics: ['connectNodes', 'submitAnswer'],

    topic: 'linked-list',
    title: 'Reverse a linked list',
    learningObjective: 'Swapping prev and next while advancing rewires the list in one pass, then the new head is the old tail.',
    canonicalAlgorithm:
      'prev = null, current = head. While current is not null: next = current.next; current.next = prev; prev = current; current = next. The new head is prev.',
    instanceHints: { minLength: 4, maxLength: 6, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'hard',
  },
  {
    id: 'sliding-window-max-sum',
    allowedMechanics: ['selectObject', 'assignValue', 'comparePair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'arrays',
    title: 'Maximum sum of any window of size k',
    learningObjective:
      'A fixed-size sliding window reuses the previous sum instead of recomputing it: add the entrant, drop the leaver, track the best.',
    canonicalAlgorithm:
      'Sum the first k values. Then slide: add a[read], subtract a[read-k], and keep the largest window sum seen. The best is the answer.',
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [1, 20] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'two-pointers-pair',
    allowedMechanics: ['selectObject', 'comparePair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'submitAnswer'],

    topic: 'arrays',
    title: 'Two Sum in a sorted array',
    learningObjective:
      'Two pointers converge from opposite ends: the pair sum tells you which pointer to move, so each step discards one index.',
    canonicalAlgorithm:
      'Set left=0, right=n-1. While left<right compare a[left]+a[right] with target: equal stops, smaller moves left right, larger moves right left.',
    instanceHints: { minLength: 6, maxLength: 10, unique: true, sorted: true, targetGuaranteed: true, valueRange: [1, 40] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'prefix-sum-range',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'arrays',
    title: 'Range sum with a prefix array',
    learningObjective:
      'One preprocessing pass stores every prefix total, so any range sum is a single subtraction: prefix[r+1] - prefix[l].',
    canonicalAlgorithm:
      'Build prefix[0]=0, prefix[i+1]=prefix[i]+a[i]. Answer each query [l,r] as prefix[r+1]-prefix[l].',
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [1, 20] },
    complexity: { time: 'O(n) build, O(1) query', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'kadane-max-subarray',
    allowedMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'submitAnswer'],

    topic: 'arrays',
    title: "Kadane's maximum subarray",
    learningObjective:
      'At each value decide extend-or-restart: carry the running sum forward only while it stays positive, and remember the best seen.',
    canonicalAlgorithm:
      'Keep current=a[0], best=a[0]. For each next value set current=max(value, current+value) and best=max(best, current). best is the answer.',
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [-9, 20] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'merge-intervals',
    allowedMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'submitAnswer'],

    topic: 'arrays',
    title: 'Merge overlapping intervals',
    learningObjective:
      'Sorted by start, overlap is one test: the next start is at or before the running end, so extend the end or emit the interval.',
    canonicalAlgorithm:
      'Sort by start. Walk the intervals keeping cur=[s,e]: if next.s<=cur.e set cur.e=max(cur.e,next.e), else emit cur and start next.',
    instanceHints: { minLength: 4, maxLength: 7, valueRange: [1, 20] },
    complexity: { time: 'O(n log n)', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'next-greater-element',
    allowedMechanics: ['selectObject', 'comparePair', 'pushPop', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'pushPop', 'submitAnswer'],

    topic: 'stack',
    title: 'Next greater element (monotonic stack)',
    learningObjective:
      'A decreasing stack resolves each element the moment a larger value arrives: pop everything smaller, then push the current value.',
    canonicalAlgorithm:
      'Walk left to right with a decreasing stack of indices. While the stack top holds a smaller value, pop it and record the current value as its answer. Push the current index.',
    instanceHints: { minLength: 5, maxLength: 8, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'rotated-search',
    allowedMechanics: ['selectObject', 'comparePair', 'choosePath', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'choosePath', 'submitAnswer'],

    topic: 'binary-search',
    title: 'Search in a rotated sorted array',
    learningObjective:
      'One half of a rotated array is always sorted: find which half, test whether the target lies inside it, and discard the other half.',
    canonicalAlgorithm:
      'With lo/hi, read mid. If a[mid]==target stop. If the left half is sorted and the target lies in it, search left; if the right half is sorted and holds the target, search right; otherwise search the other half.',
    instanceHints: { minLength: 7, maxLength: 11, unique: true, targetGuaranteed: true, valueRange: [1, 99] },
    complexity: { time: 'O(log n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'linked-list-cycle',
    allowedMechanics: ['selectObject', 'traverseNode', 'submitAnswer'],
    requiredMechanics: ['traverseNode', 'submitAnswer'],

    topic: 'linked-list',
    title: 'Detect a cycle (tortoise and hare)',
    learningObjective:
      'A fast pointer gains one node per round on a slow pointer, so on a cycle they must eventually meet; on a plain list the fast pointer runs off the end.',
    canonicalAlgorithm:
      'Advance slow by one and fast by two each round. If they land on the same node there is a cycle. If fast reaches null there is none.',
    instanceHints: { minLength: 4, maxLength: 7, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'frequency-count',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'hash-table',
    title: 'Most frequent value (frequency map)',
    learningObjective:
      'Counting with a hash map trades space for time: one pass records every frequency, and the largest count is the answer.',
    canonicalAlgorithm:
      'Walk the array incrementing count[value] for each value. Then scan the map and return the value with the largest count.',
    instanceHints: { minLength: 6, maxLength: 10, valueRange: [1, 9] },
    complexity: { time: 'O(n)', space: 'O(n)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'valid-anagram',
    allowedMechanics: ['selectObject', 'assignValue', 'comparePair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'hash-table',
    title: 'Valid anagram by counting letters',
    learningObjective:
      'Two strings are anagrams exactly when every letter count matches: add one string, subtract the other, and require all zeroes.',
    canonicalAlgorithm:
      'Count each letter of s, then subtract each letter of t. If every count returns to zero the strings are anagrams.',
    instanceHints: { minLength: 4, maxLength: 8, tokenAlphabet: ['a', 'b', 'c', 'd', 'e'] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'valid-palindrome',
    allowedMechanics: ['selectObject', 'comparePair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'submitAnswer'],

    topic: 'strings',
    title: 'Valid palindrome (two pointers)',
    learningObjective:
      'Symmetry is checked from the outside in: compare the outermost unmatched pair, and any mismatch decides the answer.',
    canonicalAlgorithm:
      'Set left=0, right=n-1. While left<right compare s[left] with s[right]: on mismatch return false, else move both inward. Equal all the way means palindrome.',
    instanceHints: { minLength: 4, maxLength: 8, tokenAlphabet: ['a', 'b', 'c', 'd', 'e'] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
] as const

export const PROBLEM_IDS = PROBLEMS.map((p) => p.id)

export function getProblem(id: string): ProblemMeta | undefined {
  return PROBLEMS.find((p) => p.id === id)
}

export function problemsByTopic(topic: DsaTopic): ProblemMeta[] {
  return PROBLEMS.filter((p) => p.topic === topic)
}
