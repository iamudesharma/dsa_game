'use client'

import { AnimatePresence, motion } from 'framer-motion'
import type { ActionOutcome, GameState, PlayerFeedback } from '@dsa/game-schema'
import type { WorkCountdown } from '@/lib/guidance'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/format'

export interface MoveFeedbackProps {
  feedback: PlayerFeedback
  outcome: ActionOutcome
  state: GameState
  work: WorkCountdown
  onDismiss: () => void
  onGoToDebrief: () => void
}

/**
 * What just happened, and what to think about.
 *
 * THE DESIGN DECISION THIS FILE EXISTS FOR: educational-game research is
 * consistent that explanatory feedback — "here is why, and here is what to think
 * about next" — produces better learning than confirmatory feedback. A tick and
 * the word "correct" tells a learner they scored a point. It tells them nothing
 * about the algorithm, which is the thing they came here to learn.
 *
 * So the layout is fixed regardless of verdict, and `teach` is ALWAYS rendered,
 * including on success:
 *
 *   verdict   → one line, coloured, no praise
 *   teach     → the algorithmic reason, always present
 *   didWhat   → the operation just performed, in the theme's own words
 *   nextStep  → what to try instead, when there was something to try instead
 *   codeLine  → the line of real code that just ran, small and last
 *
 * ON PRAISE: nothing here congratulates the person. Deci & Ryan's
 * autonomy-supportive feedback is informational, not controlling; "Great job!"
 * tells a learner the adult is pleased, which is not information they can use.
 * What gets said instead is the thing the engine sent in `encourage`, which is
 * aimed at the STRATEGY, and it is optional by contract — so there is nothing
 * to say on the turns where the engine has no strategic observation to make.
 *
 * NEVER A DEAD END: when the move was wrong the board below is still live and
 * the engine's expected ids are ringed on it, so there is always something to
 * do. This component never dims, never covers and never disables the board.
 */
export function MoveFeedback({
  feedback,
  outcome,
  state,
  work,
  onDismiss,
  onGoToDebrief,
}: MoveFeedbackProps) {
  const wrong = feedback.verdict !== 'correct'

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={`${outcome.traceStep}-${feedback.verdict}`}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        role="status"
        aria-live="polite"
        className={cn(
          'panel relative overflow-hidden p-4',
          wrong
            ? 'border-[color:color-mix(in_oklab,var(--dsa-danger)_52%,var(--dsa-border))]'
            : 'border-[color:color-mix(in_oklab,var(--dsa-success)_40%,var(--dsa-border))]',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-1.5',
            wrong ? 'bg-[var(--dsa-danger)]' : 'bg-[var(--dsa-success)]',
          )}
        />

        <div className="pl-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p
                className={cn(
                  'text-[1.05rem] leading-tight font-bold',
                  wrong ? 'text-[var(--dsa-danger)]' : 'text-[var(--dsa-success)]',
                )}
              >
                {feedback.headline}
              </p>
              {/* The operation, in the theme's words. This is the "you just did
                  X" chip, and it doubles as the bridge from the game to the
                  algorithm — the word on the chip is the word in the code. */}
              <span className="chip text-[var(--dsa-ink)]">
                <span className="text-[var(--dsa-faint)]">you</span>
                {feedback.didWhat}
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Hide this explanation">
              Hide
            </Button>
          </div>

          <p className="mt-2 max-w-2xl text-[0.98rem] leading-relaxed text-[var(--dsa-ink)]">
            {feedback.teach}
          </p>

          {feedback.nextStep ? (
            <div
              className={cn(
                'mt-3 rounded-xl border px-3 py-2.5',
                'border-[color:color-mix(in_oklab,var(--dsa-primary)_45%,transparent)]',
                'bg-[color-mix(in_oklab,var(--dsa-primary)_10%,transparent)]',
              )}
            >
              <p className="text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--dsa-primary)] uppercase">
                Try this
              </p>
              <p className="mt-1 text-[0.95rem] text-[var(--dsa-ink)]">{feedback.nextStep}</p>
            </div>
          ) : null}

          {feedback.encourage ? (
            <p className="mt-2.5 text-[0.92rem] text-[var(--dsa-muted)] italic">{feedback.encourage}</p>
          ) : null}

          {/* The code line, last and smallest. It is reference material, not an
              instruction: showing it up front is what made the old UI read as a
              debug console. */}
          {feedback.codeLineText ? (
            <details className="mt-3 group">
              <summary className="cursor-pointer select-none text-[0.72rem] font-semibold text-[var(--dsa-faint)]">
                the code that just ran
              </summary>
              <pre className="mono mt-1.5 overflow-x-auto rounded-lg border border-[var(--dsa-border)] bg-[color-mix(in_oklab,#020617_45%,transparent)] p-2.5 text-[0.78rem] leading-relaxed">
                <span className="mr-3 select-none text-[var(--dsa-faint)]">{feedback.codeLine}</span>
                {feedback.codeLineText}
              </pre>
            </details>
          ) : null}

          {/* Two different units, deliberately not conflated. `moves` is
              everything the learner pressed; `comparisons` is what the
              algorithm counted, and it is the unit the complexity claim is made
              in. A binary-search turn is three moves but one comparison. */}
          <p className="mt-2.5 text-[0.72rem] text-[var(--dsa-faint)]">
            move {state.progress.steps}
            {work.worstCase !== null
              ? ` · ${work.used} of at most ${work.worstCase} ${work.unit} used`
              : ''}
            {state.phase !== 'playing' ? ' · the run has ended' : ''}
          </p>

          {outcome.won === true ? (
            <Button variant="primary" className="mt-3" onClick={onGoToDebrief}>
              See the replay and the code
            </Button>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
