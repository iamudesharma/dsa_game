'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { CatalogueResponse, HealthResponse, ProviderTier } from '@dsa/game-schema'

import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorState } from '@/components/ui/ErrorState'
import { Panel } from '@/components/ui/Panel'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusRow } from '@/components/ui/Status'
import { DsaApiError, getCatalogue, getHealth } from '@/lib/api'
import { PROVIDER_TIER_LABELS, topicLabel } from '@/lib/contract'
import { formatDuration } from '@/lib/format'

/**
 * Home: pick a topic.
 *
 * The status strip is not decoration. This app has a four-step provider
 * cascade and a local decision model behind it, and knowing which tier will
 * actually serve you explains why a generation takes three seconds or thirty
 * milliseconds. It also gives the player an honest reason to retry with the
 * template tier when tier 1 is down.
 */
export function HomeView() {
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<DsaApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.all([getCatalogue(controller.signal), getHealth(controller.signal)])
      .then(([cat, hp]) => {
        setCatalogue(cat)
        setHealth(hp)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(
          cause instanceof DsaApiError
            ? cause
            : new DsaApiError({
                kind: 'unknown',
                code: 'UNEXPECTED',
                message: cause instanceof Error ? cause.message : 'Could not load the catalogue.',
                retryable: true,
              }),
        )
        setLoading(false)
      })
    return () => controller.abort()
  }, [reloadToken])

  const reload = (): void => setReloadToken((token) => token + 1)

  // `/api/catalogue` reports `{ tier, available }`; `/api/health` adds `detail`.
  // Widen explicitly so both can feed the same strip.
  const tiers: { tier: ProviderTier; available: boolean; detail?: string }[] =
    health?.tiers ?? catalogue?.tiers ?? []
  const laya: { enabled: boolean; available: boolean; detail?: string } | undefined =
    health?.laya ?? catalogue?.laya
  const bestTier = tiers.find((t) => t.tier === 'opencode' && t.available)?.tier ?? null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="max-w-3xl">
        <Chip tone="primary">learn by playing</Chip>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--dsa-ink)] sm:text-4xl">
          Learn the algorithm by playing it.
        </h1>
        <p className="mt-2 text-base text-[var(--dsa-muted)]">
          Pick a data structure. The server generates a themed mini-game that <em>is</em> the algorithm — you
          make the comparisons, swaps, pushes and branches that the code would make, and when you finish you get
          the replay, the pseudocode, and the real code side by side.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {error && !catalogue && <ErrorState error={error} onRetry={reload} />}

          {loading && !catalogue && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="status" aria-live="polite">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="panel space-y-3 p-4">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ))}
              <span className="sr-only">Loading topics…</span>
            </div>
          )}

          {catalogue && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {catalogue.topics.map((topic) => (
                <li key={topic.id} className="panel flex flex-col p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold text-[var(--dsa-ink)]">
                      {topicLabel(topic.id, topic.label)}
                    </h2>
                    <span className="mono text-[0.65rem] text-[var(--dsa-ink-faint)]">
                      {topic.problems.length} problem{topic.problems.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="mt-2 flex-1 space-y-1.5">
                    {topic.problems.map((problem) => (
                      <li key={problem.id}>
                        <Link
                          href={`/problem/${problem.id}`}
                          className="group flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[color-mix(in_oklab,var(--dsa-primary)_16%,transparent)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-[var(--dsa-ink)] group-hover:text-[var(--dsa-accent)]">
                              {problem.title}
                            </span>
                            <span className="mono block text-[0.6rem] text-[var(--dsa-ink-faint)]">
                              {problem.complexity.time} time · {problem.complexity.space} space
                            </span>
                          </span>
                          <Chip tone={problem.defaultDifficulty === 'easy' ? 'success' : 'muted'}>
                            {problem.defaultDifficulty}
                          </Chip>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel
            title="Service status"
            subtitle="Which provider will write your game spec."
            action={
              <Button size="sm" variant="ghost" onClick={reload} aria-label="Refresh service status">
                ↻
              </Button>
            }
          >
            {health === null && loading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : (
              <>
                <ul>
                  {tiers.map((tier) => (
                    <li key={tier.tier}>
                      <StatusRow
                        label={
                          <span className="truncate">
                            {PROVIDER_TIER_LABELS[tier.tier as ProviderTier] ?? tier.tier}
                          </span>
                        }
                        ok={tier.available}
                        detail={tier.detail}
                      />
                    </li>
                  ))}
                </ul>
                <div className="mt-2 border-t border-[var(--dsa-border)] pt-2">
                  <StatusRow
                    label="Laya (decision sidecar)"
                    ok={Boolean(laya?.available)}
                    detail={laya?.detail}
                  />
                </div>
                <p className="mt-3 text-[0.65rem] text-[var(--dsa-ink-faint)]">
                  {bestTier
                    ? `Games will be written by ${
                        PROVIDER_TIER_LABELS[bestTier] ?? bestTier
                      }. Expect a few seconds.`
                    : 'Only the offline template tier is available, so games will be instant and plain — but fully playable.'}
                  {health && <> · up {formatDuration(health.uptimeSec)} · v{health.version}</>}
                </p>
              </>
            )}
          </Panel>

          <Panel title="How it works">
            <ol className="list-inside list-decimal space-y-1.5 text-xs text-[var(--dsa-muted)]">
              <li>You pick a problem; a provider themes it into a board.</li>
              <li>You make the algorithm&apos;s moves — the oracle checks every one.</li>
              <li>Wrong moves teach: you see the expected operation immediately.</li>
              <li>The debrief replays your run against the reference and shows the code.</li>
            </ol>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
