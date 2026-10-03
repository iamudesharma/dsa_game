'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CatalogueResponse, DecideResponse, Difficulty, GenerateResponse } from '@dsa/game-schema'

import { WorldScene, RobotGuide } from '@/components/adventure/WorldScene'
import { worldForProblem } from '@/lib/adventure'
import type { CSSProperties } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorState } from '@/components/ui/ErrorState'
import { Panel } from '@/components/ui/Panel'
import { GeneratingSkeleton } from '@/components/ui/Skeleton'
import { chatLink } from '@/lib/learning-api'
import { DsaApiError, getCatalogue, postDecide, postGenerate } from '@/lib/api'
import { DIFFICULTIES, PROVIDER_TIER_LABELS } from '@/lib/contract'
import { cn } from '@/lib/format'
import { getLinkedListQuestion } from '@/lib/linked-list-learning'
import { resourcesForProblem } from '@/lib/resources'
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
export function ProblemView({
  problemId,
  questionId,
  initialDifficulty,
}: {
  problemId: string
  questionId?: string
  initialDifficulty?: Difficulty
}) {
  const router = useRouter()
  const generationController = useRef<AbortController | null>(null)
  useEffect(() => () => generationController.current?.abort(), [])
  const [problem, setProblem] = useState<CatalogueResponse['topics'][number]['problems'][number] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null)
  const [freeText, setFreeText] = useState('')
  const [decision, setDecision] = useState<DecideResponse | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null)
  const [genElapsedSec, setGenElapsedSec] = useState(0)
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
            setDifficulty(initialDifficulty ?? found.defaultDifficulty)
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
  }, [problemId, reloadToken, initialDifficulty])

  // Truthful waiting status: generation is one opaque server round-trip, so the
  // only honest live facts are that the request is in flight and how long it
  // has taken. Anything naming a specific tier mid-flight would be invented —
  // the tier report arrives with the response and is shown under "Last
  // generated" below.
  useEffect(() => {
    if (!generating || genStartedAt === null) return
    const id = window.setInterval(() => {
      setGenElapsedSec(Math.floor((Date.now() - genStartedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [generating, genStartedAt])

  useEffect(() => {
    if (!generating) {
      setGenStartedAt(null)
      setGenElapsedSec(0)
    }
  }, [generating])

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

  const generate = async (instant = forceTemplate): Promise<void> => {
    generationController.current?.abort()
    const controller = new AbortController()
    generationController.current = controller
    setGenerating(true)
    setGenStartedAt(Date.now())
    setGenElapsedSec(0)
    setError(null)
    try {
      const res = await postGenerate({
        problemId,
        ...(difficulty ? { difficulty } : {}),
        ...(freeText.trim() ? { freeText: freeText.trim() } : {}),
        ...(instant ? { forceTemplate: true } : {}),
      }, controller.signal)
      if (controller.signal.aborted) return
      setResult(res)
      hydrate({
        gameId: res.gameId,
        spec: res.spec,
        state: res.state,
        usedTier: res.usedTier,
        attempts: res.attempts,
        notes: res.notes,
        intent: { problemId, difficulty: difficulty ?? undefined, freeText: freeText.trim() || undefined, seed: res.seed, forceTemplate },
        turnPrompt: res.turnPrompt,
      })
      router.push(`/play/${res.gameId}`)
    } catch (cause) {
      if (controller.signal.aborted) return
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
  const linkedListQuestion = getLinkedListQuestion(questionId)
  const activeQuestion = linkedListQuestion?.gameProblemId === problemId ? linkedListQuestion : undefined
  const resources = useMemo(() => resourcesForProblem(problemId), [problemId])
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
          ← Adventure map
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
          <section className="mission-preview" style={{ '--world-color': worldForProblem(problemId).color, '--world-pale': worldForProblem(problemId).pale } as CSSProperties}><div><p className="eyebrow">MISSION BRIEFING · {problem.topic}</p><h2>{worldForProblem(problemId).name}</h2></div><WorldScene world={worldForProblem(problemId)} compact/></section>
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="primary">{problem.topic}</Chip>
                  
                </div>
                <h1 className="mt-2 text-2xl font-bold text-[var(--dsa-ink)] sm:text-3xl">{problem.title}</h1>
                <Link className="btn mt-3" href={chatLink(`Explain ${problem.title} with an example.`,{type:'problem',problemId})}>Ask about this problem</Link>
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

          <section className="panel p-4"><h2 className="font-bold">How practice changes</h2><p className="text-sm">Low uses a smaller instance; medium increases the work; high uses a larger instance to test the same rule. Hints remain available.</p></section>
          <details className="adventure-drawer"><summary>Peek inside the algorithm</summary><div className="p-4">
            <pre className="mono prose-block text-sm">{problem.canonicalAlgorithm}</pre></div></details>

          <details className="adventure-drawer"><summary>Study resources · {resources.patterns.length > 0 ? `${resources.patterns.length} pattern${resources.patterns.length === 1 ? '' : 's'}` : 'foundations drill'}{resources.trackMentions.length > 0 ? ` · stamps ${resources.trackMentions.length} classic${resources.trackMentions.length === 1 ? '' : 's'}` : ''}</summary><div className="p-4">
            {resources.patterns.length > 0 ? (
              <ul className="space-y-3">
                {resources.patterns.map((pattern) => (
                  <li key={pattern.id} className="text-sm">
                    <Link href={`/patterns#${pattern.id}`} className="font-semibold text-[var(--dsa-accent)] underline-offset-4 hover:underline">
                      {pattern.name}
                    </Link>
                    <span className="text-[var(--dsa-muted)]"> — the reusable approach this game trains. </span>
                    <a
                      href={pattern.deepDive}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--dsa-accent)] underline-offset-4 hover:underline"
                    >
                      Deep dive ↗
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--dsa-muted)]">
                A foundations drill: it teaches the moves other patterns build on, so no pattern claims it. The classics below still stamp it.
              </p>
            )}
            {resources.trackMentions.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-[var(--dsa-ink)]">Stamps these Interview Classics</p>
                <ul className="mt-1 space-y-1">
                  {resources.trackMentions.map((mention) => (
                    <li key={`${mention.category}-${mention.n}`} className="text-xs text-[var(--dsa-muted)]">
                      <span className="mono">#{mention.n} {mention.name}</span>
                      <span> · {mention.category} · </span>
                      <Link href="/tracks" className="text-[var(--dsa-accent)] underline-offset-4 hover:underline">
                        view track ↗
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}</div></details>

          {activeQuestion && (
            <Panel
              title={`Question: ${activeQuestion.title}`}
              subtitle="Solve this prompt by carrying out the algorithm on a generated linked list."
            >
              <p className="text-sm text-[var(--dsa-muted)]">{activeQuestion.prompt}</p>
              <p className="mt-2 text-xs text-[var(--dsa-ink-faint)]">
                {activeQuestion.objective} The board grows with the difficulty you choose; every move is checked by the linked-list oracle.
              </p>
              <a href="/learn/linked-list" className="mt-3 inline-block text-xs text-[var(--dsa-accent)] underline-offset-4 hover:underline">
                Back to the lesson and code examples
              </a>
            </Panel>
          )}

          <details className="adventure-drawer"><summary>Make it your story · optional</summary><div className="p-4">
            <label className="block">
              <span className="sr-only">What do you want to play?</span>
              <textarea
                className="input min-h-20 resize-y"
                value={freeText}
                maxLength={400}
                placeholder="e.g. a haunted library where I sort the books, on high"
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
          </div></details>

          <Panel title="Choose your challenge" subtitle="Low, medium, and high generate short, standard, and longer game instances.">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Difficulty">
              {DIFFICULTIES.map((level) => (
                <Button
                  key={level}
                  size="sm"
                  variant={difficulty === level ? 'primary' : 'default'}
                  onClick={() => setDifficulty(level)}
                  aria-pressed={difficulty === level}
                >
                  {level === 'easy' ? 'low' : level === 'hard' ? 'high' : 'medium'}
                </Button>
              ))}
            </div>
            <details className="mt-4 adventure-drawer"><summary>Generation settings</summary><div className="p-4">
              <label className="flex items-center gap-2 text-xs text-[var(--dsa-muted)]">
                <input
                  type="checkbox"
                  checked={forceTemplate}
                  onChange={(e) => setForceTemplate(e.target.checked)}
                />
                Use an instant template adventure
              </label>
            <p className="mt-2 text-[0.65rem] text-[var(--dsa-ink-faint)]">
              Mechanics available for this problem:{' '}
              {mechanicsList.map((m) => (
                <span key={m} className="mono">
                  {m}{' '}
                </span>
              ))}
            </p></div></details>
          </Panel>

          {generating ? (
            <Panel title="Building your little adventure"><div className="flex flex-wrap gap-2"><Button onClick={() => { generationController.current?.abort(); setGenerating(false) }}>Cancel</Button><Button onClick={() => void generate(true)}>Use instant template instead</Button></div><div className="scene-loading"><WorldScene world={worldForProblem(problemId)} compact/></div>
              <GeneratingSkeleton
                label={
                  forceTemplate
                    ? 'Building from the built-in template — no waiting on storytellers.'
                    : `Asking the storytellers, fastest first… (${genElapsedSec}s)`
                }
                detail={
                  forceTemplate
                    ? 'The template always works offline, so this is quick.'
                    : 'If every storyteller is busy, the built-in template finishes the job — your mission still opens.'
                }
              />
            </Panel>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" size="lg" onClick={() => void generate()}>
                Start mission →
              </Button>
              <span className="text-xs text-[var(--dsa-ink-faint)]">
          {difficulty ? `${difficulty === 'easy' ? 'low' : difficulty === 'hard' ? 'high' : 'medium'} · ` : ''}
                {forceTemplate ? 'instant adventure' : 'a fresh adventure'}
              </span>
            </div>
          )}

          <RobotGuide>Take your time. You can ask for a hint whenever you need one.</RobotGuide>
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
