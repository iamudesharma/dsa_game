'use client'

import type { GameSpec, GameState } from '@dsa/game-schema'
import type { WorkCountdown } from '@/lib/guidance'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/format'
import { providerTierLabel } from '@/lib/contract'

export interface ProgressRailProps {
  state: GameState
  spec: GameSpec
  work: WorkCountdown
  usedTier: string | null
  attempts: readonly { tier: string; ok: boolean; ms: number; error?: string }[]
  notes: readonly string[]
  round: number
  canUndo: boolean
  onUndo: () => void
}

/**
 * Progress the learner can SEE, which at this age band is the difference
 * between "I'm playing" and "am I getting anywhere".
 *
 * Four questions, in the order a learner actually asks them:
 *
 *   1. HOW MUCH IS LEFT TO CHECK?  The space the algorithm has not thrown away,
 *      as a bar plus a fraction. This is the number that MOVES for a halving
 *      algorithm, so it is the one on top.
 *   2. AM I ACTUALLY MAKING IT FASTER?  A COUNTDOWN OF REMAINING
 *      COMPARISONS, `worstCase - used`. The brief asks for complexity as a
 *      countdown rather than as `O(log n)` alone, and this is why: a learner
 *      who watches the count fall 3 → 2 → 1 → 0 across a run has *measured*
 *      logarithmic behaviour, and the notation at the end is then a label for
 *      something they already watched happen. Shown as notation first, it is
 *      just vocabulary to memorise.
 *   3. HOW AM I DOING?  Moves / wrong turns / hints, all from the engine.
 *      Mistakes are shown, not hidden, and never in a shaming colour: a learner
 *      who can see their mistake count is a learner who keeps going.
 *   4. HOW WAS THIS BUILT?  Collapsed, because it explains the app to its author.
 */
export function ProgressRail({
  state,
  spec,
  work,
  usedTier,
  attempts,
  notes,
  round,
  canUndo,
  onUndo,
}: ProgressRailProps) {
  const finished = state.phase !== 'playing'
  const progress = state.progress
  const spaceRatio = work.total === 0 ? 0 : work.live / work.total
  const spentRatio =
    work.worstCase !== null && work.worstCase > 0 ? Math.min(1, work.used / work.worstCase) : null
  const unitWord = work.unit === 'comparisons' ? 'comparison' : 'move'
  const unitWordPlural = `${unitWord}s`
  // "you just threw away more than half" is the sentence that makes a halving
  // algorithm stick, and it is invisible in the notation.
  const justHalved = finished ? false : work.live * 2 <= work.total && work.discarded > 0

  return (
    <section className="panel p-4" aria-label="How far you are">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-faint)] uppercase">
          How far you are
        </h2>
        <Button size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo}>
          Start this board over
        </Button>
      </header>

      {/* 1. Space still in play. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <p className="text-[0.95rem] font-semibold text-[var(--dsa-ink)]">
            {work.live} of {work.total} still in play
          </p>
          <p className="mono text-[0.75rem] text-[var(--dsa-faint)]">{Math.round(spaceRatio * 100)}%</p>
        </div>
        <div
          className="h-3 overflow-hidden rounded-full bg-[color-mix(in_oklab,#020617_50%,transparent)]"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(spaceRatio * 100)}
          aria-label={`${work.live} of ${work.total} still in play`}
        >
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--dsa-primary),var(--dsa-accent))] transition-[width] duration-500"
            style={{ width: `${Math.round(spaceRatio * 100)}%` }}
          />
        </div>
        {justHalved ? (
          <p className="mt-1.5 text-[0.85rem] text-[var(--dsa-success)]">
            That step threw away {work.total - work.live} of {work.total}. That is the trick.
          </p>
        ) : work.discarded > 0 ? (
          <p className="mt-1.5 text-[0.82rem] text-[var(--dsa-faint)]">
            {work.discarded} ruled out so far. A plain check-everything pass would cost {work.linearCase}.
          </p>
        ) : null}
      </div>

      {/* 2. The countdown. */}
      <div className="mt-3 rounded-xl border border-[var(--dsa-border)] bg-[color-mix(in_oklab,var(--dsa-surface-2)_55%,transparent)] p-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
              {unitWordPlural} left
            </p>
            <p className="mt-0.5 text-[0.88rem] text-[var(--dsa-muted)]">
              {work.remaining === null
                ? `${work.used} ${work.used === 1 ? unitWord : unitWordPlural} so far`
                : `of at most ${work.worstCase} on this board`}
            </p>
          </div>
          <p
            className={cn(
              'mono text-[2.5rem] leading-none font-bold tabular-nums',
              work.remaining === 0 ? 'text-[var(--dsa-success)]' : 'text-[var(--dsa-accent)]',
            )}
          >
            {work.remaining === null ? '—' : work.remaining}
          </p>
        </div>

        {spentRatio !== null ? (
          <div
            className="mt-2.5 h-2 overflow-hidden rounded-full bg-[color-mix(in_oklab,#020617_50%,transparent)]"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(spentRatio * 100)}
            aria-label={`${work.used} of at most ${work.worstCase} ${unitWordPlural} used`}
          >
            <div
              className="h-full rounded-full bg-[var(--dsa-accent)] transition-[width] duration-500"
              style={{ width: `${Math.round(spentRatio * 100)}%` }}
            />
          </div>
        ) : null}

        {/* The payoff, revealed only once it has been earned. */}
        {finished && work.notation ? (
          <p className="mt-2.5 rounded-lg border border-[color:color-mix(in_oklab,var(--dsa-success)_45%,transparent)] bg-[color-mix(in_oklab,var(--dsa-success)_10%,transparent)] px-2.5 py-2 text-[0.9rem] leading-relaxed text-[var(--dsa-ink)]">
            You just ran <span className="mono font-bold text-[var(--dsa-success)]">{work.notation}</span> using{' '}
            <span className="mono font-bold">{work.used}</span> {work.used === 1 ? unitWord : unitWordPlural} — and the
            worst case for this board was {work.worstCase}. That is the whole claim: the work grows with the logarithm
            of the board, not with the board.
          </p>
        ) : null}
      </div>

      {/* 3. The scoreboard. */}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="moves" value={progress.steps} />
        <Stat label="wrong turns" value={progress.mistakes} tone={progress.mistakes > 0 ? 'warn' : 'calm'} />
        <Stat label="hints" value={progress.hintsUsed} />
      </dl>

      <Provenance spec={spec} usedTier={usedTier} attempts={attempts} notes={notes} round={round} />
    </section>
  )
}

