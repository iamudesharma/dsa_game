/// The adventure map: illustrated world destinations with mission nodes.
///
/// Replaces the old topic-card grid. Every mission stays accessible from the
/// start — completion stamps, the collection sheet and the suggested next
/// mission orient the player; nothing is ever locked. Provider diagnostics
/// live in a secondary section, and a health-probe failure never blocks the
/// catalogue (see [CatalogueController]).
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../adventure/progress.dart';
import '../adventure/progress_store.dart';
import '../adventure/robot_guide.dart';
import '../adventure/world_scene.dart';
import '../adventure/worlds.dart';
import '../learn/onboarding.dart';
import '../models/problem.dart';
import '../state/catalogue_controller.dart';
import '../theme/palette.dart';
import '../widgets/common.dart';
import 'learn_screen.dart';
import 'patterns_screen.dart';
import 'problem_screen.dart';
import 'tracks_screen.dart';

class TopicScreen extends StatefulWidget {
  const TopicScreen({super.key});

  @override
  State<TopicScreen> createState() => _TopicScreenState();
}

class _TopicScreenState extends State<TopicScreen> {
  @override
  void initState() {
    super.initState();
    // Kick loads off after the first frame so the route transition is not
    // blocked behind network or storage calls.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final catalogue = context.read<CatalogueController>();
      if (!catalogue.hasData && !catalogue.isLoading) catalogue.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<CatalogueController>();
    final adventure = context.watch<AdventureController>();
    final catalogue = controller.catalogue;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Play the Algorithms'),
        actions: [
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const LearnScreen()),
            ),
            icon: const Icon(Icons.menu_book_outlined),
            tooltip: 'Field notebook',
          ),
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const PatternsScreen()),
            ),
            icon: const Icon(Icons.pattern_rounded),
            tooltip: 'Patterns',
          ),
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const TracksScreen()),
            ),
            icon: const Icon(Icons.route_rounded),
            tooltip: 'Tracks',
          ),
          IconButton(
            onPressed: catalogue == null ? null : () => _openCollection(context, catalogue),
            icon: Badge(
              label: Text('${adventure.progress.completed.length}'),
              child: const Icon(Icons.emoji_events_outlined),
            ),
            tooltip: 'Your collection',
          ),
          IconButton(
            onPressed: controller.isLoading ? null : () => controller.load(),
            icon: controller.isLoading
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: context.gameColors.primary),
                  )
                : const Icon(Icons.refresh_rounded),
            tooltip: 'Reload catalogue',
          ),
        ],
      ),
      body: SafeArea(child: _body(context, controller, catalogue)),
    );
  }

  Widget _body(BuildContext context, CatalogueController controller, CatalogueResponse? catalogue) {
    if (catalogue == null && controller.error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: ApiErrorCard(
            error: controller.error!,
            onRetry: () => controller.load(),
            retryLabel: 'Reload the catalogue',
          ),
        ),
      );
    }

    if (catalogue == null || catalogue.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.hourglass_empty_rounded, size: 28, color: context.gameColors.muted),
            const SizedBox(height: 10),
            Text(
              controller.isLoading ? 'Fetching the catalogue…' : 'No topics came back.',
              style: TextStyle(fontSize: 13, color: context.gameColors.muted),
            ),
            const SizedBox(height: 10),
            Text(
              controller.baseUrl,
              style: TextStyle(
                fontSize: 11,
                fontFamily: 'monospace',
                color: context.gameColors.muted.withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
      );
    }

    final adventure = context.watch<AdventureController>();
    final orderedIds = [for (final t in catalogue.topics) for (final p in t.problems) p.id];
    final nextId = nextMission(adventure.progress, orderedIds);
    final nextProblem = nextId == null ? null : catalogue.problemById(nextId);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
      children: [
        if (adventure.warning)
          _WarningBanner(
            text: 'Progress storage is unavailable or was reset. You can keep playing; new stamps may not be kept.',
          ),
        _Hero(nextProblem: nextProblem, catalogue: catalogue),
        const SizedBox(height: 12),
        const _OnboardingCard(),
        const SizedBox(height: 16),
        const SectionHeading(title: 'the adventure map', icon: Icons.map_outlined),
        const SizedBox(height: 4),
        Text(
          'Every world is open. Pick what sparks your curiosity.',
          style: TextStyle(fontSize: 12.5, height: 1.35, color: context.gameColors.muted),
        ),
        const SizedBox(height: 10),
        for (final topic in catalogue.topics) ...[
          _WorldCard(topic: topic, nextProblemId: nextId),
          const SizedBox(height: 12),
        ],
        const SizedBox(height: 8),
        _Diagnostics(catalogue: catalogue, controller: controller),
      ],
    );
  }

  void _openCollection(BuildContext context, CatalogueResponse catalogue) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => _CollectionSheet(catalogue: catalogue),
    );
  }
}

