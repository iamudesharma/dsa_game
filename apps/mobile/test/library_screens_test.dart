/// Patterns and tracks screens against a mocked API.
///
/// Boots the real app through `MockClient` with the contract fixtures, then
/// walks into both screens from the adventure map: the pattern cards expand
/// to templates and play buttons, the tracks stamp from adventure progress,
/// and a play button generates through the fixture and lands on the board.
library;

import 'dart:convert';

import 'package:dsa_game_mobile/main.dart';
import 'package:dsa_game_mobile/screens/problem_screen.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fixtures.dart';

Future<void> _bootApp(WidgetTester tester) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  Future<http.Response> respond(http.BaseRequest request) async {
    final path = request.url.path;
    final payload = switch (path) {
      '/api/catalogue' => catalogueJson,
      '/api/health' => healthJson,
      '/api/generate' => generateJson,
      '/api/action' => wrongActionJson,
      '/api/hint' => hintJson,
      '/api/decide' => decideJson,
      _ => {
        'error': {'code': 'BAD_REQUEST', 'message': 'no route for $path'},
      },
    };
    final status = payload.containsKey('error') ? 404 : 200;
    return http.Response(
      jsonEncode(payload),
      status,
      headers: {'content-type': 'application/json'},
    );
  }

  await tester.pumpWidget(
    DsaGameApp(api: ApiClient(httpClient: MockClient(respond))),
  );
  await tester.pumpAndSettle();
}

/// Scrolls [listKey]'s list until [finder] is built. Flings the list itself
/// rather than dragging an anchor widget: anchors scroll out of view after
/// the first fling on a long list, while the list area always accepts the
/// gesture. Starts by flinging back to the top, because tab switches preserve
/// the scroll offset and the target may sit above the viewport.
Future<void> _scrollTo(
  WidgetTester tester,
  Finder finder,
  Finder listKey,
) async {
  for (var i = 0; i < 5; i++) {
    await tester.fling(listKey, const Offset(0, 500), 800);
    await tester.pumpAndSettle();
  }
  for (var i = 0; i < 15 && finder.evaluate().isEmpty; i++) {
    await tester.fling(listKey, const Offset(0, -500), 800);
    await tester.pumpAndSettle();
  }
}

void main() {
  testWidgets('patterns screen filters, expands and plays a mapped game', (
    tester,
  ) async {
    await _bootApp(tester);

    await tester.tap(find.text('Learn'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Patterns'));
    await tester.pumpAndSettle();
    expect(find.text('20 patterns that cover LeetCode'), findsOneWidget);

    // Filter narrows the library to the matching pattern.
    await tester.enterText(find.byType(TextField).first, 'palindrome');
    await tester.pumpAndSettle();
    expect(find.text('Two Pointers'), findsOneWidget);
    expect(find.text('Sliding Window'), findsNothing);

    // Expanding shows the template and the play affordance.
    await tester.tap(find.text('Two Pointers'));
    await tester.pumpAndSettle();
    expect(find.textContaining('L = 0, R = n-1'), findsOneWidget);

    // The fixture catalogue only knows binary-search: clear the filter and
    // play the one mapped game it can generate.
    await tester.enterText(find.byType(TextField).first, '');
    await tester.pumpAndSettle();
    await _scrollTo(
      tester,
      find.text('Modified Binary Search'),
      find.byKey(const ValueKey('patterns-list')),
    );
    await tester.tap(find.text('Modified Binary Search'));
    await tester.pumpAndSettle();
    final play = find.textContaining('Play: Find the target').first;
    await tester.ensureVisible(play);
    await tester.pumpAndSettle();
    await tester.tap(play);
    await tester.pumpAndSettle();
    expect(find.byType(ProblemScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tracks screen stamps mapped games and plays from the tour', (
    tester,
  ) async {
    await _bootApp(tester);

    await tester.tap(find.text('Learn'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Interview tracks'));
    await tester.pumpAndSettle();
    expect(find.text('Interview tracks'), findsOneWidget);
    expect(find.text('Interview Classics'), findsOneWidget);

    // The classics list renders categories with LeetCode numbers.
    await _scrollTo(
      tester,
      find.text('Arrays & Hashing'),
      find.byKey(const ValueKey('tracks-list-0')),
    );
    await tester.tap(find.text('Arrays & Hashing'));
    await tester.pumpAndSettle();
    expect(find.text('#1 Two Sum', findRichText: true), findsOneWidget);

    // The full tour derives from the fixture catalogue: two worlds, two games.
    // Category headers build eagerly, so no scroll is needed before tapping —
    // and flinging this short list only parks the header at an unhittable
    // edge. Scroll only for the play button, after expanding.
    await tester.tap(find.text('Full Tour'));
    await tester.pumpAndSettle();
    final category = find.text('Binary Search');
    await tester.ensureVisible(category);
    await tester.pumpAndSettle();
    await tester.tap(category);
    await tester.pumpAndSettle();
    final tourPlay = find.widgetWithText(
      TextButton,
      'Find the target in a sorted array',
    );
    await _scrollTo(
      tester,
      tourPlay,
      find.byKey(const ValueKey('tracks-list-1')),
    );
    await tester.tap(tourPlay);
    await tester.pumpAndSettle();
    expect(find.byType(ProblemScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
