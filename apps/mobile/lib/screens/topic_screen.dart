/// Topic picker — the six DSA topics from `GET /api/catalogue`.
///
/// No pull-to-refresh: the catalogue is small and static for a demo server, so
/// the screen uses explicit reload affordances and real error states (including
/// "the API is not running", which is the single most common first-run state).
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/problem.dart';
import '../state/catalogue_controller.dart';
import '../theme/palette.dart';
import '../widgets/common.dart';
import 'problem_screen.dart';

class TopicScreen extends StatefulWidget {
  const TopicScreen({super.key});

  @override
  State<TopicScreen> createState() => _TopicScreenState();
}

class _TopicScreenState extends State<TopicScreen> {
  @override
  void initState() {
    super.initState();
    // Kick the load off after the first frame so the route transition is not
    // blocked behind a network call.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final catalogue = context.read<CatalogueController>();
      if (!catalogue.hasData && !catalogue.isLoading) catalogue.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<CatalogueController>();
    final colors = context.gameColors;
    final catalogue = controller.catalogue;

    return Scaffold(
      appBar: AppBar(
        title: const Text('DSA by playing'),
        actions: [
          IconButton(
            onPressed: controller.isLoading ? null : () => controller.load(),
            icon: controller.isLoading
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: colors.primary),
                  )
                : const Icon(Icons.refresh_rounded),
            tooltip: 'Reload catalogue',
          ),
        ],
      ),
      body: SafeArea(
        child: _body(context, controller, catalogue),
      ),
    );
  }

  Widget _body(BuildContext context, CatalogueController controller, CatalogueResponse? catalogue) {
    if (catalogue == null && controller.error != null) {
      return _Centered(
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
      return _Centered(
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

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
      children: [
        Text(
          'Pick a topic. Every game is generated for you: a theme, a story and a real algorithm to run.',
          style: TextStyle(fontSize: 12.5, height: 1.35, color: context.gameColors.muted),
        ),
        const SizedBox(height: 14),
        for (final topic in catalogue.topics) ...[
          _TopicCard(
            topic: topic,
            onOpen: () => _openTopic(context, topic),
          ),
          const SizedBox(height: 10),
        ],
        const SizedBox(height: 6),
        _Footer(catalogue: catalogue, controller: controller),
      ],
    );
  }

  void _openTopic(BuildContext context, TopicDto topic) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => ProblemScreen(topic: topic)),
    );
  }
}

class _TopicCard extends StatelessWidget {
  const _TopicCard({required this.topic, required this.onOpen});

  final TopicDto topic;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final enumTopic = topic.topic;
    final icon = enumTopic?.icon ?? Icons.category_outlined;

    return Material(
      color: colors.surface,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
          ),
          padding: const EdgeInsets.fromLTRB(14, 13, 12, 13),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: colors.primary.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, color: colors.primary, size: 21),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          topic.label,
                          style: TextStyle(
                            fontSize: 15.5,
                            fontWeight: FontWeight.w800,
                            color: colors.onSurface,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                          decoration: BoxDecoration(
                            color: colors.muted.withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(5),
                          ),
                          child: Text(
                            '${topic.problems.length}',
                            style: TextStyle(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w900,
                              color: colors.muted,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      enumTopic?.blurb ?? '',
                      style: TextStyle(fontSize: 11.5, height: 1.3, color: colors.muted),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: colors.muted, size: 22),
            ],
          ),
        ),
      ),
    );
  }
}

/// Health + tier status, so it is obvious *why* generation is slow or down.
class _Footer extends StatelessWidget {
  const _Footer({required this.catalogue, required this.controller});

  final CatalogueResponse catalogue;
  final CatalogueController controller;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final health = controller.health;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeading(title: 'api', icon: Icons.dns_rounded),
        const SizedBox(height: 7),
        Text(
          controller.baseUrl,
          style: TextStyle(fontSize: 11, fontFamily: 'monospace', color: colors.muted),
        ),
        const SizedBox(height: 8),
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
        const SizedBox(height: 10),
        Text(
          '${catalogue.problemCount} problems across ${catalogue.topics.length} topics.',
          style: TextStyle(fontSize: 11, color: colors.muted),
        ),
      ],
    );
  }
}

class _Centered extends StatelessWidget {
  const _Centered({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Center(child: child);
}
