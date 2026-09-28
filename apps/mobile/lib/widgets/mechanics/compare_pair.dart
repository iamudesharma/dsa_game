/// `comparePair` — select two objects, then declare lt / eq / gt between
/// their values.
///
/// The three buttons are labelled with `vocabulary.lowerWord / equalWord /
/// higherWord`, so the player reads "lower" in the theme's language rather than
/// `<`, `=`, `>`. The relation is only sent when two objects are held.
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class ComparePairMechanic extends MechanicView {
  const ComparePairMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.comparePair;

  @override
  State<ComparePairMechanic> createState() => _ComparePairMechanicState();
}

class _ComparePairMechanicState extends MechanicViewState<ComparePairMechanic> {
  @override
  int get selectionCapacity => 2;

  Future<void> _compare(Relation relation) async {
    final a = firstSelected;
    final b = secondSelected;
    if (a == null || b == null) return;
    await act(ComparePairAction(aId: a, bId: b, relation: relation));
  }

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final (lower, equal, higher) = widget.spec.vocabulary.relationWords;
    final ready = secondSelected != null;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(child: PairReadout(state: widget.state, selection: selection, bracket: 'vs')),
        const SizedBox(height: 8),
        Row(
          children: [
            for (final entry in [
              (Relation.lt, lower, Icons.south_rounded, colors.primary),
              (Relation.eq, equal, Icons.drag_handle_rounded, colors.accent),
              (Relation.gt, higher, Icons.north_rounded, colors.success),
            ]) ...[
              if (entry.$1 != Relation.lt) const SizedBox(width: 8),
              Expanded(
                child: ActionButton(
                  label: entry.$2,
                  icon: entry.$3,
                  color: entry.$4,
                  dense: true,
                  enabled: ready,
                  expand: true,
                  onPressed: () => _compare(entry.$1),
                ),
              ),
            ],
          ],
        ),
        if (!ready) ...[
          const SizedBox(height: 6),
          Text(
            'Tap one more ${widget.spec.vocabulary.object} to compare.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: colors.muted),
          ),
        ],
      ],
    );
  }
}
