/// `pushPop` — push an object into a stack / queue, or pop the top.
///
/// `push` needs a container *and* an object; `pop` needs only the container.
/// When a board has one container (the common case) that is chosen
/// automatically so the player never has to make a decision the algorithm does
/// not make.
library;

import 'package:flutter/material.dart';

import '../../models/action.dart';
import '../../models/enums.dart';
import '../../models/state.dart';
import '../../theme/palette.dart';
import 'mechanic_view.dart';

class PushPopMechanic extends MechanicView {
  const PushPopMechanic({
    required super.controller,
    required super.spec,
    required super.state,
    required super.expectedIds,
    super.key,
  });

  @override
  MechanicId get mechanicId => MechanicId.pushPop;

  @override
  State<PushPopMechanic> createState() => _PushPopMechanicState();
}

class _PushPopMechanicState extends MechanicViewState<PushPopMechanic> {
  String? _containerId;

  List<GameContainer> get _containers {
    final list = widget.state.containers.values.toList()
      ..sort((a, b) => a.id.compareTo(b.id));
    return list;
  }

  GameContainer? get _container {
    final containers = _containers;
    if (containers.isEmpty) return null;
    return containers.firstWhere(
      (c) => c.id == _containerId,
      orElse: () => containers.first,
    );
  }

  @override
  Widget buildBoard() => buildBoardFrom(
    // A push takes its object from the free pool; tapping a pool item selects it
    // and the "push" button sends it.
    poolTitle: 'to push',
    onObjectTap: canAct ? (object) => select(object.id) : null,
  );

  Future<void> _push() async {
    final container = _container;
    final objectId = firstSelected;
    if (container == null || objectId == null) return;
    await act(PushPopAction(containerId: container.id, op: StackOp.push, objectId: objectId));
  }

  Future<void> _pop() async {
    final container = _container;
    if (container == null) return;
    await act(PushPopAction(containerId: container.id, op: StackOp.pop));
  }

  @override
  Widget buildControls(BuildContext context) {
    final colors = context.gameColors;
    final container = _container;
    final selected = widget.state.object(firstSelected);
    final isQueue = container?.kind == ContainerKind.queue;
    final canPush = container != null && selected != null && !container.isFull;
    final canPop = container != null && container.order.isNotEmpty;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_containers.length > 1) ...[
          ChoiceChipRow<GameContainer>(
            options: _containers,
            selected: container,
            labelOf: (c) => c.label ?? c.kind.wire,
            onSelected: (c) => setState(() => _containerId = c.id),
          ),
          const SizedBox(height: 8),
        ],
        Row(
          children: [
            Expanded(
              child: ActionButton(
                label: isQueue ? 'Enqueue' : 'Push',
                icon: Icons.arrow_upward_rounded,
                dense: true,
                expand: true,
                enabled: canPush,
                color: colors.primary,
                onPressed: _push,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: ActionButton(
                label: isQueue ? 'Dequeue' : 'Pop',
                icon: Icons.arrow_downward_rounded,
                dense: true,
                expand: true,
                enabled: canPop,
                color: colors.accent,
                onPressed: _pop,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          switch ((selected, container)) {
            (null, null) => 'This board has no container to work with.',
            (null, final c?) => 'Tap a ${widget.spec.vocabulary.object} in ${c.label ?? c.kind.wire} to ${isQueue ? 'enqueue' : 'push'} it.',
            (final s?, final c?) => canPush
                ? '${s.label} is ready to ${isQueue ? 'enqueue' : 'push'} into ${c.label ?? c.kind.wire}.'
                : '${c.label ?? c.kind.wire} is full — pop one first.',
            _ => 'Tap an object to pick it up.',
          },
          textAlign: TextAlign.center,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 11, height: 1.25, color: colors.muted),
        ),
      ],
    );
  }
}
