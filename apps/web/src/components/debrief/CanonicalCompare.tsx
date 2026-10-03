'use client'

import type { DebriefResponse, TraceFrame } from '@dsa/game-schema'
import { Panel } from '@/components/ui/Panel'
import { ReplayPlayer } from './ReplayPlayer'

/**
 * Side-by-side: what the player did versus what the algorithm would have done.
 *
 * Two independent replays rather than a merged one. A merged timeline would
 * have to invent a correspondence between frames the server never promised to
 * relate, and a wrong merge teaches the wrong lesson. Two players, one scrub
 * position each, makes "here is where you left the optimal path" obvious
 * without lying about the mapping.
 */
export function CanonicalCompare({
  debrief,
  state,
  spec,
  gameId,
}: {
  gameId?: string
  debrief: DebriefResponse
  state: import('@dsa/game-schema').GameState
  spec: import('@dsa/game-schema').GameSpec
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReplayPlayer
          frames={debrief.playedTrace}
          state={state}
          spec={spec}
          gameId={gameId}
          title="Your run"
          subtitle={`${debrief.playedTrace.length} steps, ${debrief.stats.mistakes} mistakes`}
        />
        <ReplayPlayer
          frames={debrief.canonicalTrace}
          state={state}
          spec={spec}
          title="Reference solution"
          subtitle={`${debrief.canonicalTrace.length} steps — the optimal path`}
        />
      </div>
      <DiagonalTrace played={debrief.playedTrace} canonical={debrief.canonicalTrace} />
    </div>
  )
}

interface Divergence {
  index: number
  playedNote: string
  canonicalNote: string
  codeLine: number | null
  canonicalLine: number | null
  /**
   * True when the runs were the same all the way through and only the
   * LENGTH differs — the player committed a final answer the reference trace
   * does not include.
   *
   * WHY THIS IS NOT A COSMETIC FLAG. This panel used to fall through to a
   * length comparison and report a "divergence" for any run whose frame count
   * differed, then print, underneath, the sentence "the mistake compounded from
   * here, not from the start". A flawless binary-search run — 10 moves, 0
   * mistakes, score 98, every frame `correct: true` — was told it had made a
   * mistake at step 9, because the player's run ended with a `submitAnswer` the
   * 9-frame reference trace has no entry for. Telling a learner they erred when
   * the engine forced an extra click is the most trust-destroying thing this
   * app could do: it is indistinguishable, from the learner's side, from being
   * bad at the algorithm.
   */
  readonly tailOnly: boolean
}

/**
 * The first index at which the player's run stops matching the reference, or
 * null when it never does.
 *
 * COMPARED ON `dsaOp`, NOT ON `action.type`, and that is the fix for the second
 * version of this bug. Measured on a flawless run:
 *
 *   played   choosePath  dsaOp=terminate  line 6   "found at v2"
 *   canon    submitAnswer dsaOp=terminate  line 13  "found: target 15 at index 2"
 *
 * Binary search accepts two ways to close the loop — `choosePath('found')`
 * followed by `submitAnswer`, or `submitAnswer` on its own — and the reference
 * line takes the shorter one. Both are `correct: true` and both are the same
 * OPERATION: the search ended. Comparing the mechanic a player happened to use
 * called that a divergence and printed "whatever went wrong starts here" about a
 * run with no wrong turns. `dsaOp` is the algorithm's vocabulary, so it is the
 * right level to compare at: two frames that performed the same operation
 * matched, whichever control the learner reached for.
 *
 * A rejected frame is still a divergence on its own terms, whatever it was
 * trying to do. `illegal` means the move was not available yet, which is a
 * mis-click rather than a wrong idea, so only `correct === false` counts.
 */
function findDivergence(played: TraceFrame[], canonical: TraceFrame[]): Divergence | null {
  const limit = Math.min(played.length, canonical.length)
  for (let i = 0; i < limit; i++) {
    const p = played[i]!
    const c = canonical[i]!
    const wasWrong = p.correct === false
    if (wasWrong || p.dsaOp !== c.dsaOp) {
      return {
        index: i,
        playedNote: p.note,
        canonicalNote: c.note,
        codeLine: p.codeLine,
        canonicalLine: c.codeLine,
        tailOnly: false,
      }
    }
  }

  // Every shared frame agrees. A length difference is only a real divergence if
  // the player is AHEAD — extra moves past the reference's end mean they kept
  // going after the algorithm had finished, which is worth naming. Extra frames
  // at the TAIL of a longer-than-reference run are the commit, not a mistake.
  if (played.length > limit) {
    const at = limit
    const p = played[at]
    return {
      index: at,
      playedNote: p?.note ?? '(you stopped here)',
      canonicalNote: '(the algorithm had already finished here)',
      codeLine: p?.codeLine ?? null,
      canonicalLine: null,
      tailOnly: true,
    }
  }
  return null
}

function DiagonalTrace({ played, canonical }: { played: TraceFrame[]; canonical: TraceFrame[] }) {
  const divergence = findDivergence(played, canonical)
  const identical = divergence === null

  return (
    <Panel
      title={identical ? 'Where the paths split' : 'Where your run differs'}
      subtitle="Compared step by step against the reference solution."
    >
      {identical ? (
        <p className="text-sm text-[var(--dsa-success)]">
          Every step you took is the step the reference takes, in the same order. There is no
          divergence to unpick.
        </p>
      ) : divergence!.tailOnly ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--dsa-success)]">
            You followed the reference solution exactly, and then finished the round by committing
            the answer. That last move is yours — the reference line stops at the search.
          </p>
          <p className="text-xs text-[var(--dsa-muted)]">
            No decision you made was the wrong one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--dsa-ink)]">
            The two runs part company at step{' '}
            <span className="mono font-bold">{divergence!.index + 1}</span>.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-[color-mix(in_oklab,var(--dsa-danger)_40%,var(--dsa-border))] bg-[color-mix(in_oklab,var(--dsa-danger)_8%,transparent)] p-3">
              <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-[var(--dsa-ink-faint)] uppercase">
                you did
              </p>
              <p className="mt-1 text-sm text-[var(--dsa-ink)]">{divergence!.playedNote}</p>
              {divergence!.codeLine !== null && (
                <p className="mono mt-1 text-[0.65rem] text-[var(--dsa-ink-faint)]">line {divergence!.codeLine}</p>
              )}
            </div>
            <div className="rounded-lg border border-[color-mix(in_oklab,var(--dsa-success)_40%,var(--dsa-border))] bg-[color-mix(in_oklab,var(--dsa-success)_8%,transparent)] p-3">
              <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-[var(--dsa-ink-faint)] uppercase">
                the algorithm
              </p>
              <p className="mt-1 text-sm text-[var(--dsa-ink)]">{divergence!.canonicalNote}</p>
              {divergence!.canonicalLine !== null && (
                <p className="mono mt-1 text-[0.65rem] text-[var(--dsa-ink-faint)]">
                  line {divergence!.canonicalLine}
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-[var(--dsa-muted)]">
            Everything before this step was right. Whatever went wrong starts here — which means
            it is one decision, not the whole run.
          </p>
        </div>
      )}
    </Panel>
  )
}
