/// Linked-list board: nodes in a computed grid with painted `next` / `prev`
/// edges, plus a live drag pointer while the player is rewiring links.
///
/// Pan gestures are handled by the *board*, not by each node: the board already
/// knows every node rectangle, so hit-testing the start point in one place is
/// both simpler and more forgiving than asking each cell to track itself.
library;

import 'package:flutter/material.dart';

import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'link_painter.dart';
import 'object_tile.dart';
import 'pointer_badge.dart';

class NodeBoard extends StatefulWidget {
  const NodeBoard({
    required this.state,
    required this.spec,
    required this.selectedIds,
    required this.highlightIds,
    this.onNodeTap,
    this.onPanStart,
    this.onPanUpdate,
    this.onPanEnd,
    this.dragFromId,
    this.dragPoint,
    super.key,
  });

  final GameState state;
  final GameSpec spec;
  final Set<String> selectedIds;
  final Set<String> highlightIds;

  final void Function(GameObject node)? onNodeTap;

  /// Fired when a pan begins on a node; [localPoint] is board-local.
  final void Function(String nodeId, Offset localPoint)? onPanStart;
  final void Function(Offset localPoint)? onPanUpdate;

  /// Fired on pan end with the node under the pointer, if any.
  final void Function(String? targetId)? onPanEnd;

  final String? dragFromId;
  final Offset? dragPoint;

  @override
  State<NodeBoard> createState() => _NodeBoardState();
}

class _NodeBoardState extends State<NodeBoard> {
  final _boardKey = GlobalKey();

  /// The node the finger is currently over, so the painter can snap the live
  /// pointer to it and `onPanEnd` knows what was released.
  String? _hoverTarget;
  String? _panSource;

  Offset _toLocal(Offset global) {
    final box = _boardKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return global;
    return box.globalToLocal(global);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final nodes = widget.state.objectsOfKind(GameObjectKind.node);
    if (nodes.isEmpty) return const SizedBox.shrink();

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final layout = NodeLayout.compute(
          ids: nodes.map((n) => n.id).toList(growable: false),
          width: width,
        );
        // Only snap while the player is actually rewiring from this node.
        final snapTarget = _panSource == null ? null : _hoverTarget;

        return GestureDetector(
          key: _boardKey,
          behavior: HitTestBehavior.opaque,
          onPanStart: widget.onPanStart == null
              ? null
              : (details) {
                  final local = _toLocal(details.globalPosition);
                  final id = layout.hitTest(local);
                  if (id != null) {
                    _panSource = id;
                    widget.onPanStart!(id, local);
                  }
                },
          onPanUpdate: widget.onPanUpdate == null
              ? null
              : (details) {
                  final local = _toLocal(details.globalPosition);
                  final hovered = layout.hitTest(local);
                  if (hovered != _hoverTarget) setState(() => _hoverTarget = hovered);
                  widget.onPanUpdate!(local);
                },
          onPanEnd: widget.onPanEnd == null
              ? null
              : (_) {
                  widget.onPanEnd!(_hoverTarget);
                  setState(() {
                    _hoverTarget = null;
                    _panSource = null;
                  });
                },
          child: SizedBox(
            height: layout.height,
            width: width,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(
                  child: CustomPaint(
                    painter: LinkPainter(
                      layout: layout,
                      links: widget.state.links,
                      nextColor: colors.accent,
                      prevColor: colors.primary,
                      dimmed: nodes.where((n) => n.isEliminated).map((n) => n.id).toSet(),
                      dragFromId: widget.dragFromId,
                      dragPoint: widget.dragPoint,
                      dragColor: colors.success,
                      snapTargetId: snapTarget,
                    ),
                  ),
                ),
                for (final node in nodes)
                  if (layout.rects[node.id] case final rect?)
                    Positioned(
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                      child: _NodeCell(
                        node: node,
                        spec: widget.spec,
                        selected: widget.selectedIds.contains(node.id),
                        highlighted: widget.highlightIds.contains(node.id),
                        cursor: widget.state.cursor,
                        onTap: widget.onNodeTap == null ? null : () => widget.onNodeTap!(node),
                      ),
                    ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// A single node: pointer badges above a themed tile.
class _NodeCell extends StatelessWidget {
  const _NodeCell({
    required this.node,
    required this.spec,
    required this.selected,
    required this.highlighted,
    required this.cursor,
    this.onTap,
  });

  final GameObject node;
  final GameSpec spec;
  final bool selected;
  final bool highlighted;
  final Cursor cursor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final badges = <Widget>[
      if (cursor.nodeId == node.id)
        PointerBadge(
          pointer: CursorPointer.node,
          color: pointerColor(colors, CursorPointer.node),
          dense: true,
        ),
      if (cursor.prevNodeId == node.id)
        PointerBadge(
          pointer: CursorPointer.prevNode,
          color: pointerColor(colors, CursorPointer.prevNode),
          dense: true,
        ),
      if (cursor.bestObjectId == node.id)
        PointerBadge(
          pointer: CursorPointer.best,
          color: pointerColor(colors, CursorPointer.best),
          dense: true,
        ),
    ];

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 15,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (final badge in badges)
                Padding(padding: const EdgeInsets.symmetric(horizontal: 1.5), child: badge),
            ],
          ),
        ),
        Expanded(
          child: InkWell(
            onTap: onTap,
            child: ObjectTile(
              object: node,
              spec: spec,
              selected: selected,
              highlighted: highlighted,
            ),
          ),
        ),
      ],
    );
  }
}

/// The pool of objects that are not on any slot — the free tray the player
/// drags from or picks from for push / assign.
class ObjectPool extends StatelessWidget {
  const ObjectPool({
    required this.state,
    required this.spec,
    required this.selectedIds,
    required this.highlightIds,
    this.title = 'in hand',
    this.onTap,
    this.onLongPress,
    this.dragBuilder,
    this.filter,
    super.key,
  });

  final GameState state;
  final GameSpec spec;
  final Set<String> selectedIds;
  final Set<String> highlightIds;
  final String title;
  final void Function(GameObject object)? onTap;
  final void Function(GameObject object)? onLongPress;
  final Widget Function(Widget child, GameObject object)? dragBuilder;

  /// Narrows the pool, e.g. to tokens a push is legal for.
  final bool Function(GameObject object)? filter;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final objects = state.poolObjects.where((o) => filter?.call(o) ?? true).toList(growable: false);
    if (objects.isEmpty) return const SizedBox.shrink();

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 5),
          child: Text(
            title,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.1,
              color: colors.muted,
            ),
          ),
        ),
        SizedBox(
          // A pool can hold every element of a long instance, so it scrolls
          // horizontally — unlike the board itself, which must never scroll.
          height: 54,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: objects.length,
            separatorBuilder: (_, _) => const SizedBox(width: 6),
            itemBuilder: (context, index) {
              final object = objects[index];
              Widget tile = ObjectTile(
                object: object,
                spec: spec,
                selected: selectedIds.contains(object.id),
                highlighted: highlightIds.contains(object.id),
              );
              if (dragBuilder != null) tile = dragBuilder!(tile, object);
              if (onTap != null || onLongPress != null) {
                tile = InkWell(
                  onTap: onTap == null ? null : () => onTap!(object),
                  onLongPress: onLongPress == null ? null : () => onLongPress!(object),
                  child: tile,
                );
              }
              return tile;
            },
          ),
        ),
      ],
    );
  }
}
