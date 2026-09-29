/**
 * Curated tracks (Phase 5 UX layer).
 *
 * Two tracks:
 *
 *   interview-classics  Blind-75-style coverage across every category, each
 *             item mapped to the oracle ids that train it (`playIds`,
 *             possibly empty). It is deliberately NOT titled "Blind 75": this
 *             list holds 114 items and the canonical list holds 75, so that
 *             title would be a false count. Items without a game are still
 *             listed — as study references with LeetCode numbers, never as
 *             playable — per the expansion rule that nothing unplayable is
 *             advertised as playable.
 *   full-tour Every problem in this app's catalogue, grouped by topic and
 *             derived from PROBLEMS so it cannot drift from the registry.
 *
 * LeetCode references are number + name text (searchable, never fabricated
 * URLs). Progress comes from the adventure store: an item is done when all
 * its mapped games are stamped complete.
 */

import { DSA_TOPICS, PROBLEMS, TOPIC_LABELS } from '@dsa/game-schema'

export interface TrackItem {
  /** LeetCode problem number. */
  n: number
  name: string
  /** Oracle ids that train this item; empty means study-only for now. */
  playIds: readonly string[]
}

export interface TrackCategory {
  title: string
  items: readonly TrackItem[]
}

export interface Track {
  id: string
  title: string
  subtitle: string
  categories: readonly TrackCategory[]
}

function item(n: number, name: string, playIds: readonly string[] = []): TrackItem {
  return { n, name, playIds }
}

