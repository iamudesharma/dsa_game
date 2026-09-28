/// The board screen.
///
/// Layout is portrait-first and bottom-weighted: the story and objective sit at
/// the top where they are read once, the board owns the middle, the algorithm
/// strip and trace rail sit directly under it (so the player can see a pointer
/// move and the variable change that caused it without scrolling), and the
/// mechanic's controls are pinned to the bottom within thumb reach.
///
/// The spec's palette is applied as a nested `Theme`, so this screen and the
/// debrief look like the generated world while the topic/problem screens keep
/// the neutral shell theme.
library;

// `material.dart` exports Flutter's own `Action<T>`; the debrief describes
// the contract's action union.
import 'package:flutter/material.dart' hide Action;

import 'package:provider/provider.dart';

import '../models/action.dart';
import '../models/api.dart';
import '../models/enums.dart';
import '../models/spec.dart';
import '../models/state.dart';
import '../state/game_controller.dart';
import '../theme/palette.dart';
import '../widgets/algorithm_strip.dart';
import '../widgets/common.dart';
import '../widgets/hint_button.dart';
import '../widgets/mechanics/mechanic_registry.dart';
import '../widgets/trace_rail.dart';
import 'debrief_screen.dart';

class PlayScreen extends StatefulWidget {
  const PlayScreen({super.key});

  @override
  State<PlayScreen> createState() => _PlayScreenState();
}

class _PlayScreenState extends State<PlayScreen> {
  MechanicId? _activeMechanic;
  int _lastDebriefEpoch = -1;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<GameController>();
    final spec = controller.spec;

    if (spec == null) {
      // The run was cleared (e.g. after the debrief) — nothing to play.
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    _maybeOpenDebrief(controller);

    return Theme(
      data: GameColorsX.themed(spec.visual.palette),
      child: Builder(
        builder: (context) => Scaffold(
          backgroundColor: context.gameColors.background,
          appBar: _appBar(context, controller, spec),
          body: SafeArea(child: _body(context, controller, spec)),
        ),
      ),
    );
  }

  /// Pushes the debrief exactly once per finished game.
  void _maybeOpenDebrief(GameController controller) {
    if (controller.debrief == null) return;
    if (controller.debriefEpoch == _lastDebriefEpoch) return;
    _lastDebriefEpoch = controller.debriefEpoch;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final finished = controller.debrief;
      if (finished == null) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => DebriefScreen(debrief: finished)),
      );
      if (!mounted) return;
      // Coming back from the debrief with a finished game: offer a new run
      // rather than leaving a dead board behind.
      if (controller.isFinished) setState(() {});
    });
  }

  PreferredSizeWidget _appBar(BuildContext context, GameController controller, GameSpec spec) {
    final colors = context.gameColors;
    final progress = controller.state?.progress;
    return AppBar(
      backgroundColor: colors.background,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            spec.theme.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.onSurface),
          ),
          Text(
            spec.objective,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w500, color: colors.muted),
          ),
        ],
      ),
      actions: [
        _CounterChip(
          value: progress?.mistakes ?? 0,
          icon: Icons.close_rounded,
          color: (progress?.mistakes ?? 0) > 0 ? colors.danger : colors.muted,
          tooltip: 'mistakes',
        ),
        _CounterChip(
          value: progress?.steps ?? 0,
          icon: Icons.play_arrow_rounded,
          color: colors.muted,
          tooltip: 'steps taken',
        ),
        const SizedBox(width: 4),
      ],
    );
  }

  Widget _body(BuildContext context, GameController controller, GameSpec spec) {
    final colors = context.gameColors;
    final state = controller.visibleState;
    if (state == null) {
      return Center(child: EmptyHint(text: 'This game has no board yet.'));
    }

    final activeMechanic = _resolveMechanic(controller, spec);
    final outcome = controller.lastOutcome;
    final expectedIds = outcome != null && !outcome.correct
        ? (outcome.expected?.objectIds ?? const <String>{})
        : const <String>{};

    return Column(
      children: [
        if (controller.isRewound) _RewindBanner(controller: controller),
        if (controller.error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: ApiErrorCard(
              error: controller.error!,
              onRetry: controller.dismissOutcome,
              retryLabel: 'Dismiss',
            ),
          ),
        if (outcome != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: _OutcomeBanner(
              controller: controller,
              outcome: outcome,
              expectedIds: expectedIds,
            ),
          ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 8),
            child: MechanicRegistry.build(
              activeMechanic,
              controller: controller,
              spec: spec,
              state: state,
              expectedIds: expectedIds,
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AlgorithmStrip(state: state, dense: true),
              const SizedBox(height: 6),
              _InfoRow(controller: controller, spec: spec, state: state),
            ],
          ),
        ),
        if (spec.mechanics.length > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
            child: _MechanicSwitcher(
              spec: spec,
              active: activeMechanic,
              enabled: !controller.isRewound,
              onSelect: (id) => setState(() => _activeMechanic = id),
            ),
          ),
        if (controller.hint != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
            child: HintCard(
              hint: controller.hint!,
              source: controller.hintSource,
              onDismiss: () => context.read<GameController>().dismissHint(),
            ),
          ),
        if (controller.isFinished && controller.debrief == null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: _NoDebriefNote(colors: colors),
          ),
      ],
    );
  }

  /// Picks which mechanic widget to show. Defaults to the first binding, and
  /// falls back to `selectObject` when a spec somehow declares none.
  MechanicId _resolveMechanic(GameController controller, GameSpec spec) {
    if (controller.isRewound) return _activeMechanic ?? _defaultMechanic(spec);
    final ids = spec.mechanics.map((m) => m.id).toSet();
    if (_activeMechanic != null && ids.contains(_activeMechanic)) return _activeMechanic!;
    return _defaultMechanic(spec);
  }

  MechanicId _defaultMechanic(GameSpec spec) =>
      spec.mechanics.isEmpty ? MechanicId.selectObject : spec.mechanics.first.id;
}

