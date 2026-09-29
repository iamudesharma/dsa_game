import { getProblem } from '@dsa/game-schema'
import { patternsForProblem } from './patterns'
import { TRACKS } from './tracks'

/**
 * Per-problem study resources (Phase 7 UX layer).
 *
 * The problem page already shows the algorithm and the generation controls;
 * what it lacked was the answer to "where does this fit". This module joins
 * the three Phase 5 artefacts backwards: which patterns train this game,
 * which Interview Classics items it stamps, and which verbatim
 * awesome-leetcode-resources deep-dives cover it.
 *
 * Sourcing honesty, same as the pattern library: LeetCode references are
 * number + name text (searchable, never fabricated URLs); deep-dives are the
 * patterns' own verbatim URLs, never constructed here.
 */

export interface ResourcePattern {
  id: string
  name: string
  deepDive: string
}

export interface ResourceTrackMention {
  category: string
  /** LeetCode problem number. */
  n: number
  name: string
}

export interface ProblemResources {
  patterns: readonly ResourcePattern[]
  trackMentions: readonly ResourceTrackMention[]
  /** Unique deep-dives across the training patterns, in pattern order. */
  deepDives: readonly string[]
}

export function resourcesForProblem(problemId: string): ProblemResources {
  const patterns = patternsForProblem(problemId).map((p) => ({
    id: p.id,
    name: p.name,
    deepDive: p.deepDive,
  }))
  const trackMentions: ResourceTrackMention[] = []
  for (const track of TRACKS) {
    if (track.id !== 'interview-classics') continue
    for (const category of track.categories) {
      for (const item of category.items) {
        if ((item.playIds as readonly string[]).includes(problemId)) {
          trackMentions.push({ category: category.title, n: item.n, name: item.name })
        }
      }
    }
  }
  const deepDives = [...new Set(patterns.map((p) => p.deepDive))]
  return { patterns, trackMentions, deepDives }
}

/** True when the catalogue knows this problem at all. */
export function isKnownProblem(problemId: string): boolean {
  return getProblem(problemId) !== undefined
}
