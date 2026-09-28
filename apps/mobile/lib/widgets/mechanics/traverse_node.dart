/// `traverseNode` — advance the cursor along a `next` pointer.
///
/// One big primary button ("advance") because that is the whole mechanic, plus
/// direct node taps for players who prefer pointing at the exact node. The
/// source node always comes from `cursor.nodeId` when the engine set one, so
/// the emitted `fromNodeId` matches the algorithm's own position.
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class TraverseNodeMechanic extends MechanicView {
  const TraverseNodeMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.traverseNode;

  @override
  State<TraverseNodeMechanic> createState() => _TraverseNodeMechanicState();
}

class _TraverseNodeMechanicState extends MechanicViewState<TraverseNodeMechanic> {
  List<GameObject> get _nodes => widget.state.objectsOfKind(GameObjectKind.node);

  String? get _currentId {
    final cursor = widget.state.cursor.nodeId;
    if (cursor != null) return cursor;
    return _nodes.isEmpty ? null : _nodes.first.id;
  }

  /// The node a `next` edge points at from [_currentId].
  String? get _nextId {
    final from = _currentId;
    if (from == null) return null;
    for (final link in widget.state.links) {
      if (link.from == from && link.kind == LinkKind.next) return link.to;
    }
    return null;
  }

  /// Where the player tapped, used when no cursor is set yet.
  String? _pendingFrom;

  String? get _effectiveFrom => _pendingFrom ?? _currentId;

  Future<void> _traverse({String? from, String? to}) async {
    final source = from ?? _effectiveFrom;
    final target = to ?? _nextId;
    if (source == null || target == null) return;
    await act(TraverseNodeAction(fromNodeId: source, toNodeId: target));
  }

  @override
  Widget buildBoard() => buildBoardFrom(
    showPool: false,
    onNodeTap: canAct
        ? (node) {
            final current = _effectiveFrom;
            if (current == null) {
              setState(() => _pendingFrom = node.id);
              return;
            }
            _traverse(from: current, to: node.id);
          }
        : null,
  );

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final current = _effectiveFrom;
    final next = _nextId;
    final currentLabel = current == null ? '—' : widget.state.object(current)?.label ?? current;
    final nextLabel = next == null ? null : widget.state.object(next)?.label ?? next;
    final vocabulary = widget.spec.vocabulary;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _Step(label: 'at', value: currentLabel, color: colors.accent),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 10),
              child: Icon(Icons.arrow_forward_rounded, size: 16),
            ),
            _Step(
              label: 'next',
              value: nextLabel ?? 'end of list',
              color: nextLabel == null ? colors.muted : colors.success,
            ),
          ],
        ),
        const SizedBox(height: 10),
        ActionButton(
          label: 'Step to the next ${vocabulary.object}',
          icon: Icons.skip_next_rounded,
          expand: true,
          enabled: canAct && next != null,
          color: colors.success,
          onPressed: _traverse,
        ),
        const SizedBox(height: 5),
        Text(
          'There is no indexing in a list — every step follows one pointer.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 10.5, color: colors.muted.withValues(alpha: 0.85)),
        ),
      ],
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.label, required this.value, required this.color});

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.2,
              color: context.gameColors.muted,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: color),
          ),
        ],
      ),
    );
  }
}
