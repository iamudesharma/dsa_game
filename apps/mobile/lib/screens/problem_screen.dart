/// Problem detail + generation.
///
/// The wish box is the interesting part: the free text goes to `/api/decide`
/// to pick the difficulty it implies, and then rides along in
/// `GenerateRequest.freeText` for theme steering. Both answers are surfaced —
/// which tier built the game, and how the coach read the wish — because a
/// generated game with a silent author is not inspectable, and inspecting it
/// is half the point of this app.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/provider.dart';
import '../models/problem.dart';
import '../adventure/progress_store.dart';
import '../adventure/world_scene.dart';
import '../adventure/worlds.dart';
import '../learn/resources.dart';
import '../state/catalogue_controller.dart';
import '../state/game_controller.dart';
import '../theme/palette.dart';
import '../widgets/common.dart';
import '../widgets/generation_loader.dart';
import 'play_screen.dart';

class ProblemScreen extends StatefulWidget {
  const ProblemScreen({required this.topic, this.initialProblemId, super.key});

  final TopicDto topic;

  /// Pre-selects a mission, so the adventure map can deep-link straight to it.
  final String? initialProblemId;

  @override
  State<ProblemScreen> createState() => _ProblemScreenState();
}

class _ProblemScreenState extends State<ProblemScreen> {
  final _wishController = TextEditingController();
  ProblemMeta? _selected;

  @override
  void initState() {
    super.initState();
    final problems = widget.topic.problems;
    ProblemMeta? initial;
    for (final problem in problems) {
      if (problem.id == widget.initialProblemId) initial ??= problem;
    }
    _selected = problems.isEmpty ? null : (initial ?? problems.first);
  }

  @override
  void dispose() {
    _wishController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    final controller = context.watch<GameController>();

    return Scaffold(
      appBar: AppBar(title: Text(widget.topic.label)),
      body: SafeArea(
        child: ListView(
          key: const ValueKey('problem-list'),
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 32),
          children: [
            _MissionPreview(topic: widget.topic, problem: selected),
            const SizedBox(height: 12),
            for (final problem in widget.topic.problems)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _ProblemOption(
                  problem: problem,
                  selected: problem.id == selected?.id,
                  onTap: () => setState(() {
                    _selected = problem;
                    _wishController.clear();
                    context.read<GameController>()
                      ..setDifficulty(problem.defaultDifficulty)
                      ..dismissOutcome();
                  }),
                ),
              ),
            if (selected == null)
              Padding(
                padding: const EdgeInsets.only(top: 20),
                child: EmptyHint(
                  text: 'This topic has no problems in the catalogue.',
                  icon: Icons.inbox_rounded,
                ),
              )
            else ...[
              // The primary action sits *above* the reference material: on a
              // phone the detail card is taller than the screen, and a player
              // should never have to scroll past a paragraph of theory to play.
              const SizedBox(height: 6),
              _WishBox(controller: _wishController, problem: selected),
              const SizedBox(height: 12),
              _DifficultySelector(problem: selected, game: controller),
              const SizedBox(height: 14),
              if (controller.isGenerating)
                GenerationLoader(
                  problemTitle: selected.title,
                  tierNote: _tierNote(),
                )
              else ...[
                _GenerateButton(
                  problem: selected,
                  busy: controller.status == GameStatus.failed,
                  onGenerate: () => _generate(selected),
                ),
                if (controller.error != null) ...[
                  const SizedBox(height: 10),
                  ApiErrorCard(
                    error: controller.error!,
                    onRetry: () => _generate(selected),
                    retryLabel: 'Generate again',
                  ),
                ],
              ],
              if (controller.usedTier != null && !controller.isGenerating) ...[
                const SizedBox(height: 14),
                _GenerationReport(controller: controller),
              ],
              const SizedBox(height: 20),
              const SectionHeading(title: 'the theory', icon: Icons.menu_book_rounded),
              const SizedBox(height: 9),
              _DetailCard(problem: selected),
              const SizedBox(height: 12),
              _ResourceCard(problem: selected),
            ],
          ],
        ),
      ),
    );
  }

  String? _tierNote() {
    final catalogue = context.read<CatalogueController>().catalogue;
    final live = catalogue?.tiers.where((tier) => tier.available).toList() ?? const <TierAvailability>[];
    if (live.isEmpty) return 'only the template tier is available — expect a plainer theme';
    return '${live.map((tier) => tier.tier.label).join(' · ')} available';
  }

  Future<void> _generate(ProblemMeta problem) async {
    final game = context.read<GameController>();
    game.setWish(_wishController.text);
    await game.generate(problem);
    if (!mounted) return;
    final state = context.read<GameController>();
    if (state.hasGame) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const PlayScreen()),
      );
    }
  }
}

