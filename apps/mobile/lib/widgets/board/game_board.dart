/// The game board: the one widget every mechanic draws through.
///
/// It decides *what* to show (slots, nodes, containers, pool) from the state,
/// and lets the mechanic decide *how* it responds (taps, long-presses, drags)
/// via callbacks. Keeping layout here means all ten mechanics stay visually
/// consistent, and a spec that enables a mechanic whose data it does not
/// provide still renders (its section is simply absent) instead of crashing.
library;

import 'package:flutter/material.dart';

import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'container_board.dart';
import 'node_board.dart';
import 'object_tile.dart';
import 'slot_grid.dart';

class GameBoard extends StatelessWidget {
  const GameBoard({
    required this.state,
    required this.spec,
    this.selectedIds = const <String>{},
    this.highlightIds = const <String>{},
    this.onObjectTap,
    this.onObjectLongPress,
    this.onSlotTap,
    this.slotTapEnabled = false,
    this.dragObjectBuilder,
    this.dragTargetBuilder,
    this.onNodeTap,
    this.onPanStart,
    this.onPanUpdate,
    this.onPanEnd,
    this.dragFromId,
    this.dragPoint,
    this.poolTitle = 'in hand',
    this.poolFilter,
    this.poolOnTap,
    this.poolOnLongPress,
    this.poolDragBuilder,
    this.showPool = true,
    this.showSlotLabels = true,
    super.key,
  });

  final GameState state;
  final GameSpec spec;

  /// Ids to draw as "selected" — normally `state.selection` plus the player's
  /// optimistic pending taps.
  final Set<String> selectedIds;

  /// Ids referenced by `outcome.expected`; drawn with an accent ring.
  final Set<String> highlightIds;

  final void Function(GameObject object)? onObjectTap;
  final void Function(GameObject object)? onObjectLongPress;
  final void Function(Slot slot)? onSlotTap;
  final bool slotTapEnabled;

  /// Wraps an object tile in drag behaviour (e.g. `LongPressDraggable`).
  final Widget Function(Widget child, GameObject object)? dragObjectBuilder;

  /// Wraps a slot in `DragTarget` behaviour.
  final Widget Function(Widget child, Slot slot)? dragTargetBuilder;

  final void Function(GameObject node)? onNodeTap;
  final void Function(String nodeId, Offset localPoint)? onPanStart;
  final void Function(Offset localPoint)? onPanUpdate;
  final void Function(String? targetId)? onPanEnd;
  final String? dragFromId;
  final Offset? dragPoint;

  final String poolTitle;
  final bool Function(GameObject object)? poolFilter;
  final void Function(GameObject object)? poolOnTap;
  final void Function(GameObject object)? poolOnLongPress;
  final Widget Function(Widget child, GameObject object)? poolDragBuilder;
  final bool showPool;
  final bool showSlotLabels;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final hasNodes = state.objects.values.any((o) => o.kind == GameObjectKind.node);

    Widget cellBuilder(BuildContext context, Slot slot, GameObject? occupant) {
      if (occupant == null) return const SizedBox.shrink();
      return ObjectTile(
        object: occupant,
        spec: spec,
        selected: selectedIds.contains(occupant.id),
        highlighted: highlightIds.contains(occupant.id),
        showLabel: showSlotLabels,
      );
    }

    final sections = <Widget>[];

    if (hasNodes) {
      sections.add(
        NodeBoard(
          state: state,
          spec: spec,
          selectedIds: selectedIds,
          highlightIds: highlightIds,
          onNodeTap: onNodeTap,
          onPanStart: onPanStart,
          onPanUpdate: onPanUpdate,
          onPanEnd: onPanEnd,
          dragFromId: dragFromId,
          dragPoint: dragPoint,
        ),
      );
    }

    if (state.slots.isNotEmpty) {
      sections.add(
        SlotGrid(
          state: state,
          spec: spec,
          selectedIds: selectedIds,
          highlightIds: highlightIds,
          cellBuilder: cellBuilder,
          onSlotTap: onSlotTap,
          slotTapEnabled: slotTapEnabled,
          dragTargetBuilder: dragTargetBuilder,
          onObjectTap: onObjectTap,
          onObjectLongPress: onObjectLongPress,
          dragObjectBuilder: dragObjectBuilder,
        ),
      );
    }

    if (state.containers.isNotEmpty) {
      sections.add(
        ContainerBoard(
          state: state,
          spec: spec,
          selectedIds: selectedIds,
          highlightIds: highlightIds,
          onTapObject: onObjectTap,
          onLongPressObject: onObjectLongPress,
          dragBuilder: dragObjectBuilder,
        ),
      );
    }

    if (showPool) {
      sections.add(
        ObjectPool(
          state: state,
          spec: spec,
          selectedIds: selectedIds,
          highlightIds: highlightIds,
          title: poolTitle,
          filter: poolFilter,
          onTap: poolOnTap,
          onLongPress: poolOnLongPress,
          dragBuilder: poolDragBuilder,
        ),
      );
    }

    if (sections.isEmpty) {
      return Center(
        child: Text(
          'This board has nothing to show yet.',
          style: TextStyle(color: colors.muted, fontSize: 13),
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < sections.length; i++) ...[
          if (i > 0) const SizedBox(height: 14),
          Flexible(child: sections[i]),
        ],
      ],
    );
  }
}
