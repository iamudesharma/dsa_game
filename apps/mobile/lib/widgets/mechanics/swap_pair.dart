/// `swapPair` — exchange the positions of two objects.
///
/// Tap two objects, or long-press one and drop it on the other: the drag path
/// mirrors what the player is actually asking the algorithm to do, and the
/// tap path stays available for precision.
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class SwapPairMechanic extends MechanicView {
  const SwapPairMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.swapPair;

  @override
  State<SwapPairMechanic> createState() => _SwapPairMechanicState();
}

class _SwapPairMechanicState extends MechanicViewState<SwapPairMechanic> {
  String? _hoverObjectId;

  @override
  int get selectionCapacity => 2;

  @override
  Widget buildBoard() => buildBoardFrom(
    onObjectLongPress: canAct ? (object) => _swapWithSelected(object) : null,
    dragObjectBuilder: (child, object) => _draggable(child, object),
  );

  Widget _draggable(Widget child, GameObject object) {
    if (!canAct || object.isEliminated) return child;
    return LongPressDraggable<String>(
      data: object.id,
      hapticFeedbackOnStart: true,
      dragAnchorStrategy: pointerDragAnchorStrategy,
      feedback: _SwapGhost(label: object.label),
      childWhenDragging: Opacity(opacity: 0.25, child: child),
      child: DragTarget<String>(
        onWillAcceptWithDetails: (details) {
          if (details.data == object.id) return false;
          setState(() => _hoverObjectId = object.id);
          return true;
        },
        onLeave: (_) => setState(() => _hoverObjectId = null),
        onAcceptWithDetails: (details) {
          setState(() => _hoverObjectId = null);
          _swap(details.data, object.id);
        },
        builder: (context, _, _) => _hoverObjectId == object.id
            ? DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(13),
                  boxShadow: [
                    BoxShadow(
                      color: context.gameColors.accent.withValues(alpha: 0.6),
                      blurRadius: 14,
                      spreadRadius: 1,
                    ),
                  ],
                ),
                child: child,
              )
            : child,
      ),
    );
  }

  Future<void> _swap(String aId, String bId) async {
    if (aId == bId) return;
    await act(SwapPairAction(aId: aId, bId: bId));
  }

  Future<void> _swapWithSelected(GameObject other) async {
    final current = firstSelected;
    if (current == null) {
      await select(other.id);
      return;
    }
    await _swap(current, other.id);
  }

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final ready = secondSelected != null;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        operandControls(),
        Center(
          child: PairReadout(
            state: widget.state,
            selection: selection,
            bracket: '⇄',
          ),
        ),
        const SizedBox(height: 8),
        ActionButton(
          label: 'Swap them',
          icon: Icons.swap_horiz_rounded,
          expand: true,
          enabled: ready,
          color: colors.accent,
          onPressed: () => _swap(firstSelected!, secondSelected!),
        ),
        if (!ready) ...[
          const SizedBox(height: 6),
          Text(
            'Tap two ${widget.spec.vocabulary.objectPlural}, or long-press one onto another.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: colors.muted),
          ),
        ],
      ],
    );
  }
}

class _SwapGhost extends StatelessWidget {
  const _SwapGhost({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Transform.translate(
      offset: const Offset(-28, -28),
      child: Container(
        width: 56,
        height: 56,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Color.lerp(colors.surface, colors.accent, 0.3),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: colors.accent, width: 2),
        ),
        child: Text(
          '⇄ $label',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w900,
            color: colors.onSurface,
          ),
        ),
      ),
    );
  }
}
