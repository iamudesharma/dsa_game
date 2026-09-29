/// Curated tracks, mirroring `apps/web/src/lib/tracks.ts`.
///
/// `interview-classics` is Blind-75-style coverage across every category with
/// the same item mapping (LeetCode number + name text, never fabricated
/// URLs). Like the web original it is deliberately NOT titled "Blind 75":
/// the list holds 114 items. `full-tour` is built from the live catalogue at
/// runtime, so it cannot drift from the registry.
library;

import '../models/problem.dart';

class TrackItem {
  const TrackItem({required this.n, required this.name, this.playIds = const <String>[]});

  final int n;
  final String name;
  final List<String> playIds;
}

class TrackCategory {
  const TrackCategory({required this.title, required this.items});

  final String title;
  final List<TrackItem> items;
}

class Track {
  const Track({required this.id, required this.title, required this.subtitle, required this.categories});

  final String id;
  final String title;
  final String subtitle;
  final List<TrackCategory> categories;
}

const List<TrackCategory> interviewClassicsCategories = [
  TrackCategory(title: 'Arrays & Hashing', items: [
    TrackItem(n: 217, name: 'Contains Duplicate', playIds: ['frequency-count']),
    TrackItem(n: 242, name: 'Valid Anagram', playIds: ['valid-anagram']),
    TrackItem(n: 1, name: 'Two Sum', playIds: ['two-sum']),
    TrackItem(n: 49, name: 'Group Anagrams', playIds: ['valid-anagram', 'frequency-count']),
    TrackItem(n: 347, name: 'Top K Frequent Elements', playIds: ['frequency-count', 'kth-largest-heap']),
    TrackItem(n: 238, name: 'Product of Array Except Self', playIds: ['prefix-sum-range']),
    TrackItem(n: 271, name: 'Encode and Decode Strings'),
    TrackItem(n: 128, name: 'Longest Consecutive Sequence', playIds: ['frequency-count']),
  ]),
  TrackCategory(title: 'Two Pointers', items: [
    TrackItem(n: 125, name: 'Valid Palindrome', playIds: ['valid-palindrome']),
    TrackItem(n: 167, name: 'Two Sum II - Input Array is Sorted', playIds: ['two-pointers-pair']),
    TrackItem(n: 15, name: '3Sum', playIds: ['two-pointers-pair']),
    TrackItem(n: 11, name: 'Container With Most Water'),
    TrackItem(n: 42, name: 'Trapping Rain Water'),
  ]),
  TrackCategory(title: 'Sliding Window', items: [
    TrackItem(n: 121, name: 'Best Time to Buy and Sell Stock', playIds: ['kadane-max-subarray']),
    TrackItem(n: 3, name: 'Longest Substring Without Repeating Characters', playIds: ['sliding-window-max-sum']),
    TrackItem(n: 424, name: 'Longest Repeating Character Replacement', playIds: ['sliding-window-max-sum']),
    TrackItem(n: 76, name: 'Minimum Window Substring', playIds: ['sliding-window-max-sum']),
    TrackItem(n: 239, name: 'Sliding Window Maximum', playIds: ['sliding-window-max-sum']),
    TrackItem(n: 567, name: 'Permutation in String', playIds: ['sliding-window-max-sum', 'valid-anagram']),
  ]),
  TrackCategory(title: 'Stack', items: [
    TrackItem(n: 20, name: 'Valid Parentheses', playIds: ['valid-parentheses']),
    TrackItem(n: 155, name: 'Min Stack', playIds: ['stack-push-pop']),
    TrackItem(n: 150, name: 'Evaluate Reverse Polish Notation', playIds: ['stack-push-pop']),
    TrackItem(n: 22, name: 'Generate Parentheses'),
    TrackItem(n: 739, name: 'Daily Temperatures', playIds: ['next-greater-element']),
    TrackItem(n: 853, name: 'Car Fleet'),
    TrackItem(n: 84, name: 'Largest Rectangle in Histogram', playIds: ['next-greater-element']),
  ]),
  TrackCategory(title: 'Binary Search', items: [
    TrackItem(n: 704, name: 'Binary Search', playIds: ['binary-search']),
    TrackItem(n: 74, name: 'Search a 2D Matrix'),
    TrackItem(n: 875, name: 'Koko Eating Bananas', playIds: ['binary-search']),
    TrackItem(n: 33, name: 'Search in Rotated Sorted Array', playIds: ['rotated-search']),
    TrackItem(n: 153, name: 'Find Minimum in Rotated Sorted Array', playIds: ['rotated-search']),
    TrackItem(n: 981, name: 'Time Based Key-Value Store', playIds: ['binary-search']),
  ]),
  TrackCategory(title: 'Linked List', items: [
    TrackItem(n: 206, name: 'Reverse Linked List', playIds: ['reverse-linked-list']),
    TrackItem(n: 21, name: 'Merge Two Sorted Lists', playIds: ['linked-list-traversal']),
    TrackItem(n: 143, name: 'Reorder List', playIds: ['reverse-linked-list', 'linked-list-traversal']),
    TrackItem(n: 19, name: 'Remove Nth Node From End of List', playIds: ['linked-list-traversal']),
    TrackItem(n: 138, name: 'Copy List with Random Pointer', playIds: ['linked-list-traversal']),
    TrackItem(n: 2, name: 'Add Two Numbers', playIds: ['linked-list-traversal']),
    TrackItem(n: 141, name: 'Linked List Cycle', playIds: ['linked-list-cycle']),
    TrackItem(n: 287, name: 'Find the Duplicate Number', playIds: ['linked-list-cycle']),
    TrackItem(n: 146, name: 'LRU Cache'),
    TrackItem(n: 23, name: 'Merge k Sorted Lists'),
    TrackItem(n: 25, name: 'Reverse Nodes in k-Group', playIds: ['reverse-linked-list']),
  ]),
  TrackCategory(title: 'Trees', items: [
    TrackItem(n: 104, name: 'Maximum Depth of Binary Tree', playIds: ['tree-traversals']),
    TrackItem(n: 543, name: 'Diameter of Binary Tree', playIds: ['tree-traversals']),
    TrackItem(n: 110, name: 'Balanced Binary Tree', playIds: ['bst-validate']),
    TrackItem(n: 100, name: 'Same Tree', playIds: ['tree-traversals']),
    TrackItem(n: 572, name: 'Subtree of Another Tree', playIds: ['tree-traversals']),
    TrackItem(n: 235, name: 'Lowest Common Ancestor of a BST', playIds: ['bst-search']),
    TrackItem(n: 102, name: 'Binary Tree Level Order Traversal', playIds: ['tree-level-order']),
    TrackItem(n: 199, name: 'Binary Tree Right Side View', playIds: ['tree-level-order']),
    TrackItem(n: 1448, name: 'Count Good Nodes in Binary Tree', playIds: ['tree-traversals']),
    TrackItem(n: 98, name: 'Validate Binary Search Tree', playIds: ['bst-validate']),
    TrackItem(n: 230, name: 'Kth Smallest Element in a BST', playIds: ['bst-validate', 'tree-traversals']),
    TrackItem(n: 105, name: 'Construct Binary Tree from Preorder and Inorder', playIds: ['tree-traversals']),
    TrackItem(n: 124, name: 'Binary Tree Maximum Path Sum'),
    TrackItem(n: 297, name: 'Serialize and Deserialize Binary Tree', playIds: ['tree-traversals']),
    TrackItem(n: 226, name: 'Invert Binary Tree', playIds: ['tree-traversals']),
  ]),
  TrackCategory(title: 'Heap / Priority Queue', items: [
    TrackItem(n: 703, name: 'Kth Largest Element in a Stream', playIds: ['kth-largest-heap']),
    TrackItem(n: 1046, name: 'Last Stone Weight', playIds: ['kth-largest-heap']),
    TrackItem(n: 973, name: 'K Closest Points to Origin', playIds: ['kth-largest-heap']),
    TrackItem(n: 215, name: 'Kth Largest Element in an Array', playIds: ['kth-largest-heap']),
    TrackItem(n: 621, name: 'Task Scheduler'),
    TrackItem(n: 355, name: 'Design Twitter'),
    TrackItem(n: 295, name: 'Find Median from Data Stream', playIds: ['kth-largest-heap']),
  ]),
  TrackCategory(title: 'Backtracking', items: [
    TrackItem(n: 78, name: 'Subsets', playIds: ['subsets']),
    TrackItem(n: 39, name: 'Combination Sum', playIds: ['subsets']),
    TrackItem(n: 46, name: 'Permutations', playIds: ['permutations']),
    TrackItem(n: 90, name: 'Subsets II', playIds: ['subsets']),
    TrackItem(n: 40, name: 'Combination Sum II', playIds: ['subsets']),
    TrackItem(n: 79, name: 'Word Search', playIds: ['word-search']),
    TrackItem(n: 131, name: 'Palindrome Partitioning', playIds: ['valid-palindrome']),
    TrackItem(n: 17, name: 'Letter Combinations of a Phone Number', playIds: ['trie-prefix-search']),
    TrackItem(n: 51, name: 'N-Queens'),
  ]),
  TrackCategory(title: 'Graphs', items: [
    TrackItem(n: 200, name: 'Number of Islands', playIds: ['num-islands']),
    TrackItem(n: 133, name: 'Clone Graph'),
    TrackItem(n: 695, name: 'Max Area of Island', playIds: ['max-area-island']),
    TrackItem(n: 417, name: 'Pacific Atlantic Water Flow', playIds: ['num-islands', 'max-area-island']),
    TrackItem(n: 994, name: 'Rotting Oranges', playIds: ['rotting-oranges']),
    TrackItem(n: 130, name: 'Surrounded Regions', playIds: ['num-islands']),
    TrackItem(n: 207, name: 'Course Schedule', playIds: ['union-find-connect']),
    TrackItem(n: 210, name: 'Course Schedule II', playIds: ['union-find-connect']),
    TrackItem(n: 684, name: 'Redundant Connection', playIds: ['union-find-connect']),
    TrackItem(n: 323, name: 'Number of Connected Components', playIds: ['union-find-connect']),
    TrackItem(n: 286, name: 'Walls and Gates', playIds: ['rotting-oranges']),
    TrackItem(n: 261, name: 'Graph Valid Tree', playIds: ['union-find-connect']),
    TrackItem(n: 743, name: 'Network Delay Time', playIds: ['network-delay-time']),
  ]),
  TrackCategory(title: '1D Dynamic Programming', items: [
    TrackItem(n: 70, name: 'Climbing Stairs', playIds: ['climbing-stairs']),
    TrackItem(n: 746, name: 'Min Cost Climbing Stairs', playIds: ['climbing-stairs', 'house-robber']),
    TrackItem(n: 198, name: 'House Robber', playIds: ['house-robber']),
    TrackItem(n: 213, name: 'House Robber II', playIds: ['house-robber']),
    TrackItem(n: 5, name: 'Longest Palindromic Substring', playIds: ['valid-palindrome']),
    TrackItem(n: 647, name: 'Palindromic Substrings', playIds: ['valid-palindrome']),
    TrackItem(n: 91, name: 'Decode Ways', playIds: ['climbing-stairs']),
    TrackItem(n: 322, name: 'Coin Change', playIds: ['coin-change']),
    TrackItem(n: 152, name: 'Maximum Product Subarray', playIds: ['kadane-max-subarray']),
    TrackItem(n: 139, name: 'Word Break', playIds: ['word-search', 'trie-prefix-search']),
    TrackItem(n: 300, name: 'Longest Increasing Subsequence'),
    TrackItem(n: 416, name: 'Partition Equal Subset Sum', playIds: ['subsets']),
  ]),
  TrackCategory(title: 'Greedy', items: [
    TrackItem(n: 53, name: 'Maximum Subarray', playIds: ['kadane-max-subarray']),
    TrackItem(n: 55, name: 'Jump Game', playIds: ['jump-game']),
  ]),
  TrackCategory(title: 'Intervals', items: [
    TrackItem(n: 57, name: 'Insert Interval', playIds: ['merge-intervals']),
    TrackItem(n: 56, name: 'Merge Intervals', playIds: ['merge-intervals']),
    TrackItem(n: 435, name: 'Non-overlapping Intervals', playIds: ['merge-intervals']),
    TrackItem(n: 252, name: 'Meeting Rooms', playIds: ['merge-intervals']),
    TrackItem(n: 253, name: 'Meeting Rooms II', playIds: ['merge-intervals']),
  ]),
  TrackCategory(title: 'Math & Bits', items: [
    TrackItem(n: 48, name: 'Rotate Image'),
    TrackItem(n: 54, name: 'Spiral Matrix'),
    TrackItem(n: 73, name: 'Set Matrix Zeroes'),
    TrackItem(n: 202, name: 'Happy Number', playIds: ['linked-list-cycle']),
    TrackItem(n: 66, name: 'Plus One'),
    TrackItem(n: 50, name: 'Pow(x, n)'),
    TrackItem(n: 43, name: 'Multiply Strings'),
    TrackItem(n: 136, name: 'Single Number', playIds: ['single-number']),
  ]),
];

/// The full tour, built from the live catalogue so it cannot drift.
List<TrackCategory> buildFullTour(CatalogueResponse catalogue) => [
  for (final topic in catalogue.topics)
    TrackCategory(
      title: topic.label,
      items: [for (final p in topic.problems) TrackItem(n: 0, name: p.title, playIds: [p.id])],
    ),
];

/// Done when every mapped game is stamped complete (study-only never auto-completes).
bool trackItemDone(List<String> playIds, Map<String, String> completed) =>
    playIds.isNotEmpty && playIds.every(completed.containsKey);

class TrackProgress {
  const TrackProgress({required this.done, required this.playable, required this.total});

  final int done;
  final int playable;
  final int total;
}

TrackProgress trackProgress(Track track, Map<String, String> completed) {
  final items = [for (final c in track.categories) ...c.items];
  final playable = items.where((i) => i.playIds.isNotEmpty).toList(growable: false);
  return TrackProgress(
    done: playable.where((i) => trackItemDone(i.playIds, completed)).length,
    playable: playable.length,
    total: items.length,
  );
}
