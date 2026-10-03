import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dsa_game_mobile/models/action.dart' as contract;
import 'package:dsa_game_mobile/models/spec.dart';
import 'package:dsa_game_mobile/models/state.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/state/game_controller.dart';
import 'package:dsa_game_mobile/widgets/board/object_tile.dart';
import 'package:dsa_game_mobile/widgets/mechanics/compare_pair.dart';
import 'package:dsa_game_mobile/widgets/mechanics/choose_path.dart';
import 'package:dsa_game_mobile/widgets/mechanics/submit_answer.dart';
import 'package:dsa_game_mobile/widgets/mechanics/assign_value.dart';
import 'package:dsa_game_mobile/models/guidance.dart';

import 'fixtures.dart';

class RecordingController extends GameController {
  RecordingController({this.prompt}) : super(ApiClient());
  final TurnPrompt? prompt;
  @override
  TurnPrompt? get turnPrompt => prompt;
  final actions = <contract.Action>[];
  @override
  Future<void> dispatch(contract.Action action) async {
    actions.add(action);
  }
}

void main() {
  testWidgets(
    'a newly introduced variable is reachable and a failed assignment retains its draft',
    (tester) async {
      final controller = RecordingController(
        prompt: TurnPrompt.from({
          'mechanic': 'assignValue',
          'assignmentTargetIds': ['prefix_1'],
        }),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AssignValueMechanic(
              controller: controller,
              spec: GameSpec.from(specJson),
              state: GameState.from(generateJson['state']),
              expectedIds: const {},
            ),
          ),
        ),
      );
      expect(find.text('prefix_1'), findsOneWidget);
      await tester.enterText(find.byType(TextField), '20');
      await tester.pump();
      await tester.tap(find.text('Assign'));
      await tester.pump();
      final action = controller.actions.single as contract.AssignValueAction;
      expect(action.targetId, 'prefix_1');
      expect(action.value, '20');
      expect(find.text('20'), findsOneWidget);
    },
  );

  test('branch candidates are not presented as recommended moves', () {
    final prompt = TurnPrompt.from({
      'mechanic': 'choosePath',
      'targets': [
        {'id': 'middle', 'role': 'current'},
        {'id': 'right', 'role': 'candidate'},
      ],
    });
    expect(prompt.objectIds, {'middle'});
  });
  testWidgets('typing enables Submit and sends the typed answer', (
    tester,
  ) async {
    final controller = RecordingController();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SubmitAnswerMechanic(
            controller: controller,
            spec: GameSpec.from(specJson),
            state: GameState.from(generateJson['state']),
            expectedIds: const {'o6'},
          ),
        ),
      ),
    );
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit'))
          .onPressed,
      isNull,
    );
    await tester.enterText(find.byType(TextField), '6');
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit'))
          .onPressed,
      isNotNull,
    );
    await tester.tap(find.text('Submit'));
    await tester.pump();
    expect(
      (controller.actions.single as contract.SubmitAnswerAction).value,
      '6',
    );
    expect(
      (controller.actions.single as contract.SubmitAnswerAction).targetId,
      'o6',
    );
    await tester.enterText(find.byType(TextField), '');
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit'))
          .onPressed,
      isNull,
    );
  });
  testWidgets(
    'target pool and operand replacements stay local until comparing',
    (tester) async {
      final controller = RecordingController();
      final state = GameState.from(generateJson['state']);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ComparePairMechanic(
              controller: controller,
              spec: GameSpec.from(specJson),
              state: state,
              expectedIds: const {},
            ),
          ),
        ),
      );
      Finder token(String id) =>
          find.byWidgetPredicate((w) => w is ObjectTile && w.object.id == id);
      await tester.tap(token('o4'));
      await tester.tap(token('t1'));
      await tester.pump();
      expect(controller.actions, isEmpty);
      expect(find.text('First: 31'), findsOneWidget);
      expect(find.text('Second: 55'), findsOneWidget);
      await tester.tap(find.text('Change first'));
      await tester.pump();
      await tester.tap(token('o6'));
      await tester.pump();
      expect(find.text('First: 55'), findsOneWidget);
      expect(find.text('Second: 55'), findsOneWidget);
      await tester.tap(find.text('found'));
      await tester.pump();
      expect(controller.actions, hasLength(1));
      final action = controller.actions.single as contract.ComparePairAction;
      expect(action.aId, 'o6');
      expect(action.bId, 't1');
    },
  );
  testWidgets('numeric range branch sends the middle object ID', (
    tester,
  ) async {
    final controller = RecordingController();
    final state = GameState.from(generateJson['state']);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChoosePathMechanic(
            controller: controller,
            spec: GameSpec.from(specJson),
            state: state,
            expectedIds: const {},
          ),
        ),
      ),
    );
    await tester.tap(find.text('Keep right: 5–7'));
    await tester.pump();
    final action = controller.actions.single as contract.ChoosePathAction;
    expect(action.fromId, 'o4');
    expect(action.pathId, 'right');
  });
}
