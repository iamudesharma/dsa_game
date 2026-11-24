/// Disposable live backend required; see native validation report.
library;

import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/main.dart';

import 'dart:convert';

import 'native_test_fixture.dart';

import 'package:dsa_game_mobile/models/account.dart';
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
  final deadline = DateTime.now().add(const Duration(seconds: 240));
  while (!ready() && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  expect(ready(), isTrue, reason: 'UI/network operation did not finish');
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  configureNativeTest(IntegrationTestWidgetsFlutterBinding.ensureInitialized());
  testWidgets('native Effect journey with live Node backend and provider', (
    tester,
  ) async {
    final reportError = FlutterError.onError;
    FlutterError.onError = (details) {
      debugPrint(details.toString());
      reportError?.call(details);
    };
    addTearDown(() => FlutterError.onError = reportError);
    final metrics = <String, Object?>{};
    final clock = Stopwatch()..start();
    void mark(String name) {
      metrics[name] = clock.elapsedMilliseconds;
      clock.reset();
      debugPrint('NATIVE_STAGE:$name=${metrics[name]}');
    }

    addTearDown(() {
      debugPrint('NATIVE_JOURNEY_JSON:${jsonEncode(metrics)}');
    });
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
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), email);
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
    mark('signup_ui_login_ms');
    expect((await api.fetchCatalogue()).topics, isNotEmpty);
    expect(await api.lessons(), isNotEmpty);
    final resume = await api.saveResume(
      const Resume(
        summary: 'Flutter engineer building reliable apps',
        skills: [Skill(id: 'skill:flutter', name: 'Flutter')],
      ),
    );
    expect((await api.fetchResume()).summary, resume.summary);
    await api.saveTarget(
      const Target(
        goal: 'Prepare for software engineer interview',
        companyId: 'google',
        focusAreas: ['algorithms'],
      ),
    );
    expect((await api.fetchTarget())!.companyId, 'google');
    expect(await api.fetchCompanies(), isNotEmpty);
    mark('profile_target_roundtrip_ms');
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
    await waitFor(tester, () => find.byType(PlayScreen).evaluate().isNotEmpty);
    final game = tester.element(find.byType(PlayScreen)).read<GameController>();
    expect(game.gameId, generated.gameId);
    await game.dispatch(const SelectObjectAction(objectId: 'v3'));
    await game.requestHint();
    await tester.pumpAndSettle();
    expect(game.hint, isNotNull);
    await game.undoLastAction();
    await tester.pumpAndSettle();
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
    mark('game_resume_hint_undo_solve_ms');
    await tester.ensureVisible(find.text('Explore the algorithm'));
    await tester.tap(find.text('Explore the algorithm'));
    await waitFor(
      tester,
      () => find.text('Your run, step by step').evaluate().isNotEmpty,
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
    await tester.pump(const Duration(seconds: 1));
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
        (message) =>
            message.role == 'assistant' &&
            message.text.isNotEmpty &&
            message.status == 'complete',
      ),
      isTrue,
    );
    mark('live_chat_ms');
    await api.renameLearningThread(
      threads.items.first.id,
      'Native reliability check',
    );
    expect(
      (await api.learningThreads(query: 'Native reliability')).items,
      isNotEmpty,
    );
    expect((await api.learningDashboard()).records, isNotEmpty);
    final kit = await api.generateInterview(seed: 0);
    expect(kit.questions, isNotEmpty);
    expect(
      (await api.fetchInterviewKit(kit.kitId)).questions.length,
      kit.questions.length,
    );
    expect(
      (await api.fetchInterviewKits()).any((k) => k.kitId == kit.kitId),
      isTrue,
    );
    metrics['interview_tier'] = kit.usedTier;
    mark('live_interview_generate_reopen_ms');

    final other = ApiClient();
    try {
      final account = await other.signup(
        email: 'other-$email',
        password: password,
      );
      other.setAuthToken(account.token);
      expect((await other.learningHistory()).items, isEmpty);
      expect((await other.learningThreads()).items, isEmpty);
      expect(await other.fetchInterviewKits(), isEmpty);
    } finally {
      other.close();
    }
    await api.deleteLearningThread(threads.items.first.id);
    expect((await api.learningThreads()).items, isEmpty);
    mark('persistence_isolation_cleanup_ms');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
}
