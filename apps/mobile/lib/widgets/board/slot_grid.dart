/// Grid of `Slot`s — the linear board used by arrays, sorting and binary
/// search.
///
/// Everything must fit a phone screen in portrait with no scrolling, because
/// a board the player has to pan is a board they cannot see while deciding.
/// The cell size is therefore derived from the available width: as many
/// columns as fit at a legible minimum, wrapping into extra rows when the
/// board is long. Slot `index` labels keep the left-to-right order readable
/// across a wrap.
library;

import 'package:flutter/material.dart';

import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'object_tile.dart';
import 'pointer_badge.dart';

/// Smallest readable cell. Below this the numbers stop being legible.
const double kMinCellWidth = 40;
const double kCellGap = 6;

class SlotCell extends StatelessWidget {
  const SlotCell({
    required this.slot,
    required this.spec,
    required this.pointers,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.dragTargetBuilder,
    this.isDropTarget = false,
    this.dimmed = false,
    this.width,
    this.height = 56,
    super.key,
  });

  final Slot slot;
  final GameSpec spec;

  /// Every pointer that currently targets this slot, keyed by pointer.
  final Map<CursorPointer, String> pointers;

  /// The occupant tile, or `null` for an empty slot.
  final Widget? child;

  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// Wraps [child] in drag-target behaviour when the mechanic needs it.
  final Widget Function(Widget child)? dragTargetBuilder;

  final bool isDropTarget;
  final bool dimmed;
  final double? width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final isActive = slot.kind != SlotKind.plain;
    final pointerEntries = pointers.entries.toList()
      ..sort((a, b) => a.key.index.compareTo(b.key.index));

    Widget body = AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      width: width,
      height: height,
      padding: const EdgeInsets.fromLTRB(2, 14, 2, 3),
      decoration: BoxDecoration(
        color: isDropTarget
            ? Color.lerp(colors.surface, colors.success, 0.18)
            : isActive
            ? Color.lerp(colors.surface, colors.primary, 0.12)
            : colors.surface,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(
          color: isDropTarget
              ? colors.success
              : isActive
              ? colors.primary.withValues(alpha: 0.7)
              : colors.muted.withValues(alpha: 0.25),
          width: isActive ? 1.6 : 1,
        ),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (child != null)
            child!
          else
            Icon(
              Icons.add_rounded,
              size: 14,
              color: colors.muted.withValues(alpha: 0.35),
            ),
          Positioned(
            left: 4,
            bottom: 1,
            child: Text(
              '${slot.index}',
              style: TextStyle(
                fontSize: 8.5,
                fontWeight: FontWeight.w700,
                color: colors.muted.withValues(alpha: 0.75),
              ),
            ),
          ),
          if (slot.label != null || isActive)
            Positioned(
              right: 4,
              bottom: 0,
              child: Text(
                (slot.label ?? slot.kind.wire).toUpperCase(),
                style: TextStyle(
                  fontSize: 7.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.3,
                  color: isActive ? colors.primary : colors.muted.withValues(alpha: 0.6),
                ),
              ),
            ),
        ],
      ),
    );

    if (dragTargetBuilder != null) body = dragTargetBuilder!(body);

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      onLongPress: onLongPress,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 16,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (final entry in pointerEntries)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 1.5),
                    child: PointerBadge(
                      pointer: entry.key,
                      color: pointerColor(colors, entry.key),
                      dense: true,
                    ),
                  ),
              ],
            ),
          ),
          if (dimmed) Opacity(opacity: 0.45, child: body) else body,
        ],
      ),
    );
  }
}

class SlotGrid extends StatelessWidget {
  const SlotGrid({
    required this.state,
    required this.spec,
    required this.selectedIds,
    required this.highlightIds,
    required this.cellBuilder,
    this.onSlotTap,
    this.onSlotLongPress,
    this.dragTargetBuilder,
    this.slotTapEnabled = false,
    this.onObjectTap,
    this.onObjectLongPress,
    this.dragObjectBuilder,
    super.key,
  });

  final GameState state;
  final GameSpec spec;
  final Set<String> selectedIds;
  final Set<String> highlightIds;
  final Widget Function(BuildContext context, Slot slot, GameObject? occupant) cellBuilder;

  final void Function(Slot slot)? onSlotTap;
  final void Function(Slot slot)? onSlotLongPress;
  final Widget Function(Widget child, Slot slot)? dragTargetBuilder;

  /// Slot taps are only live when the mechanic needs them (move / assign).
  final bool slotTapEnabled;

