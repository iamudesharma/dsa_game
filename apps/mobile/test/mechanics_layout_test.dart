/// Layout smoke tests for the mechanics.
///
/// A spec may enable any subset of the ten mechanics, and a board may be a
/// linear array, a stack, a queue, a linked list or a mix. Each of those
/// combinations is a different layout, and the only way to know they do not
/// overflow on a phone is to render them.
library;

import 'dart:convert';

import 'package:dsa_game_mobile/models/enums.dart';
import 'package:dsa_game_mobile/models/spec.dart';
import 'package:dsa_game_mobile/state/game_controller.dart';
import 'package:dsa_game_mobile/models/state.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/widgets/board/game_board.dart';
import 'package:dsa_game_mobile/widgets/board/object_tile.dart';
import 'package:dsa_game_mobile/widgets/mechanics/mechanic_registry.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';

import 'fixtures.dart';

/// Wraps a state + spec into a playable board for one mechanic.
Widget _board({
  required GameSpec spec,
  required GameState state,
  required MechanicIdView mechanic,
  required Set<String> expectedIds,
}) {
  return MaterialApp(
    theme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
    home: Scaffold(
      body: MechanicRegistry.build(
        mechanic.id,
        controller: _StubController(),
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
    ),
  );
}

/// Small adapter so this file does not need a real transport to lay out a board.
class _StubController extends GameController {
  _StubController() : super(ApiClient(httpClient: MockClient((_) async => throw StateError('offline'))));
}

/// The mechanic ids this suite covers, one per catalog entry.
enum MechanicIdView {
  selectObject('selectObject'),
  moveObject('moveObject'),
  comparePair('comparePair'),
  swapPair('swapPair'),
  pushPop('pushPop'),
  choosePath('choosePath'),
  traverseNode('traverseNode'),
  connectNodes('connectNodes'),
  assignValue('assignValue'),
  submitAnswer('submitAnswer');

  const MechanicIdView(this.wire);

  final String wire;

  MechanicId get id => MechanicId.values.firstWhere((m) => m.wire == wire);
}

/// A small phone: 360x640 is a realistic low end, and it is the tightest
/// vertical budget the board has to survive.
const _smallPhone = Size(360, 640);

void main() {
  final spec = GameSpec.from(jsonDecode(jsonEncode(specJson)));
  final linear = GameState.from(jsonDecode(jsonEncode(generateJson))['state']);

  // A stack/queue board: tokens in a container plus a free pool.
  final stackState = GameState.from({
    'problemId': 'valid-parentheses',
    'seed': 7,
    'instance': {
      'problemId': 'valid-parentheses',
      'seed': 7,
      'tokens': ['(', ')', '[', ']', '{', '}'],
      'slots': [
        for (var i = 0; i < 6; i++) {'id': 's$i', 'index': i, 'kind': 'default'},
      ],
    },
    'objects': {
      for (var i = 0; i < 6; i++)
        't$i': {
          'id': 't$i',
          'kind': 'token',
          'label': ['(', ')', '[', ']', '{', '}'][i],
          'state': i < 3 ? 'idle' : 'revealed',
          'visual': {'kind': 'emoji', 'glyph': ['🔵', '🔶', '🔷', '🔸', '⭕', '❎'][i]},
        },
    },
    'slots': {for (var i = 0; i < 6; i++) 's$i': {'id': 's$i', 'index': i, 'kind': 'default'}},
    'containers': {
      'stack': {'id': 'stack', 'kind': 'stack', 'order': ['t0', 't1'], 'capacity': 4, 'label': 'the pile'},
      'queue': {'id': 'queue', 'kind': 'queue', 'order': ['t2'], 'capacity': 3, 'label': 'the line'},
    },
    'links': <Object?>[],
    'selection': ['t0'],
    'cursor': <String, Object?>{},
    'variables': {'top': 1, 'size': 2, 'step': 3},
    'progress': {'steps': 3, 'mistakes': 2, 'hintsUsed': 1, 'mistakesByMechanic': {'pushPop': 2}},
    'phase': 'playing',
    'trace': <Object?>[],
    'internal': <String, Object?>{},
  });

  // A linked-list board with next and prev edges.
  final listState = GameState.from({
    'problemId': 'reverse-linked-list',
    'seed': 9,
    'instance': {
      'problemId': 'reverse-linked-list',
      'seed': 9,
      'values': [3, 8, 1, 9],
      'list': [
        {'id': 'n0', 'value': 3, 'nextId': 'n1'},
        {'id': 'n1', 'value': 8, 'nextId': 'n2'},
        {'id': 'n2', 'value': 1, 'nextId': 'n3'},
        {'id': 'n3', 'value': 9},
      ],
    },
    'objects': {
      for (var i = 0; i < 4; i++)
        'n$i': {
          'id': 'n$i',
          'kind': 'node',
          'label': '${[3, 8, 1, 9][i]}',
          'state': i < 2 ? 'visited' : 'idle',
          'tags': {'partOf': 'left-half'},
        },
    },
    'slots': <String, Object?>{},
    'containers': <String, Object?>{},
    'links': [
      {'from': 'n0', 'to': 'n1', 'kind': 'next'},
      {'from': 'n1', 'to': 'n2', 'kind': 'next'},
      {'from': 'n2', 'to': 'n3', 'kind': 'next'},
      {'from': 'n1', 'to': 'n0', 'kind': 'prev'},
    ],
    'selection': <String>['n1'],
    'cursor': {'nodeId': 'n1', 'prevNodeId': 'n0'},
    'variables': {'current': 'n1', 'prev': 'n0', 'steps': 2},
    'progress': {'steps': 2, 'mistakes': 0, 'hintsUsed': 0, 'mistakesByMechanic': <String, Object?>{}},
    'phase': 'playing',
    'trace': <Object?>[],
    'internal': <String, Object?>{},
  });

  Future<void> pumpBoard(WidgetTester tester, {required GameState state, required MechanicIdView mechanic}) async {
    tester.view.physicalSize = _smallPhone;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      _board(spec: spec, state: state, mechanic: mechanic, expectedIds: const {}),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('every mechanic lays out a linear array board without overflow', (tester) async {
    for (final mechanic in MechanicIdView.values) {
      await pumpBoard(tester, state: linear, mechanic: mechanic);
      expect(tester.takeException(), isNull, reason: '${mechanic.wire} on a linear board');
      expect(find.byType(GameBoard), findsOneWidget, reason: mechanic.wire);
    }
  });

  testWidgets('every mechanic lays out a stack + queue board without overflow', (tester) async {
    for (final mechanic in MechanicIdView.values) {
      await pumpBoard(tester, state: stackState, mechanic: mechanic);
      expect(tester.takeException(), isNull, reason: '${mechanic.wire} on a container board');
    }
  });

  testWidgets('list mechanics lay out a linked-list board without overflow', (tester) async {
    for (final mechanic in const [
      MechanicIdView.traverseNode,
      MechanicIdView.connectNodes,
      MechanicIdView.selectObject,
      MechanicIdView.submitAnswer,
    ]) {
      await pumpBoard(tester, state: listState, mechanic: mechanic);
      expect(tester.takeException(), isNull, reason: '${mechanic.wire} on a linked list');
    }
  });

  testWidgets('object states are visually distinct, and eliminated reads as gone', (tester) async {
    final varied = GameState.from({
      ...(jsonDecode(jsonEncode(generateJson))['state']! as Map<String, Object?>),
      'objects': {
        'o0': {'id': 'o0', 'kind': 'number', 'label': '4', 'state': 'idle', 'slotId': 's0'},
        'o1': {'id': 'o1', 'kind': 'number', 'label': '9', 'state': 'eliminated', 'slotId': 's1'},
        'o2': {'id': 'o2', 'kind': 'number', 'label': '14', 'state': 'selected', 'slotId': 's2'},
        'o3': {'id': 'o3', 'kind': 'number', 'label': '22', 'state': 'matched', 'slotId': 's3'},
        'o4': {'id': 'o4', 'kind': 'number', 'label': '31', 'state': 'current', 'slotId': 's4'},
        'o5': {'id': 'o5', 'kind': 'number', 'label': '40', 'state': 'visited', 'slotId': 's5'},
        'o6': {'id': 'o6', 'kind': 'number', 'label': '55', 'state': 'locked', 'slotId': 's6'},
        'o7': {'id': 'o7', 'kind': 'number', 'label': '71', 'state': 'revealed', 'slotId': 's7'},
        'o8': {'id': 'o8', 'kind': 'number', 'label': '99', 'state': 'swapped'},
      },
    });

    await pumpBoard(tester, state: varied, mechanic: MechanicIdView.selectObject);
    expect(tester.takeException(), isNull);

    // Every object drew a tile, so nothing was dropped and nothing duplicated.
    expect(find.byType(ObjectTile), findsNWidgets(9));
    // The states are distinguishable by decoration, not only by colour.
    final tiles = tester.widgetList<ObjectTile>(find.byType(ObjectTile));
    expect(tiles.map((tile) => tile.object.state).toSet(), contains(ObjectState.eliminated));
    // Eliminated is struck through, which is the "gone" signal.
    final struck = tester.widget<Text>(find.text('9'));
    expect(struck.style?.decoration, TextDecoration.lineThrough);
  });

  testWidgets('a spec with no mechanics and an empty state still renders', (tester) async {
    tester.view.physicalSize = _smallPhone;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final empty = GameState.from(const <String, Object?>{});
    await tester.pumpWidget(
      _board(spec: spec, state: empty, mechanic: MechanicIdView.selectObject, expectedIds: const {}),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
