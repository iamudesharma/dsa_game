import 'dart:async';
import 'dart:convert';

import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/services/api_exception.dart';
import 'package:dsa_game_mobile/services/api_policy.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

class StreamingClient extends http.BaseClient {
  StreamingClient({this.data = '', this.hangConnect = false});
  final String data;
  final bool hangConnect;
  int attempts = 0, aborted = 0, readerCancelled = 0;
  final connected = Completer<void>();
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    attempts++;
    final stop = (request as http.AbortableRequest).abortTrigger!;
    if (hangConnect) {
      connected.complete();
      await stop;
      aborted++;
      throw http.RequestAbortedException(request.url);
    }
    final controller = StreamController<List<int>>();
    controller.onCancel = () {
      readerCancelled++;
      unawaited(controller.close());
    };
    unawaited(
      stop.then((_) {
        aborted++;
        if (!controller.isClosed) {
          controller.addError(http.RequestAbortedException(request.url));
        }
      }),
    );
    if (data.isNotEmpty) controller.add(utf8.encode(data));
    connected.complete();
    return http.StreamedResponse(controller.stream, 200);
  }
}

class ChunkedClient extends http.BaseClient {
  ChunkedClient(this.data);
  final String data;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async =>
      http.StreamedResponse(
        Stream.fromIterable(utf8.encode(data).map((byte) => [byte])),
        200,
      );
}

class FailingCleanupClient extends http.BaseClient {
  int releases = 0;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final stream = StreamController<List<int>>();
    stream.onCancel = () {
      releases++;
      throw StateError('reader-cleanup');
    };
    return http.StreamedResponse(stream.stream, 200);
  }
}

const fastPolicy = ApiPolicy(
  streamConnectTimeoutMs: 30,
  streamIdleTimeoutMs: 30,
);

