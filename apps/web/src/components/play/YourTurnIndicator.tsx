'use client'

import { AnimatePresence, motion } from 'framer-motion'
import type { TurnPrompt } from '@dsa/game-schema'

import { indicatorFill, turnKey } from '@/lib/guidance'
import { cn } from '@/lib/format'

export interface YourTurnIndicatorProps {
  prompt: TurnPrompt
  /** Engine operation count; distinguishes two turns with identical wording. */
  step: number
  /** Set while a demonstration is playing, so the copy can shift to "watch". */
  demonstrating?: boolean
  className?: string
}

/**
 * THE PRIMARY CONTROL SURFACE.
 *
 * Cognitive-load design, in the order the eye meets it:
 *
 *   1. `goal` — a small caps kicker. Where am I? Answerable in one glance.
 *   2. `instruction` — the single most prominent thing on the page. One
 *      imperative sentence, set large. This is the only text a learner needs to
 *      read in order to act, so it gets the type size, and nothing else on the
 *      screen is allowed to compete with it.
 *   3. `reason` — one smaller supporting line. This is the GERMANE load, the
 *      part that builds the mental model, so it is present on every single turn
 *      rather than tucked away. It explains WHY the move matters, which is what
 *      turns a sequence of instructions into an algorithm the learner owns.
 *   4. `indicator` — how much is left, as a closing window rather than a
 *      sentence. `indicator.progress` is the fraction STILL IN PLAY, so the bar
 *      is filled with what remains: a bar that empties as you play would read
 *      as "you are running out", the opposite of the message.
 *
 * `targets` are NOT rendered here. They are rendered on the board, next to the
 * things they name, because "which ones do I touch" is a question about the
 * board and answering it in a panel above the board would make the learner
 * look away and mentally map labels onto tiles. The one exception is the target
 * CHIPS row below, which names them so a screen-reader user and a learner
 * scanning the instruction have the same list.
 *
 * The whole block re-animates on every new move (keyed on the move, not on the
 * render) so the eye is pulled to it — and `MotionConfig reducedMotion="user"`
 * in Providers collapses that to an instant swap for anyone who has asked their
 * OS for less motion.
 */
export function YourTurnIndicator({ prompt, step, demonstrating = false, className }: YourTurnIndicatorProps) {
  const moveKey = turnKey(prompt, step)
  const fill = indicatorFill(prompt)
  const nudge = prompt.nudge

  return (
    <section
      className={cn(
        'panel relative overflow-hidden p-4 sm:p-5',
        'border-[color:color-mix(in_oklab,var(--dsa-accent)_34%,var(--dsa-border))]',
        className,
      )}
      aria-label="Your turn"
    >
      {/* A single accent rule down the left edge. The loudest colour on the
          screen means "this is where your turn is", and it stays put, so it
          becomes a landmark rather than an event. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5 bg-[linear-gradient(180deg,var(--dsa-accent),color-mix(in_oklab,var(--dsa-accent)_25%,transparent))]"
      />

      <div className="pl-3 sm:pl-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="shrink-0 text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-accent)] uppercase">
            {demonstrating ? 'Watch this' : 'Your turn'}
          </p>
          {/* The goal is a restatement of the objective, so it is CLAMPED to two
              lines. `spec.objective` is a full sentence and providers write long
              ones; left unclamped it pushes the instruction — the one thing on
              this page that must be read — below the fold on a 390px phone. The
              objective is still available in full in the header. */}
          <p className="min-w-0 flex-1 text-[0.82rem] leading-snug text-[var(--dsa-muted)] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden [display:-webkit-box]">
            {prompt.goal}
          </p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={moveKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1 className="mt-1.5 text-[1.65rem] leading-[1.15] font-bold tracking-[-0.015em] text-[var(--dsa-ink)] sm:text-[2rem]">
              {prompt.instruction}
            </h1>
          </motion.div>
        </AnimatePresence>

        {prompt.reason ? (
          <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-[var(--dsa-muted)]">
            {prompt.reason}
          </p>
        ) : null}

        <WorkIndicator progress={fill} label={prompt.indicator.label} detail={prompt.indicator.detail} />
      </div>

      <AnimatePresence>
        {nudge ? <Nudge tone={nudge.tone} message={nudge.message} /> : null}
      </AnimatePresence>
    </section>
  )
}

/**
 * "How much is left" as a picture.
 *
 * The window is drawn as two rails that close in, with a `lo … hi` reading
 * underneath in words. The learner sees the search space physically shrink
 * before they see the word "halving", which is the entire point of playing a
 * binary search as a game rather than being shown the code.
 */
function WorkIndicator({ progress, label, detail }: { progress: number; label: string; detail: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100)

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[0.82rem] font-semibold text-[var(--dsa-ink)]">{detail}</p>
        <p className="text-[0.7rem] tracking-[0.12em] text-[var(--dsa-faint)] uppercase">{label}</p>
      </div>

      <div
        className="relative mt-2 h-3 overflow-hidden rounded-full border border-[var(--dsa-border)] bg-[color-mix(in_oklab,#020617_45%,var(--dsa-surface-2))]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${detail} — ${pct}% of the original space still in play`}
      >
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,var(--dsa-primary)_85%,transparent),var(--dsa-accent))]"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  )
}

/**
 * The nudge.
 *
 * NEVER a modal, NEVER blocking: it sits inside the indicator and the board
 * stays live underneath, because a learner who is nudged into a dead end stops
 * playing. Urgency is carried by colour and weight, not by shaking, overlaying,
 * or removing the board.
 */
function Nudge({ tone, message }: { tone: 'none' | 'gentle' | 'urgent'; message: string }) {
  if (tone === 'none') return null
  const urgent = tone === 'urgent'

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      role="status"
      aria-live="polite"
      className={cn(
        'mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[0.92rem] leading-relaxed',
        urgent
          ? 'border-[color:color-mix(in_oklab,var(--dsa-warn)_55%,transparent)] bg-[color-mix(in_oklab,var(--dsa-warn)_12%,transparent)] text-[var(--dsa-ink)]'
          : 'border-[color:color-mix(in_oklab,var(--dsa-primary)_40%,transparent)] bg-[color-mix(in_oklab,var(--dsa-primary)_10%,transparent)] text-[var(--dsa-ink)]',
      )}
    >
      {/* A bar, not an emoji. It carries meaning ("pay attention here") without
          decoration, and it inherits the palette so it themes with the game. */}
      <span
        aria-hidden
        className={cn('mt-1 h-4 w-1 shrink-0 rounded-full', urgent ? 'bg-[var(--dsa-warn)]' : 'bg-[var(--dsa-primary)]')}
      />
      <p className="min-w-0">{message}</p>
    </motion.div>
  )
}
