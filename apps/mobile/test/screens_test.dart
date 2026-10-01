/// Widget smoke tests against a mocked API.
///
/// The server is not always running while the client is being built, so these
/// drive the real screens through `MockClient` with the contract fixtures. They
/// exist to catch what `flutter analyze` cannot: a layout that overflows on a
/// phone, a screen that throws while parsing a thin spec, a control that cannot
/// be reached one-handed.
library;

import 'dart:convert';

import 'package:dsa_game_mobile/main.dart';
import 'package:dsa_game_mobile/models/action.dart';
import 'package:dsa_game_mobile/screens/debrief_screen.dart';
import 'package:dsa_game_mobile/screens/play_screen.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/state/game_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

import 'fixtures.dart';

/// Every request the app can make, recorded for assertions.
class _RecordingClient extends MockClient {
  _RecordingClient(this.routes) : super((request) => _respond(request, routes));

  final Map<String, Object? Function(http.BaseRequest)> routes;

  static Future<http.Response> _respond(
    http.BaseRequest request,
    Map<String, Object? Function(http.BaseRequest)> routes,
  ) async {
    final path = request.url.path;
    final handler = routes[path];
    if (handler == null) {
      return http.Response(
        jsonEncode({
          'error': {'code': 'BAD_REQUEST', 'message': 'no route for $path'},
        }),
        404,
        headers: {'content-type': 'application/json'},
      );
    }
    return http.Response(
      jsonEncode(handler(request)),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}

/// A phone-shaped surface: a small, tall screen is the worst case for the board.
const _phone = Size(390, 844);

Future<void> _bootApp(
  WidgetTester tester, {
  Map<String, Object? Function(http.BaseRequest)>? extraRoutes,
  _RecordingClient? client,
}) async {
  tester.view.physicalSize = _phone;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final mock = client ??
      _RecordingClient({
        '/api/catalogue': (_) => catalogueJson,
        '/api/health': (_) => healthJson,
        '/api/generate': (_) => generateJson,
        '/api/action': (_) => wrongActionJson,
        '/api/hint': (_) => hintJson,
        '/api/decide': (_) => decideJson,
        ...?extraRoutes,
      });

  await tester.pumpWidget(DsaGameApp(api: ApiClient(httpClient: mock)));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('topic screen lists the catalogue and its tiers', (tester) async {
    await _bootApp(tester);

    expect(find.text('Play the Algorithms'), findsOneWidget);
    // Illustrated destinations with algorithm names alongside world names.
    // The map is a lazy list under the hero and the onboarding card, so each
    // row is scrolled into view before asserting — an unbuilt row is not a
    // missing row.
    await _scrollTo(tester, find.text('Search Observatory'));
    expect(find.text('Search Observatory'), findsOneWidget);
    await _scrollTo(tester, find.text('Linked-list Railway'));
    expect(find.text('Linked-list Railway'), findsOneWidget);
    await _scrollTo(tester, find.text('Find the target in a sorted array'));
    expect(find.text('Find the target in a sorted array'), findsOneWidget);
    expect(find.text('Reverse a linked list'), findsOneWidget);
    // Suggested next mission orients the player.
    await _scrollTo(tester, find.text('Suggested next adventure'));
    expect(find.text('Suggested next adventure'), findsOneWidget);
    // Provider availability is surfaced in diagnostics, not hidden.
    await _scrollTo(tester, find.text('Connection & diagnostics'));
    await tester.tap(find.text('Connection & diagnostics'));
    await tester.pumpAndSettle();
    expect(find.text('opencode'), findsWidgets);
    expect(find.text('template'), findsWidgets);
  });

  testWidgets('an unreachable API shows a real error state, not a blank screen', (tester) async {
    tester.view.physicalSize = _phone;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final dead = MockClient((_) async => throw const _DeadSocket());
    await tester.pumpWidget(DsaGameApp(api: ApiClient(httpClient: dead)));
    await tester.pumpAndSettle();

    expect(find.text('Cannot reach the API'), findsOneWidget);
    expect(find.text('Reload the catalogue'), findsOneWidget);
  });

  testWidgets('problem screen generates, then the board renders with pointers and variables', (tester) async {
    await _bootApp(tester);

    // Topic -> problem.
    await _openMission(tester, 'Find the target in a sorted array');
    expect(find.text('The canonical algorithm'.toUpperCase()), findsOneWidget);
    expect(find.textContaining('Binary search halves'), findsOneWidget);

    // Wish box is wired to /api/decide on generate.
    await tester.enterText(
      find.byType(TextField).first,
      'make it a heist and give me a hard one',
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Start mission'));
    await tester.pumpAndSettle();

    // The play screen pushed itself once the spec arrived.
    expect(find.byType(PlayScreen), findsOneWidget);
    expect(find.text('The Ledger Room'), findsOneWidget);
    expect(find.textContaining('Halve the search space'), findsOneWidget);
    // lo / mid / hi are drawn as pointer chips on the board and in the strip.
    expect(find.text('lo'), findsWidgets);
    expect(find.text('mid'), findsWidgets);
    expect(find.text('hi'), findsWidgets);
    // Variables from `state.variables` are on screen, each in its own chip.
    expect(find.text('ALGORITHM STATE'), findsOneWidget);
    expect(find.text('target'), findsOneWidget);
    expect(find.text('55'), findsWidgets);
    // The mechanism, not a bare spinner.
    // The binding label appears in the control strip and in the switcher chip.
    expect(find.text('read two entries against each other'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a wrong action shows the feedback and the expected move', (tester) async {
    final client = _RecordingClient({
      '/api/catalogue': (_) => catalogueJson,
      '/api/health': (_) => healthJson,
      '/api/generate': (_) => generateJson,
      '/api/action': (_) => wrongActionJson,
      '/api/hint': (_) => hintJson,
      '/api/decide': (_) => decideJson,
    });
    await _bootApp(tester, client: client);

    await _openMission(tester, 'Find the target in a sorted array');
    await tester.tap(find.text('Start mission'));
    await tester.pumpAndSettle();

    // The compare mechanic's two themed relation buttons.
    expect(find.text('nearer'), findsOneWidget);
    expect(find.text('further'), findsOneWidget);

    // Drive the engine directly: a tap round-trip is covered above, and this
    // keeps the assertion about the *presentation* of a mistake.
    await _gameController(tester).dispatch(
      const ComparePairAction(aId: 'o4', bId: 'o6', relation: Relation.gt),
    );
    await tester.pumpAndSettle();

    expect(find.text("Not the algorithm's move"), findsOneWidget);
    expect(find.textContaining('31 sits below 55'), findsOneWidget);
    // The affordance is collapsed until asked for.
    expect(find.text('The algorithm expected…'), findsOneWidget);
    await tester.tap(find.text('The algorithm expected…'));
    await tester.pumpAndSettle();
    expect(find.text('THE ALGORITHM EXPECTED'), findsOneWidget);
    // And the trace rail logged the mistake.
    expect(find.textContaining('TRACE · 1 step'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('undo takes the move back on the server, not just in the view', (tester) async {
    // Guards the distinction the two buttons exist for. Rewind scrubs the
    // view; Undo must change the game, and the trace has to shrink with it —
    // otherwise the debrief replays a step the player already took back.
    final client = _RecordingClient({
      '/api/catalogue': (_) => catalogueJson,
      '/api/health': (_) => healthJson,
      '/api/generate': (_) => generateJson,
      '/api/action': (_) => wrongActionJson,
      '/api/undo': (_) => undoActionJson,
      '/api/hint': (_) => hintJson,
      '/api/decide': (_) => decideJson,
    });
    await _bootApp(tester, client: client);

    await _openMission(tester, 'Find the target in a sorted array');
    await tester.tap(find.text('Start mission'));
    await tester.pumpAndSettle();

    final controller = _gameController(tester);
    expect(controller.canUndo, isFalse, reason: 'nothing has been played yet');

    await controller.dispatch(
      const ComparePairAction(aId: 'o4', bId: 'o6', relation: Relation.gt),
    );
    await tester.pumpAndSettle();
    expect(controller.canUndo, isTrue);
    expect(controller.state!.progress.steps, 1);
    expect(controller.state!.trace, hasLength(1));

    await controller.undoLastAction();
    await tester.pumpAndSettle();

    // The board AND the trace went back; this is a real undo.
    expect(controller.state!.progress.steps, 0);
    expect(controller.state!.trace, isEmpty);
    // A mistake is a fact about the player's history and deliberately survives.
    expect(controller.state!.progress.mistakes, 1);
    expect(controller.canUndo, isFalse, reason: 'the stack is now empty');
    expect(tester.takeException(), isNull);
  });

  testWidgets('undo is a no-op when the server has nothing to pop', (tester) async {
    final client = _RecordingClient({
      '/api/catalogue': (_) => catalogueJson,
      '/api/health': (_) => healthJson,
      '/api/generate': (_) => generateJson,
      '/api/action': (_) => wrongActionJson,
      '/api/undo': (_) => undoNoopJson,
      '/api/hint': (_) => hintJson,
      '/api/decide': (_) => decideJson,
    });
    await _bootApp(tester, client: client);

    await _openMission(tester, 'Find the target in a sorted array');
    await tester.tap(find.text('Start mission'));
    await tester.pumpAndSettle();

    final controller = _gameController(tester);
    await controller.dispatch(
      const ComparePairAction(aId: 'o4', bId: 'o6', relation: Relation.gt),
    );
    await tester.pumpAndSettle();

    // Server declines; the board must be left exactly as it was.
    final before = controller.state!.progress.steps;
    await controller.undoLastAction();
    await tester.pumpAndSettle();
    expect(controller.state!.progress.steps, before);
    expect(controller.state!.trace, hasLength(1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a finished game opens the debrief with replay, mapping and code', (tester) async {
    final client = _RecordingClient({
      '/api/catalogue': (_) => catalogueJson,
      '/api/health': (_) => healthJson,
      '/api/generate': (_) => generateJson,
      '/api/action': (_) => finishActionJson,
      '/api/hint': (_) => hintJson,
      '/api/decide': (_) => decideJson,
    });
    await _bootApp(tester, client: client);

    await _openMission(tester, 'Find the target in a sorted array');
    await tester.tap(find.text('Start mission'));
    await tester.pumpAndSettle();

    await _gameController(tester).dispatch(const SubmitAnswerAction(targetId: 't1', value: '6'));
    await tester.pumpAndSettle();

    // The victory moment is player-controlled: a stamp card, not an
    // automatic push to the debrief.
    expect(find.text('Mission complete. Stamp collected!'), findsOneWidget);
    expect(find.byType(DebriefScreen), findsNothing);
    await tester.tap(find.text('Explore the algorithm'));
    await tester.pumpAndSettle();

    // The debrief arrived on the player's terms.
    expect(find.text('You solved it'), findsOneWidget);
    expect(find.text('index 6'), findsOneWidget);
    expect(find.text('Play a new version of this game'), findsOneWidget);
    expect(tester.takeException(), isNull);

    // Replay tab: the played run, replayable.
    expect(find.text('Your run, step by step'), findsOneWidget);
    expect(find.textContaining('step 2 / 2'), findsOneWidget);

    // Explain tab: the action meanings and the metaphor -> algorithm table.
    await tester.tap(find.text('Explain'));
    await tester.pumpAndSettle();
    expect(find.text('What you were really doing'), findsOneWidget);
    expect(find.text('a[mid]'), findsWidgets);
    await _scrollTo(tester, find.text('metaphor → algorithm'.toUpperCase()));
    expect(find.text('the window'), findsOneWidget);

    // Code tab: real code, with the line the mistake ran on marked.
    await tester.tap(find.text('Code'));
    await tester.pumpAndSettle();
    expect(find.text('The algorithm itself'), findsOneWidget);
    expect(find.text('function search(a, target) {'), findsOneWidget);
    // Once for the real code, once for the pseudocode.
    expect(find.text('you reached this'), findsNWidgets(2));
    // A language switcher, because the contract ships more than one.
    expect(find.text('python'), findsOneWidget);

    // Explain tab ends with the coach's misconception. (Anything above the
    // scroll target is legitimately unmounted in a lazy ListView, so the
    // complexity chips are asserted in the contract test instead.)
    await tester.tap(find.text('Explain'));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('MISCONCEPTION SPOTTED'));
    expect(find.textContaining('which half survives'), findsWidgets);
    expect(tester.takeException(), isNull);

    // The bottom bar stays reachable: the "new version" button is the payoff.
    await tester.ensureVisible(find.text('Play a new version of this game'));
    await tester.tap(find.text('Play a new version of this game'));
    await tester.pumpAndSettle();
    // A fresh game was generated (no seed) and a new play screen was pushed.
    expect(find.byType(PlayScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the hint affordance shows its source', (tester) async {
    await _bootApp(tester);
    await _openMission(tester, 'Find the target in a sorted array');
    await tester.tap(find.text('Start mission'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hint').first);
    await tester.pumpAndSettle();
    expect(find.text('The middle entry decides which half you keep.'), findsOneWidget);
    expect(find.text('built-in'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

/// Drags the page until [finder] has a match, so the test does not depend on
/// how tall each section happens to render.
Future<void> _scrollTo(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 14 && finder.evaluate().isEmpty; i++) {
    await tester.drag(find.byType(ListView).last, const Offset(0, -280));
    await tester.pumpAndSettle();
  }
}

/// Opens a mission from the adventure map. The map is a lazy list under a
/// hero and an onboarding card, so the mission is scrolled into view first —
/// tapping blind assumes a viewport the card no longer guarantees.
Future<void> _openMission(WidgetTester tester, String title) async {
  final mission = find.text(title);
  await _scrollTo(tester, mission);
  await tester.ensureVisible(mission.first);
  await tester.pumpAndSettle();
  await tester.tap(mission.first);
  await tester.pumpAndSettle();
}

/// The single `GameController` installed by the app under test.
GameController _gameController(WidgetTester tester) => Provider.of<GameController>(
  tester.element(find.byType(PlayScreen)),
  listen: false,
);

/// Stands in for `SocketException`, which `dart:io` raises for a refused
/// connection; the client only needs *an* exception to classify.
class _DeadSocket implements Exception {
  const _DeadSocket();
}