/// The hero: greeting, suggested next mission, and pace note.
class _Hero extends StatelessWidget {
  const _Hero({required this.nextProblem, required this.catalogue});

  final ProblemMeta? nextProblem;
  final CatalogueResponse catalogue;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final adventure = context.watch<AdventureController>();
    final done = adventure.progress.completed.length;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Big ideas. Small adventures.',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: colors.onSurface),
          ),
          const SizedBox(height: 4),
          RobotGuide(
            text: done == 0
                ? 'Swap, stack, search, and explore. Curiosity is your superpower.'
                : 'Welcome back, explorer. $done of ${catalogue.problemCount} missions stamped.',
          ),
          const SizedBox(height: 10),
          if (nextProblem != null)
            FilledButton.icon(
              onPressed: () => _openProblem(context, nextProblem!),
              icon: const Icon(Icons.play_arrow_rounded),
              label: Text(done == 0 ? "Let's play" : 'Keep exploring'),
            )
          else
            Row(
              children: [
                Icon(Icons.emoji_events_rounded, color: colors.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Every mission stamped. The map is yours.',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.onSurface),
                  ),
                ),
              ],
            ),
          const SizedBox(height: 6),
          Text(
            '${worlds.length} worlds · ${catalogue.problemCount} missions · your own pace',
            style: TextStyle(fontSize: 11, color: colors.muted),
          ),
        ],
      ),
    );
  }

  void _openProblem(BuildContext context, ProblemMeta problem) {
    final catalogue = context.read<CatalogueController>().catalogue;
    final topic = catalogue?.topics.firstWhere(
      (t) => t.problems.any((p) => p.id == problem.id),
      orElse: () => catalogue.topics.first,
    );
    if (topic == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProblemScreen(topic: topic, initialProblemId: problem.id),
      ),
    );
  }
}

/// First-visit tips, dismissible forever through the adventure store's own
/// key-value surface (a separate key, so tips can never mint or erase a
/// stamp). A missing store shows the tips; a dismissed card leaves a re-show
/// affordance, mirroring the web map.
class _OnboardingCard extends StatefulWidget {
  const _OnboardingCard();

  @override
  State<_OnboardingCard> createState() => _OnboardingCardState();
}

class _OnboardingCardState extends State<_OnboardingCard> {
  bool? _visible;

