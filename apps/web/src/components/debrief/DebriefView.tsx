'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { RobotGuide } from '@/components/adventure/WorldScene'
import { useAdventure } from '@/components/adventure/AdventureProvider'
import { CanonicalCompare } from '@/components/debrief/CanonicalCompare'
import { CodePanel } from '@/components/debrief/CodePanel'
import { SelfExplanation } from '@/components/debrief/SelfExplanation'
import {
  AnswerCard,
  ComplexityChips,
  ExplanationPanel,
  StatsPanel,
} from '@/components/debrief/ExplanationPanel'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorState } from '@/components/ui/ErrorState'
import { Panel } from '@/components/ui/Panel'
import { ThemeScope } from '@/components/ui/ThemeScope'
import { useStoreHydrated } from '@/hooks/useStoreHydrated'
import { getDebrief, getGame } from '@/lib/api'
import { computeScore } from '@/lib/score'
import { readReflections, reflectionsAnswered, type ReflectionAnswers } from '@/lib/self-explanation'
import { useGameStore } from '@/store/game'

/**
 * The teaching payoff.
 *
 * Everything here is derived from `DebriefResponse` plus the stored final
 * `GameState`, which is the only data the contract offers — no extra requests,
 * so the debrief renders even with the API down (as long as the session is
 * still in this tab).
 */
