import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:dsa_game_mobile/main.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/state/auth_controller.dart';
import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/screens/play_screen.dart';

import 'fixtures.dart';

class JourneyClient extends http.BaseClient {
  final requests = <http.BaseRequest>[];
  final messages = <Map<String, Object?>>[];
  bool created = false;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    final path = request.url.path;
    Object? data;
    if (path.endsWith('/messages') && request.method == 'POST') {
      final body = jsonDecode((request as http.Request).body) as Map;
      messages.add({
        'id': 'question',
        'role': 'user',
        'text': body['text'],
        'requestId': body['requestId'],
        'status': 'complete',
      });
      final answer = {
        'id': 'answer',
        'role': 'assistant',
        'text': 'Halve the sorted range.',
        'status': 'complete',
        'actions': [
          {'type': 'game', 'problemId': 'binary-search', 'difficulty': 'hard'},
        ],
      };
      messages.add(answer);
      return http.StreamedResponse(
        Stream.value(
          utf8.encode(
            'data: ${jsonEncode({'type': 'text', 'text': 'Halve the sorted range.'})}\n\ndata: ${jsonEncode({'type': 'complete', 'message': answer})}\n\n',
          ),
        ),
        200,
      );
    }
    if (path == '/api/auth/me') {
      data = {
        'user': {'id': 'learner', 'email': 'learner@example.test'},
        'resume': {},
        'progress': {},
      };
    } else if (path == '/api/catalogue') {
      data = catalogueJson;
    } else if (path == '/api/lessons') {
      data = {
        'lessons': [
          {
            'topic': 'binary-search',
            'title': 'Binary search',
            'concept': 'Halve the range.',
            'example': 'Find 3 in [1, 3, 5].',
            'code': 'return mid',
          },
        ],
      };
    } else if (path == '/api/health') {
      data = healthJson;
    } else if (path == '/api/learning/threads' && request.method == 'POST') {
      created = true;
      data = {
        'thread': {'id': 'thread-1', 'title': 'Search practice'},
      };
    } else if (path == '/api/learning/threads') {
      data = {
        'threads': created
            ? [
                {'id': 'thread-1', 'title': 'Search practice'},
              ]
            : [],
      };
    } else if (path == '/api/learning/threads/thread-1') {
      data = {'messages': messages};
    } else if (path.endsWith('/actions')) {
      data = generateJson;
    } else if (path.startsWith('/api/game/')) {
      data = {...generateJson, 'difficulty': 'hard'};
    } else if (path == '/api/learning/dashboard') {
      data = {
        'records': [
          {
            'gameId': generateJson['gameId'],
            'problemId': 'binary-search',
            'outcome': 'playing',
            'difficulty': 'hard',
          },
        ],
        'topics': [],
        'reviews': [],
        'completed': 0,
        'recommendation': {
          'action': 'resume',
          'gameId': generateJson['gameId'],
          'problemId': 'binary-search',
          'reason': 'Finish your saved run.',
        },
      };
    } else if (path == '/api/learning/history') {
      data = {'records': []};
    } else if (path == '/api/learning/plans') {
      data = {'plans': []};
    } else {
      data = {};
    }
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(data))),
      200,
    );
  }
}

Future<void> boot(WidgetTester tester, JourneyClient client) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final tokens = MemoryTokenStore();
  await tokens.write('test-session');
  await tester.pumpWidget(
    DsaGameApp(
      api: ApiClient(httpClient: client),
      authTokenStore: tokens,
      adventureBackend: MemoryBackend(),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('notebook empty search offers recovery and clears the field', (
    tester,
  ) async {
    await boot(tester, JourneyClient());
    await tester.tap(find.text('Learn'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'no matching concept');
    await tester.pumpAndSettle();
    expect(find.text('No concepts match your search.'), findsOneWidget);
    await tester.tap(find.text('Show all concepts'));
    await tester.pumpAndSettle();
    expect(find.text('Binary search'), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller!.text,
      isEmpty,
    );
  });

  testWidgets(
    'desktop uses side navigation and preserves the transcript across tabs',
    (tester) async {
      final client = JourneyClient();
      await boot(tester, client);
      tester.view.physicalSize = const Size(1100, 720);
      await tester.pumpAndSettle();
      expect(find.byType(NavigationRail), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      await tester.tap(find.text('Chat'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, 'Keep this draft');
      await tester.tap(find.text('Progress'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Chat'));
      await tester.pumpAndSettle();
      expect(find.text('Keep this draft'), findsOneWidget);
      expect(tester.takeException(), isNull);
      tester.view.physicalSize = const Size(390, 844);
      await tester.pumpAndSettle();
      expect(find.byType(NavigationRail), findsNothing);
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.text('Keep this draft'), findsOneWidget);
    },
  );
  testWidgets(
    'chat preview opens a game, returns to its transcript, and Progress resumes the saved run',
    (tester) async {
      final client = JourneyClient();
      await boot(tester, client);
      await tester.tap(find.text('Chat'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField).last,
        'Give me high binary-search practice',
      );
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(find.byTooltip('Send message'));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pumpAndSettle();
      expect(
        find.text('Halve the sorted range.', findRichText: true),
        findsOneWidget,
      );
      for (
        var i = 0;
        i < 8 && find.text('Generate and open').evaluate().isEmpty;
        i++
      ) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      await tester.tap(find.text('Generate and open'));
      await tester.pumpAndSettle();
      expect(find.byType(PlayScreen), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(
        find.text('Halve the sorted range.', findRichText: true),
        findsOneWidget,
      );
      await tester.enterText(
        find.byType(TextField).last,
        'Review my last attempt',
      );
      await tester.tap(find.text('Progress'));
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('Resume:'));
      await tester.pumpAndSettle();
      expect(find.byType(PlayScreen), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Chat'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField).last).controller!.text,
        'Review my last attempt',
      );
      expect(
        client.requests.where((r) => r.url.path.endsWith('/actions')),
        hasLength(1),
      );
      expect(
        client.requests
            .where((r) => r.url.path.startsWith('/api/learning/'))
            .every((r) => r.headers['authorization'] == 'Bearer test-session'),
        isTrue,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'composer and primary navigation remain usable with large text and a mobile keyboard',
    (tester) async {
      final client = JourneyClient();
      await boot(tester, client);
      tester.platformDispatcher.textScaleFactorTestValue = 1.5;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await tester.tap(find.text('Chat'));
      await tester.pumpAndSettle();
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, 'Explain this');
      await tester.pumpAndSettle();
      expect(find.byTooltip('Send message'), findsOneWidget);
      expect(
        tester.getRect(find.byTooltip('Send message')).bottom,
        lessThan(544),
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('landscape keyboard keeps the chat composer reachable', (
    tester,
  ) async {
    await boot(tester, JourneyClient());
    tester.view.physicalSize = const Size(844, 390);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Chat'));
    await tester.pumpAndSettle();
    tester.view.viewInsets = const FakeViewPadding(bottom: 210);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Explain this');
    await tester.pumpAndSettle();
    expect(
      tester.getRect(find.byTooltip('Send message')).bottom,
      lessThan(180),
    );
    expect(tester.takeException(), isNull);
  });
}
