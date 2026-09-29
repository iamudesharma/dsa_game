/// Per-problem study resources, mirroring `apps/web/src/lib/resources.ts`.
///
/// Joins the pattern library backwards: which patterns train a game, which
/// Interview Classics items it stamps, and which verbatim
/// awesome-leetcode-resources deep-dives cover it. LeetCode references stay
/// number + name text (searchable, never fabricated URLs); deep-dives are the
/// patterns' own verbatim URLs, shown as text — this client has no link
/// launcher, so nothing here pretends to be a button to the web.
library;

import 'patterns.dart';
import 'tracks.dart';

class ResourcePattern {
  const ResourcePattern({required this.id, required this.name, required this.deepDive});

  final String id;
  final String name;
  final String deepDive;
}

class ResourceTrackMention {
  const ResourceTrackMention({required this.category, required this.n, required this.name});

  final String category;
  final int n;
  final String name;
}

class ProblemResources {
  const ProblemResources({required this.patterns, required this.trackMentions, required this.deepDives});

  final List<ResourcePattern> patterns;
  final List<ResourceTrackMention> trackMentions;
  final List<String> deepDives;
}

ProblemResources resourcesForProblem(String problemId) {
  final patterns = patternsForProblem(problemId)
      .map((p) => ResourcePattern(id: p.id, name: p.name, deepDive: p.deepDive))
      .toList(growable: false);
  final trackMentions = <ResourceTrackMention>[
    for (final category in interviewClassicsCategories)
      for (final item in category.items)
        if (item.playIds.contains(problemId))
          ResourceTrackMention(category: category.title, n: item.n, name: item.name),
  ];
  final deepDives = patterns.map((p) => p.deepDive).toSet().toList(growable: false);
  return ProblemResources(patterns: patterns, trackMentions: trackMentions, deepDives: deepDives);
}
