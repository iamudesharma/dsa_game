/// The teaching payoff.
///
/// A game is only worth playing if something is learned afterwards, so this
/// screen is structured as an argument, not a summary:
///
///   1. what the answer was, and what you did
///   2. your own run, replayable step by step against the real board
///   3. the canonical run beside it, so the difference is visible
///   4. the metaphor -> algorithm mapping you were actually playing inside
///   5. pseudocode and real code, with *your* lines highlighted
///   6. complexity, stats, and any misconception the coach detected
///   7. one prominent button to play the same problem again with a new seed
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/api.dart';
import '../models/spec.dart';
import '../models/state.dart';
import '../models/trace.dart';
import '../adventure/worlds.dart';
import '../state/game_controller.dart';
import '../theme/palette.dart';
import '../widgets/common.dart';
import '../widgets/replay/code_viewer.dart';
import '../widgets/replay/replay_board.dart';
import '../widgets/trace_rail.dart';
import 'play_screen.dart';
import 'chat_screen.dart';

class DebriefScreen extends StatefulWidget {
  const DebriefScreen({required this.debrief, super.key});

  final Debrief debrief;

  @override
  State<DebriefScreen> createState() => _DebriefScreenState();
}

class _DebriefScreenState extends State<DebriefScreen> {
  /// Played-trace playback position.
  int _frame = 0;
  bool _playing = false;
  Timer? _playback;

  /// Canonical-trace playback position.
  int _canonicalFrame = 0;

  String? _language;
  int? _selectedCodeLine;

  Debrief get _debrief => widget.debrief;

  @override
  void initState() {
    super.initState();
    _frame = (_debrief.playedTrace.length - 1).clamp(
      0,
      _debrief.playedTrace.length,
    );
    final languages = _debrief.codeLanguages;
    _language = languages.isEmpty ? null : languages.first;
  }

  @override
  void dispose() {
    _playback?.cancel();
    super.dispose();
  }

  // ------------------------------------------------------------- playback

  void _togglePlay() {
    if (_debrief.playedTrace.isEmpty) return;
    setState(() {
      _playing = !_playing;
      if (_playing) {
        if (_frame >= _debrief.playedTrace.length - 1) _frame = 0;
        _playback?.cancel();
        _playback = Timer.periodic(const Duration(milliseconds: 1100), (_) {
          if (!mounted) return;
          if (_frame >= _debrief.playedTrace.length - 1) {
            _playback?.cancel();
            setState(() => _playing = false);
            return;
          }
          setState(() => _frame++);
        });
      } else {
        _playback?.cancel();
      }
    });
  }

  void _step(int delta) {
    _playback?.cancel();
    setState(() {
      _playing = false;
      _frame = (_frame + delta).clamp(0, _debrief.playedTrace.length - 1);
    });
  }

  void _scrub(int? value) {
    if (value == null) return;
    _playback?.cancel();
    setState(() {
      _playing = false;
      _frame = value.clamp(0, _debrief.playedTrace.length - 1);
    });
  }

  // ------------------------------------------------------------------ build

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<GameController>();
    final spec = controller.spec;
    final palette = spec?.visual.palette ?? Palette.fallback;
    final colors = context.gameColors;

