import 'dart:async';
import 'dart:convert';

import 'package:effect_core/effect_core.dart' as fx;

import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/services/api_exception.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dsa_game_mobile/services/api_policy.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class WaitingClient extends http.BaseClient {
  int attempts = 0;
  int aborted = 0;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    attempts++;
    await (request as http.AbortableRequest).abortTrigger;
    aborted++;
    throw http.RequestAbortedException(request.url);
  }
}

void main() {
  test('oversized responses fail once without retry', () async {
    var attempts = 0;
    final api = ApiClient(
      config: const ApiConfig(policy: ApiPolicy(maxResponseBytes: 16)),
      httpClient: MockClient((_) async {
        attempts++;
        return http.Response('x' * 32, 200);
      }),
    );
    addTearDown(api.closeAsync);
    await expectLater(api.learningPlans(), throwsA(isA<MalformedResponse>()));
    expect(attempts, 1);
  });

  test(
    'observer failures cannot change results and metrics drain on close',
    () async {
      final metrics = fx.RuntimeMetrics();
      final api = ApiClient(
        metrics: metrics,
        lifecycle: (_) => throw StateError('observer'),
        httpClient: MockClient((_) async => http.Response('{"plans":[]}', 200)),
      );
      expect(await api.learningPlans(), isEmpty);
      await api.closeAsync();
      expect(metrics.started, greaterThan(0));
      expect(metrics.active, 0);
      expect(metrics.completed, metrics.started);
    },
  );

  test(
    'overall read budget interrupts backoff before another attempt',
    () async {
      var attempts = 0;
      final api = ApiClient(
        config: const ApiConfig(
          policy: ApiPolicy(readBudgetMs: 30, retryDelayMs: 100),
        ),
        httpClient: MockClient((_) async {
          attempts++;
          return http.Response('{}', 503);
        }),
      );
      addTearDown(api.closeAsync);
      await expectLater(
        api.learningPlans(),
        throwsA(isA<ApiTimeoutException>()),
      );
      expect(attempts, 1);
    },
  );
  test('awaited close drains requests and is idempotent', () async {
    final client = WaitingClient();
    final api = ApiClient(httpClient: client);
    final result = expectLater(
      api.learningPlans(),
      throwsA(isA<ApiCancelledException>()),
    );
    while (client.attempts == 0) {
      await Future<void>.delayed(Duration.zero);
    }
    await api.closeAsync();
    expect(client.aborted, 1);
    await api.closeAsync();
    await result;
    await expectLater(
      api.learningPlans(),
      throwsA(isA<ApiCancelledException>()),
    );
  });
  test('transient GET recovers and carries authentication', () async {
    var attempts = 0;
    final api = ApiClient(
      httpClient: MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer test');
        attempts++;
        return http.Response(
          attempts < 3 ? '{}' : '{"plans":[]}',
          attempts < 3 ? 503 : 200,
        );
      }),
    )..setAuthToken('test');
    addTearDown(api.close);
    expect(await api.learningPlans(), isEmpty);
    expect(attempts, 3);
  });
  test('network retries are bounded and expose ApiException', () async {
    var attempts = 0;
    final api = ApiClient(
      httpClient: MockClient((_) async {
        attempts++;
        throw http.ClientException('offline');
      }),
    );
    addTearDown(api.close);
    await expectLater(
      api.learningPlans(),
      throwsA(isA<ApiUnreachableException>()),
    );
    expect(attempts, 3);
  });
  for (final status in [400, 401, 404, 429, 500]) {
    test('HTTP $status fails once', () async {
      var attempts = 0;
      final api = ApiClient(
        httpClient: MockClient((_) async {
          attempts++;
          return http.Response(
            jsonEncode({
              'error': {'code': 'FAILED', 'message': 'Rejected'},
            }),
            status,
          );
        }),
      );
      addTearDown(api.close);
      await expectLater(
        api.learningPlans(),
        throwsA(isA<ApiServerException>()),
      );
      expect(attempts, 1);
    });
  }
  test('mutations are never replayed', () async {
    var attempts = 0;
    final api = ApiClient(
      httpClient: MockClient((_) async {
        attempts++;
        return http.Response('{}', 503);
      }),
    );
    addTearDown(api.close);
    await expectLater(
      api.createLearningThread(),
      throwsA(isA<ApiServerException>()),
    );
    expect(attempts, 1);
  });
  test('permanent domain failure does not retry a transient status', () async {
    var attempts = 0;
    final api = ApiClient(
      httpClient: MockClient((_) async {
        attempts++;
        return http.Response(
          '{"error":{"code":"PROBLEM_NOT_PLAYABLE","message":"Unavailable"}}',
          503,
        );
      }),
    );
    addTearDown(api.close);
    await expectLater(api.learningPlans(), throwsA(isA<ApiServerException>()));
    expect(attempts, 1);
  });
  test('malformed JSON fails once', () async {
    var attempts = 0;
    final api = ApiClient(
      httpClient: MockClient((_) async {
        attempts++;
        return http.Response('invalid json', 200);
      }),
    );
    addTearDown(api.close);
    await expectLater(api.learningPlans(), throwsA(isA<MalformedResponse>()));
    expect(attempts, 1);
  });
  test('Effect timeouts abort each HTTP attempt', () async {
    final client = WaitingClient();
    final api = ApiClient(
      httpClient: client,
      config: const ApiConfig(requestTimeout: Duration(milliseconds: 10)),
    );
    addTearDown(api.close);
    await expectLater(api.learningPlans(), throwsA(isA<ApiTimeoutException>()));
    expect(client.attempts, 3);
    expect(client.aborted, 3);
  });
  test('caller cancellation stays non-retryable', () async {
    final client = WaitingClient();
    final abort = Completer<void>();
    final api = ApiClient(httpClient: client);
    addTearDown(api.close);
    final result = api.learningAction(
      'thread',
      'message',
      0,
      abortTrigger: abort.future,
    );
    final check = expectLater(result, throwsA(isA<ApiCancelledException>()));
    abort.complete();
    await check;
    expect(client.attempts, 1);
  });
  test('closing interrupts pending work and rejects later calls', () async {
    final client = WaitingClient();
    final api = ApiClient(httpClient: client);
    final check = expectLater(
      api.learningPlans(),
      throwsA(isA<ApiCancelledException>()),
    );
    await Future<void>.delayed(const Duration(milliseconds: 10));
    api.close();
    await check;
    expect(client.aborted, 1);
    await expectLater(
      api.learningPlans(),
      throwsA(isA<ApiCancelledException>()),
    );
  });
  for (final endpoint in ['interview', 'learning action']) {
    test(
      '$endpoint uses configured generation deadline and aborts once',
      () async {
        final client = WaitingClient();
        final api = ApiClient(
          httpClient: client,
          config: const ApiConfig(generateTimeout: Duration(milliseconds: 25)),
        );
        addTearDown(api.close);
        final operation = endpoint == 'interview'
            ? api.generateInterview()
            : api.learningAction('thread', 'message', 0);
        await expectLater(operation, throwsA(isA<ApiTimeoutException>()));
        expect(client.attempts, 1);
        expect(client.aborted, 1);
      },
    );
  }
}
