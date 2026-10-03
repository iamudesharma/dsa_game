/// `choosePath` — pick one branch to narrow the remaining search space.
///
/// `fromId` is whatever the algorithm is currently looking at: the `mid` cursor
/// if the engine set one, otherwise the selected object, otherwise the first
/// slot. Sending a wrong `fromId` would be the player's mistake, not the
/// client's, so the choice is made from real state and shown in the readout.
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class ChoosePathMechanic extends MechanicView {
  const ChoosePathMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.choosePath;

  @override
  State<ChoosePathMechanic> createState() => _ChoosePathMechanicState();
}

class _ChoosePathMechanicState extends MechanicViewState<ChoosePathMechanic> {
  /// Ids the player can branch into: objects the mechanic may reference.
  List<GameObject> get _branches {
    final state = widget.state;
    final branches = state.orderedObjects
        .where(
          (o) => const {
            GameObjectKind.path,
            GameObjectKind.door,
            GameObjectKind.room,
          }.contains(o.kind),
        )
        .toList();
    if (branches.isNotEmpty) return branches;
    // A spec that binds choosePath without branch objects still has to be
    // playable: fall back to whatever the player can tap.
    return state.orderedObjects.where((o) => !o.isEliminated).toList();
  }

  /// The id the branch is taken *from*.
  String? get _fromId {
    final state = widget.state;
    final mid = state.cursor.midSlotId;
    if (mid != null) {
      return state.slot(mid)?.occupantId ??
          state.orderedObjects.where((o) => o.slotId == mid).firstOrNull?.id;
    }
    if (state.variables.number('mid') != null) {
      final i = state.variables.number('mid')!.toInt();
      final slot = state.orderedSlots.where((s) => s.index == i).firstOrNull;
      if (slot != null) {
        return slot.occupantId ??
            state.orderedObjects
                .where((o) => o.slotId == slot.id)
                .firstOrNull
                ?.id;
      }
    }
    final selected = firstSelected;
    if (selected != null) return selected;
    final slots = state.orderedSlots;
    if (slots.isNotEmpty) return slots.first.id;
    final objects = state.orderedObjects;
    return objects.isEmpty ? null : objects.first.id;
  }

  Future<void> _choose(String pathId) async {
    final from = _fromId;
    if (from == null) return;
    await act(ChoosePathAction(fromId: from, pathId: pathId));
  }

  @override
  Widget buildBoard() => buildBoardFrom(
    // Branch objects are the tap targets; everything else is inert here so a
    // stray tap cannot emit an action the mechanic cannot express.
    onObjectTap: canAct
        ? (object) => _branches.any((b) => b.id == object.id)
              ? _choose(object.id)
              : null
        : null,
  );

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final from = _fromId;
    final vocabulary = widget.spec.vocabulary;
    final branches = _branches;
    final lo = widget.state.variables.number('lo'),
        hi = widget.state.variables.number('hi'),
        mid = widget.state.variables.number('mid');
    if (lo != null && hi != null && mid != null && from != null) {
      final lower = lo.toInt(), upper = hi.toInt(), middle = mid.toInt();
      final found =
          widget.state.object(from)?.value == widget.state.instance.target;
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'From ${_labelFor(from)} — keep the range containing the target.',
          ),
          if (found)
            FilledButton(
              onPressed: canAct ? () => _choose('found') : null,
              child: const Text('Report the match'),
            ),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton(
                onPressed: canAct && lower < middle
                    ? () => _choose('left')
                    : null,
                child: Text('Keep left: $lower–${middle - 1}'),
              ),
              OutlinedButton(
                onPressed: canAct && middle < upper
                    ? () => _choose('right')
                    : null,
                child: Text('Keep right: ${middle + 1}–$upper'),
              ),
            ],
          ),
        ],
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          from == null
              ? 'Nothing to branch from yet.'
              : 'From ${_labelFor(from)} — which way?',
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: colors.muted,
          ),
        ),
        const SizedBox(height: 8),
        if (branches.isEmpty)
          Text(
            'No branch is open.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: colors.muted),
          )
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              for (final branch in branches.take(6))
                _BranchButton(
                  label: branch.label,
                  object: branch,
                  enabled: canAct && branch.id != from,
                  color: colors.primary,
                  onTap: () => _choose(branch.id),
                ),
            ],
          ),
        const SizedBox(height: 6),
        Text(
          'Narrowing means discarding everything on the other side of the branch.',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 10.5,
            color: colors.muted.withValues(alpha: 0.8),
          ),
        ),
        // The themed words make the mapping from branch to comparison obvious.
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            '${vocabulary.lowerWord} ← discard right · ${vocabulary.higherWord} → discard left',
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 10,
              color: colors.muted.withValues(alpha: 0.6),
            ),
          ),
        ),
      ],
    );
  }

  String _labelFor(String id) =>
      widget.state.object(id)?.label ??
      widget.state.slot(id)?.label ??
      '#${widget.state.slot(id)?.index ?? id}';
}

class _BranchButton extends StatelessWidget {
  const _BranchButton({
    required this.label,
    required this.object,
    required this.enabled,
    required this.color,
    required this.onTap,
  });

  final String label;
  final GameObject object;
  final bool enabled;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 46,
      child: OutlinedButton.icon(
        onPressed: enabled ? onTap : null,
        icon: Text(
          object.visual == null ? '➤' : '◆',
          style: TextStyle(
            fontSize: 12,
            color: enabled ? color : context.gameColors.muted,
          ),
        ),
        label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
        style: OutlinedButton.styleFrom(
          side: BorderSide(
            color: enabled
                ? color
                : context.gameColors.muted.withValues(alpha: 0.3),
          ),
          foregroundColor: context.gameColors.onSurface,
        ),
      ),
    );
  }
}