    return Theme(
      data: GameColorsX.themed(palette),
      child: Builder(
        builder: (context) => DefaultTabController(
          length: 3,
          child: Scaffold(
            backgroundColor: colors.background,
            appBar: AppBar(
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _debrief.isWin ? 'Solved' : 'Run over',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: colors.onSurface,
                    ),
                  ),
                  Text(
                    spec?.theme.title ?? _debrief.problemId,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 10.5, color: colors.muted),
                  ),
                ],
              ),
              actions: [
                IconButton(
                  tooltip: 'Discuss replay step',
                  icon: const Icon(Icons.chat_bubble_outline),
                  onPressed: () => ChatScreen.open(
                    context,
                    prompt: 'Explain this replay step and the rule behind it.',
                    reference: {
                      'type': 'run',
                      'gameId': controller.gameId ?? '',
                      if (_debrief.playedTrace.isNotEmpty)
                        'step': _debrief.playedTrace[_frame].index,
                    },
                  ),
                ),
                IconButton(
                  tooltip: 'Jump to mistake',
                  icon: const Icon(Icons.error_outline),
                  onPressed: _debrief.playedTrace.any((f) => !f.correct)
                      ? () => setState(() {
                          final next = _debrief.playedTrace.indexWhere(
                            (f) =>
                                !f.correct &&
                                f.index > _debrief.playedTrace[_frame].index,
                          );
                          _frame = next < 0
                              ? _debrief.playedTrace.indexWhere(
                                  (f) => !f.correct,
                                )
                              : next;
                          _playing = false;
                          _playback?.cancel();
                        })
                      : null,
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded, size: 20),
                  tooltip: 'Back to the board',
                ),
              ],
            ),
            body: SafeArea(
              top: false,
              child: Column(
                children: [
                  Expanded(
                    child: NestedScrollView(
                      headerSliverBuilder: (context, innerBoxIsScrolled) => [
                        SliverToBoxAdapter(
                          child: _ResultsScene(debrief: _debrief, spec: spec),
                        ),
                        SliverToBoxAdapter(
                          child: const TabBar(
                            tabs: [
                              Tab(
                                text: 'Replay',
                                icon: Icon(Icons.replay_rounded, size: 17),
                              ),
                              Tab(
                                text: 'Explain',
                                icon: Icon(
                                  Icons.lightbulb_outline_rounded,
                                  size: 17,
                                ),
                              ),
                              Tab(
                                text: 'Code',
                                icon: Icon(Icons.code_rounded, size: 17),
                              ),
                            ],
                          ),
                        ),
                      ],
                      body: TabBarView(
                        children: [
                          _tabList([
                            if (_debrief.playedTrace.isEmpty)
                              EmptyHint(
                                text: 'No moves were recorded for this run.',
                                icon: Icons.replay_rounded,
                              )
                            else ...[
                              _Section(
                                number: '1',
                                title: 'Your run, step by step',
                                subtitle: 'Exactly the moves you made, on the board you saw.',
                                child: _ReplaySection(
                                  debrief: _debrief,
                                  spec: spec,
                                  frame: _frame,
                                  onScrub: _scrub,
                                  playing: _playing,
                                  onTogglePlay: _togglePlay,
                                  onStep: _step,
                                  resolveSnapshot: _snapshotFor,
                                ),
                              ),
                              const SizedBox(height: 18),
                            ],
                            if (_debrief.canonicalTrace.isNotEmpty) ...[
                              _Section(
                                number: '2',
                                title: 'The canonical run',
                                subtitle: 'What the algorithm does when nobody gets it wrong.',
                                child: _CanonicalSection(
                                  debrief: _debrief,
                                  spec: spec,
                                  frame: _canonicalFrame,
                                  onScrub: (value) => setState(
                                    () => _canonicalFrame = value.clamp(
                                      0,
                                      _debrief.canonicalTrace.length - 1,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ]),
                          _tabList([
                            _Section(
                              number: '3',
                              title: 'What you were really doing',
                              subtitle: 'The metaphor, and the algorithm underneath it.',
                              child: _MeaningSection(
                                debrief: _debrief,
                                spec: spec,
                              ),
                            ),
                            const SizedBox(height: 18),
                            _Section(
                              number: '4',
                              title: 'What it cost',
                              subtitle: 'Complexity, your stats, and any misconception spotted.',
                              child: _CostSection(debrief: _debrief),
                            ),
                          ]),
                          _tabList([
                            _Section(
                              number: '5',
                              title: 'The algorithm itself',
                              subtitle: 'Your lines are highlighted. Tap one to see what you did there.',
                              child: _CodeSection(
                                debrief: _debrief,
                                language: _language,
                                selectedLine: _selectedCodeLine,
                                onSelectLine: (line) => setState(
                                  () => _selectedCodeLine =
                                      _selectedCodeLine == line ? null : line,
                                ),
                                onLanguage: (lang) =>
                                    setState(() => _language = lang),
                              ),
                            ),
                          ]),
                        ],
                      ),
                    ),
                  ),
                  _NewVersionBar(onPlayAgain: _playNewVersion),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// The client holds a full board snapshot for every action it dispatched, so
  /// the player's own frames can be replayed exactly.
  GameState? _snapshotFor(int index) {
    final controller = context.read<GameController>();
    if (index < 0 || index >= _debrief.playedTrace.length) return null;
    final traceStep = _debrief.playedTrace[index].index;
    final historyIndex = controller.historyIndexForTraceStep(traceStep);
    if (historyIndex == null) return null;
    return controller.history[historyIndex].state;
  }

  /// A new seed means a new instance *and* a new theme, which is the point of
  /// "play a new version": the same algorithm, a different world.
  Future<void> _playNewVersion() async {
    final problem = context.read<GameController>().problem;
    final game = context.read<GameController>();
    if (problem == null) {
      Navigator.of(context).pop();
      return;
    }
    game.clearRun();
    if (!mounted) return;
    await game.generate(problem, forceNewSeed: true);
    if (!mounted) return;
    if (!context.read<GameController>().hasGame) return;
    await Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(builder: (_) => const PlayScreen()),
    );
  }
}

// ------------------------------------------------------------------- pieces

/// One scrollable tab page.
Widget _tabList(List<Widget> children) {
  return ListView(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
    children: children,
  );
}

/// The results scene: the outcome card with the world and algorithm named
/// alongside each other, above the Replay / Explain / Code tabs.
class _ResultsScene extends StatelessWidget {
  const _ResultsScene({required this.debrief, required this.spec});

  final Debrief debrief;
  final GameSpec? spec;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final problem = context.watch<GameController>().problem;
    final world = worldForTopic(problem?.topic.wire);
    final algorithm = problem?.title ?? debrief.problemId;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _ResultCard(debrief: debrief, spec: spec),
          const SizedBox(height: 8),
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: world.color,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  '${world.name} · $algorithm',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                    color: colors.muted,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.number,
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String number;
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
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
                number,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  color: colors.primary,
                ),
              ),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w900,
                      color: colors.onSurface,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 11,
                      height: 1.3,
                      color: colors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 9),
        child,
      ],
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.debrief, required this.spec});

  final Debrief debrief;
  final GameSpec? spec;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final win = debrief.isWin;
    final accent = win ? colors.success : colors.danger;
    final answer = debrief.answer;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 14),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, accent, 0.12)!,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: accent.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                win ? Icons.emoji_events_rounded : Icons.flag_rounded,
                size: 20,
                color: accent,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  win ? 'You solved it' : 'The run ended',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    color: colors.onSurface,
                  ),
                ),
              ),
            ],
          ),
          if (win && spec != null) ...[
            const SizedBox(height: 6),
            Text(
              spec!.narration.win,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: colors.onSurface,
              ),
            ),
          ] else if (!win && spec != null) ...[
            const SizedBox(height: 6),
            Text(
              spec!.narration.lose,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: colors.onSurface,
              ),
            ),
          ],
          const SizedBox(height: 11),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(11, 9, 11, 10),
            decoration: BoxDecoration(
              color: Color.lerp(colors.background, Colors.black, 0.25)!,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'THE ANSWER',
                  style: TextStyle(
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                    color: colors.muted,
                  ),
                ),
                const SizedBox(height: 3),
                SelectableText(
                  answer.text,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w900,
                    color: colors.onSurface,
                  ),
                ),
                if (answer.details.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  for (final detail in answer.details)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Row(
                        children: [
                          Text(
                            detail.label,
                            style: TextStyle(fontSize: 11, color: colors.muted),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              detail.value,
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w800,
                                color: colors.onSurface,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 10),
          Text(
            debrief.summary,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.45,
              color: colors.onSurface.withValues(alpha: 0.9),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReplaySection extends StatelessWidget {
  const _ReplaySection({
    required this.debrief,
    required this.spec,
    required this.frame,
    required this.onScrub,
    required this.playing,
    required this.onTogglePlay,
    required this.onStep,
    required this.resolveSnapshot,
  });

  final Debrief debrief;
  final GameSpec? spec;
  final int frame;
  final ValueChanged<int> onScrub;
  final bool playing;
  final VoidCallback onTogglePlay;
  final void Function(int delta) onStep;
  final GameState? Function(int index) resolveSnapshot;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final trace = debrief.playedTrace;
    if (trace.isEmpty || spec == null) return const SizedBox.shrink();
    final current = trace[frame.clamp(0, trace.length - 1)];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'step ${frame + 1} / ${trace.length}',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                    color: colors.muted,
                  ),
                ),
              ),
              _ReplayButton(
                icon: Icons.skip_previous_rounded,
                tooltip: 'Back one step',
                onTap: frame == 0 ? null : () => onStep(-1),
              ),
              const SizedBox(width: 5),
              _ReplayButton(
                icon: playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                tooltip: playing ? 'Pause' : 'Play',
                filled: true,
                color: colors.primary,
                onTap: onTogglePlay,
              ),
              const SizedBox(width: 5),
              _ReplayButton(
                icon: Icons.skip_next_rounded,
                tooltip: 'Forward one step',
                onTap: frame >= trace.length - 1 ? null : () => onStep(1),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ReplayBoard(
            frame: current,
            spec: spec!,
            snapshot: resolveSnapshot(frame),
          ),
          const SizedBox(height: 9),
          _FrameNote(frame: current, state: resolveSnapshot(frame)),
          const SizedBox(height: 9),
          _Scrubber(
            total: trace.length,
            value: frame,
            correctColor: colors.success,
            onChanged: onScrub,
          ),
        ],
      ),
    );
  }
}

