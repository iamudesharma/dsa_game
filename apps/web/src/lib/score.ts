import type { DebriefResponse } from '@dsa/game-schema'

/**
 * A deliberately transparent client-side score.
 *
 * There is no server-side score in the contract, so rather than inventing a
 * mysterious number we publish the exact arithmetic. The goal is an
 * "optimisation-style" nudge: be right, be brief, ask for help sparingly.
 */

export interface ScoreLine {
  label: string
  delta: number
  detail: string
}

export interface ScoreResult {
  score: number
  grade: string
  verdict: string
  lines: ScoreLine[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function computeScore(debrief: DebriefResponse): ScoreResult {
  const { stats, phase, playedTrace, canonicalTrace } = debrief
  const lines: ScoreLine[] = []

  const base = phase === 'won' ? 100 : 45
  lines.push({
    label: phase === 'won' ? 'Solved the board' : 'Reached the end without solving',
    delta: base,
    detail: phase === 'won' ? 'You found the answer the algorithm wanted.' : 'Finishing still counts; the replay is the lesson.',
  })

  const mistakePenalty = stats.mistakes * 12
  lines.push({
    label: 'Mistakes',
    delta: -mistakePenalty,
    detail: `${stats.mistakes} × 12 points`,
  })

  const hintPenalty = stats.hintsUsed * 5
  lines.push({
    label: 'Hints used',
    delta: -hintPenalty,
    detail: `${stats.hintsUsed} × 5 points`,
  })

  // Only penalise *excess* steps: extra exploration is fine, thrashing is not.
  const canonical = canonicalTrace.length
  const played = playedTrace.length || stats.steps
  const excess = canonical > 0 ? Math.max(0, played - canonical) : 0
  const stepPenalty = Math.min(20, excess * 2)
  lines.push({
    label: 'Path efficiency',
    delta: -stepPenalty,
    detail:
      canonical > 0
        ? `${played} steps vs ${canonical} in the reference solution`
        : 'No reference trace available',
  })

  const score = clamp(
    lines.reduce((sum, line) => sum + line.delta, 0),
    0,
    100,
  )

  const grade =
    score >= 90 ? 'S' : score >= 78 ? 'A' : score >= 62 ? 'B' : score >= 45 ? 'C' : 'D'

  const verdict =
    score >= 90
      ? 'Optimal-ish. The board barely got in your way.'
      : score >= 78
        ? 'Strong run — a few wasted steps.'
        : score >= 62
          ? 'Solid. Replay the divergence and it clicks.'
          : score >= 45
            ? 'You finished. Now watch the reference replay once.'
            : 'Go through the side-by-side replay — that is where it lands.'

  return { score, grade, verdict, lines }
}

/** Which code lines the player actually touched, for highlighting. */
export function linesTouchedBy(trace: readonly { codeLine: number }[]): Set<number> {
  const lines = new Set<number>()
  for (const frame of trace) {
    if (Number.isInteger(frame.codeLine) && frame.codeLine > 0) lines.add(frame.codeLine)
  }
  return lines
}
