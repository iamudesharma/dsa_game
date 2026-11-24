import 'dart:convert';

import 'package:dsa_game_mobile/models/state.dart';
import 'package:dsa_game_mobile/models/spec.dart';
import 'package:dsa_game_mobile/widgets/board/slot_grid.dart';
import 'package:dsa_game_mobile/widgets/trace_rail.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures.dart';

void main() {
  testWidgets('long action labels fit a narrow, scrubbable trace', (
    tester,
  ) async {
    final json = jsonDecode(
      jsonEncode(wrongActionJson['state']),
    ) as Map<String, dynamic>;
    json['objects']['o4']['label'] = 'A long descriptive object label';
    final state = GameState.from(json);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 260,
              child: TraceRail(
                state: state,
                scrubbable: const {0},
                onScrub: (_) {},
              ),
            ),
          ),
        ),
      ),
    );
    expect(
      find.textContaining('A long descriptive object label'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('collapsed binary search pointers fit one cell', (tester) async {
    final state = GameState.from(generateJson['state']);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 66,
              child: SlotCell(
                slot: state.slot('s4')!,
                spec: GameSpec.from(specJson),
                pointers: const {
                  CursorPointer.lo: 's4',
                  CursorPointer.mid: 's4',
                  CursorPointer.hi: 's4',
                },
                width: 66,
                child: const Text('31'),
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.text('lo'), findsOneWidget);
    expect(find.text('mid'), findsOneWidget);
    expect(find.text('hi'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
