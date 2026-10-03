/// Shared base for the ten mechanic widgets.
///
/// Selection is the subtle part. `state.selection` is owned by the *engine* —
/// tapping an object emits a real `selectObject` action and the oracle
/// decides what that means. To make taps feel instant anyway, the base class
/// keeps a short list of pending taps, renders the union with the engine's
/// selection, and clears it as soon as the response lands. The engine's answer
/// always wins, so a spec that treats a second tap as a replacement converges
/// correctly instead of leaving a stale highlight.
library;

// Flutter's `material.dart` also exports an `Action<T>` class; the contract's
// action union is what every mechanic in this directory means by "Action".
import 'package:flutter/material.dart' hide Action;

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../models/spec.dart';
import '../../models/state.dart';
import '../../state/game_controller.dart';
import '../../theme/palette.dart';
import '../board/game_board.dart';

abstract class MechanicView extends StatefulWidget {
  const MechanicView({
    required this.controller,
    required this.spec,
    required this.state,
    required this.expectedIds,
    super.key,
  });

  final GameController controller;
  final GameSpec spec;

  /// The state to draw: the live one, or a rewound snapshot.
  final GameState state;

  /// Object ids referenced by `outcome.expected` for the current mistake.
  final Set<String> expectedIds;

  MechanicId get mechanicId;
}

abstract class MechanicViewState<T extends MechanicView> extends State<T> {
  /// Ids tapped since the last engine acknowledgement.
  final List<String> _pending = <String>[];
  List<String?>? _operands;
  int? _replacement;

  /// How many objects this mechanic can hold at once. `comparePair` and
  /// `swapPair` are two-party; everything else is one.
  int get selectionCapacity => 1;

  bool get canAct =>
      widget.state.isPlaying && !widget.controller.isActionInFlight;

  /// The engine's selection merged with in-flight taps, in tap order.
  List<String> get selection {
    if (_operands != null) return _operands!.whereType<String>().toList();
    final merged = <String>[...widget.state.selection.take(selectionCapacity)];
    for (final id in _pending) {
      if (!merged.contains(id) && merged.length < selectionCapacity) {
        merged.add(id);
      }
    }
    return merged;
  }

  Set<String> get selectedIds => selection.toSet();

  Set<String> get highlightIds => widget.expectedIds;

  String? get firstSelected => _operands != null
      ? _operands![0]
      : selection.isEmpty
      ? null
      : selection.first;

  String? get secondSelected => _operands != null
      ? _operands![1]
      : selection.length < 2
      ? null
      : selection[1];

  /// The themed label for this mechanic, falling back to the verb.
  String get bindingLabel =>
      widget.spec.bindingFor(widget.mechanicId)?.label ??
      widget.spec.vocabulary.actionVerb;

  String? get bindingHint => widget.spec.bindingFor(widget.mechanicId)?.hint;

  Future<void> select(String objectId) async {
    if (!canAct) return;
    if (selectionCapacity == 2) {
      setState(() {
        _operands ??= [firstSelected, secondSelected];
        final index = _replacement ?? (_operands![0] == null ? 0 : 1);
        if (_operands![1 - index] == objectId) _operands![1 - index] = null;
        _operands![index] = objectId;
        _replacement = null;
      });
      return;
    }
    setState(() {
      if (_pending.length >= selectionCapacity) _pending.removeAt(0);
      _pending.add(objectId);
    });
    await widget.controller.dispatch(SelectObjectAction(objectId: objectId));
    if (mounted) setState(_pending.clear);
  }