class _CanonicalSection extends StatelessWidget {
  const _CanonicalSection({
    required this.debrief,
    required this.spec,
    required this.frame,
    required this.onScrub,
  });

  final Debrief debrief;
  final GameSpec? spec;
  final int frame;
  final ValueChanged<int> onScrub;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final trace = debrief.canonicalTrace;
    if (trace.isEmpty || spec == null) return const SizedBox.shrink();
    final current = trace[frame.clamp(0, trace.length - 1)];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 12),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, Colors.black, 0.18)!,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.auto_awesome_rounded, size: 13, color: colors.accent),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'REFERENCE · step ${frame + 1} / ${trace.length}',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    color: colors.accent,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ReplayBoard(frame: current, spec: spec!),
          const SizedBox(height: 9),
          _FrameNote(frame: current, state: null),
          const SizedBox(height: 9),
          _Scrubber(
            total: trace.length,
            value: frame,
            correctColor: colors.accent,
            onChanged: onScrub,
          ),
        ],
      ),
    );
  }
}

class _FrameNote extends StatelessWidget {
  const _FrameNote({required this.frame, required this.state});

  final TraceFrame frame;
  final GameState? state;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final label = state == null
        ? 'op ${frame.dsaOp.wire}'
        : describeAction(frame.action, state!);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          frame.dsaOp.glyph,
          style: TextStyle(fontSize: 13, color: colors.accent),
        ),
        const SizedBox(width: 7),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: colors.onSurface,
                ),
              ),
              if (frame.note.isNotEmpty)
                Text(
                  frame.note,
                  style: TextStyle(
                    fontSize: 11,
                    height: 1.3,
                    color: colors.muted,
                  ),
                ),
            ],
          ),
        ),
        if (frame.codeLine > 0)
          MiniTag(text: 'L${frame.codeLine}', color: colors.primary),
      ],
    );
  }
}