export function DebriefView({ gameId }: { gameId: string }) {
  const router = useRouter()
  const hydrated = useStoreHydrated()
  const spec = useGameStore((s) => s.spec)
  const state = useGameStore((s) => s.state)
  const debrief = useGameStore((s) => s.debrief)
  const error = useGameStore((s) => s.error)
  const lastIntent = useGameStore((s) => s.lastIntent)
  const storeGameId = useGameStore((s) => s.gameId)
  const generate = useGameStore((s) => s.generate)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'replay' | 'explanation' | 'code'>('replay')
  /**
   * The learner's self-explanation answers for this game, read once from
   * localStorage. The explanation tab stays gated behind producing them (or
   * explicitly skipping) — R2.1 — and the answers are echoed back inside the
   * explanation once revealed — R2.2. The `typeof window` guard is for the
   * server prerender; the main content below only renders after hydration, at
   * which point this already holds the stored value.
   */
  const [reflections, setReflections] = useState<ReflectionAnswers | null>(() =>
    typeof window === 'undefined' ? null : readReflections(window.localStorage, gameId),
  )
  const explanationRevealed =
    reflections !== null && (reflections.skipped || reflectionsAnswered(reflections))
  const { warning } = useAdventure()

  const score = useMemo(() => (debrief ? computeScore(debrief) : null), [debrief])

  /**
   * Cold deep link to a debrief. The debrief normally arrives attached to the
   * final `/api/action` response, so a link pasted into another tab has nothing
   * to show. It is a pure function of the stored game server-side, so fetch it
   * rather than telling the reader the round is lost.
   */
  const setDebrief = useGameStore((s) => s.setDebrief)
  const hydrateFromServer = useGameStore((s) => s.hydrateFromServer)
  const recovered = useRef(false)
  /**
   * A cold `/debrief/<id>` — a pasted or shared link — has nothing in
   * sessionStorage, so it is re-fetched from the server. `GET
   * /api/game/:id/debrief` exists precisely so a debrief link is shareable
   * (see the route's own docstring), which means the RECOVERY SUCCEEDS.
   *
   * So the "this debrief is not in this tab" branch must not render while that
   * request is in flight. It used to, and the first thing a shared link showed
   * was a dead end that then resolved about a second later: an error screen
   * telling the reader to "refresh the tab that played it" — for a link nobody
   * had played. `recovering` distinguishes "we do not have this and never
   * will" from "we do not have this YET", and only the first may be an error.
   */
  const [recovering, setRecovering] = useState(hydrated && (storeGameId !== gameId || !debrief))
  useEffect(() => {
    if (!hydrated || recovered.current) return
    if (storeGameId === gameId && debrief) {
      recovered.current = true
      setRecovering(false)
      return
    }
    recovered.current = true
    setRecovering(true)
    const controller = new AbortController()
    void (async () => {
      const game = await getGame(gameId, controller.signal)
      if (game) hydrateFromServer(game)
      const result = await getDebrief(gameId, controller.signal)
      if (result) setDebrief(result)
      setRecovering(false)
    })()
    return () => controller.abort()
  }, [hydrated, gameId, storeGameId, debrief, hydrateFromServer, setDebrief])

  const playNewVersion = (): void => {
    if (!lastIntent) return
    setBusy(true)
    // Omitting the seed is the contract's "Retry with New Game": a fresh
    // instance and a freshly themed spec, landing on a new /play route.
    void generate(
      { problemId: lastIntent.problemId, difficulty: lastIntent.difficulty, freeText: lastIntent.freeText, forceTemplate: lastIntent.forceTemplate },
      { newSeed: true },
    ).then((newId) => {
      setBusy(false)
      if (newId) router.push(`/play/${newId}`)
    })
  }

  if (!hydrated || recovering) {
    return (
      <ThemeScope>
        <main className="mx-auto max-w-3xl px-4 py-16">
          <div className="h-8 w-1/2 animate-pulse rounded bg-[var(--dsa-border)]" />
          <span className="sr-only">Loading the debrief…</span>
        </main>
      </ThemeScope>
    )
  }

  if (storeGameId !== gameId || !spec || !state || !debrief || !score) {
    return (
      <ThemeScope>
        <main className="mx-auto max-w-2xl px-4 py-16">
          <Panel title="This debrief is no longer available">
            {/* The copy used to claim the contract had no endpoint to read a
                finished game back. It has one — `GET /api/game/:id/debrief` —
                and this screen only appears when the re-fetch came back empty,
                which means the game aged out of the server's in-memory session
                store rather than that the debrief was never retrievable. Saying
                so is the difference between "try again" and "this is gone". */}
            <p className="text-sm text-[var(--dsa-muted)]">
              Games are held in memory for a few hours, so a debrief link stops working once its
              session expires. Nothing is wrong with your run — it just is not on the server any more.
              Play it again to get a fresh debrief.
            </p>
            {error && (
              <div className="mt-4">
                <ErrorState error={error} />
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => router.push('/')}>
                Pick a topic
              </Button>
              {lastIntent && (
                <Button onClick={() => router.push(`/problem/${lastIntent.problemId}`)}>Back to the problem</Button>
              )}
            </div>
          </Panel>
        </main>
      </ThemeScope>
    )
  }

  const won = debrief.phase === 'won'

  return (
    <ThemeScope spec={spec}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6">
        <header className="victory-scene"><RobotGuide>{won ? "Another big idea, discovered." : "Let’s explore what happened."}</RobotGuide>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={won ? 'success' : 'danger'}>{won ? 'Solved' : 'Ended'}</Chip>
                <Chip tone="primary">{spec.theme.title}</Chip>

              </div>
              <h1 className="mt-2 text-xl font-bold text-[var(--dsa-ink)] sm:text-2xl">
                {won ? 'Mission complete. Keep your curiosity.' : 'There’s a discovery in every attempt.'}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-[var(--dsa-muted)]">{spec.objective}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="btn" href={`/play/${gameId}`}>
                Back to the board
              </Link>
              <Button variant="primary" onClick={playNewVersion} disabled={busy}>
                {busy ? 'Generating…' : 'Play a new version of this game'}
              </Button>
            </div>
          </div>
        </header>

        <Link className="btn self-start" href="/">← Adventure map & collection</Link>
        {warning && <p className="storage-notice" role="status">Your stamp may not be saved in this browser.</p>}
        <div className="result-tabs" role="tablist" aria-label="Explore the algorithm">{(['replay', 'explanation', 'code'] as const).map((item, index) => <button key={item} id={`tab-${item}`} className="btn" role="tab" aria-selected={tab === item} aria-controls={`panel-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={event => {
          const tabs = ['replay', 'explanation', 'code'] as const
          const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1
          if (next >= 0) { event.preventDefault(); setTab(tabs[next]!); document.getElementById(`tab-${tabs[next]}`)?.focus() }
        }}>{item === 'replay' ? '↺ Replay your journey' : item === 'explanation' ? '✧ The big idea' : '{ } The real code'}</button>)}</div>
        <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
          {tab === 'replay' && <CanonicalCompare debrief={debrief} state={state} spec={spec} />}
          {tab === 'explanation' && (
            <div className="space-y-4">
              {!explanationRevealed && (
                <SelfExplanation
                  problemId={debrief.problemId}
                  gameId={gameId}
                  initial={reflections}
                  onReveal={setReflections}
                />
              )}
              {explanationRevealed ? (
                <ExplanationPanel debrief={debrief} reflections={reflections} />
              ) : (
                <p className="text-xs text-[var(--dsa-ink-faint)]">
                  The big idea unlocks after you put it in your own words — or skip, and it shows
                  right away. Nothing you write is scored.
                </p>
              )}
            </div>
          )}
          {tab === 'code' && <CodePanel debrief={debrief} />}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <AnswerCard debrief={debrief} />
            <ComplexityChips debrief={debrief} />
          </div>
          <aside className="min-w-0 space-y-4">
            <details className="adventure-drawer"><summary>Run details & score</summary><StatsPanel
              debrief={debrief}
              score={score}
              onNewGame={playNewVersion}
              newGameBusy={busy}
              newGameLabel="Play a new version of this game"
            /></details>
            {debrief.hintPool.length > 0 && (
              <Panel title="More clues to explore" subtitle="Written for this board.">
                <ul className="list-inside list-disc space-y-1 text-xs text-[var(--dsa-muted)]">
                  {debrief.hintPool.map((hint, index) => (
                    <li key={index}>{hint}</li>
                  ))}
                </ul>
              </Panel>
            )}
          </aside>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--dsa-border)] pt-4 text-xs text-[var(--dsa-ink-faint)]">
          <span>
            Problem <span className="mono">{debrief.problemId}</span> · seed{' '}
            <span className="mono">{state.seed}</span> · {state.instance.values.length} values
          </span>
          <Button variant="primary" onClick={playNewVersion} disabled={busy}>
            Play a new version of this game
          </Button>
        </footer>
      </div>
    </ThemeScope>
  )
}