class _CounterChip extends StatelessWidget {
  const _CounterChip({required this.value, required this.icon, required this.color, required this.tooltip});

  final int value;
  final IconData icon;
  final Color color;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Container(
        margin: const EdgeInsets.only(left: 4),
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 11, color: color),
            const SizedBox(width: 3),
            Text(
              '$value',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: color),
            ),
          ],
        ),
      ),
    );
  }
}

/// The mistake / correctness banner. A wrong action is never a dead end: the
/// feedback is shown large, and `outcome.expected` is one tap away and also
/// highlighted on the board.
class _OutcomeBanner extends StatelessWidget {
  const _OutcomeBanner({required this.controller, required this.outcome, required this.expectedIds});

  final GameController controller;
  final ActionOutcome outcome;
  final Set<String> expectedIds;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final correct = outcome.correct;
    final accent = correct ? colors.success : colors.danger;
    final expected = outcome.expected;
    final revealed = controller.expectationRevealed;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 9, 8, 10),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, accent, 0.13)!,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: accent.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                correct ? Icons.check_circle_rounded : Icons.error_rounded,
                size: 18,
                color: accent,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      correct
                          ? 'Right move'
                          : outcome.isDeadEnd
                          ? 'That move is not allowed here'
                          : 'Not the algorithm\'s move',
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: accent),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      outcome.feedback,
                      style: TextStyle(fontSize: 12.5, height: 1.35, color: colors.onSurface),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: () => context.read<GameController>().dismissOutcome(),
                icon: const Icon(Icons.close_rounded, size: 16),
                visualDensity: VisualDensity.compact,
                tooltip: 'Dismiss',
              ),
            ],
          ),
          if (!correct && expected != null) ...[
            const SizedBox(height: 7),
            if (!revealed)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => context.read<GameController>().revealExpectation(),
                  icon: const Icon(Icons.visibility_rounded, size: 15),
                  label: Text(
                    'The algorithm expected…',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: accent),
                  ),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              )
            else
              _ExpectedRow(
                expected: expected,
                state: controller.visibleState!,
                color: accent,
              ),
          ],
          if (!correct && expected == null && !outcome.isDeadEnd) ...[
            const SizedBox(height: 6),
            Text(
              'The algorithm had no single expected move here — try the other legal action.',
              style: TextStyle(fontSize: 11, color: colors.muted),
            ),
          ],
        ],
      ),
    );
  }
}

class _ExpectedRow extends StatelessWidget {
  const _ExpectedRow({required this.expected, required this.state, required this.color});

  final Action expected;
  final GameState state;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(9, 7, 9, 7),
      decoration: BoxDecoration(
        color: Color.lerp(colors.background, color, 0.16)!,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'THE ALGORITHM EXPECTED',
            style: TextStyle(
              fontSize: 8.5,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.2,
              color: color,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            describeAction(expected, state),
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: colors.onSurface),
          ),
        ],
      ),
    );
  }
}

class _RewindBanner extends StatelessWidget {
  const _RewindBanner({required this.controller});

