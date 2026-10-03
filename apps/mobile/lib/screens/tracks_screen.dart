/// Interview tracks: the classics checklist mapped to playable games, plus
/// the full tour built from the live catalogue.
///
/// Content mirrors `apps/web/src/lib/tracks.ts`. Progress is the adventure
/// store's own completion map: an item is done when every mapped game is
/// stamped complete. Play links generate through the [GameController] and
/// push the [PlayScreen], like the notebook's question cards.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../adventure/progress_store.dart';
import '../learn/tracks.dart';
import '../state/catalogue_controller.dart';
import '../theme/palette.dart';
import '../widgets/common.dart';
import 'problem_screen.dart';
import 'chat_screen.dart';

class TracksScreen extends StatefulWidget {
  const TracksScreen({super.key});

  @override
  State<TracksScreen> createState() => _TracksScreenState();
}

class _TracksScreenState extends State<TracksScreen> {
  int _trackIndex = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final catalogue = context.read<CatalogueController>();
      if (!catalogue.hasData && !catalogue.isLoading) catalogue.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final completed = context.watch<AdventureController>().progress.completed;
    final catalogue = context.watch<CatalogueController>().catalogue;

    final tour = Track(
      id: 'full-tour',
      title: 'Full Tour',
      subtitle: 'Every game in this app, grouped by world. Built from the live catalogue, so it never drifts.',
      categories: catalogue == null
          ? const <TrackCategory>[]
          : buildFullTour(catalogue),
    );
    const classics = Track(
      id: 'interview-classics',
      title: 'Interview Classics',
      subtitle: 'Blind-75-style coverage across every category, each item mapped to the games that train it.',
      categories: interviewClassicsCategories,
    );
    final track = _trackIndex == 0 ? classics : tour;
    final stats = trackProgress(track, completed);

    return Scaffold(
      appBar: AppBar(title: const Text('Tracks')),
      body: SafeArea(
        // A key per tab: each track keeps its own scroll position, and
        // switching tabs always starts at the top instead of inheriting a
        // deep offset from the other tab's longer list.
        child: ListView(
          key: ValueKey('tracks-list-$_trackIndex'),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(
              'Interview tracks',
              style: TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w900,
                color: colors.onSurface,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Checklists that point at games, not just problems. Play a mapped game to stamp its items.',
              style: TextStyle(fontSize: 12, color: colors.muted),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: [
                ChoiceChip(
                  selected: _trackIndex == 0,
                  onSelected: (_) => setState(() => _trackIndex = 0),
                  label: const Text('Interview Classics'),
                ),
                ChoiceChip(
                  selected: _trackIndex == 1,
                  onSelected: (_) => setState(() => _trackIndex = 1),
                  label: const Text('Full Tour'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              track.subtitle,
              style: TextStyle(fontSize: 11.5, color: colors.muted),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                StatChip(
                  label: 'stamped',
                  value: '${stats.done}',
                  icon: Icons.check_circle_rounded,
                  color: colors.success,
                ),
                StatChip(
                  label: 'playable',
                  value: '${stats.playable}',
                  icon: Icons.play_arrow_rounded,
                ),
                StatChip(
                  label: 'total',
                  value: '${stats.total}',
                  icon: Icons.list_rounded,
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (_trackIndex == 1 && catalogue == null)
              const EmptyHint(text: 'Loading the catalogue for the full tour…'),
            for (final category in track.categories)
              _CategoryCard(category: category, completed: completed),
          ],
        ),
      ),
    );
  }
}

class _CategoryCard extends StatelessWidget {
  const _CategoryCard({required this.category, required this.completed});

  final TrackCategory category;
  final Map<String, String> completed;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final playable = category.items.where((i) => i.playIds.isNotEmpty).length;
    final done = category.items
        .where((i) => trackItemDone(i.playIds, completed))
        .length;
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
                category.title,
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w900,
                  color: colors.onSurface,
                ),
              ),
            ),
            MiniLabel(
              text: '$done/$playable playable',
              color: done == playable && playable > 0
                  ? colors.success
                  : colors.muted,
            ),
          ],
        ),
        children: [
          for (final item in category.items)
            _TrackRow(item: item, done: trackItemDone(item.playIds, completed)),
        ],
      ),
    );
  }
}

class _TrackRow extends StatelessWidget {
  const _TrackRow({required this.item, required this.done});

  final TrackItem item;
  final bool done;

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 9, 16, 9),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: colors.muted.withValues(alpha: 0.15)),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                done
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 16,
                color: done ? colors.success : colors.muted,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: [
                      if (item.n > 0)
                        TextSpan(
                          text: '#${item.n} ',
                          style: TextStyle(
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: colors.muted,
                          ),
                        ),
                      TextSpan(
                        text: item.name,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: colors.onSurface,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          TextButton.icon(
            onPressed: () => ChatScreen.open(
              context,
              prompt:
                  'Help me practise ${item.name}. Ask one question at a time and give feedback.',
            ),
            icon: const Icon(Icons.chat_bubble_outline, size: 16),
            label: const Text('Practise in Chat'),
          ),
          if (done)
            const Text(
              'Practice milestone completed. Solve the interview problem independently to check transfer.',
            ),
          if (item.playIds.isNotEmpty) ...[
            const SizedBox(height: 4),
            Wrap(
              spacing: 2,
              runSpacing: 2,
              children: [
                for (final id in item.playIds) _TrackPlayLink(problemId: id),
              ],
            ),
          ] else ...[
            const SizedBox(height: 2),
            Text(
              'Written practice available in Chat',
              style: TextStyle(fontSize: 10.5, color: colors.muted),
            ),
          ],
        ],
      ),
    );
  }
}

class _TrackPlayLink extends StatelessWidget {
  const _TrackPlayLink({required this.problemId});

  final String problemId;

  @override
  Widget build(BuildContext context) {
    final title =
        context
            .read<CatalogueController>()
            .catalogue
            ?.problemById(problemId)
            ?.title ??
        problemId;
    return TextButton.icon(
      onPressed: () => _play(context),
      icon: const Icon(Icons.play_arrow_rounded, size: 14),
      label: Text(title, style: const TextStyle(fontSize: 11.5)),
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 6),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
    );
  }

  Future<void> _play(BuildContext context) async {
    final problem = context.read<CatalogueController>().catalogue?.problemById(
      problemId,
    );
    if (problem == null) return;
    final catalogue = context.read<CatalogueController>().catalogue;
    final topic = catalogue?.topics
        .where((t) => t.problems.any((p) => p.id == problemId))
        .firstOrNull;
    if (topic == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            ProblemScreen(topic: topic, initialProblemId: problemId),
      ),
    );
  }
}