/// Compact scene preview: the world and the algorithm side by side, so the
/// learner can connect the metaphor to the concept before starting.
class _MissionPreview extends StatelessWidget {
  const _MissionPreview({required this.topic, required this.problem});

  final TopicDto topic;
  final ProblemMeta? problem;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final world = worldForTopic(topic.topic?.wire ?? topic.id);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: world.color,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  world.mark,
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Colors.white),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${world.name} · ${problem?.title ?? topic.label}',
                  style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900, color: colors.onSurface),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          WorldScene(world: world, height: 96),
        ],
      ),
    );
  }
}

class _ProblemOption extends StatelessWidget {
  const _ProblemOption({required this.problem, required this.selected, required this.onTap});

  final ProblemMeta problem;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final solved = context.watch<AdventureController>().progress.completed.containsKey(problem.id);
    return Material(
      color: selected ? Color.lerp(colors.surface, colors.primary, 0.14) : colors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? colors.primary : colors.muted.withValues(alpha: 0.22),
              width: selected ? 1.6 : 1,
            ),
          ),
          padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
          child: Row(
            children: [
              Icon(
                selected
                    ? Icons.radio_button_checked_rounded
                    : solved
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 17,
                color: selected
                    ? colors.primary
                    : solved
                    ? colors.success
                    : colors.muted.withValues(alpha: 0.6),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      problem.title,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                        color: colors.onSurface,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${problem.complexityTime} time · ${problem.complexitySpace} space',
                      style: TextStyle(fontSize: 10.5, color: colors.muted),
                    ),
                  ],
                ),
              ),
              MiniLabel(text: problem.defaultDifficulty.label, color: colors.accent),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailCard extends StatelessWidget {
  const _DetailCard({required this.problem});

  final ProblemMeta problem;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final hints = problem.instanceHints;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            problem.title,
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: colors.onSurface),
          ),
          const SizedBox(height: 8),
          const SectionHeading(title: 'you should internalise', icon: Icons.school_rounded),
          const SizedBox(height: 4),
          Text(
            problem.learningObjective,
            style: TextStyle(fontSize: 12.5, height: 1.4, color: colors.onSurface.withValues(alpha: 0.9)),
          ),
          const SizedBox(height: 11),
          const SectionHeading(title: 'the canonical algorithm', icon: Icons.account_tree_rounded),
          const SizedBox(height: 4),
          Text(
            problem.canonicalAlgorithm,
            style: TextStyle(fontSize: 12, height: 1.45, color: colors.muted),
          ),
          const SizedBox(height: 11),
          ComplexityChips(chips: problem.complexityChips),
          const SizedBox(height: 11),
          const SectionHeading(title: 'the data you will get', icon: Icons.data_array_rounded),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (hints.minLength > 0)
                MiniLabel(
                  text: '${hints.minLength}–${hints.maxLength} items',
                  icon: Icons.straighten_rounded,
                  color: colors.primary,
                ),
              if (hints.sorted) MiniLabel(text: 'sorted', icon: Icons.sort_rounded, color: colors.success),
              if (hints.unique) MiniLabel(text: 'unique', icon: Icons.filter_alt_rounded, color: colors.success),
              if (hints.targetGuaranteed)
                MiniLabel(text: 'target present', icon: Icons.my_location_rounded, color: colors.accent),
              if (hints.valueRangeLabel case final String range?)
                MiniLabel(text: 'values $range', icon: Icons.numbers_rounded, color: colors.muted),
              if (hints.tokenAlphabet.isNotEmpty)
                MiniLabel(
                  text: 'alphabet ${hints.tokenAlphabet.take(6).join(' ')}',
                  icon: Icons.abc_rounded,
                  color: colors.muted,
                ),
            ],
          ),
          const SizedBox(height: 11),
          const SectionHeading(title: 'mechanics you can use', icon: Icons.extension_rounded),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final mechanic in problem.allowedMechanics)
                MiniLabel(text: mechanic.wire, icon: Icons.circle, color: colors.accent),
            ],
          ),
        ],
      ),
    );
  }
}