void main() {
  test(
    'stream timeout preserves cleanup failure instead of cancellation',
    () async {
      final client = FailingCleanupClient();
      final api = ApiClient(
        httpClient: client,
        config: const ApiConfig(policy: fastPolicy),
      );
      addTearDown(api.closeAsync);
      await expectLater(
        api.streamLearning('id', {}, Completer<void>().future).toList(),
        throwsA(isA<ApiCleanupException>()),
      );
      expect(client.releases, 1);
    },
  );
  test('awaited close releases a paused stream reader', () async {
    final client = StreamingClient(data: 'data: {"type":"text"}\n\n');
    final api = ApiClient(httpClient: client);
    final seen = Completer<void>();
    late StreamSubscription<Map<String, Object?>> subscription;
    subscription = api
        .streamLearning('id', {}, Completer<void>().future)
        .listen((_) {
          subscription.pause();
          seen.complete();
        });
    await seen.future;
    await api.closeAsync();
    expect(client.readerCancelled, 1);
    await subscription.cancel();
  });

  for (final newline in ['\r', '\n', '\r\n']) {
    test(
      'byte-split UTF8 and multiline SSE with ${jsonEncode(newline)}',
      () async {
        final api = ApiClient(
          httpClient: ChunkedClient(
            'data: {"type":"text",$newline'
            'data: "text":"λ"}$newline$newline'
            'data: {"type":"complete"}$newline$newline',
          ),
        );
        addTearDown(api.closeAsync);
        final events = await api
            .streamLearning('id', {}, Completer<void>().future)
            .toList();
        expect(events.first['text'], 'λ');
        expect(events.last['type'], 'complete');
      },
    );
  }
  test('EOF without terminal event fails without reconnecting', () async {
    final api = ApiClient(
      httpClient: ChunkedClient('data: {"type":"text"}\n\n'),
    );
    addTearDown(api.closeAsync);
    await expectLater(
      api.streamLearning('id', {}, Completer<void>().future).toList(),
      throwsA(isA<MalformedResponse>()),
    );
  });

  for (final data in ['data: ${'x' * 100}', 'data: ${'x' * 100}\n\n']) {
    test(
      'oversized stream frame aborts without replay: ${data.length}',
      () async {
        final client = StreamingClient(data: data);
        final api = ApiClient(
          httpClient: client,
          config: const ApiConfig(
            policy: ApiPolicy(maxStreamFrameCharacters: 32),
          ),
        );
        addTearDown(api.closeAsync);
        await expectLater(
          api.streamLearning('id', {}, Completer<void>().future).toList(),
          throwsA(isA<MalformedResponse>()),
        );
        expect(client.attempts, 1);
        expect(client.readerCancelled, 1);
      },
    );
  }
  test('policy disables automatic read retry', () async {
    final client = StreamingClient(hangConnect: true);
    final api = ApiClient(
      httpClient: client,
      config: const ApiConfig(
        policy: ApiPolicy(readRetries: 0),
        requestTimeout: Duration(milliseconds: 10),
      ),
    );
    addTearDown(api.close);
    await expectLater(api.learningPlans(), throwsA(isA<ApiTimeoutException>()));
    expect(client.attempts, 1);
  });
  test('generation default leaves room for the provider deadline', () {
    expect(const ApiConfig().generateTimeout, const Duration(seconds: 240));
  });
  test('stream connection timeout aborts transport without replay', () async {
    final client = StreamingClient(hangConnect: true);
    final api = ApiClient(
      httpClient: client,
      config: const ApiConfig(policy: fastPolicy),
    );
    addTearDown(api.close);
    await expectLater(
      api.streamLearning('id', {}, Completer<void>().future).toList(),
      throwsA(isA<ApiTimeoutException>()),
    );
    expect(client.attempts, 1);
    expect(client.aborted, 1);
  });
  test('idle timeout cancels the reader without replay', () async {
    final client = StreamingClient();
    final api = ApiClient(
      httpClient: client,
      config: const ApiConfig(policy: fastPolicy),
    );
    addTearDown(api.close);
    await expectLater(
      api.streamLearning('id', {}, Completer<void>().future).toList(),
      throwsA(isA<ApiTimeoutException>()),
    );
    expect(client.attempts, 1);
    expect(client.readerCancelled, 1);
  });
  test(
    'completion closes the reader even when server keeps socket open',
    () async {
      final client = StreamingClient(data: 'data: {"type":"complete"}\n\n');
      final api = ApiClient(httpClient: client);
      addTearDown(api.close);
      final events = await api
          .streamLearning('id', {}, Completer<void>().future)
          .toList();
      expect(events.single['type'], 'complete');
      expect(client.readerCancelled, 1);
    },
  );
  test('caller cancellation interrupts connection establishment', () async {
    final client = StreamingClient(hangConnect: true),
        abort = Completer<void>();
    final api = ApiClient(httpClient: client);
    addTearDown(api.close);
    final check = expectLater(
      api.streamLearning('id', {}, abort.future).toList(),
      throwsA(isA<ApiCancelledException>()),
    );
    await client.connected.future;
    abort.complete();
    await check;
    expect(client.attempts, 1);
    expect(client.aborted, 1);
  });
  test('client close interrupts an active stream', () async {
    final client = StreamingClient();
    final active = ApiClient(httpClient: client);
    final check = expectLater(
      active.streamLearning('id', {}, Completer<void>().future).toList(),
      throwsA(isA<ApiCancelledException>()),
    );
    await client.connected.future;
    await Future<void>.delayed(const Duration(milliseconds: 10));
    active.close();
    await check;
    expect(client.readerCancelled, 1);
  });
  test('consumer cancellation releases an active stream', () async {
    final client = StreamingClient(
      data: 'data: {"type":"text","text":"partial"}\n\n',
    );
    final api = ApiClient(httpClient: client);
    addTearDown(api.close);
    final seen = Completer<void>();
    final subscription = api
        .streamLearning('id', {}, Completer<void>().future)
        .listen((_) => seen.complete());
    await seen.future;
    await subscription.cancel();
    expect(client.readerCancelled, 1);
  });
}
