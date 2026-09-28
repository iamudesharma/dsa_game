'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Action, GameState, PlayerFeedback, TurnPrompt } from '@dsa/game-schema'

import { Button } from '@/components/ui/Button'
import { demoActionFor } from '@/lib/guidance'
import { cn } from '@/lib/format'

export interface WatchOneStepProps {
  prompt: TurnPrompt
  state: GameState
  /** Set when the API is serving an older build with no guidance to narrate. */
  degraded: boolean
  onDispatch: (action: Action) => void
  /** Called once the demonstration is over, so the caller can hide it. */
  onDone: () => void
  onSkip: () => void
}

type Phase = 'offer' | 'pointing' | 'playing' | 'explaining' | 'handing-over'

/** Beats, in ms. Long enough to read one line, short enough not to be a cutscene. */
const POINT_MS = 2600
const SETTLE_MS = 900
const EXPLAIN_MS = 5200

/**
 * WORKED EXAMPLE, THEN FADING.
 *
 * Showing one full worked step before asking for one is standard practice and
 * unusually effective: a learner who has watched the pattern applied once is
 * pattern-matching on the second attempt rather than reasoning from zero. So on
 * a learner's FIRST attempt at a problem this offers exactly one demonstrated
 * step, then hands over permanently (`localStorage`, keyed by problem).
 *
 * WHAT IT WILL AND WILL NOT DO — this is the important constraint:
 *
 * A demonstration must not fabricate a move. Most mechanics are not determined
 * by `TurnPrompt` alone: a comparison still needs a relation, a branch still
 * needs a side, an assignment still needs a value, and any guess made here
 * would be the CLIENT claiming a result. So:
 *
 *   - When `demoActionFor` finds a single unambiguous move (`selectObject` on
 *     one target), the demonstration actually plays it — through the normal
 *     dispatch path, so the ENGINE validates it and the narration is the
 *     engine's own `teach` line. If the engine disagreed, the engine would say
 *     so on screen, which is still honest.
 *   - Otherwise the demonstration points at the highlighted tiles, walks the
 *     instruction, and hands over. The learner makes the move.
 *
 * Either way the learner watches a step explained, which is the point. Nothing
 * here asserts that anything is correct.
 */