  @override
  void initState() {
    super.initState();
    shouldShowOnboarding(context.read<AdventureController>().keyValueStore).then((value) {
      if (mounted) setState(() => _visible = value);
    });
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    if (visible == null) return const SizedBox.shrink();
    if (!visible) {
      return Align(
        alignment: Alignment.centerLeft,
        child: TextButton(
          onPressed: () async {
            await resetOnboarding(context.read<AdventureController>().keyValueStore);
            if (mounted) setState(() => _visible = true);
          },
          style: TextButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            minimumSize: Size.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          child: const Text('Show the how-to-play tips', style: TextStyle(fontSize: 11.5)),
        ),
      );
    }
    final colors = context.gameColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
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
              Expanded(
                child: Text(
                  'Three things, then go explore',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: colors.onSurface),
                ),
              ),
              TextButton(
                onPressed: () async {
                  await dismissOnboarding(context.read<AdventureController>().keyValueStore);
                  if (mounted) setState(() => _visible = false);
                },
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Got it', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          for (final tip in onboardingTips)
            Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${tip.title}. ',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: colors.onSurface,
                      ),
                    ),
                    TextSpan(
                      text: tip.body,
                      style: TextStyle(fontSize: 12, height: 1.35, color: colors.muted),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One illustrated destination with its mission nodes.
class _WorldCard extends StatelessWidget {
  const _WorldCard({required this.topic, required this.nextProblemId});

  final TopicDto topic;
  final String? nextProblemId;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final adventure = context.watch<AdventureController>();
    final world = worldForTopic(topic.topic?.wire ?? topic.id);
    final done = topic.problems.where((p) => adventure.progress.completed.containsKey(p.id)).length;

    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
            child: Row(
              children: [
                _WorldDot(number: world.mark, color: world.color),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        world.name,
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: colors.onSurface),
                      ),
                      Text(
                        '${topic.label} · ${world.subtitle}',
                        style: TextStyle(fontSize: 11, color: colors.muted),
                      ),
                    ],
                  ),
                ),
                MiniLabel(
                  text: done == topic.problems.length ? '★ complete' : '$done/${topic.problems.length}',
                  icon: done == topic.problems.length ? Icons.star_rounded : Icons.explore_outlined,
                  color: done == topic.problems.length ? colors.accent : colors.muted,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 6, 14, 0),
            child: WorldScene(world: world, height: 104),
          ),
          for (var i = 0; i < topic.problems.length; i++)
            _MissionNode(
              problem: topic.problems[i],
              index: i,
              solved: adventure.progress.completed.containsKey(topic.problems[i].id),
              suggested: nextProblemId == topic.problems[i].id,
              onOpen: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ProblemScreen(topic: topic, initialProblemId: topic.problems[i].id),
                ),
              ),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _WorldDot extends StatelessWidget {
  const _WorldDot({required this.number, required this.color});

  final String number;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 38,
      height: 38,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
      child: Text(
        number,
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Colors.white),
      ),
    );
  }
}

class _MissionNode extends StatelessWidget {
  const _MissionNode({
    required this.problem,
    required this.index,
    required this.solved,
    required this.suggested,
    required this.onOpen,
  });

  final ProblemMeta problem;
  final int index;
  final bool solved;
  final bool suggested;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 4, 10, 4),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onOpen,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 7),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: solved
                        ? colors.success.withValues(alpha: 0.18)
                        : colors.primary.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: solved
                          ? colors.success.withValues(alpha: 0.5)
                          : colors.muted.withValues(alpha: 0.25),
                    ),
                  ),
                  child: solved
                      ? Icon(Icons.check_rounded, size: 18, color: colors.success, semanticLabel: 'Completed')
                      : Text(
                          '${index + 1}'.padLeft(2, '0'),
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: colors.primary),
                        ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        problem.title,
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: colors.onSurface),
                      ),
                      if (suggested)
                        Text(
                          'Suggested next adventure',
                          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: colors.accent),
                        ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded, color: colors.muted, size: 22),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _WarningBanner extends StatelessWidget {
  const _WarningBanner({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
      decoration: BoxDecoration(
        color: Color.lerp(colors.surface, colors.accent, 0.12)!,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.accent.withValues(alpha: 0.4)),
      ),
      child: Text(text, style: TextStyle(fontSize: 11.5, color: colors.onSurface)),
    );
  }
}

/// Stamps, world badges and map frames.
class _CollectionSheet extends StatelessWidget {
  const _CollectionSheet({required this.catalogue});

