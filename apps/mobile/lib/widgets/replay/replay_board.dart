/// The board as it looked at one point in a trace.
///
/// Two modes, because the contract does not hand the client a board per frame:
///
///  * **Snapshot mode** — the client dispatched this action, so it holds the
///    full post-action `GameState`. The board is exact, with the frame's
///    pointers projected on top.
///  * **Pointer mode** — the frame came from the server's canonical trace (or
///    from a session this client did not play). Only `TraceFrame.pointers` and
///    `TraceFrame.variables` exist, so the UI shows those and says so, rather
///    than inventing a board layout that would teach the wrong thing.
library;

import 'package:flutter/material.dart';

import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../models/trace.dart';
import '../../theme/palette.dart';
import '../board/game_board.dart';

class ReplayBoard extends StatelessWidget {
  const ReplayBoard({
    required this.frame,
    required this.spec,
    this.snapshot,
    this.showAlgorithmStrip = true,
    super.key,
  });

  final TraceFrame frame;
  final GameSpec spec;

  /// The full state after this action, when the client dispatched it.
  final GameState? snapshot;

  final bool showAlgorithmStrip;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final snapshot = this.snapshot;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (snapshot == null)
          _PointerOnlyBoard(frame: frame, spec: spec)
        else
          _SnapshotBoard(frame: frame, snapshot: snapshot, spec: spec),
        if (showAlgorithmStrip) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.fromLTRB(9, 7, 9, 7),
            decoration: BoxDecoration(
              color: Color.lerp(colors.surface, Colors.black, 0.2)!,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: colors.muted.withValues(alpha: 0.2)),
            ),
            child: _VariableRow(frame: frame),
          ),
        ],
      ],
    );
  }
}

class _SnapshotBoard extends StatelessWidget {
  const _SnapshotBoard({required this.frame, required this.snapshot, required this.spec});

  final TraceFrame frame;
  final GameState snapshot;
  final GameSpec spec;

  @override
  Widget build(BuildContext context) {
    final pointers = frame.pointers;
    // Project the frame's pointers onto the snapshot: `eliminated` and
    // `current` are styling, everything else is an accent ring.
    final objects = Map<String, GameObject>.of(snapshot.objects);
    for (final id in pointers.eliminated) {
      final object = objects[id];
      if (object != null) objects[id] = object.copyWith(state: ObjectState.eliminated);
    }
    final current = pointers.current;
    if (current != null && objects.containsKey(current)) {
      final object = objects[current]!;
      if (object.state == ObjectState.idle) objects[current] = object.copyWith(state: ObjectState.current);
    }
    final projected = snapshot.withObjects(objects);

    return GameBoard(
      state: projected,
      spec: spec,
      highlightIds: {...pointers.compare, ...pointers.read, ...pointers.swapped, ?current},
      selectedIds: pointers.compare.toSet(),
      showPool: true,
      poolTitle: 'not placed',
    );
  }
}

class _PointerOnlyBoard extends StatelessWidget {
  const _PointerOnlyBoard({required this.frame, required this.spec});

  final TraceFrame frame;
  final GameSpec spec;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final pointers = frame.pointers;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 11),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, Colors.black, 0.18)!,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: colors.muted.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.visibility_off_rounded, size: 12, color: colors.muted),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  'This step has no board snapshot — showing its pointers only.',
                  style: TextStyle(fontSize: 10.5, color: colors.muted),
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (pointers.current != null)
                _PointerTag(label: 'current', value: pointers.current!, color: colors.accent),
              for (final id in pointers.compare)
                _PointerTag(label: 'compare', value: id, color: colors.primary),
              for (final id in pointers.read)
                _PointerTag(label: 'read', value: id, color: colors.primary),
              for (final id in pointers.swapped)
                _PointerTag(label: 'swapped', value: id, color: colors.accent),
              for (final id in pointers.eliminated)
                _PointerTag(label: 'eliminated', value: id, color: colors.danger),
            ],
          ),
          if (pointers.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'No pointers on this step.',
                style: TextStyle(fontSize: 11, color: colors.muted),
              ),
            ),
        ],
      ),
    );
  }
}

class _PointerTag extends StatelessWidget {
  const _PointerTag({required this.label, required this.value, required this.color});

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(7),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: color),
          ),
          const SizedBox(width: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: context.gameColors.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}

class _VariableRow extends StatelessWidget {
  const _VariableRow({required this.frame});

  final TraceFrame frame;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final variables = frame.variables;
    if (variables.isEmpty) {
      return Text(
        'no variables recorded on this step',
        style: TextStyle(fontSize: 10.5, color: colors.muted.withValues(alpha: 0.7)),
      );
    }
    return Wrap(
      spacing: 5,
      runSpacing: 5,
      children: [
        for (final name in variables.names)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: colors.muted.withValues(alpha: 0.25)),
            ),
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '$name ',
                    style: TextStyle(fontSize: 10, color: colors.muted),
                  ),
                  TextSpan(
                    text: variables.display(name),
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w900,
                      color: colors.onSurface,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
