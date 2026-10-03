/// `moveObject` — relocate an object without breaking an order guarantee.
///
/// Two ways in, because a phone makes long drags awkward: long-press-drag
/// (the native-feeling path) and tap-then-tap (the precise path, and the only
/// workable one with 16 slots on a small screen).
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class MoveObjectMechanic extends MechanicView {
  const MoveObjectMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.moveObject;

  @override
  State<MoveObjectMechanic> createState() => _MoveObjectMechanicState();
}

class _MoveObjectMechanicState extends MechanicViewState<MoveObjectMechanic> {
  /// Slot the object is hovering over, so the drop target can light up.
  String? _hoverSlotId;
  Slot? _preview;

  /// Slots the player may legally drop into, offered as chips.
  List<Slot> get _targets {
    final occupied = widget.state.occupiedSlotIds;
    final all = widget.state.orderedSlots;
    final free = all.where((s) => !occupied.contains(s.id)).toList();
    // Slots the state already marks as a destination come first.
    free.sort((a, b) => _rank(b).compareTo(_rank(a)));
    return free;
  }

  int _rank(Slot slot) => switch (slot.kind) {
    SlotKind.target => 3,
    SlotKind.sink => 2,
    SlotKind.mid => 1,
    _ => 0,
  };

  @override
  Widget buildBoard() {
    return super.buildBoardFrom(
      slotTapEnabled: true,
      onSlotTap: _moveSelectedTo,
      dragObjectBuilder: (child, object) => _draggable(child, object),
      dragTargetBuilder: (child, slot) => DragTarget<String>(
        onWillAcceptWithDetails: (details) {
          setState(() => _hoverSlotId = slot.id);
          return true;
        },
        onLeave: (_) => setState(() => _hoverSlotId = null),
        onAcceptWithDetails: (details) {
          setState(() => _hoverSlotId = null);
          move(objectId: details.data, toSlotId: slot.id);
        },
        builder: (context, candidate, _) => _highlight(child, slot.id),
      ),
    );
  }

  Widget _highlight(Widget child, String slotId) {
    if (_hoverSlotId != slotId) return child;
    final colors = context.gameColors;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(13),
        boxShadow: [
          BoxShadow(color: colors.success.withValues(alpha: 0.55), blurRadius: 14, spreadRadius: 1),
        ],
      ),
      child: child,
    );
  }

  Widget _draggable(Widget child, GameObject object) {
    if (!canAct || object.isEliminated) return child;
    return LongPressDraggable<String>(
      data: object.id,
      hapticFeedbackOnStart: true,
      dragAnchorStrategy: pointerDragAnchorStrategy,
      feedback: _DragGhost(object: object, spec: widget.spec),
      childWhenDragging: Opacity(opacity: 0.25, child: child),
      child: child,
    );
  }

  Future<void> move({required String objectId, required String toSlotId}) async {
    await act(MoveObjectAction(objectId: objectId, toSlotId: toSlotId));
  }

  Future<void> _moveSelectedTo(Slot slot) async {
    final objectId = firstSelected;
    if (objectId == null) return;
    await move(objectId: objectId, toSlotId: slot.id);
  }

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final selected = widget.state.object(firstSelected);
    final targets = _targets;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          selected == null
              ? 'Long-press and drag a ${widget.spec.vocabulary.object}, or tap one first.'
              : 'Moving ${selected.label} — pick a slot',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
            color: selected == null ? colors.muted : colors.onSurface,
          ),
        ),
        if (selected != null && targets.isNotEmpty) ...[
          const SizedBox(height: 8),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 96),
            child: SingleChildScrollView(
              child: ChoiceChipRow<Slot>(
                options: targets,
                selected: _preview,
                enabled: canAct,
                labelOf: (slot) => '${slot.index}',
                onSelected: (slot) => setState(()=>_preview=slot),
              ),
            ),
          ),
          if(_preview!=null)Wrap(spacing:8,children:[Text('Destination: slot ${_preview!.index}'),TextButton(onPressed:()=>setState(()=>_preview=null),child:const Text('Clear preview')),FilledButton(onPressed:canAct?()async{final slot=_preview!;setState(()=>_preview=null);await _moveSelectedTo(slot);}:null,child:const Text('Move here'))]),
        ],
      ],
    );
  }
}

/// What follows the finger during a long-press drag.
class _DragGhost extends StatelessWidget {
  const _DragGhost({required this.object, required this.spec});

  final GameObject object;
  final GameSpec spec;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Transform.translate(
      offset: const Offset(-30, -30),
      child: Material(
        color: Colors.transparent,
        child: Container(
          width: 60,
          height: 60,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Color.lerp(colors.surface, colors.primary, 0.25),
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: colors.primary, width: 2),
            boxShadow: [
              BoxShadow(color: Colors.black.withValues(alpha: 0.4), blurRadius: 16, offset: const Offset(0, 6)),
            ],
          ),
          child: Text(
            '${spec.visual.glyphFor(object.kind)} ${object.label}',
            textAlign: TextAlign.center,
            maxLines: 2,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w900,
              color: colors.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}