  final void Function(GameObject object)? onObjectTap;
  final void Function(GameObject object)? onObjectLongPress;
  final Widget Function(Widget child, GameObject object)? dragObjectBuilder;

  @override
  Widget build(BuildContext context) {
    final slots = state.orderedSlots;
    if (slots.isEmpty) return const SizedBox.shrink();
    final colors = context.gameColors;
    final pointerMap = state.cursor.slotPointers;
    // A grid oracle (islands, rotting oranges, word search) promises row-major
    // ids plus `gridCols` in the instance extras: lay out exact rows so
    // up/down neighbours sit one row apart. Otherwise wrap by width as before.
    final forced = state.instance.extras.number('gridCols')?.toInt();
    final gridCols = forced != null && forced >= 2 && forced <= slots.length ? forced : null;

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final cols = gridCols ?? _columnsFor(width, slots.length);
        final cellWidth = ((width - kCellGap * (cols - 1)) / cols).clamp(kMinCellWidth, 66.0);
        // Centre the cells when they are wider than the row allows.
        final rowWidth = cellWidth * cols + kCellGap * (cols - 1);
        final rows = <Widget>[];

        for (var start = 0; start < slots.length; start += cols) {
          final slice = slots.skip(start).take(cols).toList();
          rows.add(
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < slice.length; i++) ...[
                  if (i > 0) const SizedBox(width: kCellGap),
                  SizedBox(
                    width: cellWidth,
                    child: _buildCell(context, colors, pointerMap, slice[i]),
                  ),
                ],
              ],
            ),
          );
        }

        return Center(
          child: SizedBox(
            width: rowWidth > width ? width : rowWidth,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                for (var r = 0; r < rows.length; r++) ...[
                  // The "continues" marker only makes sense for incidental
                  // wrapping. A forced grid's row breaks are the layout, not
                  // an overflow, so they stay silent.
                  if (r > 0 && gridCols == null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.subdirectory_arrow_right_rounded,
                              size: 11, color: colors.muted.withValues(alpha: 0.5)),
                          Text(
                            '  continues',
                            style: TextStyle(
                              fontSize: 9,
                              color: colors.muted.withValues(alpha: 0.6),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  rows[r],
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildCell(
    BuildContext context,
    GameColors colors,
    Map<CursorPointer, String> pointerMap,
    Slot slot,
  ) {
    final occupant = state.occupantOf(slot.id);
    final pointers = <CursorPointer, String>{};
    pointerMap.forEach((pointer, target) {
      if (target == slot.id) pointers[pointer] = target;
    });

    final tile = occupant == null
        ? null
        : cellBuilder(
            context,
            slot,
            occupant,
          );

    return SlotCell(
      slot: slot,
      spec: spec,
      pointers: pointers,
      onTap: slotTapEnabled ? () => onSlotTap?.call(slot) : null,
      onLongPress: slotTapEnabled ? () => onSlotLongPress?.call(slot) : null,
      dragTargetBuilder: dragTargetBuilder == null || occupant == null
          ? null
          : (child) => dragTargetBuilder!(child, slot),
      child: occupant == null
          ? null
          : _wrapObject(occupant, tile ?? const SizedBox.shrink()),
    );
  }

  Widget _wrapObject(GameObject object, Widget tile) {
    var child = tile;
    if (dragObjectBuilder != null) child = dragObjectBuilder!(child, object);
    if (onObjectTap != null || onObjectLongPress != null) {
      child = GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onObjectTap == null ? null : () => onObjectTap!(object),
        onLongPress: onObjectLongPress == null ? null : () => onObjectLongPress!(object),
        child: child,
      );
    }
    return child;
  }

  static int _columnsFor(double width, int count) {
    if (count <= 1) return 1;
    final maxCols = ((width + kCellGap) / (kMinCellWidth + kCellGap)).floor();
    return maxCols.clamp(1, count);
  }
}

/// Convenience wrapper so every mechanic builds its tiles the same way.
class DefaultCellBuilder {
  const DefaultCellBuilder({this.showLabel = true, this.dense = false, this.height = 46});

  final bool showLabel;
  final bool dense;
  final double height;

  Widget call(BuildContext context, GameObject object, GameSpec spec, {bool selected = false, bool highlighted = false, bool dimmed = false}) =>
      ObjectTile(
        object: object,
        spec: spec,
        selected: selected,
        highlighted: highlighted,
        dimmed: dimmed,
        showLabel: showLabel,
        dense: dense,
        height: height,
      );
}
