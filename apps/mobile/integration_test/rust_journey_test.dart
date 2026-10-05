/// Run only against a disposable Rust service and local mock AI provider.
/// flutter test integration_test/rust_journey_test.dart -d macos
///   --dart-define=API_BASE_URL=http://127.0.0.1:8797
library;

import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/main.dart';
import 'package:dsa_game_mobile/models/action.dart';
import 'package:dsa_game_mobile/models/api.dart';
import 'package:dsa_game_mobile/models/problem.dart';
import 'package:dsa_game_mobile/screens/play_screen.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/state/auth_controller.dart';
import 'package:dsa_game_mobile/state/game_controller.dart';
import 'package:flutter/material.dart' hide Action;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';

Future<void> waitFor(WidgetTester tester, bool Function() ready) async {
  final deadline = DateTime.now().add(const Duration(seconds: 30));
  while (!ready() && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  expect(ready(), isTrue, reason: 'UI/network operation did not finish');
  await tester.pump(const Duration(milliseconds: 200));
}

Future<void> show(WidgetTester tester, Finder target) async {
  await tester.scrollUntilVisible(
    target,
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'native Flutter signs in, resumes, plays, undoes and streams with Rust',
    (tester) async {
      final reportError = FlutterError.onError;
      FlutterError.onError = (details) {
        debugPrint(details.toString());
        reportError?.call(details);
      };
      addTearDown(() => FlutterError.onError = reportError);
      final api = ApiClient();
      addTearDown(api.close);
      final email =
          'native-${DateTime.now().microsecondsSinceEpoch}@example.test';
      const password = 'native-test-password-123';
      await api.signup(email: email, password: password);
      final store = MemoryTokenStore();
      await tester.pumpWidget(
        DsaGameApp(
          api: api,
          authTokenStore: store,
          adventureBackend: MemoryBackend(),
        ),
      );
      await waitFor(
        tester,
        () => find.text('Play the Algorithms').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Profile'));
      await waitFor(tester, () => find.text('Sign in').evaluate().isNotEmpty);
      await tester.tap(find.text('Sign in'));
      await waitFor(
        tester,
        () => find.widgetWithText(TextFormField, 'Email').evaluate().isNotEmpty,
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Email'),
        email,
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Password (8+ characters)'),
        password,
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await waitFor(
        tester,
        () => find.text('Your profile').evaluate().isNotEmpty,
      );
      expect((await api.me()).user.email, email);

      final generated = await api.generate(
        const GenerateRequest(
          problemId: 'binary-search',
          seed: 0,
          difficulty: Difficulty.easy,
          forceTemplate: true,
        ),
      );
      await tester.tap(find.text('Progress'));
      await waitFor(
        tester,
        () => find.textContaining('Resume:').evaluate().isNotEmpty,
      );
      await tester.tap(find.textContaining('Resume:').first);
      await waitFor(
        tester,
        () => find.byType(PlayScreen).evaluate().isNotEmpty,
      );
      final game = tester
          .element(find.byType(PlayScreen))
          .read<GameController>();
      expect(game.gameId, generated.gameId);
      await game.dispatch(const SelectObjectAction(objectId: 'v3'));
      await game.requestHint();
      await tester.pumpAndSettle();
      expect(game.hint, isNotNull);
      await show(tester, find.text('Memory and move history'));
      await tester.tap(find.text('Memory and move history'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Undo move'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Undo move'));
      await waitFor(tester, () => game.state!.trace.isEmpty);
      expect(tester.takeException(), isNull);

      // Canonical seed-zero easy journey, sent through the real client/controller.
      const actions = [
        {'type': 'selectObject', 'objectId': 'v3'},
        {'type': 'comparePair', 'aId': 'v3', 'bId': 'target', 'relation': 'gt'},
        {'type': 'choosePath', 'fromId': 'v3', 'pathId': 'right'},
        {'type': 'selectObject', 'objectId': 'v5'},
        {'type': 'comparePair', 'aId': 'v5', 'bId': 'target', 'relation': 'lt'},
        {'type': 'choosePath', 'fromId': 'v5', 'pathId': 'left'},
        {'type': 'selectObject', 'objectId': 'v4'},
        {'type': 'comparePair', 'aId': 'v4', 'bId': 'target', 'relation': 'eq'},
        {'type': 'choosePath', 'fromId': 'v4', 'pathId': 'found'},
        {'type': 'submitAnswer', 'targetId': 'answer', 'value': '4'},
      ];
      for (final action in actions) {
        await game.dispatch(Action.fromJson(action)!);
        await tester.pumpAndSettle();
        expect(game.error, isNull);
        expect(game.lastOutcome!.correct, isTrue);
        expect(tester.takeException(), isNull, reason: 'after $action');
      }
      expect(game.isFinished, isTrue);
      expect(game.debrief, isNotNull);
      await tester.ensureVisible(find.text('Explore the algorithm'));
      await tester.tap(find.text('Explore the algorithm'));
      await waitFor(
        tester,
        () => find.text('You solved it').evaluate().isNotEmpty,
      );
      await tester.tap(find.byTooltip('Back to the board'));
      await tester.pumpAndSettle();
      Navigator.of(tester.element(find.byType(PlayScreen))).pop();
      await tester.pumpAndSettle();
      expect(
        (await api.learningHistory()).items.any(
          (record) => record.gameId == generated.gameId,
        ),
        isTrue,
      );

      await tester.tap(find.text('Chat'));
      await waitFor(
        tester,
        () => find.byTooltip('Send message').evaluate().isNotEmpty,
      );
      const question = 'Explain the binary search invariant';
      await tester.enterText(find.byType(TextField).last, question);
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Send message'));
      await waitFor(
        tester,
        () => find
            .textContaining(
              'Compare values and explain the invariant.',
              findRichText: true,
            )
            .evaluate()
            .isNotEmpty,
      );
      await waitFor(
        tester,
        () => find.byTooltip('Stop response').evaluate().isEmpty,
      );
      final threads = await api.learningThreads();
      expect(threads.items, isNotEmpty);
      final messages = await api.learningMessages(threads.items.first.id);
      expect(messages.items.any((message) => message.text == question), isTrue);
      expect(
        messages.items.any(
          (message) => message.text.contains('Compare values'),
        ),
        isTrue,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
