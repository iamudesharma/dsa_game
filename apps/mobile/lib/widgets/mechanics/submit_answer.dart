/// `submitAnswer` — commit the final answer: a result index, a value, or an
/// outcome.
///
/// This is the action that can end the game, so the control is deliberately
/// the biggest target on the screen. Quick-fill chips come from the instance's
/// own data (slot indices, element values, the target) because on a phone,
/// typing a two-digit number with a thumb is the single most common source of
/// a wasted attempt.
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class SubmitAnswerMechanic extends MechanicView {
  const SubmitAnswerMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.submitAnswer;

  @override
  State<SubmitAnswerMechanic> createState() => _SubmitAnswerMechanicState();
}

class _SubmitAnswerMechanicState extends MechanicViewState<SubmitAnswerMechanic> {
  final _controller = TextEditingController();
  String? _pickedTargetId;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Where the answer is going. A `target` object wins; otherwise the `target`
  /// or `mid` slot; otherwise the first slot; otherwise a bare "answer" id,
  /// which is what a free-form oracle looks for.
  String get _targetId {
    final picked = _pickedTargetId;
    if (picked != null) return picked;
    final state = widget.state;
    for (final object in state.orderedObjects) {
      if (object.kind == GameObjectKind.target) return object.id;
    }
    for (final slot in state.orderedSlots) {
      if (slot.kind == SlotKind.target) return slot.id;
    }
    if (widget.state.slot(widget.state.cursor.midSlotId) != null) {
      return widget.state.cursor.midSlotId!;
    }
    if (state.orderedSlots.isNotEmpty) return state.orderedSlots.first.id;
    return 'answer';
  }

  List<String> get _suggestions {
    final state = widget.state;
    final out = <String>[];
    for (final object in state.orderedObjects) {
      if (object.kind == GameObjectKind.target) out.add(object.label);
    }
    for (final slot in state.orderedSlots.take(4)) {
      out.add('${slot.index}');
    }
    for (final value in state.instance.values.take(3)) {
      out.add(value.toString());
    }
    final target = state.instance.target;
    if (target != null) out.add(target.toString());
    final seen = <String>{};
    return out.where(seen.add).take(6).toList(growable: false);
  }

  Future<void> _submit() async {
    final value = _controller.text.trim();
    if (value.isEmpty) return;
    await act(SubmitAnswerAction(targetId: _targetId, value: value));
  }

  @override
  Widget buildBoard() => buildBoardFrom(
    poolTitle: 'candidates',
  );

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final suggestions = _suggestions;
    final targetObject = widget.state.object(_targetId);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                enabled: canAct,
                keyboardType: TextInputType.text,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: colors.onSurface),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: 'your answer',
                  hintStyle: TextStyle(color: colors.muted, fontSize: 15),
                  prefixIcon: Icon(Icons.flag_rounded, size: 18, color: colors.muted),
                  prefixIconConstraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                ),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              height: 50,
              child: FilledButton(
                onPressed: canAct && _controller.text.trim().isNotEmpty ? _submit : null,
                style: FilledButton.styleFrom(
                  backgroundColor: colors.accent,
                  foregroundColor: colors.accent.computeLuminance() > 0.6
                      ? const Color(0xFF0B0E12)
                      : Colors.white,
                  disabledBackgroundColor: colors.surface,
                  disabledForegroundColor: colors.muted.withValues(alpha: 0.5),
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Submit', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (suggestions.isNotEmpty)
          Wrap(
            spacing: 6,
            runSpacing: 6,
            alignment: WrapAlignment.center,
            children: [
              for (final suggestion in suggestions)
                ActionChip(
                  label: Text(suggestion),
                  onPressed: canAct ? () => setState(() => _controller.text = suggestion) : null,
                ),
            ],
          ),
        const SizedBox(height: 6),
        Text(
          targetObject == null
              ? 'Commit the answer that solves the task.'
              : 'Committing against ${targetObject.label}.',
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 10.5, color: colors.muted.withValues(alpha: 0.85)),
        ),
      ],
    );
  }
}
