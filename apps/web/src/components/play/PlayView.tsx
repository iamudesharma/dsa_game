'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { Board } from '@/components/board/Board'
import { deriveActiveMechanic, MechanicHost } from '@/components/mechanics/MechanicHost'
import { useObjectClickRouter } from '@/components/mechanics/useObjectClickRouter'
import { CoachPanel } from '@/components/play/CoachPanel'
import { HintPanel } from '@/components/play/HintPanel'
import { MoveFeedback } from '@/components/play/MoveFeedback'
import { ProgramMemory, ProgressRail } from '@/components/play/ProgressRail'
import { TraceRail } from '@/components/play/TraceRail'
import { WatchOneStep } from '@/components/play/WatchOneStep'
import { YourTurnIndicator } from '@/components/play/YourTurnIndicator'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { ThemeScope } from '@/components/ui/ThemeScope'
import { useStoreHydrated } from '@/hooks/useStoreHydrated'
import { buildBoard } from '@/lib/board'
import { getGame } from '@/lib/api'
import { markWatchOneStepSeen, shouldOfferWatchOneStep } from '@/lib/firstRun'
import { buildTargetMarkers, deriveWorkCountdown } from '@/lib/guidance'
import { useGameStore, useTurnPrompt } from '@/store/game'

export interface PlayViewProps {
  gameId: string
}

/**
 * The play screen.
 *
 * PRIORITY ORDER, and it is the whole design:
 *
 *   1. YOUR TURN — one instruction, the largest text on the page, always at the
 *      top and always in the same place. A learner who has to hunt for "what do
 *      I do" is spending working memory on navigation instead of on the
 *      algorithm.
 *   2. THE BOARD — the tiles the instruction refers to, so the words and the
 *      things they name are adjacent.
 *   3. THE CONTROL — the one button that completes the current operation, with
 *      the targets the engine named.
 *   4. THE EXPLANATION — what just happened and why, directly under the board so
 *      the consequence and its reason are read together.
 *   5. REFERENCE — progress, hints, memory, history, coach. On a phone these
 *      stack below in that order; on a wide screen they move right. None of them
 *      is above the board on any viewport, because none of them is what the
 *      learner is trying to do right now.
 *
 * WHAT IS NOT ON THIS SCREEN ANY MORE, and why — the short version of the
 * cognitive-load argument:
 *   - `lo / mid / hi / i / j / best / current / prev` as a chip row. They are
 *     pointers, and pointers are drawn as brackets around a range on the board.
 *   - The mechanic id and `dsaOp` under each operation tab. Wire metadata.
 *   - A code line per trace frame. The debrief shows the whole run at once,
 *     which is the only time code is the point.
 *   - `comparePair(a, b, lt | eq | gt)` style previews under the controls. The
 *     renderer is not a place to read the wire format.
 *   - The provider cascade (tier, attempts, notes) on three permanent lines.
 *     Collapsed, because it explains the app to its author, not to its learner.
 *   - The whole list of every object as a second copy of the board.
 */
