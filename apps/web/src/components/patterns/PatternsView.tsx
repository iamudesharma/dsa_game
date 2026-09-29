'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { getProblem } from '@dsa/game-schema'
import { Chip } from '@/components/ui/Chip'
import { Panel } from '@/components/ui/Panel'
import { DSA_PATTERNS } from '@/lib/patterns'

/**
 * The 20-pattern library: when to use it, the reusable template, LeetCode
 * practice references, and a straight line into every playable game.
 */
export function PatternsView() {
  const [filter, setFilter] = useState('')
  const patterns = useMemo(() => {
    const text = filter.trim().toLowerCase()
    if (!text) return DSA_PATTERNS
    return DSA_PATTERNS.filter(
      (p) =>
        p.name.toLowerCase().includes(text) ||
        p.whenToUse.toLowerCase().includes(text) ||
        p.leetcode.some((ref) => ref.name.toLowerCase().includes(text)),
    )
  }, [filter])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8">
      <nav className="text-xs text-[var(--dsa-ink-faint)]">
        <Link href="/" className="hover:text-[var(--dsa-accent)]">
          ← Adventure map
        </Link>
      </nav>

      <Panel
        title="20 patterns that cover LeetCode"
        subtitle="Recognise the pattern and you recognise the approach — even for questions you have never seen. Playable patterns link straight into a game."
      >
        <label className="block">
          <span className="sr-only">Filter patterns</span>
          <input
            className="input"
            value={filter}
            maxLength={80}
            placeholder="Filter: e.g. window, tree, heap…"
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <p className="mt-2 text-xs text-[var(--dsa-ink-faint)]">
          {patterns.length} of {DSA_PATTERNS.length} patterns · {DSA_PATTERNS.filter((p) => p.playIds.length > 0).length} playable here
        </p>
      </Panel>

      {patterns.map((pattern) => (
        <details key={pattern.id} className="adventure-drawer">
          <summary>
            {pattern.name}{' '}
            <span>
              {pattern.playIds.length > 0 ? (
                <Chip tone="success">{pattern.playIds.length} playable</Chip>
              ) : (
                <Chip tone="muted">study only</Chip>
              )}
            </span>
          </summary>
          <div className="p-4">
            <p className="text-sm text-[var(--dsa-muted)]">{pattern.whenToUse}</p>
            <pre className="mono prose-block mt-3 text-sm">{pattern.template}</pre>
            {pattern.playIds.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pattern.playIds.map((id) => (
                  <Link key={id} href={`/problem/${id}`} className="btn btn-primary">
                    Play: {getProblem(id)?.title ?? id} →
                  </Link>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-[var(--dsa-muted)]">
              Practice on LeetCode:{' '}
              {pattern.leetcode.map((ref) => (
                <span key={ref.n} className="mono">
                  #{ref.n} {ref.name}
                  {' · '}
                </span>
              ))}
            </p>
            <a
              href={pattern.deepDive}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-[var(--dsa-accent)] underline-offset-4 hover:underline"
            >
              Deep dive ↗
            </a>
          </div>
        </details>
      ))}

      {patterns.length === 0 && (
        <Panel title="No patterns match" subtitle="Try a shorter filter — a single word like “tree” or “window”.">
          <p className="text-sm text-[var(--dsa-muted)]">Nothing in the library mentions “{filter.trim()}”.</p>
        </Panel>
      )}
    </main>
  )
}
