/// Live algorithm state strip: `state.variables` + `state.cursor`.
///
/// This is the widget that makes the game an *algorithm* lesson rather than a
/// puzzle: the player always sees `lo / mid / hi / i / j / best` next to the
/// board, and the cursor's own fields are rendered as pointer chips so the
/// strip and the board can never disagree about where a pointer is.
library;

import 'package:flutter/material.dart';

import '../models/state.dart';
import '../theme/palette.dart';
import 'board/pointer_badge.dart';

class AlgorithmStrip extends StatelessWidget {
  const AlgorithmStrip({
    required this.state,
    this.dense = false,
    super.key,
  });

  final GameState state;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final pointers = state.cursor.slotPointers;

    return Container(
      padding: EdgeInsets.fromLTRB(10, dense ? 6 : 8, 10, dense ? 6 : 8),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, Colors.black, 0.22)!,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.memory_rounded, size: 12, color: colors.muted),
              const SizedBox(width: 5),
              Text(
                'ALGORITHM STATE',
                style: TextStyle(
                  fontSize: 8.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.3,
                  color: colors.muted,
                ),
              ),
              const Spacer(),
              if (pointers.isNotEmpty)
                Text(
                  'step ${state.progress.steps}',
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                    color: colors.muted.withValues(alpha: 0.7),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          if (pointers.isNotEmpty) ...[
            Wrap(
              spacing: 5,
              runSpacing: 5,
              children: [
                for (final entry in pointers.entries)
                  _PointerPill(
                    pointer: entry.key,
                    target: _describeTarget(entry.value),
                    color: pointerColor(colors, entry.key),
                  ),
              ],
            ),
            const SizedBox(height: 7),
          ],
          if (state.variables.isEmpty)
            Text(
              'no variables yet',
              style: TextStyle(fontSize: 11, color: colors.muted.withValues(alpha: 0.6)),
            )
          else
            Wrap(
              spacing: 5,
              runSpacing: 5,
              children: [
                for (final name in state.variables.names)
                  _VariableChip(
                    name: name,
                    value: state.variables.display(name),
                    dense: dense,
                  ),
              ],
            ),
        ],
      ),
    );
  }

  /// "s3" for a slot, "n2" for an object — the id alone is meaningless to a
  /// player, but the *position* it refers to is exactly what they need.
  String _describeTarget(String id) {
    final slot = state.slot(id);
    if (slot != null) return '#${slot.index}';
    final object = state.object(id);
    if (object != null) return object.label;
    return id;
  }
}

class _PointerPill extends StatelessWidget {
  const _PointerPill({required this.pointer, required this.target, required this.color});

  final CursorPointer pointer;
  final String target;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        PointerBadge(pointer: pointer, color: color, dense: true),
        const SizedBox(width: 3),
        Text(
          target,
          style: TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
            color: context.gameColors.onSurface,
          ),
        ),
      ],
    );
  }
}

class _VariableChip extends StatelessWidget {
  const _VariableChip({required this.name, required this.value, required this.dense});

  final String name;
  final String value;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return TweenAnimationBuilder<double>(
      // Values change every step; a short tween makes the change perceptible
      // without delaying the next tap.
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: MediaQuery.disableAnimationsOf(context) ? 0 : 220),
      curve: Curves.easeOutCubic,
      builder: (context, t, _) => Container(
        padding: EdgeInsets.symmetric(horizontal: 7, vertical: dense ? 2 : 3),
        decoration: BoxDecoration(
          color: Color.lerp(colors.surface, colors.onSurface, 0.07 * t + 0.05),
          borderRadius: BorderRadius.circular(7),
          border: Border.all(color: colors.muted.withValues(alpha: 0.25)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              name,
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: colors.muted,
              ),
            ),
            Text(
              ' = ',
              style: TextStyle(fontSize: 10.5, color: colors.muted.withValues(alpha: 0.6)),
            ),
            Text(
              value,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w900,
                color: colors.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