export function PlayView({ gameId }: PlayViewProps) {
  const router = useRouter()
  const hydrated = useStoreHydrated()

  const spec = useGameStore((s) => s.spec)
  const state = useGameStore((s) => s.state)
  const outcome = useGameStore((s) => s.outcome)
  const feedback = useGameStore((s) => s.feedback)
  const busy = useGameStore((s) => s.busy)
  const error = useGameStore((s) => s.error)
  const hints = useGameStore((s) => s.hints)
  const usedTier = useGameStore((s) => s.usedTier)
  const attempts = useGameStore((s) => s.attempts)
  const notes = useGameStore((s) => s.notes)
  const round = useGameStore((s) => s.round)
  const lastIntent = useGameStore((s) => s.lastIntent)
  const storeGameId = useGameStore((s) => s.gameId)
  const overrideMechanic = useGameStore((s) => s.activeMechanicId)
  const setActiveMechanic = useGameStore((s) => s.setActiveMechanic)
  const dispatch = useGameStore((s) => s.dispatch)
  const requestHint = useGameStore((s) => s.requestHint)
  const restartSameSeed = useGameStore((s) => s.restartSameSeed)
  const clearError = useGameStore((s) => s.clearError)

  // The one prompt the whole screen is built around. Falls back to a state-only
  // derivation when the server has not sent one; see `useTurnPrompt`.
  const prompt = useTurnPrompt()
  /** True when the prompt is ours rather than the oracle's, so we can say so. */
  const degradedGuidance = useGameStore((s) => s.turnPrompt === null)

  const [picked, setPicked] = useState<string[]>([])
  const [dismissedStep, setDismissedStep] = useState<number | null>(null)
  const [coachOpen, setCoachOpen] = useState(false)
  const [demoState, setDemoState] = useState<'offer' | 'showing' | 'done'>('done')
  const autoAdvanced = useRef(false)

  const loaded = Boolean(spec && state && storeGameId === gameId)
  const model = useMemo(() => (state && spec ? buildBoard(state, spec) : null), [state, spec])
  const markers = useMemo(
    () => (state && prompt ? buildTargetMarkers(prompt, state) : new Map()),
    [state, prompt],
  )
  const work = useMemo(() => (state ? deriveWorkCountdown(state, prompt) : null), [state, prompt])
  const activeMechanicId = useMemo(
    () =>
      spec && state
        ? deriveActiveMechanic({
            spec,
            state,
            override: overrideMechanic,
            ...(prompt ? { suggested: prompt.mechanic } : {}),
          })
        : 'selectObject',
    [spec, state, overrideMechanic, prompt],
  )

  // Cold deep link: a pasted or bookmarked `/play/<id>` arrives with an empty
  // sessionStorage. The server still holds the authoritative game, so ask for it
  // rather than telling the player to regenerate. Runs once per gameId and only
  // when the store genuinely does not have this game.
  const hydrateFromServer = useGameStore((s) => s.hydrateFromServer)
  const attemptedRecovery = useRef(false)
  useEffect(() => {
    if (!hydrated || loaded || attemptedRecovery.current) return
    attemptedRecovery.current = true
    const controller = new AbortController()
    void getGame(gameId, controller.signal).then((game) => {
      if (game) hydrateFromServer(game)
    })
    return () => controller.abort()
  }, [hydrated, loaded, gameId, hydrateFromServer])

  // A terminal state is the end of the round: send the player to the debrief
  // automatically (once per round) so the payoff is never behind them, but keep
  // the board rendered read-only behind the decision.
  useEffect(() => {
    if (!state || state.phase === 'playing' || autoAdvanced.current) return
    autoAdvanced.current = true
    const timer = setTimeout(() => router.replace(`/debrief/${gameId}`), 2600)
    return () => clearTimeout(timer)
  }, [state, gameId, router])

  useEffect(() => {
    setPicked([])
  }, [state?.trace.length, state?.phase])

  // First run: offer the worked example once, and only while the learner has
  // genuinely not started. A single gate in the view, not a settings page, and
  // the marker is written when the demonstration STARTS so dismissing it half
  // way through does not bring it back next session.
  useEffect(() => {
    if (!spec || !state) return
    if (state.trace.length > 0 || state.phase !== 'playing') return
    if (shouldOfferWatchOneStep(spec.problemId)) setDemoState('offer')
  }, [spec, state])

  const objectRouter = useObjectClickRouter({
    mechanic: activeMechanicId,
    picked,
    setPicked,
    dispatch,
  })

  const onSlotActivate = useCallback(
    (slotId: string) => {
      const source = picked[0]
      if (activeMechanicId === 'moveObject' && source) {
        dispatch({ type: 'moveObject', objectId: source, toSlotId: slotId })
        setPicked([])
      }
    },
    [activeMechanicId, picked, dispatch],
  )

  /**
   * "Start over" re-generates from the same seed, which mints a NEW gameId. The
   * store is now holding that new game while the URL still points at the old
   * one, so we must follow it — otherwise the board renders as "not loaded".
   */
  const onUndo = useCallback(() => {
    void restartSameSeed().then((newId) => {
      if (newId) router.replace(`/play/${newId}`)
    })
  }, [restartSameSeed, router])

  const beginDemo = useCallback(() => {
    if (spec) markWatchOneStepSeen(spec.problemId)
    setDemoState('showing')
  }, [spec])

  const endDemo = useCallback(() => setDemoState('done'), [])

  if (!hydrated) {
    return (
      <ThemeScope>
        <main className="mx-auto max-w-6xl px-4 py-10" aria-busy="true">
          <div className="h-32 w-full animate-pulse rounded-[20px] bg-[var(--dsa-border)]" />
          <div className="mt-4 h-40 animate-pulse rounded-[20px] bg-[var(--dsa-border)]" />
          <span className="sr-only">Loading your game…</span>
        </main>
      </ThemeScope>
    )
  }

  if (!loaded || !spec || !state || !model || !prompt || !work) {
    return (
      <ThemeScope>
        <main className="mx-auto max-w-2xl px-4 py-16">
          <section className="panel p-5">
            <h1 className="text-xl font-bold text-[var(--dsa-ink)]">This game is not loaded in this tab</h1>
            <p className="mt-2 text-[0.95rem] text-[var(--dsa-muted)]">
              A game lives in this tab while you play it, so a link pasted into a new tab cannot pick up where it
              left off. Go back to the problem and start a fresh board.
            </p>
            {error ? (
              <div className="mt-4">
                <ErrorState error={error} onRetry={clearError} />
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => router.push('/')}>
                Pick a topic
              </Button>
              {lastIntent ? (
                <Button onClick={() => router.push(`/problem/${lastIntent.problemId}`)}>Back to the problem</Button>
              ) : null}
            </div>
          </section>
        </main>
      </ThemeScope>
    )
  }

  const finished = state.phase !== 'playing'
  const showFeedback = Boolean(outcome && feedback && outcome.traceStep !== dismissedStep)
  const activeFrame = state.trace[state.trace.length - 1] ?? null

  return (
    <ThemeScope spec={spec}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-3 sm:px-4 sm:py-6">
        {/* Deliberately NO objective here. `turnPrompt.goal` is a restatement of
            `spec.objective` and it already sits directly under the instruction in
            `YourTurnIndicator`, where "what am I trying to do" belongs. Printing
            both put the same sentence on the page twice, which is textbook
            extraneous load — the reader has to work out whether the two versions
            differ. The full objective is one tap away, for when they want it. */}
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h1 className="truncate text-[1.05rem] font-bold text-[var(--dsa-ink)] sm:text-[1.2rem]">
              {spec.theme.title}
            </h1>
            <details className="text-[0.82rem] text-[var(--dsa-muted)]">
              <summary className="cursor-pointer select-none text-[var(--dsa-faint)]">What you are doing</summary>
              <p className="mt-1 max-w-xl leading-relaxed">{spec.objective}</p>
            </details>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setCoachOpen((open) => !open)} aria-pressed={coachOpen}>
              {coachOpen ? 'Close coach' : 'Ask a coach'}
            </Button>
            <Link className="btn min-h-9 px-2.5 text-xs" href={`/problem/${spec.problemId}`}>
              Change problem
            </Link>
          </div>
        </header>

        {error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              clearError()
            }}
            retryLabel="Dismiss and try the action again"
          />
        ) : null}

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_350px]">
          <div className="min-w-0 space-y-3">
            <YourTurnIndicator
              prompt={prompt}
              step={state.progress.steps}
              demonstrating={demoState === 'showing'}
            />

            <AnimatePresence>
              {demoState === 'offer' ? (
                <motion.div
                  key="demo"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <WatchOneStep
                    prompt={prompt}
                    state={state}
                    degraded={degradedGuidance}
                    onDispatch={(action) => void dispatch(action)}
                    onDone={endDemo}
                    onSkip={endDemo}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>

            {finished ? (
              <motion.section
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel border-[color:color-mix(in_oklab,var(--dsa-accent)_45%,var(--dsa-border))] p-4"
              >
                <p className="text-[1.1rem] font-bold text-[var(--dsa-ink)]">
                  {state.phase === 'won' ? 'Solved — here is the algorithm underneath.' : 'The run ended.'}
                </p>
                <p className="mt-1 text-[0.95rem] text-[var(--dsa-muted)]">
                  {state.phase === 'won' ? spec.narration.win : spec.narration.lose}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => router.push(`/debrief/${gameId}`)}>
                    Replay and the real code
                  </Button>
                  <Button onClick={() => router.push(`/problem/${spec.problemId}`)}>New board</Button>
                </div>
              </motion.section>
            ) : null}

            {/* The board is NOT wrapped in a titled panel. A "the board" heading
                above a row of tiles is a label for something the learner is
                already looking at, and the space was better spent on the gap
                between the instruction and the tiles. */}
            <div className="panel p-3 pt-3 sm:p-4">
              <Board
                state={state}
                spec={spec}
                model={model}
                prompt={prompt}
                picked={picked}
                disabled={finished || busy || demoState === 'showing'}
                slotsInteractive={!finished && !busy && activeMechanicId === 'moveObject' && picked.length > 0}
                allowDrag={!finished && !busy && activeMechanicId === 'moveObject'}
                onObjectActivate={objectRouter.onObjectActivate}
                onSlotActivate={onSlotActivate}
                onObjectDrop={(objectId, slotId) => {
                  dispatch({ type: 'moveObject', objectId, toSlotId: slotId })
                  setPicked([])
                }}
              />
            </div>

            <MechanicHost
              spec={spec}
              state={state}
              model={model}
              activeMechanicId={activeMechanicId}
              onSelectMechanic={setActiveMechanic}
              disabled={finished || busy || demoState === 'showing'}
              picked={picked}
              setPicked={setPicked}
              dispatch={dispatch}
              markers={markers}
              prompt={prompt}
            />

            <AnimatePresence>
              {showFeedback && outcome && feedback ? (
                <MoveFeedback
                  key={`${outcome.traceStep}-${feedback.verdict}`}
                  feedback={feedback}
                  outcome={outcome}
                  state={state}
                  work={work}
                  onDismiss={() => setDismissedStep(outcome.traceStep)}
                  onGoToDebrief={() => router.push(`/debrief/${gameId}`)}
                />
              ) : null}
            </AnimatePresence>
          </div>

          <aside className="min-w-0 space-y-3">
            <ProgressRail
              state={state}
              spec={spec}
              work={work}
              usedTier={usedTier}
              attempts={attempts}
              notes={notes}
              round={round}
              canUndo={!finished && !busy}
              onUndo={onUndo}
            />
            <HintPanel progress={state.progress} hints={hints} busy={busy} onHint={() => void requestHint()} />
            {coachOpen ? (
              <CoachPanel gameId={gameId} progress={prompt.progress} onClose={() => setCoachOpen(false)} />
            ) : null}
            <ProgramMemory state={state} />
            <TraceRail trace={state.trace} activeIndex={activeFrame?.index ?? null} />
          </aside>
        </div>

        <footer className="px-1 pb-2 text-[0.72rem] text-[var(--dsa-faint)]">
          {degradedGuidance ? (
            <p>
              This server build does not send per-turn guidance, so the instruction above is derived from the board
              state. The engine still checks every move.
            </p>
          ) : (
            <p>Every move is checked by the algorithm&rsquo;s own rules, not by this page.</p>
          )}
        </footer>
      </div>
    </ThemeScope>
  )
}
