'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { CanonicalCompare } from '@/components/debrief/CanonicalCompare'
import { CodePanel } from '@/components/debrief/CodePanel'
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
import { PROVIDER_TIER_LABELS } from '@/lib/contract'
import { computeScore } from '@/lib/score'
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
  const usedTier = useGameStore((s) => s.usedTier)
  const lastIntent = useGameStore((s) => s.lastIntent)
  const storeGameId = useGameStore((s) => s.gameId)
  const generate = useGameStore((s) => s.generate)
  const [busy, setBusy] = useState(false)

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
  useEffect(() => {
    if (!hydrated || recovered.current) return
    if (storeGameId === gameId && debrief) {
      recovered.current = true
      return
    }
    recovered.current = true
    const controller = new AbortController()
    void (async () => {
      const game = await getGame(gameId, controller.signal)
      if (game) hydrateFromServer(game)
      const result = await getDebrief(gameId, controller.signal)
      if (result) setDebrief(result)
    })()
    return () => controller.abort()
  }, [hydrated, gameId, storeGameId, debrief, hydrateFromServer, setDebrief])

  const playNewVersion = (): void => {
    if (!lastIntent) return
    setBusy(true)
    // Omitting the seed is the contract's "Retry with New Game": a fresh
    // instance and a freshly themed spec, landing on a new /play route.
    void generate(
      { problemId: lastIntent.problemId, difficulty: lastIntent.difficulty, freeText: lastIntent.freeText },
      { newSeed: true },
    ).then((newId) => {
      setBusy(false)
      if (newId) router.push(`/play/${newId}`)
    })
  }

  if (!hydrated) {
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
          <Panel title="This debrief is not in this tab">
            <p className="text-sm text-[var(--dsa-muted)]">
              The debrief is produced by the final <span className="mono">/api/action</span> response and is kept
              in <span className="mono">sessionStorage</span>, because the contract has no endpoint to read a
              finished game back. Refresh the tab that played it, or generate a new game.
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
        <header className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={won ? 'success' : 'danger'}>{won ? 'Solved' : 'Ended'}</Chip>
                <Chip tone="primary">{spec.theme.title}</Chip>
                {usedTier && (
                  <Chip tone="muted">
                    generated by {PROVIDER_TIER_LABELS[usedTier] ?? usedTier}
                  </Chip>
                )}
              </div>
              <h1 className="mt-2 text-xl font-bold text-[var(--dsa-ink)] sm:text-2xl">
                {won ? 'Nice — here is the algorithm underneath.' : 'Here is what the algorithm would have done.'}
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

        <CanonicalCompare debrief={debrief} state={state} spec={spec} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <ExplanationPanel debrief={debrief} />
            <CodePanel debrief={debrief} />
          </div>
          <aside className="min-w-0 space-y-4">
            <AnswerCard debrief={debrief} />
            <ComplexityChips debrief={debrief} />
            <StatsPanel
              debrief={debrief}
              score={score}
              onNewGame={playNewVersion}
              newGameBusy={busy}
              newGameLabel="Play a new version of this game"
            />
            {debrief.hintPool.length > 0 && (
              <Panel title="Hints you did not need" subtitle="Written for this board.">
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
