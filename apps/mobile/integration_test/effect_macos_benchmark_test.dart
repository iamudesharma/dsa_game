/// Native transport benchmark. Run in profile mode with integration_test/driver.dart.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dsa_game_mobile/models/api.dart';
import 'package:dsa_game_mobile/models/problem.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/services/api_exception.dart';
import 'package:dsa_game_mobile/services/api_policy.dart';
import 'package:effect_core/effect_core.dart' as fx;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';

Map<String, Object?> stats(List<int> micros) {
  final sorted = [...micros]..sort();
  return {
    'n': sorted.length,
    'p50_ms': sorted[(sorted.length * .5).floor()] / 1000,
    'p95_ms': sorted[(sorted.length * .95).floor()] / 1000,
    'mean_ms': sorted.reduce((a, b) => a + b) / sorted.length / 1000,
  };
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native latency and failure policy matrix', (tester) async {
    final results = <String, Object?>{
      'mode': kProfileMode ? 'profile' : 'debug',
    };
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var mode = 'ok', count = 0;
    final arrivals = <int>[];
    final epoch = Stopwatch()..start();
    final handlers = <Future<void>>[];
    final sub = server.listen((request) {
      handlers.add(() async {
        await request.drain<void>();
        count++;
        arrivals.add(epoch.elapsedMilliseconds);
        final response = request.response;
        try {
          if (mode == 'slow') {
            await Future<void>.delayed(const Duration(milliseconds: 300));
          }
          response.headers.contentType = ContentType.json;
          response.statusCode = mode == 'recover' && count < 3
              ? 503
              : int.tryParse(mode) ?? 200;
          response.write(mode == 'malformed' ? '{' : '{"plans":[]}');
          await response.close();
        } on HttpException {
          /* expected abort */
        } on SocketException {
          /* expected abort */
        }
      }());
    });
    final base = 'http://127.0.0.1:${server.port}';
    final raw = http.Client();
    final api = ApiClient(config: ApiConfig(baseUrl: base));
    final fast = ApiClient(
      config: ApiConfig(
        baseUrl: base,
        requestTimeout: const Duration(milliseconds: 50),
        generateTimeout: const Duration(milliseconds: 50),
        policy: const ApiPolicy(readRetries: 0),
      ),
    );
    try {
      final rawTimes = <int>[], effectTimes = <int>[];
      Future<void> direct(bool record) async {
        final timer = Stopwatch()..start();
        final response = await raw.get(Uri.parse('$base/api/learning/plans'));
        expect((jsonDecode(response.body) as Map)['plans'], isEmpty);
        if (record) rawTimes.add(timer.elapsedMicroseconds);
      }

      Future<void> wrapped(bool record) async {
        final timer = Stopwatch()..start();
        expect(await api.learningPlans(), isEmpty);
        if (record) effectTimes.add(timer.elapsedMicroseconds);
      }

      for (var i = 0; i < 20; i++) {
        await direct(false);
        await wrapped(false);
      }
      results['rss_before_bytes'] = ProcessInfo.currentRss;
      for (var i = 0; i < 200; i++) {
        if (i.isEven) {
          await direct(true);
          await wrapped(true);
        } else {
          await wrapped(true);
          await direct(true);
        }
      }
      results['raw_http'] = stats(rawTimes);
      results['effect_api'] = stats(effectTimes);
      results['rss_after_bytes'] = ProcessInfo.currentRss;
      final simple = fx.Effect.sync<int, String, fx.Unit>(() => 42);
      final shared = fx.Runtime(fx.Unit.value);
      final coreTimes = <int>[], ownerTimes = <int>[];
      try {
        for (var i = 0; i < 1000; i++) {
          final watch = Stopwatch()..start();
          expect(await shared.runFuture(simple), 42);
          coreTimes.add(watch.elapsedMicroseconds);
          watch.reset();
          final owned = fx.Runtime(fx.Unit.value);
          expect(await owned.runFuture(simple), 42);
          await owned.shutdown();
          ownerTimes.add(watch.elapsedMicroseconds);
        }
      } finally {
        await shared.shutdown();
      }
      results['simple_effect_shared_runtime'] = stats(coreTimes);
      results['simple_effect_owned_runtime'] = stats(ownerTimes);
      mode = 'recover';
      count = 0;
      arrivals.clear();
      final timer = Stopwatch()..start();
      await api.learningPlans();
      results['recovery_ms'] = timer.elapsedMilliseconds;
      results['retry_intervals_ms'] = [
        arrivals[1] - arrivals[0],
        arrivals[2] - arrivals[1],
      ];
      expect(count, 3);
      for (final code in ['401', '429', '500']) {
        mode = code;
        count = 0;
        await expectLater(
          api.learningPlans(),
          throwsA(isA<ApiServerException>()),
        );
        expect(count, 1);
      }
      mode = 'malformed';
      count = 0;
      await expectLater(api.learningPlans(), throwsA(isA<MalformedResponse>()));
      expect(count, 1);
      mode = '503';
      count = 0;
      await expectLater(
        api.createLearningThread(),
        throwsA(isA<ApiServerException>()),
      );
      expect(count, 1);
      mode = 'slow';
      count = 0;
      timer.reset();
      await expectLater(
        fast.learningPlans(),
        throwsA(isA<ApiTimeoutException>()),
      );
      results['deadline_50ms_observed_ms'] = timer.elapsedMilliseconds;
      expect(count, 1);
      final abort = Completer<void>();
      timer.reset();
      final check = expectLater(
        fast.generate(
          const GenerateRequest(
            problemId: 'binary-search',
            difficulty: Difficulty.easy,
          ),
          abortTrigger: abort.future,
        ),
        throwsA(isA<ApiCancelledException>()),
      );
      await Future<void>.delayed(const Duration(milliseconds: 10));
      abort.complete();
      await check;
      results['abort_after_10ms_observed_ms'] = timer.elapsedMilliseconds;
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Center(child: Text('Native Effect benchmark passed')),
          ),
        ),
      );
      await tester.pump();
    } finally {
      raw.close();
      api.close();
      fast.close();
      await sub.cancel();
      await server.close(force: true);
      await Future.wait(handlers);
      debugPrint('NATIVE_BENCHMARK_JSON:${jsonEncode(results)}');
    }
  });
}