class _Scrubber extends StatelessWidget {
  const _Scrubber({
    required this.total,
    required this.value,
    required this.correctColor,
    required this.onChanged,
  });

  final int total;
  final int value;
  final Color correctColor;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    if (total <= 1) return const SizedBox.shrink();
    return SliderTheme(
      data: SliderThemeData(
        trackHeight: 3,
        activeTrackColor: correctColor,
        inactiveTrackColor: colors.muted.withValues(alpha: 0.2),
        thumbColor: correctColor,
        overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
      ),
      child: Slider(
        value: value.toDouble().clamp(0, (total - 1).toDouble()),
        min: 0,
        max: (total - 1).toDouble(),
        onChanged: (v) => onChanged(v.round()),
      ),
    );
  }
}

class _ReplayButton extends StatelessWidget {
  const _ReplayButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.filled = false,
    this.color,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;
  final bool filled;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final tint = color ?? colors.primary;
    final enabled = onTap != null;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: filled ? tint : colors.surface,
        borderRadius: BorderRadius.circular(9),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(9),
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Icon(
              icon,
              size: 17,
              color: filled
                  ? (tint.computeLuminance() > 0.6
                        ? const Color(0xFF0B0E12)
                        : Colors.white)
                  : enabled
                  ? colors.onSurface
                  : colors.muted.withValues(alpha: 0.35),
            ),
          ),
        ),
      ),
    );
  }
}