/// Where this game fits: training patterns with their LeetCode numbers, the
/// Interview Classics it stamps, and the verbatim deep-dive URLs as text.
/// Deep-dives stay text because this client has no link launcher — a row that
/// looks tappable but goes nowhere would be the dishonest control.
class _ResourceCard extends StatelessWidget {
  const _ResourceCard({required this.problem});

  final ProblemMeta problem;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final res = resourcesForProblem(problem.id);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeading(title: 'study resources', icon: Icons.library_books_rounded),
          const SizedBox(height: 6),
          if (res.patterns.isEmpty)
            Text(
              'A foundations drill: it teaches the moves other patterns build on, so no pattern claims it. The classics below still stamp it.',
              style: TextStyle(fontSize: 12, height: 1.4, color: colors.muted),
            ),
          for (final pattern in res.patterns) ...[
            Text(
              pattern.name,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: colors.onSurface),
            ),
            const SizedBox(height: 2),
            Text(
              'Deep dive: ${pattern.deepDive}',
              style: TextStyle(fontSize: 10, fontFamily: 'monospace', color: colors.muted),
            ),
            const SizedBox(height: 8),
          ],
          if (res.trackMentions.isNotEmpty) ...[
            Text(
              'Stamps these classics',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: colors.onSurface),
            ),
            const SizedBox(height: 3),
            for (final mention in res.trackMentions)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  '#${mention.n} ${mention.name} · ${mention.category}',
                  style: TextStyle(fontSize: 11.5, color: colors.muted),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _WishBox extends StatelessWidget {
  const _WishBox({required this.controller, required this.problem});

  final TextEditingController controller;
  final ProblemMeta problem;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final game = context.watch<GameController>();
    final routing = game.wishRouting;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeading(title: 'anything specific you want?', icon: Icons.edit_note_rounded),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          enabled: !game.isGenerating,
          minLines: 1,
          maxLines: 3,
          maxLength: 280,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (value) => context.read<GameController>().setWish(value),
          style: TextStyle(fontSize: 13, height: 1.3, color: colors.onSurface),
          decoration: const InputDecoration(
            hintText: 'e.g. make it a heist, and I want to see the pointers move',
          ),
        ),
        if (routing != null && game.wish.trim().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Row(
              children: [
                Icon(
                  routing.source.isLlm ? Icons.psychology_rounded : Icons.rule_rounded,
                  size: 12,
                  color: routing.source.isLlm ? colors.primary : colors.muted,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    '${routing.source.label} read that as ${routing.choice} '
                    '(${(routing.confidence * 100).round()}% confident)',
                    style: TextStyle(fontSize: 10.5, color: colors.muted),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _DifficultySelector extends StatelessWidget {
  const _DifficultySelector({required this.problem, required this.game});

  final ProblemMeta problem;
  final GameController game;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeading(title: 'difficulty', icon: Icons.speed_rounded),
        const SizedBox(height: 7),
        Row(
          children: [
            for (final difficulty in Difficulty.values) ...[
              if (difficulty != Difficulty.easy) const SizedBox(width: 8),
              Expanded(
                child: _DifficultyOption(
                  difficulty: difficulty,
                  selected: game.difficulty == difficulty,
                  isDefault: problem.defaultDifficulty == difficulty,
                  enabled: !game.isGenerating,
                  onTap: () => context.read<GameController>().setDifficulty(difficulty),
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }
}

class _DifficultyOption extends StatelessWidget {
  const _DifficultyOption({
    required this.difficulty,
    required this.selected,
    required this.isDefault,
    required this.enabled,
    required this.onTap,
  });

  final Difficulty difficulty;
  final bool selected;
  final bool isDefault;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final color = switch (difficulty) {
      Difficulty.easy => colors.success,
      Difficulty.medium => colors.accent,
      Difficulty.hard => colors.danger,
    };
    return SizedBox(
      height: 48,
      child: OutlinedButton(
        onPressed: enabled ? onTap : null,
        style: OutlinedButton.styleFrom(
          backgroundColor: selected ? color.withValues(alpha: 0.18) : null,
          side: BorderSide(
            color: selected ? color : colors.muted.withValues(alpha: 0.3),
            width: selected ? 1.8 : 1,
          ),
          padding: EdgeInsets.zero,
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              difficulty.label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w900,
                color: selected ? color : colors.onSurface,
              ),
            ),
            if (isDefault)
              Text(
                'default',
                style: TextStyle(fontSize: 8.5, color: colors.muted),
              ),
          ],
        ),
      ),
    );
  }
}

class _GenerateButton extends StatelessWidget {
  const _GenerateButton({
    required this.problem,
    required this.busy,
    required this.onGenerate,
  });

  final ProblemMeta problem;
  final bool busy;

  /// Runs generation and then opens the board, so a success always lands the
  /// player on the game rather than on a screen that changed underneath them.
  final Future<void> Function() onGenerate;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return FilledButton.icon(
      onPressed: onGenerate,
      icon: Icon(busy ? Icons.refresh_rounded : Icons.play_arrow_rounded, size: 20),
      label: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(
          busy ? 'Generate again' : 'Start mission',
          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
        ),
      ),
      style: FilledButton.styleFrom(
        backgroundColor: colors.primary,
        foregroundColor: colors.primary.computeLuminance() > 0.6
            ? const Color(0xFF0B0E12)
            : Colors.white,
        minimumSize: const Size(double.infinity, 52),
      ),
    );
  }
}

/// `usedTier` + `attempts` + `notes`, made visible. A player should be able to
/// say "this one was written by the template tier" without guessing.
class _GenerationReport extends StatelessWidget {
  const _GenerationReport({required this.controller});

  final GameController controller;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final attempts = controller.attempts;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 12),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, colors.primary, 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.primary.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.receipt_long_rounded, size: 13, color: colors.primary),
              const SizedBox(width: 6),
              Text(
                'who built it',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.3,
                  color: colors.primary,
                ),
              ),
              const Spacer(),
              // The badge carries a variable-length attempt count, so it gets
              // the flexible half of the row rather than overflowing the title.
              Flexible(
                child: Align(
                  alignment: Alignment.centerRight,
                  child: ProviderBadge(tier: controller.usedTier, attempts: attempts, dense: true),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (attempts.isNotEmpty)
            for (final attempt in attempts)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Row(
                  children: [
                    Icon(
                      attempt.ok ? Icons.check_circle_rounded : Icons.cancel_rounded,
                      size: 12,
                      color: attempt.ok ? colors.success : colors.danger,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '${attempt.tier.label} · ${attempt.ms}ms'
                        '${attempt.error == null ? '' : ' · ${attempt.error}'}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 10.5, color: colors.muted),
                      ),
                    ),
                  ],
                ),
              )
          else
            EmptyHint(text: 'no attempt log for this generation'),
          if (controller.notes.isNotEmpty) ...[
            const SizedBox(height: 7),
            for (final note in controller.notes)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline_rounded, size: 12, color: colors.accent),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(note, style: TextStyle(fontSize: 10.5, color: colors.muted)),
                    ),
                  ],
                ),
              ),
          ],
          const SizedBox(height: 6),
          Text(
            'seed ${controller.seed}',
            style: TextStyle(fontSize: 10, fontFamily: 'monospace', color: colors.muted),
          ),
        ],
      ),
    );
  }
}
