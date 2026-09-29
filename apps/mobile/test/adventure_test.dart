/// Progression rules: stamps, badges, recommendation, and storage failure.
///
/// Mirrors the web client's `adventure.test.ts` contract: one stamp per
/// problem regardless of difficulty/mistakes/hints, won-only persistence,
/// idempotent replays, first-unfinished recommendation, and graceful
/// corrupt/blocked storage.
library;

import 'package:dsa_game_mobile/adventure/progress.dart';
import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/adventure/worlds.dart';
import 'package:flutter_test/flutter_test.dart';

const _known = {'array-max-min', 'two-sum', 'linked-list-traversal'};

Map<WorldDefinition, List<String>> _missions() => {
  worldForTopic('arrays'): ['array-max-min', 'two-sum'],
  worldForTopic('linked-list'): ['linked-list-traversal'],
};

void main() {
  test('awards once and keeps the first timestamp across replays', () {
    var progress = AdventureProgress.fresh();
    final first = recordCompletion(
      progress,
      _known,
      problemId: 'array-max-min',
      phase: 'won',
      clock: () => DateTime.utc(2026, 9, 29, 10),
    );
    expect(first.completed, {'array-max-min': '2026-09-29T10:00:00.000Z'});
    // A replay earns nothing, not even a new timestamp.
    final replay = recordCompletion(
      first,
      _known,
      problemId: 'array-max-min',
      phase: 'won',
      clock: () => DateTime.utc(2026, 10, 1, 10),
    );
    expect(identical(replay, first), isTrue);
    expect(replay.completed, {'array-max-min': '2026-09-29T10:00:00.000Z'});
  });

  test('never rewards playing, lost, or unknown missions', () {
    final progress = AdventureProgress.fresh();
    for (final args in [
      (problemId: 'array-max-min', phase: 'playing'),
      (problemId: 'array-max-min', phase: 'lost'),
      (problemId: 'invented', phase: 'won'),
    ]) {
      final next = recordCompletion(
        progress,
        _known,
        problemId: args.problemId,
        phase: args.phase,
      );
      expect(next.completed, isEmpty, reason: '${args.problemId}/${args.phase}');
    }
  });

  test('earns a world badge only after all its missions', () {
    var progress = AdventureProgress.fresh();
    progress = recordCompletion(progress, _known, problemId: 'array-max-min', phase: 'won');
    expect(completedWorlds(progress, _missions()), isEmpty);
    progress = recordCompletion(progress, _known, problemId: 'two-sum', phase: 'won');
    expect(
      completedWorlds(progress, _missions()).map((w) => w.topic.wire),
      ['arrays'],
    );
  });

  test('recommends the first unfinished mission in catalogue order', () {
    var progress = AdventureProgress.fresh();
    const ordered = ['array-max-min', 'two-sum', 'linked-list-traversal'];
    expect(nextMission(progress, ordered), 'array-max-min');
    progress = recordCompletion(progress, _known, problemId: 'array-max-min', phase: 'won');
    expect(nextMission(progress, ordered), 'two-sum');
    progress = recordCompletion(progress, _known, problemId: 'two-sum', phase: 'won');
    progress = recordCompletion(progress, _known, problemId: 'linked-list-traversal', phase: 'won');
    expect(nextMission(progress, ordered), isNull);
  });

  test('lesson questions map onto playable missions', () {
    expect(lessonQuestionToMission['count-nodes'], 'linked-list-traversal');
    expect(lessonQuestionToMission['reverse-list'], 'reverse-linked-list');
  });

  test('corrupt payloads reset with a warning instead of throwing', () {
    for (final raw in [
      null,
      '{bad json',
      {'version': 999, 'completed': {}},
      {'version': 1, 'completed': 'not-a-map'},
      {
        'version': 1,
        'completed': {'array-max-min': 'not-a-date', 'two-sum': '2026-09-29T10:00:00.000Z'},
      },
    ]) {
      final parsed = AdventureProgress.fromJson(raw);
      expect(parsed.progress.completed.containsKey('array-max-min'), isFalse);
    }
    expect(AdventureProgress.fromJson(null).warning, isTrue);
    expect(AdventureProgress.fromJson('{bad').warning, isTrue);
    final partial = AdventureProgress.fromJson({
      'version': 1,
      'completed': {'two-sum': '2026-09-29T10:00:00.000Z'},
    });
    expect(partial.warning, isFalse);
    expect(partial.progress.completed.keys, ['two-sum']);
  });

  test('controller persists wins and guards unearned frames', () async {
    final backend = MemoryBackend();
    final controller = AdventureController(backend);
    // Wait for the initial load.
    for (var i = 0; i < 50 && !controller.ready; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(controller.ready, isTrue);

    controller.recordWin(_known, problemId: 'array-max-min', phase: 'won');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.progress.completed.keys, ['array-max-min']);

    // Lost games and unknown ids earn nothing.
    controller.recordWin(_known, problemId: 'two-sum', phase: 'lost');
    controller.recordWin(_known, problemId: 'invented', phase: 'won');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.progress.completed.keys, ['array-max-min']);

    // Unearned frames are refused.
    controller.selectFrame('arrays', _missions());
    expect(controller.progress.mapFrame, 'default');
    controller.recordWin(_known, problemId: 'two-sum', phase: 'won');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    controller.selectFrame('arrays', _missions());
    expect(controller.progress.mapFrame, 'arrays');
    controller.dispose();
  });

  test('controller degrades gracefully when storage is blocked', () async {
    final backend = MemoryBackend()..failReads = true;
    final controller = AdventureController(backend);
    for (var i = 0; i < 50 && !controller.ready; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(controller.ready, isTrue);
    expect(controller.warning, isTrue);
    // Play is never blocked: in-memory progress still works.
    controller.recordWin(_known, problemId: 'array-max-min', phase: 'won');
    expect(controller.progress.completed.keys, ['array-max-min']);

    backend
      ..failReads = false
      ..failWrites = true;
    final writer = AdventureController(backend);
    for (var i = 0; i < 50 && !writer.ready; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    writer.recordWin(_known, problemId: 'two-sum', phase: 'won');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(writer.warning, isTrue);
    controller.dispose();
    writer.dispose();
  });
}
