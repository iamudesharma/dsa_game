/// `connectNodes` — draw or rewire a `next` / `prev` pointer between nodes.
///
/// The signature interaction: a live `CustomPainter` line that follows the
/// finger from the source node and snaps (with a ring) onto whichever node it
/// is released over. A tap-tap path with an explicit link-kind toggle is kept
/// as the precise alternative — rewiring backwards is a real part of reverse-a-
/// linked-list, and dragging cannot express intent as clearly as a label can.
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class ConnectNodesMechanic extends MechanicView {
  const ConnectNodesMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.connectNodes;

  @override
  State<ConnectNodesMechanic> createState() => _ConnectNodesMechanicState();
}

class _ConnectNodesMechanicState extends MechanicViewState<ConnectNodesMechanic> {
  /// Where the dragged pointer currently is, in board-local coordinates.
  Offset? _dragPoint;

  /// Node the pointer started on.
  String? _dragFrom;

  /// Tapped source, for the tap-tap path.
  String? _pickedFrom;

  LinkKind _kind = LinkKind.next;

  @override
  int get selectionCapacity => 2;

  String? get _fromId => _dragFrom ?? _pickedFrom ?? firstSelected;

  @override
  Widget buildBoard() => buildBoardFrom(
    showPool: false,
    onNodeTap: canAct ? (node) => _tapNode(node) : null,
    onPanStart: canAct
        ? (id, point) => setState(() {
            _dragFrom = id;
            _pickedFrom = id;
            _dragPoint = point;
          })
        : null,
    onPanUpdate: canAct ? (point) => setState(() => _dragPoint = point) : null,
    onPanEnd: canAct
        ? (target) {
            final from = _dragFrom;
            setState(() {
              _dragPoint = null;
              _dragFrom = null;
            });
            if (from != null && target != null && target != from) _connect(from, target);
          }
        : null,
    dragFromId: _dragFrom,
    dragPoint: _dragPoint,
  );

  void _tapNode(GameObject node) {
    final from = _pickedFrom;
    if (from == null || from == node.id) {
      setState(() => _pickedFrom = node.id);
      select(node.id);
      return;
    }
    _connect(from, node.id);
  }

  Future<void> _connect(String from, String to) async {
    setState(() => _pickedFrom = null);
    await act(ConnectNodesAction(fromNodeId: from, toNodeId: to, linkKind: _kind));
  }

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final from = _fromId;
    final to = secondSelected;
    final ready = from != null && to != null && from != to;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: _KindToggle(
                kind: LinkKind.next,
                selected: _kind == LinkKind.next,
                enabled: canAct,
                color: colors.accent,
                onTap: () => setState(() => _kind = LinkKind.next),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _KindToggle(
                kind: LinkKind.prev,
                selected: _kind == LinkKind.prev,
                enabled: canAct,
                color: colors.primary,
                onTap: () => setState(() => _kind = LinkKind.prev),
              ),
            ),
          ],
        ),
        const SizedBox(height: 9),
        Center(
          child: PairReadout(
            state: widget.state,
            selection: from == null ? const <String>[] : [from, ?to],
            bracket: _kind.arrow,
          ),
        ),
        const SizedBox(height: 8),
        ActionButton(
          label: 'Wire ${_kind.wire} pointer',
          icon: Icons.arrow_forward_rounded,
          expand: true,
          enabled: ready,
          color: colors.success,
          onPressed: () => _connect(from!, to!),
        ),
        const SizedBox(height: 5),
        Text(
          'Drag from one node to another, or tap the two ends.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 10.5, color: colors.muted.withValues(alpha: 0.85)),
        ),
      ],
    );
  }
}

class _KindToggle extends StatelessWidget {
  const _KindToggle({
    required this.kind,
    required this.selected,
    required this.enabled,
    required this.color,
    required this.onTap,
  });

  final LinkKind kind;
  final bool selected;
  final bool enabled;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return SizedBox(
      height: 40,
      child: OutlinedButton(
        onPressed: enabled ? onTap : null,
        style: OutlinedButton.styleFrom(
          backgroundColor: selected ? color.withValues(alpha: 0.18) : null,
          side: BorderSide(
            color: selected ? color : colors.muted.withValues(alpha: 0.3),
            width: selected ? 1.8 : 1,
          ),
          foregroundColor: selected ? color : colors.muted,
        ),
        child: Text(
          '${kind.arrow}  ${kind.wire}',
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
            color: selected ? color : colors.muted,
          ),
        ),
      ),
    );
  }
}
