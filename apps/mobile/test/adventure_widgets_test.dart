/// Adventure-map and notebook widget tests.
///
/// The map, collection sheet and notebook render against a seeded
/// [MemoryBackend], so progression UI is verified without platform storage.
library;

import 'dart:convert';

import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/main.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fixtures.dart';

Future<void> _bootMap(
  WidgetTester tester, {
  MemoryBackend? backend,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  Future<http.Response> respond(http.BaseRequest request) async {
    final path = request.url.path;
    final payload = switch (path) {
      '/api/catalogue' => catalogueJson,
      '/api/health' => healthJson,
      _ => {
        'error': {'code': 'BAD_REQUEST', 'message': 'no route for $path'},
      },
    };
    final status = payload.containsKey('error') ? 404 : 200;
    return http.Response(jsonEncode(payload), status, headers: {'content-type': 'application/json'});
  }

  await tester.pumpWidget(
    DsaGameApp(
      api: ApiClient(httpClient: MockClient(respond)),
      adventureBackend: backend ?? MemoryBackend(),
    ),
  );
  await tester.pumpAndSettle();
}

String _seedWith(List<String> problemIds) => jsonEncode({
  'version': 1,
  'completed': {
    for (final id in problemIds) id: '2026-09-29T10:00:00.000Z',
  },
  'mapFrame': 'default',
});

void main() {
  testWidgets('a stamped mission shows its check and the collection counts it', (tester) async {
    await _bootMap(tester, backend: MemoryBackend(seed: _seedWith(['binary-search'])));

    // The binary-search world has one mission in the fixture catalogue, so it
    // completes outright. The map is a lazy list, so the completed world is
    // scrolled into view before asserting.
    for (var i = 0; i < 10 && find.text('★ complete').evaluate().isEmpty; i++) {
      await tester.drag(find.byType(ListView).first, const Offset(0, -400));
      await tester.pumpAndSettle();
    }
    expect(find.text('★ complete'), findsOneWidget);
    // The suggested mission lives on the following world card, which needs
    // its own scroll — each expect runs while its row is built.
    for (var i = 0; i < 10 && find.text('Suggested next adventure').evaluate().isEmpty; i++) {
      await tester.drag(find.byType(ListView).first, const Offset(0, -400));
      await tester.pumpAndSettle();
    }
    expect(find.text('Suggested next adventure'), findsOneWidget);

    await tester.tap(find.byTooltip('Your collection'));
    await tester.pumpAndSettle();
    expect(find.text('Your collection'), findsOneWidget);
    expect(find.textContaining('1 mission stamps'), findsOneWidget);
    expect(find.text('Collected!'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an unearned frame cannot be selected from the collection', (tester) async {
    await _bootMap(tester);
    await tester.tap(find.byTooltip('Your collection'));
    await tester.pumpAndSettle();
    // Sixteen world rows push the frame picker below the fold of the sheet's
    // lazy list, so it is not built until scrolled to. Drag the sheet's own
    // (always built) title upward until the picker materialises.
    for (var i = 0; i < 10 && find.text('Original').evaluate().isEmpty; i++) {
      await tester.drag(find.text('Your collection'), const Offset(0, -400));
      await tester.pumpAndSettle();
    }
    // Only the original frame is offered; no world is complete.
    expect(find.text('Original'), findsOneWidget);
    expect(find.text('Collected!'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the onboarding tips show once, dismiss, and come back on re-show', (tester) async {
    final backend = MemoryBackend();
    await _bootMap(tester, backend: backend);

    expect(find.text('Three things, then go explore'), findsOneWidget);
    expect(find.textContaining('highlighted tiles', findRichText: true), findsOneWidget);

    await tester.tap(find.text('Got it'));
    await tester.pumpAndSettle();
    expect(find.text('Three things, then go explore'), findsNothing);
    expect(await backend.readKey('play-the-algorithms:onboarding:v1'), 'seen');

    // The dismissed card leaves a re-show affordance, mirroring the web map.
    expect(find.text('Show the how-to-play tips'), findsOneWidget);
    await tester.tap(find.text('Show the how-to-play tips'));
    await tester.pumpAndSettle();
    expect(find.text('Three things, then go explore'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the problem screen shows study resources for the mission', (tester) async {
    await _bootMap(tester);

    // The fixture catalogue's binary-search mission trains a pattern and
    // stamps a classic, so its resource card has both halves. The map is a
    // lazy list under the onboarding card: scroll before tapping.
    for (var i = 0; i < 10 && find.text('Find the target in a sorted array').evaluate().isEmpty; i++) {
      await tester.fling(find.byType(ListView).first, const Offset(0, -500), 800);
      await tester.pumpAndSettle();
    }
    final mission = find.text('Find the target in a sorted array');
    await tester.ensureVisible(mission.first);
    await tester.pumpAndSettle();
    await tester.tap(mission.first);
    await tester.pumpAndSettle();
    final list = find.byKey(const ValueKey('problem-list'));
    for (var i = 0; i < 12 && find.text('STUDY RESOURCES').evaluate().isEmpty; i++) {
      await tester.fling(list, const Offset(0, -500), 800);
      await tester.pumpAndSettle();
    }
    expect(find.text('STUDY RESOURCES'), findsOneWidget);
    for (var i = 0; i < 6 && find.text('Modified Binary Search').evaluate().isEmpty; i++) {
      await tester.fling(list, const Offset(0, -500), 800);
      await tester.pumpAndSettle();
    }
    expect(find.text('Modified Binary Search'), findsOneWidget);
    expect(find.text('#704 Binary Search · Binary Search'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the field notebook shows readings, questions, languages and drafts', (tester) async {
    final backend = MemoryBackend();
    await _bootMap(tester, backend: backend);

    await tester.tap(find.byTooltip('Field notebook'));
    await tester.pumpAndSettle();
    expect(find.text('Field notebook'), findsOneWidget);
    expect(find.text('Singly linked lists in JavaScript'), findsOneWidget);
    for (var i = 0; i < 8 && find.text('Count the nodes').evaluate().isEmpty; i++) {
      await tester.drag(find.byType(ListView).first, const Offset(0, -300));
      await tester.pumpAndSettle();
    }
    expect(find.text('Count the nodes'), findsOneWidget);
    for (var i = 0; i < 8 && find.text('Reverse a singly linked list').evaluate().isEmpty; i++) {
      await tester.drag(find.byType(ListView).first, const Offset(0, -300));
      await tester.pumpAndSettle();
    }
    expect(find.text('Reverse a singly linked list'), findsOneWidget);

    // Drafts save through to storage, per question and language.
    await tester.enterText(find.byType(TextField).first, 'my count draft');
    await tester.pumpAndSettle();
    expect(
      await backend.readKey('play-the-algorithms:draft:count-nodes:javascript'),
      'my count draft',
    );
    expect(tester.takeException(), isNull);
  });
}
