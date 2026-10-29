/// Guest catalogue and native board rendering against a disposable live backend.
library;

import 'dart:convert';

import 'native_test_fixture.dart';

import 'package:flutter/scheduler.dart';
import 'package:flutter/rendering.dart';

import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/main.dart';
import 'package:dsa_game_mobile/models/api.dart';
import 'package:dsa_game_mobile/models/problem.dart';
import 'package:dsa_game_mobile/screens/play_screen.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/state/auth_controller.dart';
import 'package:dsa_game_mobile/state/game_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';

Map<String, Object?> frameStats(List<int> values) {
  values.sort();
  return {
    'n': values.length,
    'p50_ms': values[(values.length * .5).floor()] / 1000,
    'p95_ms': values[(values.length * .95).floor()] / 1000,
    'max_ms': values.last / 1000,
    'over_16_67_ms': values.where((v) => v > 16670).length,
  };
}

Future<void> waitFor(WidgetTester tester, Finder target) async {
  final deadline = DateTime.now().add(const Duration(seconds: 30));
  while (target.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  expect(target, findsWidgets);
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  configureNativeTest(binding);
  testWidgets('guest learning and all catalogue boards render natively', (
    tester,
  ) async {
    final frames = <FrameTiming>[];
    void record(List<FrameTiming> batch) => frames.addAll(batch);
    SchedulerBinding.instance.addTimingsCallback(record);
    addTearDown(() => SchedulerBinding.instance.removeTimingsCallback(record));
    final api = ApiClient();
    addTearDown(api.close);
    await tester.pumpWidget(
      DsaGameApp(
        api: api,
        authTokenStore: MemoryTokenStore(),
        adventureBackend: MemoryBackend(),
      ),
    );
    await tester.pump(const Duration(milliseconds: 500));
    debugPrint('NATIVE_STAGE:guest_boot');
    await tester.tap(find.text('Learn'));
    await tester.pump(const Duration(milliseconds: 500));
    await waitFor(tester, find.text('Your field notebook'));
    expect(await api.lessons(), isNotEmpty);
    await tester.tap(find.text('Explore').first);
    await tester.pump(const Duration(milliseconds: 500));
    debugPrint('NATIVE_STAGE:guest_learning_open');
    final context = tester.element(find.text('Play the Algorithms'));
    final game = context.read<GameController>();
    final catalogue = await api.fetchCatalogue();
    final results = <Map<String, Object?>>[];
    Future<void> renderBoards() async {
      for (final problem in catalogue.topics.expand((t) => t.problems)) {
        if (const bool.fromEnvironment('PROFILE_WIDGETS') &&
            !const [
              'array-max-min',
              'binary-search',
              'num-islands',
            ].contains(problem.id)) {
          continue;
        }
        for (final difficulty in Difficulty.values) {
          final timer = Stopwatch()..start();
          final generated = await api.generate(
            GenerateRequest(
              problemId: problem.id,
              seed: 0,
              difficulty: difficulty,
              forceTemplate: true,
            ),
          );
          final networkMs = timer.elapsedMilliseconds;
          game.adoptGenerated(generated, problem, difficulty: difficulty);
          final navigator = Navigator.of(context);
          final route = navigator.push(
            MaterialPageRoute<void>(builder: (_) => const PlayScreen()),
          );
          await tester.pump();
          await waitFor(tester, find.byType(PlayScreen));
          await tester.pump(const Duration(milliseconds: 350));
          expect(find.byType(PlayScreen), findsOneWidget);
          expect(game.state, isNotNull);
          expect(
            tester.takeException(),
            isNull,
            reason: '${problem.id}/${difficulty.wire}',
          );
          debugPrint('NATIVE_BOARD:${problem.id}/${difficulty.wire}');
          results.add({
            'problem': problem.id,
            'difficulty': difficulty.wire,
            'generate_ms': networkMs,
            'generate_and_render_ms': timer.elapsedMilliseconds,
          });
          navigator.pop();
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 350));
          await route;
        }
      }
    }

    if (const bool.fromEnvironment('PROFILE_WIDGETS')) {
      debugProfileBuildsEnabled = true;
      debugProfileLayoutsEnabled = true;
      try {
        await binding.traceAction(renderBoards, streams: ['Dart', 'Embedder']);
      } finally {
        debugProfileBuildsEnabled = false;
        debugProfileLayoutsEnabled = false;
      }
    } else {
      await renderBoards();
    }
    expect(
      results.length,
      (const bool.fromEnvironment('PROFILE_WIDGETS')
              ? 3
              : catalogue.topics.expand((t) => t.problems).length) *
          Difficulty.values.length,
    );
    await tester.pump(const Duration(milliseconds: 600));
    final report = {
      'boards': results,
      'build': frameStats(
        frames.map((f) => f.buildDuration.inMicroseconds).toList(),
      ),
      'raster': frameStats(
        frames.map((f) => f.rasterDuration.inMicroseconds).toList(),
      ),
    };
    debugPrint('NATIVE_CATALOGUE_JSON:${jsonEncode(report)}');
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(milliseconds: 500));
  });
}
