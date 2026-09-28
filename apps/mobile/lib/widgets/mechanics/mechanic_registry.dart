/// The mechanic registry: `MechanicId` -> widget.
///
/// `spec.mechanics` is authored by the LLM, so the client must be able to
/// render *any* subset of the catalog in any order without a combinatorial
/// explosion of screens. The active mechanic is a chip row on the play screen
/// and this switch turns the chosen id into its widget.
library;

import 'package:flutter/material.dart';

import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../state/game_controller.dart';
import 'assign_value.dart';
import 'choose_path.dart';
import 'compare_pair.dart';
import 'connect_nodes.dart';
import 'move_object.dart';
import 'push_pop.dart';
import 'select_object.dart';
import 'submit_answer.dart';
import 'swap_pair.dart';
import 'traverse_node.dart';

class MechanicRegistry {
  const MechanicRegistry._();

  static Widget build(
    MechanicId id, {
    required GameController controller,
    required GameSpec spec,
    required GameState state,
    required Set<String> expectedIds,
    Key? key,
  }) {
    Widget child = SelectObjectMechanic(
      controller: controller,
      spec: spec,
      state: state,
      expectedIds: expectedIds,
    );
    child = switch (id) {
      MechanicId.selectObject => child,
      MechanicId.moveObject => MoveObjectMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
      MechanicId.comparePair => ComparePairMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
      MechanicId.swapPair => SwapPairMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
      MechanicId.pushPop => PushPopMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
      MechanicId.choosePath => ChoosePathMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
      MechanicId.traverseNode => TraverseNodeMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
      MechanicId.connectNodes => ConnectNodesMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
      MechanicId.assignValue => AssignValueMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
      MechanicId.submitAnswer => SubmitAnswerMechanic(
        controller: controller,
        spec: spec,
        state: state,
        expectedIds: expectedIds,
      ),
    };
    return KeyedSubtree(key: key, child: child);
  }
}
