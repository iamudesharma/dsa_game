/// `selectObject` — read one object, pick it as the current item, or make it
/// the mid / target. The simplest mechanic, and the entry point for most games.
library;

import 'package:flutter/material.dart';

import '../../models/enums.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class SelectObjectMechanic extends MechanicView {
  const SelectObjectMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.selectObject;

  @override
  State<SelectObjectMechanic> createState() => _SelectObjectMechanicState();
}

class _SelectObjectMechanicState extends MechanicViewState<SelectObjectMechanic> {
  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final object = widget.state.object(firstSelected);
    final vocabulary = widget.spec.vocabulary;
    final isMid = widget.state.cursor.midSlotId != null && widget.state.cursor.midSlotId == object?.slotId;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Icon(
              object == null ? Icons.touch_app_rounded : Icons.check_circle_rounded,
              size: 15,
              color: object == null ? colors.muted : colors.success,
            ),
            const SizedBox(width: 7),
            Expanded(
              child: Text(
                object == null
                    ? 'Tap a ${vocabulary.object} to read it'
                    : 'Reading ${object.label}${isMid ? ' — this is mid' : ''}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: object == null ? colors.muted : colors.onSurface,
                ),
              ),
            ),
          ],
        ),
        if (object != null) ...[
          const SizedBox(height: 6),
          Text(
            'value ${object.comparable?.toString() ?? object.label}'
            '${object.isEliminated ? ' · out of the search space' : ''}',
            style: TextStyle(fontSize: 11, color: colors.muted),
          ),
        ],
      ],
    );
  }
}
