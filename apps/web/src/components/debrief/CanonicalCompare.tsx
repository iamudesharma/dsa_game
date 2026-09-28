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
}: {
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
}

/**
 * The most teaching-relevant artefact on the page: the first index at which the
 * player's run stops matching the reference. Everything before it was fine;
 * everything after inherits from that mistake.
 */
function findDivergence(played: TraceFrame[], canonical: TraceFrame[]): Divergence | null {
  const limit = Math.min(played.length, canonical.length)
  for (let i = 0; i < limit; i++) {
    const p = played[i]!
    const c = canonical[i]!
    const sameAction = p.action.type === c.action.type
    const sameCorrect = p.correct === c.correct
    if (!sameAction || !sameCorrect) {
      return {
        index: i,
        playedNote: p.note,
        canonicalNote: c.note,
        codeLine: p.codeLine,
        canonicalLine: c.codeLine,
      }
    }
  }
  if (played.length !== canonical.length) {
    const at = limit
    const p = played[at]
    const c = canonical[at]
    return {
      index: at,
      playedNote: p?.note ?? '(you stopped here)',
      canonicalNote: c?.note ?? '(the run was already complete)',
      codeLine: p?.codeLine ?? null,
      canonicalLine: c?.codeLine ?? null,
    }
  }
  return null
}

function DiagonalTrace({ played, canonical }: { played: TraceFrame[]; canonical: TraceFrame[] }) {
  const divergence = findDivergence(played, canonical)
  const identical = divergence === null

  return (
    <Panel
      title="Where the paths split"
      subtitle="Compared step by step against the reference solution."
    >
      {identical ? (
        <p className="text-sm text-[var(--dsa-success)]">
          Your run matched the reference solution at every step. That is the optimal path.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--dsa-ink)]">
            The first divergence is at step <span className="mono font-bold">{divergence!.index + 1}</span>.
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
            Steps before this one were correct — the mistake compounded from here, not from the start.
          </p>
        </div>
      )}
    </Panel>
  )
}
