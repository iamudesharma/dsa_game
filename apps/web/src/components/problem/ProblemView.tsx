'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogueResponse, DecideResponse, Difficulty, GenerateResponse } from '@dsa/game-schema'

import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorState } from '@/components/ui/ErrorState'
import { Panel } from '@/components/ui/Panel'
import { GeneratingSkeleton } from '@/components/ui/Skeleton'
import { DsaApiError, getCatalogue, postDecide, postGenerate } from '@/lib/api'
import { DIFFICULTIES, PROVIDER_TIER_LABELS } from '@/lib/contract'
import { cn } from '@/lib/format'
import { useGameStore } from '@/store/game'

/**
 * Problem detail + generation.
 *
 * The free-text box is wired twice on purpose: once to `/api/decide` for an
 * immediate acknowledgement ("I heard you, I'll aim for X"), and once as
 * `GenerateRequest.freeText` so the Laya/LLM layer can actually steer the theme.
 * Deciding without steering would be a cosmetic feature; steering without
 * acknowledging would feel like the input was ignored.
 */
export function ProblemView({ problemId }: { problemId: string }) {
  const router = useRouter()
  const [problem, setProblem] = useState<CatalogueResponse['topics'][number]['problems'][number] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null)
  const [freeText, setFreeText] = useState('')
  const [decision, setDecision] = useState<DecideResponse | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<DsaApiError | null>(null)
  const [result, setResult] = useState<GenerateResponse | null>(null)
  const [forceTemplate, setForceTemplate] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const hydrate = useGameStore((s) => s.hydrateFromGenerate)

  useEffect(() => {
    const controller = new AbortController()
    setProblem(null)
    setNotFound(false)
    getCatalogue(controller.signal)
      .then((cat) => {
        for (const topic of cat.topics) {
          const found = topic.problems.find((p) => p.id === problemId)
          if (found) {
            setProblem(found)
            setDifficulty(found.defaultDifficulty)
            return
          }
        }
        setNotFound(true)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(
          cause instanceof DsaApiError
            ? cause
            : new DsaApiError({
                kind: 'unknown',
                code: 'UNEXPECTED',
                message: 'Could not load the problem list.',
                retryable: true,
              }),
        )
      })
    return () => controller.abort()
  }, [problemId, reloadToken])

  const askLaya = async (): Promise<void> => {
    const text = freeText.trim()
    if (!text) return
    setDeciding(true)
    try {
      const res = await postDecide({
        kind: 'pick-theme',
        stateText: `The player is about to generate a game for problem "${problem?.title ?? problemId}". Their wish: ${text}`,
        options: {
          accept: 'Use this wish as the theme and difficulty',
          adapt: 'Use it as flavour but keep the mechanics the algorithm needs',
          decline: 'Ignore it and use the default theme',
        },
        instructions:
          'Choose whether the free-text wish can be honoured, adapted, or must be declined, given that a DSA oracle validates every move. Never sacrifice mechanical correctness for flavour.',
      })
      setDecision(res)
    } catch (cause) {
      // A failed advisory call must never block generating: the wish still
      // travels to the generator via `freeText`.
      setDecision(null)
      setError(cause instanceof DsaApiError ? cause : null)
    } finally {
      setDeciding(false)
    }
  }

  const generate = async (): Promise<void> => {
    setGenerating(true)
    setError(null)
    try {
      const res = await postGenerate({
        problemId,
        ...(difficulty ? { difficulty } : {}),
        ...(freeText.trim() ? { freeText: freeText.trim() } : {}),
        ...(forceTemplate ? { forceTemplate: true } : {}),
      })
      setResult(res)
      hydrate({
        gameId: res.gameId,
        spec: res.spec,
        state: res.state,
        usedTier: res.usedTier,
        attempts: res.attempts,
        notes: res.notes,
        intent: { problemId, difficulty: difficulty ?? undefined, freeText: freeText.trim() || undefined, seed: res.seed },
      })
      router.push(`/play/${res.gameId}`)
    } catch (cause) {
      setError(
        cause instanceof DsaApiError
          ? cause
          : new DsaApiError({
              kind: 'unknown',
              code: 'UNEXPECTED',
              message: cause instanceof Error ? cause.message : 'Generation failed.',
              retryable: true,
            }),
      )
      setGenerating(false)
    }
  }

  const mechanicsList = useMemo(() => problem?.allowedMechanics ?? [], [problem])

  if (notFound) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState
          error={
            new DsaApiError({
              kind: 'http',
              code: 'UNKNOWN_PROBLEM',
              message: `"${problemId}" is not in the problem registry.`,
              status: 404,
              retryable: false,
            })
          }
        />
      </main>
    )
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8">
      <nav className="text-xs text-[var(--dsa-ink-faint)]">
        <a href="/" className="hover:text-[var(--dsa-accent)]">
          All topics
        </a>
      </nav>

      {error && (
        <ErrorState
          error={error}
          onRetry={() => {
            if (problem) void generate()
            else setReloadToken((token) => token + 1)
          }}
          retryLabel="Try again"
        />
      )}

      {!problem ? (
        <div className="panel space-y-4 p-5" role="status" aria-live="polite">
          <div className="h-7 w-1/2 animate-pulse rounded bg-[var(--dsa-border)]" />
          <div className="h-3 w-full animate-pulse rounded bg-[var(--dsa-border)]" />
          <span className="sr-only">Loading the problem…</span>
        </div>
      ) : (
        <>
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="primary">{problem.topic}</Chip>
                  <Chip tone="muted">{problem.id}</Chip>
                </div>
                <h1 className="mt-2 text-2xl font-bold text-[var(--dsa-ink)] sm:text-3xl">{problem.title}</h1>
                <p className="mt-2 max-w-2xl text-sm text-[var(--dsa-muted)]">{problem.learningObjective}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Chip tone="accent">
                  time <span className="mono">{problem.complexity.time}</span>
                </Chip>
                <Chip tone="accent">
                  space <span className="mono">{problem.complexity.space}</span>
                </Chip>
              </div>
            </div>
          </Panel>

          <Panel title="The canonical algorithm" subtitle="What your game will be a playable version of.">
            <pre className="mono prose-block text-sm">{problem.canonicalAlgorithm}</pre>
          </Panel>

          <Panel
            title="What will you play?"
            subtitle="Optional. Sent to the decision layer and to the generator as theme steering."
          >
            <label className="block">
              <span className="sr-only">What do you want to play?</span>
              <textarea
                className="input min-h-20 resize-y"
                value={freeText}
                maxLength={400}
                placeholder="e.g. a haunted library where I sort the books, on hard"
                onChange={(e) => setFreeText(e.target.value)}
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={deciding || freeText.trim() === ''} onClick={() => void askLaya()}>
                {deciding ? 'Asking…' : 'Ask what is possible'}
              </Button>
              <span className="text-[0.65rem] text-[var(--dsa-ink-faint)]">{freeText.length}/400</span>
            </div>
            {decision && (
              <div
                className={cn(
                  'mt-3 rounded-lg border p-3 text-sm',
                  decision.choice === 'decline'
                    ? 'border-[color-mix(in_oklab,var(--dsa-danger)_40%,var(--dsa-border))] text-[var(--dsa-ink)]'
                    : 'border-[color:color-mix(in_oklab,var(--dsa-success)_40%,var(--dsa-border))] text-[var(--dsa-ink)]',
                )}
              >
                <p>
                  <span className="font-semibold">{decision.choice}</span>
                  <span className="text-[var(--dsa-muted)]">
                    {' '}
                    — {decision.choice === 'accept'
                      ? 'the theme will follow your wish.'
                      : decision.choice === 'adapt'
                        ? 'the mechanics stay correct; your wish becomes the flavour.'
                        : 'that wish conflicts with the algorithm, so the default theme is used.'}
                  </span>
                </p>
                <p className="mono mt-1 text-[0.6rem] text-[var(--dsa-ink-faint)]">
                  {decision.source === 'laya' ? 'Laya' : 'heuristic'} · confidence{' '}
                  {Math.round(decision.confidence * 100)}%
                </p>
              </div>
            )}
          </Panel>

          <Panel title="Difficulty" subtitle="Controls instance length and how much slack the oracle gives.">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Difficulty">
              {DIFFICULTIES.map((level) => (
                <Button
                  key={level}
                  size="sm"
                  variant={difficulty === level ? 'primary' : 'default'}
                  onClick={() => setDifficulty(level)}
                  aria-pressed={difficulty === level}
                >
                  {level}
                </Button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-[var(--dsa-muted)]">
                <input
                  type="checkbox"
                  checked={forceTemplate}
                  onChange={(e) => setForceTemplate(e.target.checked)}
                />
                Skip the LLM tiers (instant, plainer theme)
              </label>
            </div>
            <p className="mt-2 text-[0.65rem] text-[var(--dsa-ink-faint)]">
              Mechanics available for this problem:{' '}
              {mechanicsList.map((m) => (
                <span key={m} className="mono">
                  {m}{' '}
                </span>
              ))}
            </p>
          </Panel>

          {generating ? (
            <Panel title="Generating your game">
              <GeneratingSkeleton label="Writing a theme, choosing the mechanics, and building the board. Tier 1 is a language model, so give it a few seconds." />
            </Panel>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={() => void generate()}>
                Generate game
              </Button>
              <span className="text-xs text-[var(--dsa-ink-faint)]">
                {difficulty ? `${difficulty} · ` : ''}
                {forceTemplate ? 'template tier' : 'best available tier'}
              </span>
            </div>
          )}

          {result && (
            <Panel title="Last generated" subtitle="Kept visible so the provider behind a game is never a mystery.">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="success">{PROVIDER_TIER_LABELS[result.usedTier] ?? result.usedTier}</Chip>
                <Chip tone="muted">seed {result.seed}</Chip>
                <Chip tone="muted">
                  {result.attempts.length} attempt{result.attempts.length === 1 ? '' : 's'}
                </Chip>
                <Chip tone="muted">{result.spec.mechanics.length} mechanics</Chip>
              </div>
              {result.notes.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-[var(--dsa-muted)]">
                  {result.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </>
      )}
    </main>
  )
}