  /// Emits a non-selection action, when the mechanic is not busy.
  Future<void> act(Action action) async {
    if (!canAct) return;
    await widget.controller.dispatch(action);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Column(
      mainAxisSize: MainAxisSize.max,
      children: [
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            // The board must never overflow: the outcome banner, the hint card
            // and the trace rail all compete for the same vertical space, and
            // on a short screen a long board would otherwise clip its last row.
            // A tall board scrolls; a short one does not move at all.
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                physics: const ClampingScrollPhysics(),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [buildBoard()],
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          decoration: BoxDecoration(
            color: Color.lerp(colors.surface, Colors.black, 0.30),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
            border: Border(
              top: BorderSide(color: colors.muted.withValues(alpha: 0.22)),
            ),
          ),
          child: SafeArea(
            top: false,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 180),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _BindingHeader(
                      label: bindingLabel,
                      hint: bindingHint,
                      opGlyph:
                          widget.spec
                              .bindingFor(widget.mechanicId)
                              ?.boundDsaOp
                              .glyph ??
                          '●',
                    ),
                    const SizedBox(height: 8),
                    buildControls(context),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// The board for this mechanic. Override to add taps, drags or pointers.
  Widget buildBoard() => buildBoardFrom();

  /// The board, with the interaction hooks a mechanic needs. Every override
  /// starts from this so the layout stays identical across mechanics.
  Widget buildBoardFrom({
    void Function(GameObject object)? onObjectTap,
    void Function(GameObject object)? onObjectLongPress,
    void Function(Slot slot)? onSlotTap,
    bool slotTapEnabled = false,
    Widget Function(Widget child, GameObject object)? dragObjectBuilder,
    Widget Function(Widget child, Slot slot)? dragTargetBuilder,
    void Function(GameObject node)? onNodeTap,
    void Function(String nodeId, Offset localPoint)? onPanStart,
    void Function(Offset localPoint)? onPanUpdate,
    void Function(String? targetId)? onPanEnd,
    String? dragFromId,
    Offset? dragPoint,
    String poolTitle = 'in hand',
    bool Function(GameObject object)? poolFilter,
    void Function(GameObject object)? poolOnTap,
    void Function(GameObject object)? poolOnLongPress,
    Widget Function(Widget child, GameObject object)? poolDragBuilder,
    bool showPool = true,
  }) => GameBoard(
    state: widget.state,
    spec: widget.spec,
    selectedIds: selectedIds,
    highlightIds: highlightIds,
    onObjectTap: onObjectTap ?? (canAct ? (object) => select(object.id) : null),
    onObjectLongPress: onObjectLongPress,
    onSlotTap: onSlotTap,
    slotTapEnabled: slotTapEnabled,
    dragObjectBuilder: dragObjectBuilder,
    dragTargetBuilder: dragTargetBuilder,
    onNodeTap: onNodeTap,
    onPanStart: onPanStart,
    onPanUpdate: onPanUpdate,
    onPanEnd: onPanEnd,
    dragFromId: dragFromId,
    dragPoint: dragPoint,
    poolTitle: poolTitle,
    poolFilter: poolFilter,
    poolOnTap:
        poolOnTap ??
        onObjectTap ??
        (canAct ? (object) => select(object.id) : null),
    poolOnLongPress: poolOnLongPress,
    poolDragBuilder: poolDragBuilder,
    showPool: showPool,
  );

  Widget operandControls() => Wrap(
    spacing: 8,
    children: [
      for (final index in [0, 1])
        TextButton(
          onPressed: canAct
              ? () => setState(() {
                  _operands ??= [firstSelected, secondSelected];
                  _operands![index] = null;
                  _replacement = index;
                })
              : null,
          child: Text(index == 0 ? 'Change first' : 'Change second'),
        ),
      TextButton(
        onPressed: canAct
            ? () => setState(() {
                _operands = [null, null];
                _replacement = null;
              })
            : null,
        child: const Text('Clear selection'),
      ),
    ],
  );

  /// The thumb-reachable control strip at the bottom of the screen.
  Widget buildControls(BuildContext context);
}

class _BindingHeader extends StatelessWidget {
  const _BindingHeader({
    required this.label,
    required this.hint,
    required this.opGlyph,
  });

  final String label;
  final String? hint;
  final String opGlyph;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 22,
              height: 22,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: colors.primary.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(7),
              ),
              child: Text(
                opGlyph,
                style: TextStyle(
                  fontSize: 12,
                  color: colors.primary,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.2,
                  color: colors.onSurface,
                ),
              ),
            ),
          ],
        ),
        if (hint != null && hint!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 3, left: 30),
            child: Text(
              hint!,
              style: TextStyle(
                fontSize: 11.5,
                height: 1.25,
                color: colors.muted,
              ),
            ),
          ),
      ],
    );
  }
}

