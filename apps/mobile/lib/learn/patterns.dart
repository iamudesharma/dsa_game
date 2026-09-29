/// The 20-pattern library, mirroring `apps/web/src/lib/patterns.ts`.
///
/// Same content contract: when to use it, a reusable template, LeetCode
/// practice references as number + name text (searchable, never fabricated
/// URLs), verbatim awesome-leetcode-resources deep-dives, and `playIds`
/// mapping into the oracle catalogue for the "play it" affordance.
library;

/// A LeetCode practice reference: number + name text, no URL.
class PracticeRef {
  const PracticeRef({required this.n, required this.name});

  final int n;
  final String name;
}

class DsaPattern {
  const DsaPattern({
    required this.id,
    required this.name,
    required this.whenToUse,
    required this.template,
    required this.leetcode,
    required this.playIds,
    required this.deepDive,
  });

  final String id;
  final String name;
  final String whenToUse;
  final String template;
  final List<PracticeRef> leetcode;
  final List<String> playIds;
  final String deepDive;
}

const List<DsaPattern> dsaPatterns = [
  DsaPattern(
    id: 'prefix-sum',
    name: 'Prefix Sum',
    whenToUse: 'Many sum queries over subarrays, finding subarrays with a target sum, or cumulative totals. If you recompute a range sum more than once, preprocess it.',
    template: 'prefix[0] = 0\nfor i in 0..n-1: prefix[i+1] = prefix[i] + a[i]\nsum(l, r) = prefix[r+1] - prefix[l]',
    leetcode: [
      PracticeRef(n: 303, name: 'Range Sum Query - Immutable'),
      PracticeRef(n: 525, name: 'Contiguous Array'),
      PracticeRef(n: 560, name: 'Subarray Sum Equals K'),
      PracticeRef(n: 238, name: 'Product of Array Except Self'),
    ],
    playIds: ['prefix-sum-range'],
    deepDive: 'https://algomaster.io/learn/dsa/prefix-sum-introduction',
  ),
  DsaPattern(
    id: 'two-pointers',
    name: 'Two Pointers',
    whenToUse: 'Pairs in a sorted array, comparing from both ends, partitioning, or palindrome checks. Converging pointers turn O(n²) pair search into one pass.',
    template: 'L = 0, R = n-1\nwhile L < R:\n  s = a[L] + a[R]\n  if s == target: done\n  elif s < target: L += 1\n  else: R -= 1',
    leetcode: [
      PracticeRef(n: 167, name: 'Two Sum II - Input Array is Sorted'),
      PracticeRef(n: 15, name: '3Sum'),
      PracticeRef(n: 11, name: 'Container With Most Water'),
      PracticeRef(n: 42, name: 'Trapping Rain Water'),
      PracticeRef(n: 125, name: 'Valid Palindrome'),
    ],
    playIds: ['two-pointers-pair', 'valid-palindrome'],
    deepDive: 'https://algomaster.io/learn/dsa/two-pointers-introduction',
  ),
  DsaPattern(
    id: 'sliding-window',
    name: 'Sliding Window',
    whenToUse: 'Contiguous subarray/substring problems, best window of size k, or longest/shortest windows with a property. Slide instead of restarting.',
    template: 'window = sum of first k\nbest = window\nfor s in 1..n-k:\n  window += a[s+k-1] - a[s-1]\n  best = max(best, window)',
    leetcode: [
      PracticeRef(n: 643, name: 'Maximum Average Subarray I'),
      PracticeRef(n: 3, name: 'Longest Substring Without Repeating Characters'),
      PracticeRef(n: 76, name: 'Minimum Window Substring'),
      PracticeRef(n: 567, name: 'Permutation in String'),
      PracticeRef(n: 239, name: 'Sliding Window Maximum'),
    ],
    playIds: ['sliding-window-max-sum'],
    deepDive: 'https://algomaster.io/learn/dsa/sliding-window-introduction',
  ),
  DsaPattern(
    id: 'fast-slow-pointers',
    name: 'Fast & Slow Pointers',
    whenToUse: 'Cycle detection, middle of a linked list, or start of a cycle. The fast pointer gains one node per round, so a meeting is inevitable on a loop.',
    template: 'slow = fast = head\nwhile fast and fast.next:\n  slow = slow.next\n  fast = fast.next.next\n  if slow == fast: cycle found',
    leetcode: [
      PracticeRef(n: 141, name: 'Linked List Cycle'),
      PracticeRef(n: 142, name: 'Linked List Cycle II'),
      PracticeRef(n: 202, name: 'Happy Number'),
      PracticeRef(n: 287, name: 'Find the Duplicate Number'),
      PracticeRef(n: 876, name: 'Middle of the Linked List'),
    ],
    playIds: ['linked-list-cycle'],
    deepDive: 'https://algomaster.io/learn/dsa/fast-slow-pointers-introduction',
  ),
  DsaPattern(
    id: 'linked-list-reversal',
    name: 'Linked List In-place Reversal',
    whenToUse: 'Reversing a list or a section of it, k-group reversals, or list palindromes. Save next before rewiring — otherwise the rest is lost.',
    template: 'prev = null, cur = head\nwhile cur:\n  nxt = cur.next\n  cur.next = prev\n  prev, cur = cur, nxt\nreturn prev',
    leetcode: [
      PracticeRef(n: 206, name: 'Reverse Linked List'),
      PracticeRef(n: 92, name: 'Reverse Linked List II'),
      PracticeRef(n: 24, name: 'Swap Nodes in Pairs'),
      PracticeRef(n: 25, name: 'Reverse Nodes in k-Group'),
      PracticeRef(n: 234, name: 'Palindrome Linked List'),
    ],
    playIds: ['reverse-linked-list'],
    deepDive: 'https://algomaster.io/learn/dsa/linked-list-in-place-reversal-introduction',
  ),
  DsaPattern(
    id: 'frequency-counting',
    name: 'Frequency Counting',
    whenToUse: 'Duplicates, anagrams, top-k frequent, or anything asked about occurrences. A hash map trades one pass of space for dropping a nested loop.',
    template: 'count = {}\nfor v in a: count[v] += 1\nanswer = key with max count',
    leetcode: [
      PracticeRef(n: 242, name: 'Valid Anagram'),
      PracticeRef(n: 49, name: 'Group Anagrams'),
      PracticeRef(n: 347, name: 'Top K Frequent Elements'),
      PracticeRef(n: 387, name: 'First Unique Character in a String'),
    ],
    playIds: ['frequency-count', 'valid-anagram'],
    deepDive: 'https://algomaster.io/learn/dsa/hash-tables-introduction',
  ),
  DsaPattern(
    id: 'monotonic-stack',
    name: 'Monotonic Stack',
    whenToUse: 'Next/previous greater or smaller element, daily temperatures, stock spans, histograms. Keep the stack ordered; each arrival resolves everyone it beats.',
    template: 'stack = []  # decreasing values\nfor i, v in enumerate(a):\n  while stack and a[stack.top] < v:\n    ans[stack.pop()] = v\n  stack.push(i)',
    leetcode: [
      PracticeRef(n: 496, name: 'Next Greater Element I'),
      PracticeRef(n: 739, name: 'Daily Temperatures'),
      PracticeRef(n: 84, name: 'Largest Rectangle in Histogram'),
      PracticeRef(n: 42, name: 'Trapping Rain Water'),
      PracticeRef(n: 901, name: 'Online Stock Span'),
    ],
    playIds: ['next-greater-element'],
    deepDive: 'https://algomaster.io/learn/dsa/monotonic-stack-introduction',
  ),
  DsaPattern(
    id: 'bit-manipulation',
    name: 'Bit Manipulation',
    whenToUse: 'A lone unpaired value, counting set bits, powers of two, or subset masks. XOR cancels pairs: x ^ x is 0, so a full fold leaves the survivor.',
    template: 'acc = 0\nfor v in a: acc ^= v\nreturn acc  # pairs cancelled',
    leetcode: [
      PracticeRef(n: 136, name: 'Single Number'),
      PracticeRef(n: 191, name: 'Number of 1 Bits'),
      PracticeRef(n: 338, name: 'Counting Bits'),
      PracticeRef(n: 231, name: 'Power of Two'),
      PracticeRef(n: 268, name: 'Missing Number'),
    ],
    playIds: ['single-number'],
    deepDive: 'https://algomaster.io/learn/dsa/bit-manipulation-introduction',
  ),
  DsaPattern(
    id: 'top-k-elements',
    name: "Top 'K' Elements",
    whenToUse: 'K largest/smallest, kth order statistics, or k most frequent. A heap of size k remembers exactly the winners and forgets the rest.',
    template: 'heap = first k values, heapified\nfor v in rest:\n  if v > heap.min:\n    replace root, sift down\nreturn heap.min  # kth largest',
    leetcode: [
      PracticeRef(n: 215, name: 'Kth Largest Element in an Array'),
      PracticeRef(n: 347, name: 'Top K Frequent Elements'),
      PracticeRef(n: 973, name: 'K Closest Points to Origin'),
      PracticeRef(n: 373, name: 'Find K Pairs with Smallest Sums'),
      PracticeRef(n: 703, name: 'Kth Largest Element in a Stream'),
    ],
    playIds: ['kth-largest-heap', 'frequency-count'],
    deepDive: 'https://algomaster.io/learn/dsa/top-k-elements-introduction',
  ),
  DsaPattern(
    id: 'overlapping-intervals',
    name: 'Overlapping Intervals',
    whenToUse: 'Merging, meeting rooms, or interval insertion. Sort by start and overlap becomes one test: next start at or before the running end.',
    template: 'sort by start\ncur = intervals[0]\nfor nxt in rest:\n  if nxt.start <= cur.end: cur.end = max(cur.end, nxt.end)\n  else: emit cur; cur = nxt',
    leetcode: [
      PracticeRef(n: 56, name: 'Merge Intervals'),
      PracticeRef(n: 57, name: 'Insert Interval'),
      PracticeRef(n: 435, name: 'Non-overlapping Intervals'),
      PracticeRef(n: 252, name: 'Meeting Rooms'),
      PracticeRef(n: 253, name: 'Meeting Rooms II'),
    ],
    playIds: ['merge-intervals'],
    deepDive: 'https://algomaster.io/learn/dsa/intervals-introduction',
  ),
  DsaPattern(
    id: 'modified-binary-search',
    name: 'Modified Binary Search',
    whenToUse: 'Rotated arrays, first/last occurrence, peaks, or searching a condition rather than a value. One half is always sorted — find it, test membership, discard the rest.',
    template: 'lo, hi = 0, n-1\nwhile lo <= hi:\n  mid = (lo+hi)//2\n  if a[mid] == target: done\n  if left half sorted and target inside: hi = mid-1\n  else if right half holds it: lo = mid+1\n  else: search the other half',
    leetcode: [
      PracticeRef(n: 33, name: 'Search in Rotated Sorted Array'),
      PracticeRef(n: 153, name: 'Find Minimum in Rotated Sorted Array'),
      PracticeRef(n: 74, name: 'Search a 2D Matrix'),
      PracticeRef(n: 162, name: 'Find Peak Element'),
      PracticeRef(n: 278, name: 'First Bad Version'),
    ],
    playIds: ['binary-search', 'rotated-search', 'bst-search'],
    deepDive: 'https://algomaster.io/learn/dsa/binary-search-introduction',
  ),
  DsaPattern(
    id: 'binary-tree-traversal',
    name: 'Binary Tree Traversal',
    whenToUse: 'Visiting every node in a fixed order, BST checks (inorder is sorted), or serialization. Pre/in/post differ only in when the node itself is visited.',
    template: 'walk(node):\n  if null: return\n  [pre: visit] walk(left)\n  [in: visit] walk(right)\n  [post: visit]',
    leetcode: [
      PracticeRef(n: 94, name: 'Binary Tree Inorder Traversal'),
      PracticeRef(n: 144, name: 'Binary Tree Preorder Traversal'),
      PracticeRef(n: 145, name: 'Binary Tree Postorder Traversal'),
      PracticeRef(n: 230, name: 'Kth Smallest Element in a BST'),
      PracticeRef(n: 98, name: 'Validate Binary Search Tree'),
    ],
    playIds: ['tree-traversals', 'bst-validate'],
    deepDive: 'https://algomaster.io/learn/dsa/binary-tree-introduction',
  ),
  DsaPattern(
    id: 'dfs',
    name: 'Depth-First Search',
    whenToUse: 'Exploring every path, connected components, cycle checks, or topological order. Go deep with a stack (or recursion) before backtracking.',
    template: 'dfs(node):\n  mark visited\n  for nb in neighbours(node):\n    if unvisited: dfs(nb)',
    leetcode: [
      PracticeRef(n: 112, name: 'Path Sum'),
      PracticeRef(n: 113, name: 'Path Sum II'),
      PracticeRef(n: 133, name: 'Clone Graph'),
      PracticeRef(n: 210, name: 'Course Schedule II'),
      PracticeRef(n: 200, name: 'Number of Islands'),
    ],
    playIds: ['num-islands', 'max-area-island', 'word-search'],
    deepDive: 'https://algomaster.io/learn/dsa/dfs-introduction',
  ),
  DsaPattern(
    id: 'bfs',
    name: 'Breadth-First Search',
    whenToUse: 'Shortest path on unweighted graphs, level order, or anything spreading wave by wave. A FIFO queue guarantees the first visit is the shortest.',
    template: 'queue = [start]  # minute 0\nwhile queue:\n  node = dequeue\n  for nb in neighbours(node):\n    if unvisited: mark, enqueue',
    leetcode: [
      PracticeRef(n: 102, name: 'Binary Tree Level Order Traversal'),
      PracticeRef(n: 994, name: 'Rotting Oranges'),
      PracticeRef(n: 127, name: 'Word Ladder'),
      PracticeRef(n: 111, name: 'Minimum Depth of Binary Tree'),
      PracticeRef(n: 286, name: 'Walls and Gates'),
    ],
    playIds: ['tree-level-order', 'rotting-oranges'],
    deepDive: 'https://algomaster.io/learn/dsa/bfs-introduction',
  ),
  DsaPattern(
    id: 'shortest-path',
    name: 'Shortest Path (Dijkstra)',
    whenToUse: 'Minimum cost or distance on weighted graphs with non-negative weights. Always settle the closest unsettled node; its distance is final.',
    template: 'dist[source] = 0, pq = [(0, source)]\nwhile pq:\n  d, node = popMin\n  if d > dist[node]: skip\n  for nb, w in edges(node):\n    relax dist[nb] via d + w',
    leetcode: [
      PracticeRef(n: 743, name: 'Network Delay Time'),
      PracticeRef(n: 787, name: 'Cheapest Flights Within K Stops'),
      PracticeRef(n: 1514, name: 'Path with Maximum Probability'),
      PracticeRef(n: 778, name: 'Swim in Rising Water'),
      PracticeRef(n: 1631, name: 'Path with Minimum Effort'),
    ],
    playIds: ['network-delay-time', 'rotting-oranges'],
    deepDive: 'https://algomaster.io/learn/dsa/dijkstras-algorithm',
  ),
  DsaPattern(
    id: 'matrix-traversal',
    name: 'Matrix Traversal',
    whenToUse: 'Grid islands, regions, flood fill, or mazes. Treat 4-neighbours as graph edges with boundary checks; DFS and BFS both apply.',
    template: 'DIRS = [up, right, down, left]\nwalk(r, c):\n  if outside or water or seen: return\n  mark seen\n  for d in DIRS: walk(r+dr, c+dc)',
    leetcode: [
      PracticeRef(n: 200, name: 'Number of Islands'),
      PracticeRef(n: 733, name: 'Flood Fill'),
      PracticeRef(n: 130, name: 'Surrounded Regions'),
      PracticeRef(n: 695, name: 'Max Area of Island'),
      PracticeRef(n: 417, name: 'Pacific Atlantic Water Flow'),
    ],
    playIds: ['num-islands', 'max-area-island', 'rotting-oranges', 'word-search'],
    deepDive: 'https://algomaster.io/learn/dsa/graphs-introduction',
  ),
  DsaPattern(
    id: 'backtracking',
    name: 'Backtracking',
    whenToUse: 'Enumerating subsets, permutations, or constraint layouts (N-Queens, Sudoku). Choose, recurse, then unchoose — the undo is the pattern.',
    template: 'dfs(state):\n  if complete: emit; return\n  for choice in options(state):\n    apply choice; dfs(state)\n    undo choice  # backtrack',
    leetcode: [
      PracticeRef(n: 78, name: 'Subsets'),
      PracticeRef(n: 46, name: 'Permutations'),
      PracticeRef(n: 39, name: 'Combination Sum'),
      PracticeRef(n: 51, name: 'N-Queens'),
      PracticeRef(n: 79, name: 'Word Search'),
    ],
    playIds: ['subsets', 'permutations', 'word-search'],
    deepDive: 'https://algomaster.io/learn/dsa/backtracking-introduction',
  ),
  DsaPattern(
    id: 'trie',
    name: 'Trie (Prefix Tree)',
    whenToUse: 'Autocomplete, spell checking, or word games over a dictionary. Shared prefixes share nodes, so a query walk either lands on all completions or falls off.',
    template: 'node = root\nfor ch in query:\n  node = node.children[ch]\n  if missing: no completions\nreturn word-ends under node',
    leetcode: [
      PracticeRef(n: 208, name: 'Implement Trie (Prefix Tree)'),
      PracticeRef(n: 212, name: 'Word Search II'),
      PracticeRef(n: 211, name: 'Design Add and Search Words Data Structure'),
      PracticeRef(n: 648, name: 'Replace Words'),
      PracticeRef(n: 720, name: 'Longest Word in Dictionary'),
    ],
    playIds: ['trie-prefix-search'],
    deepDive: 'https://algomaster.io/learn/dsa/tries-introduction',
  ),
  DsaPattern(
    id: 'greedy',
    name: 'Greedy',
    whenToUse: 'Optimization where a local choice is provably safe: interval scheduling, jump reach, or activity selection. Keep one running number and never look back.',
    template: 'reach = 0\nfor i, jump in enumerate(a):\n  if i > reach: stuck\n  reach = max(reach, i + jump)\nreturn reached the end',
    leetcode: [
      PracticeRef(n: 55, name: 'Jump Game'),
      PracticeRef(n: 45, name: 'Jump Game II'),
      PracticeRef(n: 134, name: 'Gas Station'),
      PracticeRef(n: 621, name: 'Task Scheduler'),
      PracticeRef(n: 763, name: 'Partition Labels'),
    ],
    playIds: ['jump-game'],
    deepDive: 'https://algomaster.io/learn/dsa/greedy-introduction',
  ),
  DsaPattern(
    id: 'dynamic-programming',
    name: 'Dynamic Programming',
    whenToUse: 'Overlapping subproblems with optimal substructure: optimization, counting ways, or decision questions. Solve small, reuse, never recompute.',
    template: 'dp[0..1] = base cases\nfor i in 2..n:\n  dp[i] = combine(dp[i-1], dp[i-2], a[i])\nreturn dp[n]',
    leetcode: [
      PracticeRef(n: 70, name: 'Climbing Stairs'),
      PracticeRef(n: 198, name: 'House Robber'),
      PracticeRef(n: 322, name: 'Coin Change'),
      PracticeRef(n: 1143, name: 'Longest Common Subsequence'),
      PracticeRef(n: 300, name: 'Longest Increasing Subsequence'),
      PracticeRef(n: 416, name: 'Partition Equal Subset Sum'),
      PracticeRef(n: 72, name: 'Edit Distance'),
    ],
    playIds: ['climbing-stairs', 'house-robber', 'kadane-max-subarray', 'coin-change'],
    deepDive: 'https://algomaster.io/learn/dsa/dp-introduction',
  ),
];

/// Patterns that train [problemId], for cross-linking.
List<DsaPattern> patternsForProblem(String problemId) =>
    dsaPatterns.where((p) => p.playIds.contains(problemId)).toList(growable: false);