const BLIND_75_CATEGORIES: readonly TrackCategory[] = [
  {
    title: 'Arrays & Hashing',
    items: [
      item(217, 'Contains Duplicate', ['frequency-count']),
      item(242, 'Valid Anagram', ['valid-anagram']),
      item(1, 'Two Sum', ['two-sum']),
      item(49, 'Group Anagrams', ['valid-anagram', 'frequency-count']),
      item(347, 'Top K Frequent Elements', ['frequency-count', 'kth-largest-heap']),
      item(238, 'Product of Array Except Self', ['prefix-sum-range']),
      item(271, 'Encode and Decode Strings'),
      item(128, 'Longest Consecutive Sequence', ['frequency-count']),
    ],
  },
  {
    title: 'Two Pointers',
    items: [
      item(125, 'Valid Palindrome', ['valid-palindrome']),
      item(167, 'Two Sum II - Input Array is Sorted', ['two-pointers-pair']),
      item(15, '3Sum', ['two-pointers-pair']),
      item(11, 'Container With Most Water'),
      item(42, 'Trapping Rain Water'),
    ],
  },
  {
    title: 'Sliding Window',
    items: [
      item(121, 'Best Time to Buy and Sell Stock', ['kadane-max-subarray']),
      item(3, 'Longest Substring Without Repeating Characters', ['sliding-window-max-sum']),
      item(424, 'Longest Repeating Character Replacement', ['sliding-window-max-sum']),
      item(76, 'Minimum Window Substring', ['sliding-window-max-sum']),
      item(239, 'Sliding Window Maximum', ['sliding-window-max-sum']),
      item(567, 'Permutation in String', ['sliding-window-max-sum', 'valid-anagram']),
    ],
  },
  {
    title: 'Stack',
    items: [
      item(20, 'Valid Parentheses', ['valid-parentheses']),
      item(155, 'Min Stack', ['stack-push-pop']),
      item(150, 'Evaluate Reverse Polish Notation', ['stack-push-pop']),
      item(22, 'Generate Parentheses'),
      item(739, 'Daily Temperatures', ['next-greater-element']),
      item(853, 'Car Fleet'),
      item(84, 'Largest Rectangle in Histogram', ['next-greater-element']),
    ],
  },
  {
    title: 'Binary Search',
    items: [
      item(704, 'Binary Search', ['binary-search']),
      item(74, 'Search a 2D Matrix'),
      item(875, 'Koko Eating Bananas', ['binary-search']),
      item(33, 'Search in Rotated Sorted Array', ['rotated-search']),
      item(153, 'Find Minimum in Rotated Sorted Array', ['rotated-search']),
      item(981, 'Time Based Key-Value Store', ['binary-search']),
    ],
  },
  {
    title: 'Linked List',
    items: [
      item(206, 'Reverse Linked List', ['reverse-linked-list']),
      item(21, 'Merge Two Sorted Lists', ['linked-list-traversal']),
      item(143, 'Reorder List', ['reverse-linked-list', 'linked-list-traversal']),
      item(19, 'Remove Nth Node From End of List', ['linked-list-traversal']),
      item(138, 'Copy List with Random Pointer', ['linked-list-traversal']),
      item(2, 'Add Two Numbers', ['linked-list-traversal']),
      item(141, 'Linked List Cycle', ['linked-list-cycle']),
      item(287, 'Find the Duplicate Number', ['linked-list-cycle']),
      item(146, 'LRU Cache'),
      item(23, 'Merge k Sorted Lists'),
      item(25, 'Reverse Nodes in k-Group', ['reverse-linked-list']),
    ],
  },
  {
    title: 'Trees',
    items: [
      item(104, 'Maximum Depth of Binary Tree', ['tree-traversals']),
      item(543, 'Diameter of Binary Tree', ['tree-traversals']),
      item(110, 'Balanced Binary Tree', ['bst-validate']),
      item(100, 'Same Tree', ['tree-traversals']),
      item(572, 'Subtree of Another Tree', ['tree-traversals']),
      item(235, 'Lowest Common Ancestor of a BST', ['bst-search']),
      item(102, 'Binary Tree Level Order Traversal', ['tree-level-order']),
      item(199, 'Binary Tree Right Side View', ['tree-level-order']),
      item(1448, 'Count Good Nodes in Binary Tree', ['tree-traversals']),
      item(98, 'Validate Binary Search Tree', ['bst-validate']),
      item(230, 'Kth Smallest Element in a BST', ['bst-validate', 'tree-traversals']),
      item(105, 'Construct Binary Tree from Preorder and Inorder', ['tree-traversals']),
      item(124, 'Binary Tree Maximum Path Sum'),
      item(297, 'Serialize and Deserialize Binary Tree', ['tree-traversals']),
      item(226, 'Invert Binary Tree', ['tree-traversals']),
    ],
  },
  {
    title: 'Heap / Priority Queue',
    items: [
      item(703, 'Kth Largest Element in a Stream', ['kth-largest-heap']),
      item(1046, 'Last Stone Weight', ['kth-largest-heap']),
      item(973, 'K Closest Points to Origin', ['kth-largest-heap']),
      item(215, 'Kth Largest Element in an Array', ['kth-largest-heap']),
      item(621, 'Task Scheduler'),
      item(355, 'Design Twitter'),
      item(295, 'Find Median from Data Stream', ['kth-largest-heap']),
    ],
  },
  {
    title: 'Backtracking',
    items: [
      item(78, 'Subsets', ['subsets']),
      item(39, 'Combination Sum', ['subsets']),
      item(46, 'Permutations', ['permutations']),
      item(90, 'Subsets II', ['subsets']),
      item(40, 'Combination Sum II', ['subsets']),
      item(79, 'Word Search', ['word-search']),
      item(131, 'Palindrome Partitioning', ['valid-palindrome']),
      item(17, 'Letter Combinations of a Phone Number', ['trie-prefix-search']),
      item(51, 'N-Queens'),
    ],
  },
  {
    title: 'Graphs',
    items: [
      item(200, 'Number of Islands', ['num-islands']),
      item(133, 'Clone Graph'),
      item(695, 'Max Area of Island', ['max-area-island']),
      item(417, 'Pacific Atlantic Water Flow', ['num-islands', 'max-area-island']),
      item(994, 'Rotting Oranges', ['rotting-oranges']),
      item(130, 'Surrounded Regions', ['num-islands']),
      item(207, 'Course Schedule', ['union-find-connect']),
      item(210, 'Course Schedule II', ['union-find-connect']),
      item(684, 'Redundant Connection', ['union-find-connect']),
      item(323, 'Number of Connected Components', ['union-find-connect']),
      item(286, 'Walls and Gates', ['rotting-oranges']),
      item(261, 'Graph Valid Tree', ['union-find-connect']),
      item(743, 'Network Delay Time', ['network-delay-time']),
    ],
  },
  {
    title: '1D Dynamic Programming',
    items: [
      item(70, 'Climbing Stairs', ['climbing-stairs']),
      item(746, 'Min Cost Climbing Stairs', ['climbing-stairs', 'house-robber']),
      item(198, 'House Robber', ['house-robber']),
      item(213, 'House Robber II', ['house-robber']),
      item(5, 'Longest Palindromic Substring', ['valid-palindrome']),
      item(647, 'Palindromic Substrings', ['valid-palindrome']),
      item(91, 'Decode Ways', ['climbing-stairs']),
      item(322, 'Coin Change', ['coin-change']),
      item(152, 'Maximum Product Subarray', ['kadane-max-subarray']),
      item(139, 'Word Break', ['word-search', 'trie-prefix-search']),
      item(300, 'Longest Increasing Subsequence'),
      item(416, 'Partition Equal Subset Sum', ['subsets']),
    ],
  },
  {
    title: 'Greedy',
    items: [
      item(53, 'Maximum Subarray', ['kadane-max-subarray']),
      item(55, 'Jump Game', ['jump-game']),
    ],
  },
  {
    title: 'Intervals',
    items: [
      item(57, 'Insert Interval', ['merge-intervals']),
      item(56, 'Merge Intervals', ['merge-intervals']),
      item(435, 'Non-overlapping Intervals', ['merge-intervals']),
      item(252, 'Meeting Rooms', ['merge-intervals']),
      item(253, 'Meeting Rooms II', ['merge-intervals']),
    ],
  },
  {
    title: 'Math & Bits',
    items: [
      item(48, 'Rotate Image'),
      item(54, 'Spiral Matrix'),
      item(73, 'Set Matrix Zeroes'),
      item(202, 'Happy Number', ['linked-list-cycle']),
      item(66, 'Plus One'),
      item(50, 'Pow(x, n)'),
      item(43, 'Multiply Strings'),
      item(136, 'Single Number', ['single-number']),
    ],
  },
]