export function WatchOneStep({ prompt, state, degraded, onDispatch, onDone, onSkip }: WatchOneStepProps) {
  const [phase, setPhase] = useState<Phase>('offer')
  const [script, setScript] = useState<PlayerFeedback | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const played = useRef(false)
  /** Trace length when the demonstrated action was dispatched. */
  const traceBaseline = useRef(0)

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  // Leaving the demonstration for any reason must not leave a timer queued to
  // dispatch an action into a game the learner has since moved on in.
  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  const start = useCallback(() => {
    const action = demoActionFor(prompt, state)
    played.current = action !== null
    traceBaseline.current = state.trace.length

    if (!action) {
      // Nothing unambiguous to play: point, explain, hand over.
      setPhase('pointing')
      timers.current.push(setTimeout(() => setPhase('explaining'), POINT_MS))
      timers.current.push(setTimeout(() => setPhase('handing-over'), POINT_MS + EXPLAIN_MS))
      return
    }

    setPhase('pointing')
    timers.current.push(
      setTimeout(() => {
        setPhase('playing')
        onDispatch(action)
      }, POINT_MS),
    )
  }, [onDispatch, prompt, state])

  useEffect(() => {
    if (phase !== 'playing' || played.current !== true) return
    played.current = false

    // The narration is the engine's own `teach` line for the move it just
    // validated — read from the store, never composed here. Guarding on the
    // trace having actually grown means a failed request falls through to the
    // generic explanation instead of narrating the PREVIOUS move as if it were
    // the demonstrated one.
    const grew = state.trace.length > traceBaseline.current
    const latest = grew ? state.trace[state.trace.length - 1] : undefined
    if (latest) {
      setScript({
        verdict: latest.correct ? 'correct' : 'wrong',
        headline: '',
        teach: latest.note,
        codeLine: latest.codeLine,
        codeLineText: latest.codeLineText,
        didWhat: '',
      })
    }
    timers.current.push(setTimeout(() => setPhase('explaining'), SETTLE_MS))
    timers.current.push(
      setTimeout(() => setPhase('handing-over'), SETTLE_MS + EXPLAIN_MS),
    )
  }, [phase, state.trace])

  const lines = buildScript(prompt, degraded)

  return (
    <section
      className={cn(
        'panel relative overflow-hidden p-4',
        'border-[color:color-mix(in_oklab,var(--dsa-accent)_40%,var(--dsa-border))]',
      )}
      aria-label="Watch one step first"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5 bg-[linear-gradient(180deg,var(--dsa-accent),transparent)]"
      />

      <div className="pl-3">
        <p className="text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-accent)] uppercase">
          First time on this board?
        </p>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <h2 className="mt-1.5 text-[1.3rem] leading-tight font-bold text-[var(--dsa-ink)] sm:text-[1.45rem]">
              {phase === 'offer'
                ? 'Watch one step, then you drive.'
                : phase === 'pointing'
                  ? 'Here is the move.'
                  : phase === 'playing'
                    ? 'Watch what it does.'
                    : phase === 'explaining'
                      ? 'This is why it matters.'
                      : 'Your turn now.'}
            </h2>

            <p className="mt-1.5 text-[0.98rem] leading-relaxed text-[var(--dsa-muted)]">
              {phase === 'offer' ? (
                <>
                  Before you play, here is one step of this algorithm done for you — with the reason out loud. Then
                  the board is yours.
                </>
              ) : phase === 'pointing' ? (
                <>
                  {lines.pointing}{' '}
                  {prompt.targets.length > 0 ? (
                    <span className="text-[var(--dsa-ink)]">
                      {prompt.targets.map((t) => t.label).join(prompt.targets.length > 1 ? ' and ' : '')}
                    </span>
                  ) : null}{' '}
                  {lines.reason}
                </>
              ) : phase === 'playing' ? (
                <>Watch the board change. Nothing you have to do yet.</>
              ) : phase === 'explaining' ? (
                <>
                  {script?.teach || lines.reason}{' '}
                  <span className="text-[var(--dsa-ink)]">{lines.soWhat}</span>
                </>
              ) : (
                <>
                  The same move, with you holding the board. {lines.encourage}
                </>
              )}
            </p>
          </motion.div>
        </AnimatePresence>

        {phase === 'offer' ? (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={start}>
              Watch one step
            </Button>
            <Button variant="ghost" onClick={onSkip}>
              Skip it, I want to play
            </Button>
          </div>
        ) : (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={onDone} disabled={phase !== 'handing-over'}>
              {phase === 'handing-over' ? 'Got it — my turn' : 'Working through it…'}
            </Button>
            <Button variant="ghost" onClick={onSkip}>
              End the demonstration
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * The narration.
 *
 * Every line here is drawn from the contract — `reason` for the why, `target
 * label`/`hint` for the what — with the connective tissue written locally. The
 * "so what" line is the one piece of teaching copy this component owns, and it
 * deliberately praises the SHAPE OF THE MOVE rather than the person.
 */
function buildScript(prompt: TurnPrompt, degraded: boolean): {
  pointing: string
  reason: string
  soWhat: string
  encourage: string
} {
  const soWhatByDsaOp: Record<string, string> = {
    compare: 'That is the whole job of a comparison: it decides which way the program goes next.',
    'choose-path': 'Discarding half is why the next step is cheaper than the last one.',
    read: 'Reading a value costs one step and tells the program one fact.',
    traverse: 'Following a link is the only way to reach the next value.',
    link: 'The pointer decides where the program goes next — so which way you wire it matters.',
    assign: 'Saving a value now means the program never has to work it out twice.',
    move: 'Moving something is how the data gets to where the algorithm expects it.',
    swap: 'A swap changes two positions at once — that is why sorting spends most of its time here.',
    push: 'Pushing keeps the value available for later, in order.',
    pop: 'Popping takes the value off in the reverse order it arrived.',
    terminate: 'Finishing is how the program reports what it found.',
  }

  return {
    pointing: prompt.targets.length > 0 ? 'The board is highlighting' : 'On this board, look at',
    reason: prompt.reason,
    soWhat: soWhatByDsaOp[prompt.dsaOp] ?? 'That is the step the algorithm takes.',
    encourage: degraded
      ? 'Do the same thing you just watched.'
      : 'Same move, your hands on the board.',
  }
}
