/// Stack / queue containers, drawn so the player's next legal move is obvious:
/// the element a `pop` would remove is always the one nearest the label.
library;

import 'package:flutter/material.dart';

import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'object_tile.dart';

class ContainerBoard extends StatelessWidget {
  const ContainerBoard({
    required this.state,
    required this.spec,
    required this.selectedIds,
    required this.highlightIds,
    this.onTapObject,
    this.onLongPressObject,
    this.dragBuilder,
    this.onTapContainer,
    this.maxHeight = 190,
    super.key,
  });

  final GameState state;
  final GameSpec spec;
  final Set<String> selectedIds;
  final Set<String> highlightIds;
  final void Function(GameObject object)? onTapObject;
  final void Function(GameObject object)? onLongPressObject;
  final Widget Function(Widget child, GameObject object)? dragBuilder;
  final void Function(GameContainer container)? onTapContainer;
  final double maxHeight;

  @override
  Widget build(BuildContext context) {
    final containers = state.containers.values.toList()
      ..sort((a, b) => a.id.compareTo(b.id));
    if (containers.isEmpty) return const SizedBox.shrink();

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final container in containers)
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: container == containers.last ? 0 : 10),
              child: _ContainerColumn(
                container: container,
                state: state,
                spec: spec,
                selectedIds: selectedIds,
                highlightIds: highlightIds,
                onTapObject: onTapObject,
                onLongPressObject: onLongPressObject,
                dragBuilder: dragBuilder,
                onTap: onTapContainer == null ? null : () => onTapContainer!(container),
                maxHeight: maxHeight,
              ),
            ),
          ),
      ],
    );
  }
}

class _ContainerColumn extends StatelessWidget {
  const _ContainerColumn({
    required this.container,
    required this.state,
    required this.spec,
    required this.selectedIds,
    required this.highlightIds,
    required this.onTapObject,
    required this.onLongPressObject,
    required this.dragBuilder,
    required this.maxHeight,
    this.onTap,
  });

  final GameContainer container;
  final GameState state;
  final GameSpec spec;
  final Set<String> selectedIds;
  final Set<String> highlightIds;
  final void Function(GameObject object)? onTapObject;
  final void Function(GameObject object)? onLongPressObject;
  final Widget Function(Widget child, GameObject object)? dragBuilder;
  final double maxHeight;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    // `displayOrder` puts a stack's top-of-stack first; a queue reads front
    // first. The player always reads top-down, and the "next" element is the
    // one the algorithm would pop / dequeue.
    final ids = container.displayOrder;
    final capacity = container.capacity;
    final isFull = container.isFull;
    final isQueue = container.kind == ContainerKind.queue;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 10),
        decoration: BoxDecoration(
          color: Color.lerp(colors.surface, Colors.black, 0.18)!,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isFull ? colors.danger.withValues(alpha: 0.7) : colors.muted.withValues(alpha: 0.3),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  isQueue ? Icons.login_rounded : Icons.vertical_align_top_rounded,
                  size: 13,
                  color: colors.accent,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    (container.label ?? container.kind.wire).toUpperCase(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.0,
                      color: colors.muted,
                    ),
                  ),
                ),
                if (capacity != null)
                  Text(
                    '${ids.length}/$capacity',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: isFull ? colors.danger : colors.muted,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            if (ids.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Text(
                  isQueue ? 'empty' : 'empty',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 10, color: colors.muted.withValues(alpha: 0.7)),
                ),
              )
            else
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: maxHeight),
                child: SingleChildScrollView(
                  reverse: true,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (var i = 0; i < ids.length; i++) ...[
                        if (i > 0) const SizedBox(height: 5),
                        _buildItem(context, ids[i], isQueue ? i : ids.length - 1 - i),
                      ],
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 6),
            Container(
              height: 3,
              decoration: BoxDecoration(
                color: colors.muted.withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildItem(BuildContext context, String objectId, int displayIndex) {
    final object = state.object(objectId);
    if (object == null) return const SizedBox.shrink();
    Widget tile = ObjectTile(
      object: object,
      spec: spec,
      selected: selectedIds.contains(object.id),
      highlighted: highlightIds.contains(object.id),
      showLabel: true,
    );
    if (dragBuilder != null) tile = dragBuilder!(tile, object);
    if (onTapObject != null || onLongPressObject != null) {
      tile = GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTapObject == null ? null : () => onTapObject!(object),
        onLongPress: onLongPressObject == null ? null : () => onLongPressObject!(object),
        child: tile,
      );
    }
    return Row(
      children: [
        Expanded(child: tile),
      ],
    );
  }
}
