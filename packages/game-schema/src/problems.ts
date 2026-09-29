/**
 * The problem registry: twenty-two problems across eight topics.
 *
 * Scope follows the awesome-leetcode-resources fundamentals list: the original
 * six topics (3 arrays, 2 sorting, 2 stack, 1 queue, 1 binary search,
 * 2 linked list) plus the highest-yield gaps — array patterns (sliding window,
 * two pointers, prefix sum, Kadane, intervals), monotonic stack, rotated
 * binary search, linked-list cycle detection, hash-table frequency counting,
 * anagrams, palindrome checking, binary trees (traversals, BST validation,
 * level order, BST search), heaps (kth largest via a size-k min-heap), and
 * graphs (islands, max area, rotting oranges, word search, union-find) — the
 * grid games render through a columns-aware slots lane on both clients —
 * plus dynamic programming (climbing stairs, house robber), backtracking
 * (subsets, permutations), greedy (jump game), bit manipulation (single
 * number), and tries (prefix search on a static trie).
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
  | 'trees'
  | 'heap'
  | 'graphs'
  | 'dp'
  | 'backtracking'
  | 'greedy'
  | 'bit-manip'
  | 'trie'

export const DSA_TOPICS: readonly DsaTopic[] = [
  'arrays',
  'sorting',
  'stack',
  'queue',
  'binary-search',
  'linked-list',
  'hash-table',
  'strings',
  'trees',
  'heap',
  'graphs',
  'dp',
  'backtracking',
  'greedy',
  'bit-manip',
  'trie',
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
  trees: 'Trees',
  heap: 'Heap',
  graphs: 'Graphs',
  dp: 'Dynamic Programming',
  backtracking: 'Backtracking',
  greedy: 'Greedy',
  'bit-manip': 'Bit Manipulation',
  trie: 'Trie',
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
  {
    id: 'tree-traversals',
    allowedMechanics: ['selectObject', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'submitAnswer'],

    topic: 'trees',
    title: 'Binary tree traversals (pre/in/post-order)',
    learningObjective:
      'Preorder, inorder, and postorder differ only in when the node itself is visited relative to its children — the routes are the same walk.',
    canonicalAlgorithm:
      'Walk the tree recursively: preorder visits node, left, right; inorder visits left, node, right; postorder visits left, right, node. Record each visit.',
    instanceHints: { minLength: 5, maxLength: 9, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(h)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'bst-validate',
    allowedMechanics: ['selectObject', 'comparePair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'submitAnswer'],

    topic: 'trees',
    title: 'Validate a binary search tree',
    learningObjective:
      "A binary tree is a BST exactly when its inorder walk is sorted: one descending adjacent pair anywhere disproves the whole tree.",
    canonicalAlgorithm:
      'Walk the nodes inorder, comparing each value with the previous one. If any value is smaller than its predecessor the tree is not a BST; otherwise it is.',
    instanceHints: { minLength: 5, maxLength: 9, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(h)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'tree-level-order',
    allowedMechanics: ['selectObject', 'pushPop', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'pushPop', 'submitAnswer'],

    topic: 'trees',
    title: 'Level-order traversal with a queue',
    learningObjective:
      'Breadth-first order falls out of a FIFO queue: dequeue a node, visit it, enqueue its children, and levels emerge left to right.',
    canonicalAlgorithm:
      'Enqueue the root. While the queue is nonempty, dequeue the front, visit it, then enqueue its left child and right child when they exist.',
    instanceHints: { minLength: 5, maxLength: 9, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n)', space: 'O(w)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'bst-search',
    allowedMechanics: ['selectObject', 'comparePair', 'choosePath', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'choosePath', 'submitAnswer'],

    topic: 'trees',
    title: 'Search in a binary search tree',
    learningObjective:
      'The BST invariant decides the direction at every node: smaller goes left, larger goes right, and each step discards a whole subtree.',
    canonicalAlgorithm:
      'Start at the root. Compare the target with the node: equal stops, smaller descends to the left child, larger to the right child. Repeat until found.',
    instanceHints: { minLength: 5, maxLength: 9, unique: true, targetGuaranteed: true, valueRange: [1, 99] },
    complexity: { time: 'O(h)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'kth-largest-heap',
    allowedMechanics: ['selectObject', 'comparePair', 'swapPair', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'swapPair', 'submitAnswer'],

    topic: 'heap',
    title: 'Kth largest with a size-k min-heap',
    learningObjective:
      'A min-heap of size k holds exactly the k largest values seen: anything smaller than its minimum is irrelevant, anything larger replaces it.',
    canonicalAlgorithm:
      'Heapify the first k values into a min-heap. For each remaining value, if it exceeds the heap minimum, replace the root and sift down. The root is the kth largest.',
    instanceHints: { minLength: 6, maxLength: 9, unique: true, valueRange: [1, 99] },
    complexity: { time: 'O(n log k)', space: 'O(k)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'num-islands',
    allowedMechanics: ['selectObject', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'submitAnswer'],

    topic: 'graphs',
    title: 'Number of islands (grid DFS)',
    learningObjective:
      'One depth-first walk claims exactly one island: every reachable land cell belongs to it, so the next unvisited land starts a new one.',
    canonicalAlgorithm:
      'Scan row by row. On an unvisited land cell, flood through its land neighbours and count one island. Water and visited cells are skipped.',
    instanceHints: { minLength: 16, maxLength: 30, valueRange: [0, 1] },
    complexity: { time: 'O(rows × cols)', space: 'O(rows × cols)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'max-area-island',
    allowedMechanics: ['selectObject', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'submitAnswer'],

    topic: 'graphs',
    title: 'Max area of island',
    learningObjective:
      'Area is just the size of one flood: measure each island as you claim it and keep the largest.',
    canonicalAlgorithm:
      'Flood each island exactly as in counting, but record how many cells the flood covered. The largest cover is the answer.',
    instanceHints: { minLength: 16, maxLength: 30, valueRange: [0, 1] },
    complexity: { time: 'O(rows × cols)', space: 'O(rows × cols)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'rotting-oranges',
    allowedMechanics: ['selectObject', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'submitAnswer'],

    topic: 'graphs',
    title: 'Rotting oranges (multi-source BFS)',
    learningObjective:
      'Breadth-first search from every rotten orange at once measures minutes: each wave rots the neighbours, and unreachable fresh means impossible.',
    canonicalAlgorithm:
      'Queue all rotten cells at minute 0. Repeatedly rot their fresh neighbours at the next minute. The last minute with a rotting is the answer, or -1 when fresh cells remain.',
    instanceHints: { minLength: 16, maxLength: 25, valueRange: [0, 2] },
    complexity: { time: 'O(rows × cols)', space: 'O(rows × cols)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'word-search',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'graphs',
    title: 'Word search (backtracking on a grid)',
    learningObjective:
      'Backtracking is DFS with an undo: mark the cell, explore, and unmark when the path dies — so every attempt leaves the board as it found it.',
    canonicalAlgorithm:
      'Try every cell as a start. Walk letter by letter through unvisited neighbours, marking the path. On a dead end unmark and back up. Finding every letter in order means the word exists.',
    instanceHints: { minLength: 16, maxLength: 25, tokenAlphabet: ['a', 'b', 'c', 'd', 'e'] },
    complexity: { time: 'O(rows × cols × 4^L)', space: 'O(L)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'union-find-connect',
    allowedMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],

    topic: 'graphs',
    title: 'Connected components (union-find)',
    learningObjective:
      'Each set keeps one root: find climbs parent pointers to compare sets, and union attaches one root under the other, dropping the component count by one.',
    canonicalAlgorithm:
      'Start with every node its own parent. For each edge, find both roots by climbing. Different roots union (one fewer component); equal roots are already connected.',
    instanceHints: { minLength: 6, maxLength: 9, valueRange: [0, 8] },
    complexity: { time: 'O(n α(n))', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'climbing-stairs',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'dp',
    title: 'Climbing stairs (Fibonacci DP)',
    learningObjective:
      'The ways to reach step i reuse smaller answers: step 1 or 2 at a time means ways[i] is the sum of the two previous counts.',
    canonicalAlgorithm:
      'Set dp[0]=1, dp[1]=1. For each step i from 2 to n, record dp[i]=dp[i-1]+dp[i-2]. dp[n] is the answer.',
    instanceHints: { minLength: 6, maxLength: 11, valueRange: [0, 10] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'house-robber',
    allowedMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'comparePair', 'assignValue', 'submitAnswer'],

    topic: 'dp',
    title: 'House robber (take-or-skip DP)',
    learningObjective:
      'At each house decide take or skip: robbing it adds its money to the best from two doors down, skipping keeps the best so far.',
    canonicalAlgorithm:
      'Keep dp[-1]=0, dp[0]=money[0]. For each house i, take=money[i]+dp[i-2] and skip=dp[i-1]; record dp[i]=max(take, skip). The last dp is the answer.',
    instanceHints: { minLength: 5, maxLength: 8, valueRange: [1, 20] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'subsets',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'backtracking',
    title: 'Subsets (choose / unchoose)',
    learningObjective:
      'Every element is a fork: include it and enumerate the rest, then unmark it and enumerate without it — the undo is what makes it backtracking.',
    canonicalAlgorithm:
      'Walk positions in order. At each one, mark include and recurse, then unmark (exclude) and recurse. Each root-to-leaf path is one subset.',
    instanceHints: { minLength: 3, maxLength: 4, unique: true, valueRange: [1, 9] },
    complexity: { time: 'O(n × 2^n)', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'permutations',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'backtracking',
    title: 'Permutations (used-flag backtracking)',
    learningObjective:
      'Each open position tries every unused value: mark it used, fill the rest, then free it — freeing is what lets the next branch reuse the value.',
    canonicalAlgorithm:
      'At each open position, try every unused value in order: mark it used, recurse, then unmark it. Each full path is one permutation.',
    instanceHints: { minLength: 3, maxLength: 4, unique: true, valueRange: [1, 9] },
    complexity: { time: 'O(n × n!)', space: 'O(n)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'jump-game',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'greedy',
    title: 'Jump game (greedy reach)',
    learningObjective:
      'One running number decides everything: the farthest reachable index. A cell beyond it ends the run; otherwise it may extend it.',
    canonicalAlgorithm:
      'Track reach=0. For each index i in order, if i is beyond reach the end is unreachable; otherwise extend reach to max(reach, i+jumps[i]). Reaching the last index wins.',
    instanceHints: { minLength: 5, maxLength: 8, valueRange: [0, 4] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
  {
    id: 'single-number',
    allowedMechanics: ['selectObject', 'assignValue', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'assignValue', 'submitAnswer'],

    topic: 'bit-manip',
    title: 'Single number (XOR accumulation)',
    learningObjective:
      'XOR cancels pairs: a number XOR itself is zero, so folding the whole array leaves exactly the unpaired value.',
    canonicalAlgorithm:
      'Fold an accumulator starting at 0: acc = acc XOR value for each value. Pairs cancel to zero and the survivor is the single number.',
    instanceHints: { minLength: 5, maxLength: 9, valueRange: [1, 30] },
    complexity: { time: 'O(n)', space: 'O(1)' },
    defaultDifficulty: 'easy',
  },
  {
    id: 'trie-prefix-search',
    allowedMechanics: ['selectObject', 'traverseNode', 'submitAnswer'],
    requiredMechanics: ['selectObject', 'traverseNode', 'submitAnswer'],

    topic: 'trie',
    title: 'Prefix search on a trie',
    learningObjective:
      'Shared prefixes share nodes: walking the query letter by letter either falls off (no words) or lands where every completion hangs below.',
    canonicalAlgorithm:
      'Follow one link per query letter from the root. If a link is missing the prefix matches nothing; otherwise every word-end in the landed subtree is a completion.',
    instanceHints: { minLength: 4, maxLength: 8, tokenAlphabet: ['a', 'b', 'c', 'd', 'e'] },
    complexity: { time: 'O(L + C)', space: 'O(1)' },
    defaultDifficulty: 'medium',
  },
] as const

export const PROBLEM_IDS = PROBLEMS.map((p) => p.id)

export function getProblem(id: string): ProblemMeta | undefined {
  return PROBLEMS.find((p) => p.id === id)
}

export function problemsByTopic(topic: DsaTopic): ProblemMeta[] {
  return PROBLEMS.filter((p) => p.topic === topic)
}