  final GameController controller;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final index = controller.rewoundTo;
    final entry = index == null ? null : controller.history[index];
    return Container(
      width: double.infinity,
      color: Color.lerp(colors.surface, colors.accent, 0.2)!,
      padding: const EdgeInsets.fromLTRB(12, 7, 8, 7),
      child: Row(
        children: [
          Icon(Icons.history_toggle_off_rounded, size: 15, color: colors.accent),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              entry == null
                  ? 'Reviewing an earlier step.'
                  : 'Step ${index! + 1} of ${controller.history.length} · '
                      '${entry.wasMistake ? 'a mistake' : describeAction(entry.action, entry.state)}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: colors.onSurface),
            ),
          ),
          IconButton(
            onPressed: () => context.read<GameController>().stepForward(),
            icon: const Icon(Icons.skip_next_rounded, size: 17),
            visualDensity: VisualDensity.compact,
            tooltip: 'Forward',
          ),
          TextButton(
            onPressed: () => context.read<GameController>().returnToLive(),
            style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
            child: const Text('live', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.controller, required this.spec, required this.state});

  final GameController controller;
  final GameSpec spec;
  final GameState state;

  @override
  Widget build(BuildContext context) {
    final scrubbable = {
      for (var i = 0; i < controller.history.length; i++) controller.history[i].outcome.traceStep,
    };

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Expanded(
              child: TraceRail(
                state: state,
                scrubbable: scrubbable,
                activeTraceStep: controller.isRewound ? controller.history[controller.rewoundTo!].outcome.traceStep : null,
                maxHeight: 132,
                onScrub: (step) {
                  final game = context.read<GameController>();
                  if (step == null) return game.returnToLive();
                  final index = game.historyIndexForTraceStep(step);
                  if (index != null) game.rewindTo(index);
                },
              ),
            ),
            const SizedBox(width: 6),
            Column(
              children: [
                HintButton(
                  hint: controller.hint,
                  source: controller.hintSource,
                  used: controller.hintsUsed,
                  busy: controller.hintInFlight,
                  onPressed: controller.isRewound
                      ? null
                      : () => controller.requestHint(),
                ),
                const SizedBox(height: 6),
                _RewindButton(controller: controller),
                const SizedBox(height: 6),
                _UndoButton(controller: controller),
              ],
            ),
          ],
        ),
      ],
    );
  }
}

/// Takes the last action back for real, on the server.
///
/// Distinct from Rewind, which only scrubs the view. This one changes the
/// game, so it is only offered while the game is still in play and there is
/// actually a move to take back.
class _UndoButton extends StatelessWidget {
  const _UndoButton({required this.controller});

  final GameController controller;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final canUndo = controller.canUndo;
    return Tooltip(
      message: canUndo
          ? 'Take back your last move'
          : 'Nothing to take back yet',
      child: Material(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: canUndo ? () => controller.undoLastAction() : null,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.backspace_outlined,
                  size: 16,
                  color: canUndo ? colors.onSurface : colors.muted.withValues(alpha: 0.4),
                ),
                const SizedBox(width: 5),
                Text(
                  'Undo move',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: canUndo ? colors.onSurface : colors.muted.withValues(alpha: 0.4),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RewindButton extends StatelessWidget {
  const _RewindButton({required this.controller});

  final GameController controller;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final controller = context.read<GameController>();
    final canStep = controller.history.isNotEmpty && controller.rewoundTo != 0;
    return Tooltip(
      message: 'Step back one move (view only — the server keeps playing)',
      child: Material(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: canStep ? controller.stepBack : null,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.undo_rounded,
                  size: 16,
                  color: canStep ? colors.onSurface : colors.muted.withValues(alpha: 0.4),
                ),
                const SizedBox(width: 5),
                Text(
                  'Rewind',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: canStep ? colors.onSurface : colors.muted.withValues(alpha: 0.4),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MechanicSwitcher extends StatelessWidget {
  const _MechanicSwitcher({
    required this.spec,
    required this.active,
    required this.enabled,
    required this.onSelect,
  });

  final GameSpec spec;
  final MechanicId active;
  final bool enabled;
  final ValueChanged<MechanicId> onSelect;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return SizedBox(
      height: 34,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final binding in spec.mechanics)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                selected: binding.id == active,
                onSelected: enabled ? (_) => onSelect(binding.id) : null,
                avatar: Text(
                  binding.boundDsaOp.glyph,
                  style: TextStyle(fontSize: 11, color: binding.id == active ? colors.accent : colors.muted),
                ),
                label: Text(
                  binding.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _NoDebriefNote extends StatelessWidget {
  const _NoDebriefNote({required this.colors});

  final GameColors colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, colors.accent, 0.12)!,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.accent.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline_rounded, size: 15, color: colors.accent),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'The run is over, but the server did not send a debrief. Play a new version instead.',
              style: TextStyle(fontSize: 11.5, color: colors.onSurface),
            ),
          ),
        ],
      ),
    );
  }
}
