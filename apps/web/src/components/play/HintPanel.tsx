'use client'

import { AnimatePresence, motion } from 'framer-motion'
import type { Progress } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import type { RevealedHint } from '@/store/game'

export interface HintPanelProps {
  progress: Progress
  hints: RevealedHint[]
  busy: boolean
  onHint: () => void
}

/**
 * Hints, and the permission slip.
 *
 * Hints are revealed one at a time, newest first, and asking for one is framed
 * as a normal thing to do rather than a failure: at this age band a learner who
 * thinks asking costs them something will simply guess instead, and guessing
 * teaches less. The count is already on the progress rail, so this panel does
 * not repeat it.
 *
 * The spec's own `narration.hintPool` disclosure is gone. It printed every
 * authored hint at once inside a `<details>`, which meant the "throttled,
 * revealed on demand" contract was bypassable by one tap and the learner
 * could read the whole ladder without playing. The server picks which hint to
 * reveal; the client shows what it was given.
 *
 * The `source` / `confidence` line is retained but demoted: which model chose
 * a hint is genuinely interesting to someone building this and noise to someone
 * learning it, so it lives in the title attribute rather than in the reading
 * path.
 */
export function HintPanel({ progress, hints, busy, onHint }: HintPanelProps) {
  return (
    <section className="panel p-4" aria-label="Hints">
      <header className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-faint)] uppercase">
          Stuck is fine
        </h2>
        <Button size="sm" variant="accent" disabled={busy} onClick={onHint}>
          {busy ? 'Thinking…' : hints.length === 0 ? 'Give me a nudge' : 'Another nudge'}
        </Button>
      </header>

      {hints.length === 0 ? (
        <p className="text-[0.9rem] leading-relaxed text-[var(--dsa-muted)]">
          A nudge names the kind of step to take next. It will not tell you which tile — that part is yours.
        </p>
      ) : (
        <ol className="space-y-2">
          <AnimatePresence initial={false}>
            {hints.map((hint, index) => (
              <motion.li
                key={`${hint.hint}-${index}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-[color:color-mix(in_oklab,var(--dsa-primary)_40%,transparent)] bg-[color-mix(in_oklab,var(--dsa-primary)_10%,transparent)] p-3"
              >
                <p className="text-[0.95rem] leading-relaxed text-[var(--dsa-ink)]">{hint.hint}</p>
                <p
                  className="mt-1 text-[0.62rem] text-[var(--dsa-faint)]"
                  title={hint.source === 'laya' ? `chosen by Laya, ${hint.confidence ?? 0} confidence` : 'rule-based hint'}
                >
                  {hint.source === 'laya' ? 'coach-chosen' : 'rule-based'} · hint {index + 1}
                </p>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}

      {progress.hintsUsed > 0 && (
        <p className="mt-2.5 text-[0.78rem] text-[var(--dsa-faint)]">
          {progress.hintsUsed} counted in this run. They cost you nothing except the thinking you skipped.
        </p>
      )}
    </section>
  )
}