  final CatalogueResponse catalogue;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final adventure = context.watch<AdventureController>();
    final missionIds = {
      for (final topic in catalogue.topics)
        worldForTopic(topic.topic?.wire ?? topic.id): [for (final p in topic.problems) p.id],
    };
    final badges = completedWorlds(adventure.progress, missionIds);
    final frames = ['default', for (final w in badges) w.topic.wire];

    return SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
        children: [
          Text(
            'Your collection',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: colors.onSurface),
          ),
          const SizedBox(height: 4),
          const RobotGuide(
            text: 'Every solved mission earns a stamp. Finish a whole world for its badge and map frame.',
          ),
          const SizedBox(height: 12),
          Text(
            '${adventure.progress.completed.length} mission stamps · ${badges.length} world badges',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: colors.muted),
          ),
          const SizedBox(height: 10),
          for (final world in worlds)
            _BadgeRow(
              world: world,
              earned: badges.contains(world),
              count: missionIds[world]?.where(adventure.progress.completed.containsKey).length ?? 0,
              total: missionIds[world]?.length ?? 0,
            ),
          const SizedBox(height: 12),
          Text('Map frame', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: colors.onSurface)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final frame in frames)
                ChoiceChip(
                  selected: adventure.progress.mapFrame == frame,
                  onSelected: (_) {
                    adventure.selectFrame(frame, missionIds);
                  },
                  label: Text(frame == 'default' ? 'Original' : worldForTopic(frame).name),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Saved on this device. No account needed.',
            style: TextStyle(fontSize: 11, color: colors.muted),
          ),
        ],
      ),
    );
  }
}

class _BadgeRow extends StatelessWidget {
  const _BadgeRow({required this.world, required this.earned, required this.count, required this.total});

  final WorldDefinition world;
  final bool earned;
  final int count;
  final int total;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(
            earned ? Icons.star_rounded : Icons.star_outline_rounded,
            color: earned ? colors.accent : colors.muted,
            size: 22,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              world.name,
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: colors.onSurface),
            ),
          ),
          Text(
            earned ? 'Collected!' : '$count/$total',
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: earned ? colors.accent : colors.muted),
          ),
        ],
      ),
    );
  }
}

/// Provider tiers, Laya and version — secondary on purpose. The map above
/// never depends on any of it.
class _Diagnostics extends StatelessWidget {
  const _Diagnostics({required this.catalogue, required this.controller});

  final CatalogueResponse catalogue;
  final CatalogueController controller;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final health = controller.health;
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      shape: const Border(),
      leading: Icon(Icons.dns_outlined, color: colors.muted, size: 18),
      title: Text(
        'Connection & diagnostics',
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.muted),
      ),
      children: [
        if (health == null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              'Service status is unavailable. Missions can still be started.',
              style: TextStyle(fontSize: 11.5, color: colors.muted),
            ),
          ),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final tier in catalogue.tiers)
              MiniLabel(
                text: tier.tier.label,
                icon: tier.available ? Icons.check_circle_rounded : Icons.cancel_rounded,
                color: tier.available ? colors.success : colors.muted,
              ),
            MiniLabel(
              text: catalogue.laya.isLive ? 'Laya live' : 'Laya off',
              icon: catalogue.laya.isLive ? Icons.psychology_rounded : Icons.psychology_alt_rounded,
              color: catalogue.laya.isLive ? colors.primary : colors.muted,
            ),
            if (health != null && health.ok)
              MiniLabel(
                text: 'v${health.version}',
                icon: Icons.favorite_rounded,
                color: colors.success,
              ),
          ],
        ),
        const SizedBox(height: 8),
        Text(controller.baseUrl, style: TextStyle(fontSize: 11, fontFamily: 'monospace', color: colors.muted)),
        const SizedBox(height: 6),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: controller.isLoading ? null : () => controller.load(),
            icon: const Icon(Icons.refresh_rounded, size: 15),
            label: const Text('Refresh connection'),
          ),
        ),
      ],
    );
  }
}
