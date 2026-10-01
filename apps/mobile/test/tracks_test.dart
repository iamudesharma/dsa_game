/// Curated tracks stay consistent: valid mappings, a catalogue-derived tour,
/// and progress scored from stamped games only.
///
/// Mirrors the web client's `tracks.test.ts` contract. The known-id set is
/// hardcoded on purpose: a new oracle must update it, which is the mapping
/// decision being enforced.
library;

import 'package:dsa_game_mobile/learn/tracks.dart';
import 'package:dsa_game_mobile/models/problem.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures.dart';
import 'patterns_test.dart' show knownProblemIds;

void main() {
  test('the classics list is grouped and well-formed', () {
    expect(interviewClassicsCategories, isNotEmpty);
    for (final category in interviewClassicsCategories) {
      expect(category.title.trim(), isNotEmpty);
      expect(category.items, isNotEmpty);
      for (final item in category.items) {
        expect(item.n, greaterThan(0), reason: item.name);
        expect(item.name.trim(), isNotEmpty);
        for (final id in item.playIds) {
          expect(knownProblemIds, contains(id), reason: '#${item.n} ${item.name} maps to $id');
        }
      }
    }
  });

  test('LeetCode numbers are unique within the classics', () {
    final numbers = [for (final c in interviewClassicsCategories) for (final i in c.items) i.n];
    expect(numbers.toSet(), hasLength(numbers.length));
  });

  test('a majority of the classics is playable here', () {
    const track = Track(
      id: 'interview-classics',
      title: 'Interview Classics',
      subtitle: '',
      categories: interviewClassicsCategories,
    );
    final stats = trackProgress(track, const {});
    expect(stats.playable / stats.total, greaterThan(0.5));
  });

  test('the full tour derives from the catalogue and covers it exactly', () {
    final catalogue = CatalogueResponse.from(catalogueJson);
    final tour = buildFullTour(catalogue);
    expect(tour, hasLength(catalogue.topics.length));
    final mapped = [for (final c in tour) for (final i in c.items) ...i.playIds];
    final expected = [for (final t in catalogue.topics) for (final p in t.problems) p.id];
    expect(mapped.toSet(), expected.toSet());
    // Tour items carry no LeetCode numbers: they link straight to games.
    expect(tour.expand((c) => c.items).every((i) => i.n == 0), isTrue);
  });

  test('progress counts stamped games only', () {
    expect(trackItemDone(const [], const {}), isFalse);
    expect(trackItemDone(const ['two-sum'], const {}), isFalse);
    expect(trackItemDone(const ['two-sum'], const {'two-sum': '2026-01-01'}), isTrue);
    expect(
      trackItemDone(const ['two-sum', 'binary-search'], const {'two-sum': '2026-01-01'}),
      isFalse,
    );
  });

  test('track progress reports done/playable/total', () {
    const track = Track(
      id: 'interview-classics',
      title: 'Interview Classics',
      subtitle: '',
      categories: interviewClassicsCategories,
    );
    final empty = trackProgress(track, const {});
    expect(empty.done, 0);
    expect(empty.playable, greaterThan(40));
    expect(empty.total, greaterThanOrEqualTo(empty.playable));
    final partial = trackProgress(track, const {
      'two-sum': 'x',
      'valid-parentheses': 'y',
      'binary-search': 'z',
    });
    expect(partial.done, greaterThanOrEqualTo(3));
  });
}
