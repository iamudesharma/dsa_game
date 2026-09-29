import type { DebriefResponse, TraceFrame } from '@dsa/game-schema'

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

/**
 * Frames that count as algorithm steps — everything except the commit.
 *
 * `submitAnswer` terminates the round, and the reference trace stops at the
 * search. Counting it made the mandatory final click look like a wasted move.
 * `telemetry.ts` excludes the same frames, and the two must agree: this function
 * decides the number in the score line, that one decides the number in the
 * summary sentence, and a learner reading both must not see two different
 * step counts for one run.
 */
export function algorithmSteps(trace: readonly TraceFrame[] | undefined | null): number {
  if (!Array.isArray(trace)) return 0
  return trace.filter((frame) => {
    if (frame?.action?.type === 'submitAnswer') return false
    return frame?.dsaOp !== 'terminate'
  }).length
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
  //
  // THE COMMIT IS NOT A STEP. `submitAnswer` ends the round and the oracle's
  // canonical trace has no entry for it, so counting it charged every learner two
  // points for the click the game requires them to make at the end. A flawless
  // run (10 frames, 0 mistakes) scored 98/100 and read "Very close to optimal.
  // You took 10 steps; the reference line needs 9" — a false report caused
  // entirely by the engine forcing an extra click. `telemetry.ts::algorithmSteps`
  // makes the same exclusion, and the two MUST agree or the panel and the score
  // would contradict each other on the same run.
  const used = algorithmSteps(playedTrace)
  const reference = algorithmSteps(canonicalTrace)
  const excess = reference > 0 ? Math.max(0, used - reference) : 0
  // `0` and not `-0`: a zero penalty rendered as "-0" is a small wrong signal to
  // anyone reading the published arithmetic, and `Object.is` distinguishes them.
  const stepPenalty = excess === 0 ? 0 : -Math.min(20, excess * 2)
  lines.push({
    label: 'Path efficiency',
    delta: stepPenalty,
    detail:
      reference > 0
        ? `${used} steps vs ${reference} in the reference solution`
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
      ? 'That is the optimal line, start to finish.'
      : score >= 78
        ? 'Strong run — a few wasted steps.'
        : score >= 62
          ? 'Solid. Replay the difference and it clicks.'
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
