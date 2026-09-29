/// Per-problem study resources stay consistent: valid cross-links into the
/// pattern library and the classics, honest track mentions, verbatim
/// deep-dives shown as text.
///
/// Mirrors the web client's `resources.test.ts` contract. New oracles must
/// update `knownProblemIds` (see `patterns_test.dart`); this test then forces
/// the mapping decision for the resource card.
library;

import 'package:dsa_game_mobile/learn/resources.dart';
import 'package:flutter_test/flutter_test.dart';

import 'patterns_test.dart' show knownProblemIds;

void main() {
  test('resolves for every known problem without throwing', () {
    for (final id in knownProblemIds) {
      final res = resourcesForProblem(id);
      expect(res.patterns, isNotNull);
      expect(res.trackMentions, isNotNull);
      expect(res.deepDives, isNotNull);
    }
  });

  test('trains the two new games from their patterns and classics', () {
    final kruskal = resourcesForProblem('kruskal-mst');
    expect(kruskal.patterns, isEmpty);
    expect(kruskal.trackMentions.map((m) => m.n), contains(1584));

    final paths = resourcesForProblem('unique-paths');
    expect(paths.patterns.map((p) => p.id), contains('dynamic-programming'));
    expect(paths.deepDives, contains('https://algomaster.io/learn/dsa/dp-introduction'));
    expect(paths.trackMentions.map((m) => m.n), contains(63));
  });

  test('stamps the matching classics items', () {
    final dijkstra = resourcesForProblem('network-delay-time');
    expect(dijkstra.trackMentions.map((m) => m.n), contains(743));

    final coins = resourcesForProblem('coin-change');
    expect(coins.trackMentions.map((m) => m.n), contains(322));

    // Foundations have no pattern but still stamp classics items.
    final twoSum = resourcesForProblem('two-sum');
    expect(twoSum.patterns, isEmpty);
    expect(twoSum.deepDives, isEmpty);
    expect(twoSum.trackMentions.map((m) => m.n), contains(1));
  });

  test('keeps every mention and deep-dive honest', () {
    for (final id in knownProblemIds) {
      final res = resourcesForProblem(id);
      for (final mention in res.trackMentions) {
        expect(mention.category.trim(), isNotEmpty);
        expect(mention.n, greaterThan(0));
        expect(mention.name.trim(), isNotEmpty);
      }
      for (final url in res.deepDives) {
        expect(url, startsWith('https://'));
      }
      expect(res.deepDives.length, lessThanOrEqualTo(res.patterns.length));
    }
  });
}
