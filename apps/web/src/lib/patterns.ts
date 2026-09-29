/**
 * The 20-pattern library (Phase 5 UX layer).
 *
 * Mirrors the structure of the awesome-leetcode-resources "20 DSA Patterns"
 * guide (blog.algomaster.io/p/20-dsa-patterns): when to use it, a reusable
 * template, and practice problems — plus the one thing that guide cannot do:
 * a `playIds` mapping into THIS app's oracle catalogue, so every pattern with
 * a playable game links straight to `/problem/<id>`.
 *
 * Sourcing honesty: LeetCode references are name + number text (searchable,
 * never fabricated URLs). `deepDive` links are verbatim URLs from the
 * awesome-leetcode-resources README. Templates are original short sketches in
 * the same spirit as that guide's, not copies of it.
 */

export interface PatternPracticeRef {
  /** LeetCode problem number, e.g. 206. */
  n: number
  name: string
}

export interface DsaPattern {
  id: string
  name: string
  whenToUse: string
  template: string
  leetcode: readonly PatternPracticeRef[]
  /** Oracle ids in this app that train this pattern (possibly empty). */
  playIds: readonly string[]
  /** Verbatim deep-dive URL from the awesome-leetcode-resources README. */
  deepDive: string
}

export const DSA_PATTERNS: readonly DsaPattern[] = [
  {
    id: 'prefix-sum',
    name: 'Prefix Sum',
    whenToUse: 'Many sum queries over subarrays, finding subarrays with a target sum, or cumulative totals. If you recompute a range sum more than once, preprocess it.',
    template: `prefix[0] = 0
for i in 0..n-1: prefix[i+1] = prefix[i] + a[i]
sum(l, r) = prefix[r+1] - prefix[l]`,
    leetcode: [
      { n: 303, name: 'Range Sum Query - Immutable' },
      { n: 525, name: 'Contiguous Array' },
      { n: 560, name: 'Subarray Sum Equals K' },
      { n: 238, name: 'Product of Array Except Self' },
    ],
    playIds: ['prefix-sum-range'],
    deepDive: 'https://algomaster.io/learn/dsa/prefix-sum-introduction',
  },
  {
    id: 'two-pointers',
    name: 'Two Pointers',
    whenToUse: 'Pairs in a sorted array, comparing from both ends, partitioning, or palindrome checks. Converging pointers turn O(n²) pair search into one pass.',
    template: `L = 0, R = n-1
while L < R:
  s = a[L] + a[R]
  if s == target: done
  elif s < target: L += 1
  else: R -= 1`,
    leetcode: [
      { n: 167, name: 'Two Sum II - Input Array is Sorted' },
      { n: 15, name: '3Sum' },
      { n: 11, name: 'Container With Most Water' },
      { n: 42, name: 'Trapping Rain Water' },
      { n: 125, name: 'Valid Palindrome' },
    ],
    playIds: ['two-pointers-pair', 'valid-palindrome'],
    deepDive: 'https://algomaster.io/learn/dsa/two-pointers-introduction',
  },
  {
    id: 'sliding-window',
    name: 'Sliding Window',
    whenToUse: 'Contiguous subarray/substring problems, best window of size k, or longest/shortest windows with a property. Slide instead of restarting.',
    template: `window = sum of first k
best = window
for s in 1..n-k:
  window += a[s+k-1] - a[s-1]
  best = max(best, window)`,
    leetcode: [
      { n: 643, name: 'Maximum Average Subarray I' },
      { n: 3, name: 'Longest Substring Without Repeating Characters' },
      { n: 76, name: 'Minimum Window Substring' },
      { n: 567, name: 'Permutation in String' },
      { n: 239, name: 'Sliding Window Maximum' },
    ],
    playIds: ['sliding-window-max-sum'],
    deepDive: 'https://algomaster.io/learn/dsa/sliding-window-introduction',
  },
  {
    id: 'fast-slow-pointers',
    name: 'Fast & Slow Pointers',
    whenToUse: 'Cycle detection, middle of a linked list, or start of a cycle. The fast pointer gains one node per round, so a meeting is inevitable on a loop.',
    template: `slow = fast = head
while fast and fast.next:
  slow = slow.next
  fast = fast.next.next
  if slow == fast: cycle found`,
    leetcode: [
      { n: 141, name: 'Linked List Cycle' },
      { n: 142, name: 'Linked List Cycle II' },
      { n: 202, name: 'Happy Number' },
      { n: 287, name: 'Find the Duplicate Number' },
      { n: 876, name: 'Middle of the Linked List' },
    ],
    playIds: ['linked-list-cycle'],
    deepDive: 'https://algomaster.io/learn/dsa/fast-slow-pointers-introduction',
  },
  {
    id: 'linked-list-reversal',
    name: 'Linked List In-place Reversal',
    whenToUse: 'Reversing a list or a section of it, k-group reversals, or list palindromes. Save next before rewiring — otherwise the rest is lost.',
    template: `prev = null, cur = head
while cur:
  nxt = cur.next
  cur.next = prev
  prev, cur = cur, nxt
return prev`,
    leetcode: [
      { n: 206, name: 'Reverse Linked List' },
      { n: 92, name: 'Reverse Linked List II' },
      { n: 24, name: 'Swap Nodes in Pairs' },
      { n: 25, name: 'Reverse Nodes in k-Group' },
      { n: 234, name: 'Palindrome Linked List' },
    ],
    playIds: ['reverse-linked-list'],
    deepDive: 'https://algomaster.io/learn/dsa/linked-list-in-place-reversal-introduction',
  },
  {
    id: 'frequency-counting',
    name: 'Frequency Counting',
    whenToUse: 'Duplicates, anagrams, top-k frequent, or anything asked about occurrences. A hash map trades one pass of space for dropping a nested loop.',
    template: `count = {}
for v in a: count[v] += 1
answer = key with max count`,
    leetcode: [
      { n: 242, name: 'Valid Anagram' },
      { n: 49, name: 'Group Anagrams' },
      { n: 347, name: 'Top K Frequent Elements' },
      { n: 387, name: 'First Unique Character in a String' },
    ],
    playIds: ['frequency-count', 'valid-anagram'],
    deepDive: 'https://algomaster.io/learn/dsa/hash-tables-introduction',
  },
  {
    id: 'monotonic-stack',
    name: 'Monotonic Stack',
    whenToUse: 'Next/previous greater or smaller element, daily temperatures, stock spans, histograms. Keep the stack ordered; each arrival resolves everyone it beats.',
    template: `stack = []  # decreasing values
for i, v in enumerate(a):
  while stack and a[stack.top] < v:
    ans[stack.pop()] = v
  stack.push(i)`,
    leetcode: [
      { n: 496, name: 'Next Greater Element I' },
      { n: 739, name: 'Daily Temperatures' },
      { n: 84, name: 'Largest Rectangle in Histogram' },
      { n: 42, name: 'Trapping Rain Water' },
      { n: 901, name: 'Online Stock Span' },
    ],
    playIds: ['next-greater-element'],
    deepDive: 'https://algomaster.io/learn/dsa/monotonic-stack-introduction',
  },
  {
    id: 'bit-manipulation',
    name: 'Bit Manipulation',
    whenToUse: 'A lone unpaired value, counting set bits, powers of two, or subset masks. XOR cancels pairs: x ^ x is 0, so a full fold leaves the survivor.',
    template: `acc = 0
for v in a: acc ^= v
return acc  # pairs cancelled`,
    leetcode: [
      { n: 136, name: 'Single Number' },
      { n: 191, name: 'Number of 1 Bits' },
      { n: 338, name: 'Counting Bits' },
      { n: 231, name: 'Power of Two' },
      { n: 268, name: 'Missing Number' },
    ],
    playIds: ['single-number'],
    deepDive: 'https://algomaster.io/learn/dsa/bit-manipulation-introduction',
  },
  {
    id: 'top-k-elements',
    name: "Top 'K' Elements",
    whenToUse: 'K largest/smallest, kth order statistics, or k most frequent. A heap of size k remembers exactly the winners and forgets the rest.',
    template: `heap = first k values, heapified
for v in rest:
  if v > heap.min:
    replace root, sift down
return heap.min  # kth largest`,
    leetcode: [
      { n: 215, name: 'Kth Largest Element in an Array' },
      { n: 347, name: 'Top K Frequent Elements' },
      { n: 973, name: 'K Closest Points to Origin' },
      { n: 373, name: 'Find K Pairs with Smallest Sums' },
      { n: 703, name: 'Kth Largest Element in a Stream' },
    ],
    playIds: ['kth-largest-heap', 'frequency-count'],
    deepDive: 'https://algomaster.io/learn/dsa/top-k-elements-introduction',
  },
  {
    id: 'overlapping-intervals',
    name: 'Overlapping Intervals',
    whenToUse: 'Merging, meeting rooms, or interval insertion. Sort by start and overlap becomes one test: next start at or before the running end.',
    template: `sort by start
cur = intervals[0]
for nxt in rest:
  if nxt.start <= cur.end: cur.end = max(cur.end, nxt.end)
  else: emit cur; cur = nxt`,
    leetcode: [
      { n: 56, name: 'Merge Intervals' },
      { n: 57, name: 'Insert Interval' },
      { n: 435, name: 'Non-overlapping Intervals' },
      { n: 252, name: 'Meeting Rooms' },
      { n: 253, name: 'Meeting Rooms II' },
    ],
    playIds: ['merge-intervals'],
    deepDive: 'https://algomaster.io/learn/dsa/intervals-introduction',
  },
  {
    id: 'modified-binary-search',
    name: 'Modified Binary Search',
    whenToUse: 'Rotated arrays, first/last occurrence, peaks, or searching a condition rather than a value. One half is always sorted — find it, test membership, discard the rest.',
    template: `lo, hi = 0, n-1
while lo <= hi:
  mid = (lo+hi)//2
  if a[mid] == target: done
  if left half sorted and target inside: hi = mid-1
  else if right half holds it: lo = mid+1
  else: search the other half`,
    leetcode: [
      { n: 33, name: 'Search in Rotated Sorted Array' },
      { n: 153, name: 'Find Minimum in Rotated Sorted Array' },
      { n: 74, name: 'Search a 2D Matrix' },
      { n: 162, name: 'Find Peak Element' },
      { n: 278, name: 'First Bad Version' },
    ],
    playIds: ['binary-search', 'rotated-search', 'bst-search'],
    deepDive: 'https://algomaster.io/learn/dsa/binary-search-introduction',
  },
  {
    id: 'binary-tree-traversal',
    name: 'Binary Tree Traversal',
    whenToUse: 'Visiting every node in a fixed order, BST checks (inorder is sorted), or serialization. Pre/in/post differ only in when the node itself is visited.',
    template: `walk(node):
  if null: return
  [pre: visit] walk(left)
  [in: visit] walk(right)
  [post: visit]`,
    leetcode: [
      { n: 94, name: 'Binary Tree Inorder Traversal' },
      { n: 144, name: 'Binary Tree Preorder Traversal' },
      { n: 145, name: 'Binary Tree Postorder Traversal' },
      { n: 230, name: 'Kth Smallest Element in a BST' },
      { n: 98, name: 'Validate Binary Search Tree' },
    ],
    playIds: ['tree-traversals', 'bst-validate'],
    deepDive: 'https://algomaster.io/learn/dsa/binary-tree-introduction',
  },
  {
    id: 'dfs',
    name: 'Depth-First Search',
    whenToUse: 'Exploring every path, connected components, cycle checks, or topological order. Go deep with a stack (or recursion) before backtracking.',
    template: `dfs(node):
  mark visited
  for nb in neighbours(node):
    if unvisited: dfs(nb)`,
    leetcode: [
      { n: 112, name: 'Path Sum' },
      { n: 113, name: 'Path Sum II' },
      { n: 133, name: 'Clone Graph' },
      { n: 210, name: 'Course Schedule II' },
      { n: 200, name: 'Number of Islands' },
    ],
    playIds: ['num-islands', 'max-area-island', 'word-search'],
    deepDive: 'https://algomaster.io/learn/dsa/dfs-introduction',
  },
  {
    id: 'bfs',
    name: 'Breadth-First Search',
    whenToUse: 'Shortest path on unweighted graphs, level order, or anything spreading wave by wave. A FIFO queue guarantees the first visit is the shortest.',
    template: `queue = [start]  # minute 0
while queue:
  node = dequeue
  for nb in neighbours(node):
    if unvisited: mark, enqueue`,
    leetcode: [
      { n: 102, name: 'Binary Tree Level Order Traversal' },
      { n: 994, name: 'Rotting Oranges' },
      { n: 127, name: 'Word Ladder' },
      { n: 111, name: 'Minimum Depth of Binary Tree' },
      { n: 286, name: 'Walls and Gates' },
    ],
    playIds: ['tree-level-order', 'rotting-oranges'],
    deepDive: 'https://algomaster.io/learn/dsa/bfs-introduction',
  },
  {
    id: 'shortest-path',
    name: 'Shortest Path (Dijkstra)',
    whenToUse: 'Minimum cost or distance on weighted graphs with non-negative weights. Always settle the closest unsettled node; its distance is final.',
    template: `dist[source] = 0, pq = [(0, source)]
while pq:
  d, node = popMin
  if d > dist[node]: skip
  for nb, w in edges(node):
    relax dist[nb] via d + w`,
    leetcode: [
      { n: 743, name: 'Network Delay Time' },
      { n: 787, name: 'Cheapest Flights Within K Stops' },
      { n: 1514, name: 'Path with Maximum Probability' },
      { n: 778, name: 'Swim in Rising Water' },
      { n: 1631, name: 'Path with Minimum Effort' },
    ],
    playIds: ['rotting-oranges'],
    deepDive: 'https://algomaster.io/learn/dsa/dijkstras-algorithm',
  },
  {
    id: 'matrix-traversal',
    name: 'Matrix Traversal',
    whenToUse: 'Grid islands, regions, flood fill, or mazes. Treat 4-neighbours as graph edges with boundary checks; DFS and BFS both apply.',
    template: `DIRS = [up, right, down, left]
walk(r, c):
  if outside or water or seen: return
  mark seen
  for d in DIRS: walk(r+dr, c+dc)`,
    leetcode: [
      { n: 200, name: 'Number of Islands' },
      { n: 733, name: 'Flood Fill' },
      { n: 130, name: 'Surrounded Regions' },
      { n: 695, name: 'Max Area of Island' },
      { n: 417, name: 'Pacific Atlantic Water Flow' },
    ],
    playIds: ['num-islands', 'max-area-island', 'rotting-oranges', 'word-search'],
    deepDive: 'https://algomaster.io/learn/dsa/graphs-introduction',
  },
  {
    id: 'backtracking',
    name: 'Backtracking',
    whenToUse: 'Enumerating subsets, permutations, or constraint layouts (N-Queens, Sudoku). Choose, recurse, then unchoose — the undo is the pattern.',
    template: `dfs(state):
  if complete: emit; return
  for choice in options(state):
    apply choice; dfs(state)
    undo choice  # backtrack`,
    leetcode: [
      { n: 78, name: 'Subsets' },
      { n: 46, name: 'Permutations' },
      { n: 39, name: 'Combination Sum' },
      { n: 51, name: 'N-Queens' },
      { n: 79, name: 'Word Search' },
    ],
    playIds: ['subsets', 'permutations', 'word-search'],
    deepDive: 'https://algomaster.io/learn/dsa/backtracking-introduction',
  },
  {
    id: 'trie',
    name: 'Trie (Prefix Tree)',
    whenToUse: 'Autocomplete, spell checking, or word games over a dictionary. Shared prefixes share nodes, so a query walk either lands on all completions or falls off.',
    template: `node = root
for ch in query:
  node = node.children[ch]
  if missing: no completions
return word-ends under node`,
    leetcode: [
      { n: 208, name: 'Implement Trie (Prefix Tree)' },
      { n: 212, name: 'Word Search II' },
      { n: 211, name: 'Design Add and Search Words Data Structure' },
      { n: 648, name: 'Replace Words' },
      { n: 720, name: 'Longest Word in Dictionary' },
    ],
    playIds: ['trie-prefix-search'],
    deepDive: 'https://algomaster.io/learn/dsa/tries-introduction',
  },
  {
    id: 'greedy',
    name: 'Greedy',
    whenToUse: 'Optimization where a local choice is provably safe: interval scheduling, jump reach, or activity selection. Keep one running number and never look back.',
    template: `reach = 0
for i, jump in enumerate(a):
  if i > reach: stuck
  reach = max(reach, i + jump)
return reached the end`,
    leetcode: [
      { n: 55, name: 'Jump Game' },
      { n: 45, name: 'Jump Game II' },
      { n: 134, name: 'Gas Station' },
      { n: 621, name: 'Task Scheduler' },
      { n: 763, name: 'Partition Labels' },
    ],
    playIds: ['jump-game'],
    deepDive: 'https://algomaster.io/learn/dsa/greedy-introduction',
  },
  {
    id: 'dynamic-programming',
    name: 'Dynamic Programming',
    whenToUse: 'Overlapping subproblems with optimal substructure: optimization, counting ways, or decision questions. Solve small, reuse, never recompute.',
    template: `dp[0..1] = base cases
for i in 2..n:
  dp[i] = combine(dp[i-1], dp[i-2], a[i])
return dp[n]`,
    leetcode: [
      { n: 70, name: 'Climbing Stairs' },
      { n: 198, name: 'House Robber' },
      { n: 322, name: 'Coin Change' },
      { n: 1143, name: 'Longest Common Subsequence' },
      { n: 300, name: 'Longest Increasing Subsequence' },
      { n: 416, name: 'Partition Equal Subset Sum' },
      { n: 72, name: 'Edit Distance' },
    ],
    playIds: ['climbing-stairs', 'house-robber', 'kadane-max-subarray'],
    deepDive: 'https://algomaster.io/learn/dsa/dp-introduction',
  },
] as const

export type DsaPatternEntry = (typeof DSA_PATTERNS)[number]

export function getPattern(id: string): DsaPatternEntry | undefined {
  return DSA_PATTERNS.find((p) => p.id === id)
}

/** Patterns that have at least one playable game in this app. */
export function playablePatterns(): DsaPatternEntry[] {
  return DSA_PATTERNS.filter((p) => p.playIds.length > 0)
}

/** The patterns that train a given oracle, for the problem page cross-link. */
export function patternsForProblem(problemId: string): DsaPatternEntry[] {
  return DSA_PATTERNS.filter((p) => (p.playIds as readonly string[]).includes(problemId))
}
