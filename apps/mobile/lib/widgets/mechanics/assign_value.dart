/// `assignValue` — set a value into a slot, container or variable.
///
/// The contract allows any of the three as `targetId`, and different problems
/// use different ones (a running max, a complement, a sum). Rather than
/// guessing, the control strip offers the legal-looking targets the state
/// itself advertises — target/mid slots, `target` objects, and the names the
/// engine is already tracking in `variables` — as chips, and sends whichever
/// the player picks. The value field is numeric-biased but accepts any text,
/// because the oracle may want a node id or a name.
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class AssignValueMechanic extends MechanicView {
  const AssignValueMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.assignValue;

  @override
  State<AssignValueMechanic> createState() => _AssignValueMechanicState();
}

/// One addressable thing an assignment can target.
sealed class AssignTarget {
  const AssignTarget(this.id, this.label);

  final String id;
  final String label;
}

final class SlotTarget extends AssignTarget {
  SlotTarget(Slot slot) : super(slot.id, '#${slot.index}');
}

final class VariableTarget extends AssignTarget {
  const VariableTarget(String name) : super(name, name);
}

final class LabeledTarget extends AssignTarget {
  const LabeledTarget(super.id, super.label);
}

class _AssignValueMechanicState extends MechanicViewState<AssignValueMechanic> {
  final _controller = TextEditingController();
  String? _targetId;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  List<AssignTarget> get _targets {
    final state = widget.state;
    final targets = <AssignTarget>[];

    for (final slot in state.orderedSlots) {
      if (slot.kind == SlotKind.target || slot.kind == SlotKind.mid || slot.kind == SlotKind.sink) {
        targets.add(SlotTarget(slot));
      }
    }
    for (final object in state.orderedObjects) {
      if (object.kind == GameObjectKind.target) targets.add(LabeledTarget(object.id, object.label));
    }
    // Variables the engine already tracks are legitimate targets: assigning
    // into one is how "keep a running best" is expressed.
    for (final name in state.variables.names) {
      targets.add(VariableTarget(name));
    }
    for (final slot in state.orderedSlots) {
      targets.add(SlotTarget(slot));
    }

    final seen = <String>{};
    return targets.where((t) => seen.add(t.id)).toList(growable: false);
  }

  AssignTarget get _effectiveTarget {
    final targets = _targets;
    final explicit = targets.where((t) => t.id == _targetId).firstOrNull;
    if (explicit != null) return explicit;
    return targets.isEmpty ? const VariableTarget('value') : targets.first;
  }

  /// Values the player is most likely to assign, offered as one-tap chips.
  List<String> get _suggestions {
    final out = <String>[];
    for (final value in widget.state.instance.values.take(4)) {
      out.add(value.toString());
    }
    for (final name in widget.state.variables.names.take(2)) {
      final current = widget.state.variables.display(name);
      if (current != '—') out.add(current);
    }
    return out.take(5).toList(growable: false);
  }

  Future<void> _assign() async {
    final value = _controller.text.trim();
    if (value.isEmpty) return;
    final target = _effectiveTarget;
    await act(AssignValueAction(targetId: target.id, value: value));
    if (mounted) _controller.clear();
  }

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final target = _effectiveTarget;
    final suggestions = _suggestions;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 78),
          child: SingleChildScrollView(
            child: ChoiceChipRow<AssignTarget>(
              options: _targets,
              selected: target,
              enabled: canAct,
              labelOf: (t) => t.label,
              onSelected: (t) => setState(() => _targetId = t.id),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                enabled: canAct,
                keyboardType: TextInputType.text,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _assign(),
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.onSurface),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: 'value',
                  hintStyle: TextStyle(color: colors.muted, fontSize: 13),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                ),
              ),
            ),
            const SizedBox(width: 8),
            ActionButton(
              label: 'Assign',
              icon: Icons.arrow_downward_rounded,
              dense: true,
              enabled: canAct && _controller.text.trim().isNotEmpty,
              color: colors.success,
              onPressed: _assign,
            ),
          ],
        ),
        if (suggestions.isNotEmpty) ...[
          const SizedBox(height: 8),
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
        ],
      ],
    );
  }
}

extension<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    return iterator.moveNext() ? iterator.current : null;
  }
}