function buildFullTour(): TrackCategory[] {
  return DSA_TOPICS.map((topic) => ({
    title: TOPIC_LABELS[topic],
    items: PROBLEMS.filter((p) => p.topic === topic).map((p) => ({
      n: 0,
      name: p.title,
      playIds: [p.id] as readonly string[],
    })),
  }))
}

export const TRACKS: readonly Track[] = [
  {
    id: 'interview-classics',
    title: 'Interview Classics',
    subtitle:
      'Blind-75-style coverage across every category, each item mapped to the games that train it. Study-only items show their LeetCode number.',
    categories: BLIND_75_CATEGORIES,
  },
  {
    id: 'full-tour',
    title: 'Full Tour',
    subtitle: 'Every game in this app, grouped by world. Derived from the catalogue, so it never drifts.',
    categories: buildFullTour(),
  },
]

export function getTrack(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id)
}

/** Done when every mapped game is stamped complete (study-only items never auto-complete). */
export function trackItemDone(playIds: readonly string[], completed: Record<string, string>): boolean {
  return playIds.length > 0 && playIds.every((id) => Boolean(completed[id]))
}

export interface TrackProgress {
  done: number
  playable: number
  total: number
}

export function trackProgress(track: Track, completed: Record<string, string>): TrackProgress {
  const items = track.categories.flatMap((c) => c.items)
  const playable = items.filter((i) => i.playIds.length > 0)
  return {
    done: playable.filter((i) => trackItemDone(i.playIds, completed)).length,
    playable: playable.length,
    total: items.length,
  }
}