class _MeaningSection extends StatelessWidget {
  const _MeaningSection({required this.debrief, required this.spec});

  final Debrief debrief;
  final GameSpec? spec;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    // Only explain the action types this run actually used, plus anything the
    // spec offered: an explanation of an action the player never performed is
    // noise.
    final used = <String>{
      for (final frame in debrief.playedTrace) frame.action.type.wire,
    };
    final meanings = <(String, String)>[
      for (final entry in debrief.actionMeaning.entries)
        if (used.contains(entry.key) || used.isEmpty) (entry.key, entry.value),
    ];
    // Fall back to the spec's copy when the server sent nothing.
    final specMeanings = spec == null
        ? const <(String, String)>[]
        : <(String, String)>[
            for (final entry in spec!.debrief.actionMeaning.entries)
              if (!used.contains(entry.key) && used.isNotEmpty)
                (entry.key, entry.value),
          ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (meanings.isNotEmpty || specMeanings.isNotEmpty)
          for (final (actionType, text) in [...meanings, ...specMeanings])
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(11, 9, 11, 10),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: colors.muted.withValues(alpha: 0.2),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        MiniTag(text: actionType, color: colors.accent),
                        if (!used.contains(actionType)) ...[
                          const SizedBox(width: 6),
                          Text(
                            'not used in your run',
                            style: TextStyle(
                              fontSize: 9.5,
                              color: colors.muted,
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 5),
                    SelectableText(
                      text,
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.4,
                        color: colors.onSurface,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        if (debrief.mapping.isNotEmpty) ...[
          const SizedBox(height: 4),
          const SectionHeading(
            title: 'metaphor → algorithm',
            icon: Icons.swap_horiz_rounded,
          ),
          const SizedBox(height: 7),
          Container(
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: colors.muted.withValues(alpha: 0.2)),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (var i = 0; i < debrief.mapping.length; i++)
                  _MappingRow(
                    row: debrief.mapping[i],
                    isFirst: i == 0,
                    isLast: i == debrief.mapping.length - 1,
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _MappingRow extends StatelessWidget {
  const _MappingRow({
    required this.row,
    required this.isFirst,
    required this.isLast,
  });

  final MappingRow row;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      padding: const EdgeInsets.fromLTRB(11, 8, 11, 8),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : Border(
                bottom: BorderSide(color: colors.muted.withValues(alpha: 0.15)),
              ),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 4,
            child: Text(
              row.gameTerm,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: colors.muted,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Icon(
              Icons.arrow_forward_rounded,
              size: 13,
              color: colors.accent,
            ),
          ),
          Expanded(
            flex: 5,
            child: Text(
              row.algorithmTerm,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                fontFamily: 'monospace',
                color: colors.onSurface,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CodeSection extends StatelessWidget {
  const _CodeSection({
    required this.debrief,
    required this.language,
    required this.selectedLine,
    required this.onSelectLine,
    required this.onLanguage,
  });

  final Debrief debrief;
  final String? language;
  final int? selectedLine;
  final ValueChanged<int> onSelectLine;
  final ValueChanged<String> onLanguage;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final languages = debrief.codeLanguages;
    final active = language != null && debrief.code.containsKey(language)
        ? language
        : languages.firstOrNull;
    final lines = active == null ? const <String>[] : debrief.code[active]!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (languages.length > 1) ...[
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final lang in languages)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      selected: lang == active,
                      onSelected: (_) => onLanguage(lang),
                      label: Text(lang),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
        ],
        CodeBlock(
          title: active ?? 'code',
          language: active == null || active == 'code' ? null : active,
          lines: lines,
          frames: debrief.playedTrace,
          selectedLine: selectedLine,
          onSelectLine: onSelectLine,
        ),
        if (selectedLine != null)
          CodeLineExplainer(
            line: selectedLine!,
            frames: debrief.playedTrace,
            onClose: () => onSelectLine(selectedLine!),
          ),
        const SizedBox(height: 12),
        if (debrief.pseudocode.isNotEmpty) ...[
          CodeBlock(
            title: 'pseudocode',
            lines: debrief.pseudocode,
            frames: debrief.playedTrace,
            selectedLine: selectedLine,
            onSelectLine: onSelectLine,
            maxHeight: 190,
          ),
          const SizedBox(height: 8),
          Text(
            'Trace line numbers are 1-based and index both blocks, so L${debrief.playedTrace.isEmpty ? 0 : debrief.playedTrace.first.codeLine} is the same statement in each.',
            style: TextStyle(fontSize: 10, height: 1.3, color: colors.muted),
          ),
        ],
      ],
    );
  }
}

class _CostSection extends StatelessWidget {
  const _CostSection({required this.debrief});

  final Debrief debrief;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final stats = debrief.stats;
    final complexity = debrief.complexity;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ComplexityChips(chips: complexity.chips),
        if (complexity.note != null) ...[
          const SizedBox(height: 7),
          Text(
            complexity.note!,
            style: TextStyle(
              fontSize: 12,
              height: 1.4,
              color: colors.onSurface,
            ),
          ),
        ],
        const SizedBox(height: 12),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final (label, value) in stats.chips)
              StatChip(
                label: label,
                value: value,
                icon: switch (label) {
                  'steps' => Icons.play_arrow_rounded,
                  'mistakes' => Icons.close_rounded,
                  _ => Icons.lightbulb_rounded,
                },
                color: label == 'mistakes' && stats.mistakes > 0
                    ? colors.danger
                    : colors.muted,
              ),
            if (stats.confidence != null)
              StatChip(
                label: 'coach confidence',
                value: '${(stats.confidence! * 100).round()}%',
                icon: Icons.psychology_rounded,
                color: colors.primary,
              ),
          ],
        ),
        if (stats.mechanicTallies.isNotEmpty) ...[
          const SizedBox(height: 10),
          for (final (mechanic, count) in stats.mechanicTallies)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  SizedBox(
                    width: 118,
                    child: Text(
                      mechanic,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11, color: colors.muted),
                    ),
                  ),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value:
                            (count / (stats.mistakes == 0 ? 1 : stats.mistakes))
                                .clamp(0.0, 1.0),
                        minHeight: 5,
                        backgroundColor: colors.muted.withValues(alpha: 0.15),
                        valueColor: AlwaysStoppedAnimation(colors.danger),
                      ),
                    ),
                  ),
                  const SizedBox(width: 7),
                  Text(
                    '$count',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      color: colors.muted,
                    ),
                  ),
                ],
              ),
            ),
        ],
        if (stats.misconception != null) ...[
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 11),
            decoration: BoxDecoration(
              color: Color.lerp(colors.surface, colors.accent, 0.13)!,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: colors.accent.withValues(alpha: 0.45)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.psychology_rounded,
                      size: 14,
                      color: colors.accent,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'MISCONCEPTION SPOTTED',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.2,
                        color: colors.accent,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                SelectableText(
                  stats.misconception!,
                  style: TextStyle(
                    fontSize: 12.5,
                    height: 1.4,
                    color: colors.onSurface,
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// The bottom bar with the one button that matters.
class _NewVersionBar extends StatelessWidget {
  const _NewVersionBar({required this.onPlayAgain});

  final Future<void> Function() onPlayAgain;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, Colors.black, 0.30)!,
        border: Border(
          top: BorderSide(color: colors.muted.withValues(alpha: 0.2)),
        ),
      ),
      child: SafeArea(
        top: false,
        child: FilledButton.icon(
          onPressed: () => onPlayAgain(),
          icon: const Icon(Icons.casino_rounded, size: 20),
          label: const Padding(
            padding: EdgeInsets.symmetric(vertical: 13),
            child: Text(
              'Play a new version of this game',
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
            ),
          ),
          style: FilledButton.styleFrom(
            backgroundColor: colors.accent,
            foregroundColor: colors.accent.computeLuminance() > 0.6
                ? const Color(0xFF0B0E12)
                : Colors.white,
            minimumSize: const Size(double.infinity, 52),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(15),
            ),
          ),
        ),
      ),
    );
  }
}

extension<T> on List<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
