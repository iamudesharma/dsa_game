/// The action history, rendered from `state.trace`.
///
/// Each row is the player's own action plus the engine's note, the DSA op, the
/// source line it hit, and whether it was correct. Tapping a row scrubs the
/// board to that step when the client holds a snapshot for it — the same
/// mechanism that powers the undo affordance, because a wrong action is far
/// easier to understand when you can see the board on both sides of it.
library;

// `material.dart` exports Flutter's own `Action<T>`; the contract's action
// union is what the trace describes.
import 'package:flutter/material.dart' hide Action;

import '../models/action.dart';
import '../models/state.dart';
import '../models/trace.dart';
import '../theme/palette.dart';

class TraceRail extends StatelessWidget {
  const TraceRail({
    required this.state,
    required this.onScrub,
    this.activeTraceStep,
    this.scrubbable = const {},
    this.maxHeight = 168,
    super.key,
  });

  final GameState state;

  /// Called with a trace step index, or `null` when the player returns to live.
  final ValueChanged<int?> onScrub;

  /// Trace steps the client has a full board snapshot for.
  final Set<int> scrubbable;

  final int? activeTraceStep;
  final double maxHeight;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final trace = state.trace;

    return Container(
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, Colors.black, 0.22)!,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 6, 4),
            child: Row(
              children: [
                Icon(Icons.history_rounded, size: 12, color: colors.muted),
                const SizedBox(width: 5),
                Text(
                  'TRACE · ${trace.length} step${trace.length == 1 ? '' : 's'}',
                  style: TextStyle(
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.3,
                    color: colors.muted,
                  ),
                ),
                const Spacer(),
                if (activeTraceStep != null)
                  TextButton.icon(
                    onPressed: () => onScrub(null),
                    icon: const Icon(Icons.play_arrow_rounded, size: 14),
                    label: const Text('live', style: TextStyle(fontSize: 11)),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                  ),
              ],
            ),
          ),
          if (trace.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 2, 12, 10),
              child: Row(
                children: [
                  Icon(Icons.fiber_new_rounded, size: 13, color: colors.muted.withValues(alpha: 0.6)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Your moves show up here, with the line of code each one ran.',
                      style: TextStyle(fontSize: 11, color: colors.muted.withValues(alpha: 0.75)),
                    ),
                  ),
                ],
              ),
            )
          else
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: maxHeight),
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(6, 0, 6, 6),
                reverse: true,
                itemCount: trace.length,
                itemBuilder: (context, index) {
                  // Reverse list: the newest step is at the top, next to the
                  // board, instead of requiring a scroll to see.
                  final frame = trace[trace.length - 1 - index];
                  return _TraceRow(
                    frame: frame,
                    state: state,
                    isActive: frame.index == activeTraceStep,
                    isScrubbable: scrubbable.contains(frame.index),
                    onTap: () => onScrub(frame.index == activeTraceStep ? null : frame.index),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _TraceRow extends StatelessWidget {
  const _TraceRow({
    required this.frame,
    required this.state,
    required this.isActive,
    required this.isScrubbable,
    required this.onTap,
  });

  final TraceFrame frame;
  final GameState state;
  final bool isActive;
  final bool isScrubbable;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final accent = frame.correct ? colors.success : colors.danger;
    final actionLabel = describeAction(frame.action, state);
    final dsaOp = frame.dsaOp;

    return Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Material(
        color: isActive ? colors.primary.withValues(alpha: 0.16) : Colors.transparent,
        borderRadius: BorderRadius.circular(9),
        child: InkWell(
          onTap: isScrubbable ? onTap : null,
          borderRadius: BorderRadius.circular(9),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 5, 8, 5),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 17,
                  height: 17,
                  margin: const EdgeInsets.only(top: 1),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.18),
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    frame.correct ? '✓' : '✕',
                    style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: accent),
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            dsaOp.glyph,
                            style: TextStyle(fontSize: 11, color: colors.accent),
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              actionLabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w800,
                                color: colors.onSurface,
                              ),
                            ),
                          ),
                          if (frame.codeLine > 0) ...[
                            const SizedBox(width: 5),
                            Text(
                              'L${frame.codeLine}',
                              style: TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.w800,
                                color: colors.muted.withValues(alpha: 0.75),
                              ),
                            ),
                          ],
                          if (isScrubbable) ...[
                            const SizedBox(width: 5),
                            Icon(
                              Icons.touch_app_rounded,
                              size: 10,
                              color: isActive ? colors.primary : colors.muted.withValues(alpha: 0.6),
                            ),
                          ],
                        ],
                      ),
                      if (frame.note.isNotEmpty)
                        Text(
                          frame.note,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 10, color: colors.muted),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Renders an action the way the player performed it, with object labels
/// instead of ids. The trace is the player's own history, so it must read like
/// a log of what they did, not like JSON.
String describeAction(Action action, GameState state) {
  String name(String id) => state.object(id)?.label ?? state.slot(id)?.label ?? id;
  return switch (action) {
    SelectObjectAction(:final objectId) => 'read ${name(objectId)}',
    MoveObjectAction(:final objectId, :final toSlotId) =>
      'move ${name(objectId)} → ${state.slot(toSlotId)?.index ?? toSlotId}',
    ComparePairAction(:final aId, :final bId, :final relation) =>
      '${name(aId)} ${relation.wire} ${name(bId)}',
    SwapPairAction(:final aId, :final bId) => 'swap ${name(aId)} ⇄ ${name(bId)}',
    PushPopAction(:final containerId, :final op, :final objectId) => op == StackOp.pop
        ? 'pop ${state.container(containerId)?.label ?? containerId}'
        : 'push ${objectId == null ? '?' : name(objectId)} → ${state.container(containerId)?.label ?? containerId}',
    ChoosePathAction(:final fromId, :final pathId) => 'take ${name(pathId)} from ${name(fromId)}',
    TraverseNodeAction(:final fromNodeId, :final toNodeId) => '${name(fromNodeId)} → ${name(toNodeId)}',
    ConnectNodesAction(:final fromNodeId, :final toNodeId, :final linkKind) =>
      'link ${name(fromNodeId)} ${linkKind.arrow} ${name(toNodeId)}',
    AssignValueAction(:final targetId, :final value) => 'set $targetId = $value',
    SubmitAnswerAction(:final value) => 'answer $value',
  };
}
