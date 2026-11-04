/// Five-minute real loopback transport/ownership soak (no provider costs).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/services/api_exception.dart';
import 'package:dsa_game_mobile/services/api_policy.dart';
import 'package:effect_core/effect_core.dart' as fx;

Future<void> runEffectSoak() async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  var calls = 0;
  final handlers = <Future<void>>{};
  server.listen((request) {
    final work = () async {
      try {
        await request.drain<void>();
        calls++;
        if (request.uri.path.contains('/messages')) {
          request.response.headers.contentType = ContentType(
            'text',
            'event-stream',
          );
          request.response.write('data: {"type":"complete"}\r\n\r\n');
        } else if (calls % 7 == 0) {
          request.response.statusCode = 503;
          request.response.write('{}');
        } else {
          request.response.write('{"plans":[]}');
        }
        await request.response.close();
      } catch (_) {
        /* cancelled fixture sockets */
      }
    }();
    handlers.add(work);
    unawaited(work.whenComplete(() => handlers.remove(work)));
  });
  final metrics = fx.RuntimeMetrics();
  final timer = Stopwatch()..start();
  var cycles = 0;
  final samples = <Map<String, int>>[];
  try {
    do {
      final api = ApiClient(
        metrics: metrics,
        config: ApiConfig(
          baseUrl: 'http://127.0.0.1:${server.port}',
          policy: const ApiPolicy(retryDelayMs: 1, readBudgetMs: 1000),
        ),
      );
      try {
        if ((await api.learningPlans()).isNotEmpty) throw StateError('plans');
        final events = await api
            .streamLearning('soak', {}, Completer<void>().future)
            .toList();
        if (events.single['type'] != 'complete') throw StateError('terminal');
      } finally {
        await api.closeAsync();
      }
      if (metrics.active != 0) throw StateError('active fibers after shutdown');
      try {
        await api.learningPlans();
        throw StateError('closed client accepted work');
      } on ApiCancelledException {
        /* expected */
      }
      cycles++;
      if (cycles % 100 == 0) {
        samples.add({
          'ms': timer.elapsedMilliseconds,
          'rss': ProcessInfo.currentRss,
          'cycles': cycles,
        });
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    } while (timer.elapsed < const Duration(minutes: 5));
  } finally {
    await server.close(force: true);
    await Future.wait(handlers.toList());
  }
  stdout.writeln(
    jsonEncode({
      'cycles': cycles,
      'requests': calls,
      'elapsed_ms': timer.elapsedMilliseconds,
      'active_fibers': metrics.active,
      'started': metrics.started,
      'completed': metrics.completed,
      'rss_samples': samples,
    }),
  );
}
