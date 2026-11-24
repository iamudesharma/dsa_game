/// Real HTTP validation on macOS or a physical device; no backend account data.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/services/api_exception.dart';
import 'package:dsa_game_mobile/services/api_policy.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'native Effect retries reads, bounds writes and cancels SSE over real HTTP',
    (tester) async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      var reads = 0, writes = 0, streamRequests = 0;
      var mode = 'recover';
      var connected = Completer<void>();
      final handlers = <Future<void>>[];
      final subscription = server.listen((request) {
        handlers.add(() async {
          await request.drain<void>();
          final response = request.response;
          try {
            if (request.uri.path.endsWith('/messages')) {
              streamRequests++;
              response.headers.contentType = ContentType(
                'text',
                'event-stream',
                charset: 'utf-8',
              );
              response.bufferOutput = false;
              response.write(
                'data: ${jsonEncode({'type': 'text', 'text': 'λ example'})}\r\n\r\n',
              );
              await response.flush();
              if (!connected.isCompleted) connected.complete();
              if (mode == 'complete') {
                response.write('data: {"type":"complete"}\n\n');
                await response.flush();
              }
              await Future<void>.delayed(const Duration(milliseconds: 500));
            } else {
              response.headers.contentType = ContentType.json;
              if (request.method == 'GET') {
                reads++;
                response.statusCode = mode == 'recover' && reads < 3
                    ? 503
                    : 200;
                response.write('{"plans":[]}');
              } else {
                writes++;
                response.statusCode = 503;
                response.write(
                  '{"error":{"code":"INTERNAL","message":"Unavailable"}}',
                );
              }
            }
            await response.close();
          } on HttpException {
            /* The test client aborts connections. */
          } on SocketException {
            /* The test client aborts connections. */
          }
        }());
      });
      final api = ApiClient(
        config: ApiConfig(
          baseUrl: 'http://127.0.0.1:${server.port}',
          policy: const ApiPolicy(retryDelayMs: 10, streamIdleTimeoutMs: 100),
        ),
      );
      try {
        expect(await api.learningPlans(), isEmpty);
        expect(reads, 3);
        await expectLater(
          api.createLearningThread(),
          throwsA(isA<ApiServerException>()),
        );
        expect(writes, 1);
        mode = 'complete';
        final events = await api
            .streamLearning('id', {}, Completer<void>().future)
            .toList();
        expect(events.map((event) => event['type']), ['text', 'complete']);
        expect(events.first['text'], 'λ example');
        mode = 'stall';
        connected = Completer<void>();
        await expectLater(
          api.streamLearning('id', {}, Completer<void>().future).toList(),
          throwsA(isA<ApiTimeoutException>()),
        );
        connected = Completer<void>();
        final abort = Completer<void>();
        final check = expectLater(
          api.streamLearning('id', {}, abort.future).toList(),
          throwsA(isA<ApiCancelledException>()),
        );
        await connected.future;
        abort.complete();
        await check;
        expect(streamRequests, 3);
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: Center(child: Text('Effect HTTP checks passed')),
            ),
          ),
        );
        await tester.pump();
        expect(find.text('Effect HTTP checks passed'), findsOneWidget);
      } finally {
        api.close();
        await subscription.cancel();
        await server.close(force: true);
        await Future.wait(handlers);
      }
    },
  );
}
