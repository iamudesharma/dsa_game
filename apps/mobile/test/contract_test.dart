/// Model-level checks against the wire contract.
///
/// These are the tests that would catch a silent drift: a renamed field, an enum
/// value the server can send that the client cannot parse, a `Partial<Action>`
/// in `outcome.expected` that the lenient reader gives up on.
library;

import 'dart:convert';

import 'package:dsa_game_mobile/models/action.dart';
import 'package:dsa_game_mobile/models/api.dart';
import 'package:dsa_game_mobile/models/enums.dart';
import 'package:dsa_game_mobile/models/problem.dart';
import 'package:dsa_game_mobile/models/provider.dart';
import 'package:dsa_game_mobile/models/spec.dart';
import 'package:dsa_game_mobile/models/state.dart';
import 'package:dsa_game_mobile/services/api_exception.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures.dart';

void main() {
  group('catalogue', () {
    test('parses topics, problems, tiers and laya', () {
      final catalogue = CatalogueResponse.from(jsonDecode(jsonEncode(catalogueJson)));
      expect(catalogue.topics, hasLength(2));
      expect(catalogue.problemCount, 2);
      expect(catalogue.topics.first.label, 'Binary Search');
      expect(catalogue.topics.first.topic, DsaTopic.binarySearch);

      final problem = catalogue.problemById('binary-search')!;
      expect(problem.topic, DsaTopic.binarySearch);
      expect(problem.defaultDifficulty, Difficulty.easy);
      expect(problem.allowedMechanics, contains(MechanicId.comparePair));
      expect(problem.instanceHints.sorted, isTrue);
      expect(problem.instanceHints.valueRange, (1.0, 99.0));
      expect(problem.instanceHints.valueRangeLabel, '1–99');

      expect(catalogue.tiers.first.tier, ProviderTier.opencode);
      expect(catalogue.laya.enabled, isTrue);
      expect(catalogue.laya.isLive, isFalse);
    });
  });

  group('generate', () {
    test('parses the spec and the initial state', () {
      final response = GenerateResponse.from(jsonDecode(jsonEncode(generateJson)));

      expect(response.gameId, 'binary-search-abc123');
      expect(response.usedTier, ProviderTier.opencode);
      expect(response.attempts, hasLength(2));
      expect(response.attempts[1].ok, isFalse);
      expect(response.notes, ['spec repaired on attempt 2']);

      final spec = response.spec;
      expect(spec.theme.genre, Genre.detective);
      expect(spec.theme.tone, Tone.mysterious);
      expect(spec.visual.palette.primary, '#7AA2F7');
      expect(spec.visual.glyphFor(GameObjectKind.number), '❖');
      // A kind the spec did not describe falls back to the catalog default.
      expect(spec.visual.glyphFor(GameObjectKind.item), '◆');
      expect(spec.vocabulary.relationWords, ('nearer', 'found', 'further'));
      expect(spec.mechanics, hasLength(3));
      expect(spec.mechanics.first.boundDsaOp, DsaOp.compare);
      expect(spec.hasMechanic(MechanicId.choosePath), isTrue);
      expect(spec.narration.hintPool, hasLength(2));
      expect(spec.meaningOf('comparePair'), contains('which half survives'));
      expect(spec.debrief.mapping, hasLength(3));
      expect(spec.debrief.mapping.first.gameTerm, 'entry');

      final state = response.state;
      expect(state.phase, GamePhase.playing);
      expect(state.orderedSlots, hasLength(8));
      expect(state.occupantOf('s4')?.label, '31');
      expect(state.poolObjects.map((o) => o.id), contains('t1'));
      expect(state.cursor.midSlotId, 's4');
      expect(state.cursor.slotPointers.length, 3);
      expect(state.variables.display('mid'), '4');
      expect(state.variables.number('hi'), 7);
      expect(state.internal.number('passes'), 0);
      expect(state.progress.mistakes, 0);
    });

    test('rejects a payload with no gameId', () {
      final broken = Map<String, Object?>.of(generateJson)..remove('gameId');
      expect(
        () => GenerateResponse.from(broken),
        throwsA(isA<MalformedResponse>()),
      );
    });
  });

  group('action', () {
    test('parses a wrong outcome and its partial expected action', () {
      final response = ActionResponse.from(jsonDecode(jsonEncode(wrongActionJson)));
      expect(response.outcome.correct, isFalse);
      expect(response.outcome.dsaOp, DsaOp.compare);
      expect(response.outcome.traceStep, 0);
      expect(response.outcome.illegal, isFalse);
      expect(response.outcome.isMistake, isTrue);
      expect(response.outcome.feedback, contains('nearer'));

      final expected = response.outcome.expected!;
      expect(expected, isA<ComparePairAction>());
      expect((expected as ComparePairAction).relation, Relation.lt);

      expect(response.state.progress.mistakes, 1);
      expect(response.state.progress.mistakesFor(MechanicId.comparePair), 1);
      expect(response.state.trace, hasLength(1));

      final frame = response.state.trace.first;
      expect(frame.correct, isFalse);
      expect(frame.codeLine, 3);
      expect(frame.pointers.eliminated, hasLength(4));
      expect(frame.pointers.all, contains('o6'));
      expect(frame.variables.display('lo'), '5');
    });

    test('serialises every action variant back to the contract shape', () {
      const actions = <Action>[
        SelectObjectAction(objectId: 'o1'),
        MoveObjectAction(objectId: 'o1', toSlotId: 's2'),
        ComparePairAction(aId: 'a', bId: 'b', relation: Relation.eq),
        SwapPairAction(aId: 'a', bId: 'b'),
        PushPopAction(containerId: 'c1', op: StackOp.pop),
        ChoosePathAction(fromId: 'f', pathId: 'p'),
        TraverseNodeAction(fromNodeId: 'n0', toNodeId: 'n1'),
        ConnectNodesAction(fromNodeId: 'n0', toNodeId: 'n1', linkKind: LinkKind.prev),
        AssignValueAction(targetId: 'best', value: '42'),
        SubmitAnswerAction(targetId: 't1', value: '6', actionId: 'abc'),
      ];
      for (final action in actions) {
        final json = action.toJson();
        expect(json['type'], action.type.wire);
        // Round-trips: parse(emit(x)) == x for every variant.
        expect(Action.fromJson(json)?.toJson(), json, reason: action.type.wire);
      }
      // `actionId` is only sent when the client set one.
      expect(actions.first.toJson().containsKey('actionId'), isFalse);
      expect(actions.last.toJson()['actionId'], 'abc');
      // `pop` carries no objectId.
      expect((actions[4] as PushPopAction).toJson().containsKey('objectId'), isFalse);
    });
  });

  group('debrief', () {
    test('parses traces, code, stats and misconception', () {
      final debrief = Debrief.from(jsonDecode(jsonEncode(debriefJson)));

      expect(debrief.isWin, isTrue);
      expect(debrief.phase, GamePhase.won);
      expect(debrief.playedTrace, hasLength(2));
      expect(debrief.canonicalTrace, hasLength(2));
      expect(debrief.answer.text, 'index 6');
      expect(debrief.answer.valueText, '6');
      expect(debrief.answer.details, hasLength(2));
      expect(debrief.pseudocode, hasLength(8));
      expect(debrief.codeLanguages, ['javascript', 'python']);
      expect(debrief.complexity.time, 'O(log n)');
      expect(debrief.complexity.chips.first, ('time', 'O(log n)'));
      expect(debrief.mapping.first.algorithmTerm, 'a[mid]');
      expect(debrief.stats.misconception, contains('which half survives'));
      expect(debrief.stats.confidence, 0.82);
      expect(debrief.stats.mechanicTallies.first.$1, 'comparePair');
      expect(debrief.hintPool, isNotEmpty);

      // The player reached lines 3 and 7, and line 3 is where the mistake ran.
      expect(debrief.hitCodeLines, {3, 7});
      expect(debrief.mistakeCodeLines, {3});
    });

    test('ActionResponse carries the debrief once the run is over', () {
      final response = ActionResponse.from(jsonDecode(jsonEncode(finishActionJson)));
      expect(response.state.phase, GamePhase.won);
      expect(response.outcome.won, isTrue);
      expect(response.debrief, isNotNull);
      expect(response.debrief!.answer.text, 'index 6');
    });
  });

  group('hints, decisions and health', () {
    test('parses hint, decide and health', () {
      final hint = HintResponse.from(jsonDecode(jsonEncode(hintJson)));
      expect(hint.source, CoachSource.heuristic);

      final decision = DecideResponse.from(jsonDecode(jsonEncode(decideJson)));
      expect(decision.kind, DecisionKind.difficulty);
      expect(decision.source, CoachSource.laya);
      expect(decision.source.isLlm, isTrue);
      expect(decision.distribution!['medium'], 0.74);

      final health = HealthResponse.from(jsonDecode(jsonEncode(healthJson)));
      expect(health.ok, isTrue);
      expect(health.version, '0.1.0');
      expect(health.uptimeSec, 42.5);
      expect(health.tiers.first.detail, 'gateway up');
    });
  });

  group('defensive parsing', () {
    test('an empty spec still yields a renderable theme', () {
      final spec = GameSpec.from(const {});
      expect(spec.theme.title, 'Untitled scenario');
      expect(spec.vocabulary.object, 'element');
      expect(spec.mechanics, isEmpty);
      expect(spec.visual.palette.primary, '#6C8CFF');
    });

    test('an unknown enum value falls back instead of throwing', () {
      expect(MechanicId.parse('teleport'), MechanicId.selectObject);
      expect(DsaOp.parse('???'), DsaOp.read);
      expect(ObjectState.parse('???'), ObjectState.idle);
      expect(SlotKind.parse('???'), SlotKind.plain);
      expect(GamePhase.parse('???'), GamePhase.playing);
      expect(Relation.parse('???'), Relation.eq);
      expect(ProviderTier.parse('???'), ProviderTier.template);
      expect(Genre.parse('???'), Genre.everyday);
      expect(Difficulty.parse('???'), Difficulty.easy);
      expect(Difficulty.parse(null, fallback: Difficulty.hard), Difficulty.hard);
      expect(DsaTopic.tryParse('nope'), isNull);
    });

    test('malformed nested values do not crash the parser', () {
      final state = GameState.from({
        'objects': {'o1': 'not an object'},
        'slots': 'not a map',
        'containers': [],
        'links': 'nope',
        'selection': [1, 2, 'o1'],
        'variables': {'a': 1, 'b': 'two', 'c': true, 'd': null, 'e': '17'},
        'progress': {'steps': '3', 'mistakesByMechanic': {'comparePair': '2'}},
        'trace': [{'index': 0, 'action': {'type': 'nope'}}],
        'phase': 'won',
      });
      expect(state.objects['o1']?.state, ObjectState.idle);
      expect(state.slots, isEmpty);
      expect(state.selection, ['o1']);
      expect(state.variables.display('a'), '1');
      expect(state.variables.number('e'), 17);
      expect(state.variables.display('d'), '—');
      expect(state.progress.steps, 3);
      expect(state.progress.mistakesByMechanic['comparePair'], 2);
      expect(state.phase, GamePhase.won);
      // An unknown action type is replaced by a harmless placeholder so the
      // trace still renders rather than throwing inside a ListView.
      expect(state.trace, hasLength(1));
    });

    test('slot occupancy resolves from either direction of the contract', () {
      final byOccupant = GameState.from({
        'slots': {'s0': {'index': 0, 'occupantId': 'o1'}},
        'objects': {'o1': {'id': 'o1', 'label': 'x'}},
      });
      expect(byOccupant.occupantOf('s0')?.id, 'o1');

      final bySlotId = GameState.from({
        'slots': {'s0': {'index': 0}},
        'objects': {'o1': {'id': 'o1', 'label': 'x', 'slotId': 's0'}},
      });
      expect(bySlotId.occupantOf('s0')?.id, 'o1');
      expect(bySlotId.poolObjects, isEmpty);
    });
  });
}
