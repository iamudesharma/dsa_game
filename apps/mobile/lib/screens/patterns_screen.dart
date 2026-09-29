/// The 20-pattern library: when to use it, the reusable template, LeetCode
/// practice references, and a straight line into every playable game.
///
/// Content mirrors `apps/web/src/lib/patterns.ts`. Play buttons generate
/// through the [GameController] and push the [PlayScreen], exactly like the
/// field notebook's question cards.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../learn/patterns.dart';
import '../state/catalogue_controller.dart';
import '../state/game_controller.dart';
import '../theme/palette.dart';
import 'play_screen.dart';

class PatternsScreen extends StatefulWidget {
  const PatternsScreen({super.key});

  @override
  State<PatternsScreen> createState() => _PatternsScreenState();
}

class _PatternsScreenState extends State<PatternsScreen> {
  String _filter = '';

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final query = _filter.trim().toLowerCase();
    final patterns = query.isEmpty
        ? dsaPatterns
        : dsaPatterns
              .where(
                (p) =>
                    p.name.toLowerCase().contains(query) ||
                    p.whenToUse.toLowerCase().contains(query) ||
                    p.leetcode.any((ref) => ref.name.toLowerCase().contains(query)),
              )
              .toList(growable: false);
    final playableCount = dsaPatterns.where((p) => p.playIds.isNotEmpty).length;

    return Scaffold(
      appBar: AppBar(title: const Text('Patterns')),
      body: SafeArea(
        child: ListView(
          key: const ValueKey('patterns-list'),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(
              '20 patterns that cover LeetCode',
              style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: colors.onSurface),
            ),
            const SizedBox(height: 4),
            Text(
              'Recognise the pattern and you recognise the approach. Playable patterns link straight into a game.',
              style: TextStyle(fontSize: 12, color: colors.muted),
            ),
            const SizedBox(height: 10),
            TextField(
              decoration: const InputDecoration(hintText: 'Filter: e.g. window, tree, heap…'),
              onChanged: (text) => setState(() => _filter = text),
            ),
            const SizedBox(height: 6),
            Text(
              '${patterns.length} of ${dsaPatterns.length} patterns · $playableCount playable here',
              style: TextStyle(fontSize: 11, color: colors.muted),
            ),
            const SizedBox(height: 10),
            if (patterns.isEmpty)
              Text(
                'No patterns match "$_filter". Try a single word like “tree”.',
                style: TextStyle(fontSize: 12, color: colors.muted),
              ),
            for (final pattern in patterns) _PatternCard(pattern: pattern),
          ],
        ),
      ),
    );
  }
}

class _PatternCard extends StatelessWidget {
  const _PatternCard({required this.pattern});

  final DsaPattern pattern;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.muted.withValues(alpha: 0.22)),
      ),
      child: ExpansionTile(
        shape: const Border(),
        title: Row(
          children: [
            Expanded(
              child: Text(
                pattern.name,
                style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900, color: colors.onSurface),
              ),
            ),
            _CountChip(count: pattern.playIds.length),
          ],
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(pattern.whenToUse, style: TextStyle(fontSize: 12.5, height: 1.4, color: colors.onSurface)),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerLowest,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: SelectableText(
                    pattern.template,
                    style: const TextStyle(fontSize: 11.5, fontFamily: 'monospace', height: 1.45),
                  ),
                ),
                if (pattern.playIds.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [for (final id in pattern.playIds) _PlayButton(problemId: id)],
                  ),
                ],
                const SizedBox(height: 8),
                Text(
                  'Practice on LeetCode: ${pattern.leetcode.map((r) => '#${r.n} ${r.name}').join(' · ')}',
                  style: TextStyle(fontSize: 11, color: colors.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colors.success.withValues(alpha: 0.6)),
      ),
      child: Text(
        count > 0 ? '$count playable' : 'study only',
        style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: colors.success),
      ),
    );
  }
}

class _PlayButton extends StatelessWidget {
  const _PlayButton({required this.problemId});

  final String problemId;

  @override
  Widget build(BuildContext context) {
    return FilledButton.tonalIcon(
      onPressed: () => _play(context),
      icon: const Icon(Icons.play_arrow_rounded, size: 16),
      label: Text(_titleOf(context), style: const TextStyle(fontSize: 12)),
    );
  }

  String _titleOf(BuildContext context) {
    final title = context.read<CatalogueController>().catalogue?.problemById(problemId)?.title;
    return 'Play: ${title ?? problemId}';
  }

  Future<void> _play(BuildContext context) async {
    final problem = context.read<CatalogueController>().catalogue?.problemById(problemId);
    if (problem == null) return;
    final game = context.read<GameController>();
    await game.generate(problem, routeWish: false);
    if (!context.mounted || !game.hasGame) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const PlayScreen()),
    );
  }
}