function Stat({ label, value, tone = 'calm' }: { label: string; value: number; tone?: 'calm' | 'warn' }) {
  return (
    <div className="rounded-xl border border-[var(--dsa-border)] px-2 py-1.5">
      <dt className="text-[0.62rem] tracking-wide text-[var(--dsa-faint)] uppercase">{label}</dt>
      <dd
        className={cn(
          'mono text-[1.35rem] leading-tight font-bold tabular-nums',
          tone === 'warn' && value > 0 ? 'text-[var(--dsa-warn)]' : 'text-[var(--dsa-ink)]',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Provider provenance, collapsed.
 *
 * This was three permanent lines of "round 1 · generated by template (offline) ·
 * attempts: opencode ✕ (210ms) → openrouter ✓" on the play screen. It matters
 * for debugging the cascade and it means nothing to a learner mid-game, so it
 * lives behind a disclosure. The information is not lost.
 */
function Provenance({
  spec,
  usedTier,
  attempts,
  notes,
  round,
}: {
  spec: GameSpec
  usedTier: string | null
  attempts: readonly { tier: string; ok: boolean; ms: number; error?: string }[]
  notes: readonly string[]
  round: number
}) {
  return (
    <details className="mt-3 border-t border-[var(--dsa-border)] pt-2 text-[0.72rem] text-[var(--dsa-faint)]">
      <summary className="cursor-pointer select-none font-semibold">How this board was made</summary>
      <div className="mt-1.5 space-y-1">
        <p>
          {spec.theme.genre} · {spec.theme.tone} · round {round} · built by {providerTierLabel(usedTier)}
        </p>
        {attempts.length > 1 && (
          <p>attempts: {attempts.map((a) => `${a.tier}${a.ok ? ' ok' : ` failed (${a.ms}ms)`}`).join(' → ')}</p>
        )}
        {notes.map((note, index) => (
          <p key={index}>{note}</p>
        ))}
      </div>
    </details>
  )
}

/**
 * The program's own memory, collapsed.
 *
 * `variables` is genuinely the most valuable debugging view in the app and it
 * stays — but it was open by default, in a three-column monospace grid, above
 * the fold on a phone. That is a wall of `lo 0 / mid 3 / hi 7 / n 8 / target 51`
 * sitting between a learner and the board, and decoding it is exactly the
 * extraneous load the redesign removes. The window is now DRAWN as brackets on
 * the board, so this panel is the place for everything that is not a spatial
 * pointer: the counters, the best-so-far, the seed.
 */
export function ProgramMemory({ state }: { state: GameState }) {
  const entries = Object.entries(state.variables).sort(([a], [b]) => a.localeCompare(b))
  const cursorEntries = Object.entries({
    lo: state.cursor.loSlotId,
    mid: state.cursor.midSlotId,
    hi: state.cursor.hiSlotId,
    i: state.cursor.iSlotId,
    j: state.cursor.jSlotId,
    best: state.cursor.bestObjectId,
    current: state.cursor.nodeId,
    prev: state.cursor.prevNodeId,
  }).filter(([, id]) => Boolean(id)) as [string, string][]

  return (
    <section className="panel p-4" aria-label="The program's memory">
      <details>
        <summary className="cursor-pointer select-none">
          <span className="text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-faint)] uppercase">
            The program&rsquo;s memory
          </span>
          <p className="mt-0.5 text-[0.78rem] text-[var(--dsa-muted)]">
            The numbers the running code is holding — open it when you want to see them.
          </p>
        </summary>

        <div className="mt-3 space-y-3">
          {entries.length === 0 ? (
            <p className="text-sm text-[var(--dsa-faint)]">No variables yet.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {entries.map(([name, value]) => (
                <div
                  key={name}
                  className="rounded-lg border border-[var(--dsa-border)] bg-[color-mix(in_oklab,var(--dsa-surface-2)_60%,transparent)] px-2 py-1.5"
                >
                  <dt className="mono text-[0.6rem] tracking-wide text-[var(--dsa-faint)] uppercase">{name}</dt>
                  <dd className="mono truncate text-[0.9rem] font-semibold text-[var(--dsa-ink)]">
                    {value === null ? <span className="text-[var(--dsa-faint)]">not set</span> : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {cursorEntries.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[0.65rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
                where the pointers are
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {cursorEntries.map(([role, id]) => (
                  <li key={role} className="chip">
                    <span className="mono font-bold text-[var(--dsa-primary)]">{role}</span>
                    <span className="mono text-[var(--dsa-ink)]">{describeShort(id)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-[0.7rem] text-[var(--dsa-faint)]">
            board {state.seed} · {state.instance.values.length} values
          </p>
        </div>
      </details>
    </section>
  )
}

function describeShort(id: string): string {
  return id.length > 12 ? `${id.slice(0, 11)}…` : id
}
