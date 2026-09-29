/// The pattern library stays consistent: 20 patterns, valid mappings, and an
/// explicit unmapped set so adding a game forces a conscious mapping decision.
///
/// Mirrors the web client's `patterns.test.ts` contract. The known-id set is
/// hardcoded on purpose (see adventure_test's `_known`): a new oracle must
/// update this list, which is exactly the mapping decision being enforced.
library;

import 'package:dsa_game_mobile/learn/patterns.dart';
import 'package:flutter_test/flutter_test.dart';

/// Every oracle id in the catalogue. Update when the registry grows.
const Set<String> knownProblemIds = {
  'array-max-min',
  'two-sum',
  'move-zeroes',
  'bubble-sort',
  'selection-sort',
  'valid-parentheses',
  'stack-push-pop',
  'queue-operations',
  'binary-search',
  'linked-list-traversal',
  'reverse-linked-list',
  'sliding-window-max-sum',
  'two-pointers-pair',
  'prefix-sum-range',
  'kadane-max-subarray',
  'merge-intervals',
  'next-greater-element',
  'rotated-search',
  'linked-list-cycle',
  'frequency-count',
  'valid-anagram',
  'valid-palindrome',
  'tree-traversals',
  'bst-validate',
  'tree-level-order',
  'bst-search',
  'kth-largest-heap',
  'num-islands',
  'max-area-island',
  'rotting-oranges',
  'word-search',
  'union-find-connect',
  'climbing-stairs',
  'house-robber',
  'subsets',
  'permutations',
  'jump-game',
  'network-delay-time',
  'coin-change',
  'kruskal-mst',
  'unique-paths',
  'lcs-length',
  'edit-distance',
  'single-number',
  'trie-prefix-search',
};

void main() {
  test('covers the 20 classic patterns', () {
    expect(dsaPatterns, hasLength(20));
    expect(dsaPatterns.map((p) => p.id).toSet(), hasLength(20));
  });

  test('only maps to real catalogue problems', () {
    for (final pattern in dsaPatterns) {
      for (final id in pattern.playIds) {
        expect(knownProblemIds, contains(id), reason: '${pattern.id} maps to $id');
      }
    }
  });

  test('gives every pattern a use-case, a template, and practice references', () {
    for (final pattern in dsaPatterns) {
      expect(pattern.name.trim(), isNotEmpty, reason: pattern.id);
      expect(pattern.whenToUse.trim(), isNotEmpty, reason: pattern.id);
      expect(pattern.template.trim(), isNotEmpty, reason: pattern.id);
      expect(pattern.leetcode, isNotEmpty, reason: pattern.id);
      for (final ref in pattern.leetcode) {
        expect(ref.n, greaterThan(0), reason: pattern.id);
        expect(ref.name.trim(), isNotEmpty, reason: pattern.id);
      }
      expect(pattern.deepDive, startsWith('https://'), reason: pattern.id);
    }
  });

  test('leaves only the foundations, union-find, and Kruskal unmapped, deliberately', () {
    final mapped = {for (final p in dsaPatterns) ...p.playIds};
    final unmapped = knownProblemIds.difference(mapped);
    expect(unmapped, {
      'array-max-min',
      'bubble-sort',
      'kruskal-mst',
      'linked-list-traversal',
      'move-zeroes',
      'queue-operations',
      'selection-sort',
      'stack-push-pop',
      'two-sum',
      'union-find-connect',
      'valid-parentheses',
    });
  });

  test('resolves patterns for a problem id', () {
    expect(patternsForProblem('two-sum'), isEmpty);
    expect(
      patternsForProblem('two-pointers-pair').map((p) => p.id),
      ['two-pointers'],
    );
  });
}