/// A compact "you picked A and B" readout used by the two-party mechanics.
class PairReadout extends StatelessWidget {
  const PairReadout({
    required this.state,
    required this.selection,
    required this.bracket,
    super.key,
  });

  final GameState state;
  final List<String> selection;

  /// e.g. `vs` or `→`.
  final String bracket;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    if (selection.isEmpty) {
      return Text(
        'Tap two, then choose.',
        style: TextStyle(fontSize: 12, color: colors.muted),
      );
    }
    return Wrap(
      spacing: 6,
      runSpacing: 4,
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (var i = 0; i < selection.length; i++) ...[
          if (i > 0)
            Text(
              bracket,
              style: TextStyle(
                color: colors.accent,
                fontWeight: FontWeight.w800,
                fontSize: 12,
              ),
            ),
          _Token(
            text:
                '${i == 0 ? 'First' : 'Second'}: ${state.object(selection[i])?.label ?? selection[i]}',
            color: i == 0 ? colors.primary : colors.accent,
          ),
        ],
        if (selection.length == 1)
          Text(
            '…',
            style: TextStyle(
              color: colors.muted,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
      ],
    );
  }
}

class _Token extends StatelessWidget {
  const _Token({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.6)),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          color: color,
        ),
      ),
    );
  }
}

/// Big, one-handed action button. Disabled buttons stay visible so the player
/// can see what the mechanic will let them do next.
class ActionButton extends StatelessWidget {
  const ActionButton({
    required this.label,
    required this.onPressed,
    this.icon,
    this.enabled = true,
    this.color,
    this.expand = false,
    this.dense = false,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool enabled;
  final Color? color;
  final bool expand;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final tint = color ?? colors.primary;
    final active = enabled && onPressed != null;
    return SizedBox(
      width: expand ? double.infinity : null,
      child: FilledButton.icon(
        onPressed: active ? onPressed : null,
        icon: icon == null
            ? const SizedBox.shrink()
            : Icon(icon, size: dense ? 15 : 18),
        label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
        style: FilledButton.styleFrom(
          backgroundColor: tint,
          foregroundColor: _on(tint),
          disabledBackgroundColor: colors.surface,
          disabledForegroundColor: colors.muted.withValues(alpha: 0.55),
          minimumSize: Size(0, dense ? 40 : 46),
          padding: EdgeInsets.symmetric(horizontal: dense ? 12 : 16),
        ),
      ),
    );
  }
}

Color _on(Color background) => background.computeLuminance() > 0.6
    ? const Color(0xFF0B0E12)
    : Colors.white;

/// A labelled chip used to choose a target (slot, container, variable, node).
class ChoiceChipRow<T> extends StatelessWidget {
  const ChoiceChipRow({
    required this.options,
    required this.selected,
    required this.labelOf,
    required this.onSelected,
    this.enabled = true,
    this.iconBuilder,
    super.key,
  });

  final List<T> options;
  final T? selected;
  final String Function(T option) labelOf;
  final ValueChanged<T> onSelected;
  final bool enabled;
  final Widget Function(T option)? iconBuilder;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const SizedBox.shrink();
    // A public final field is not promoted by the analyzer, so bind it locally.
    final builder = iconBuilder;
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      alignment: WrapAlignment.center,
      children: [
        for (final option in options)
          ChoiceChip(
            selected: option == selected,
            onSelected: enabled ? (_) => onSelected(option) : null,
            avatar: builder == null ? null : builder(option),
            label: Text(
              labelOf(option),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
    );
  }
}
