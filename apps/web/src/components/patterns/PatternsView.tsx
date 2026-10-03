'use client'

import Link from 'next/link'
import { useMemo, useState, useEffect } from 'react'
import { getProblem, TOPIC_LESSONS } from '@dsa/game-schema'
import { Chip } from '@/components/ui/Chip'
import { Panel } from '@/components/ui/Panel'
import { useAdventure } from '@/components/adventure/AdventureProvider'
import { chatLink } from '@/lib/learning-api'
import { DSA_PATTERNS } from '@/lib/patterns'

/**
 * The 20-pattern library: when to use it, the reusable template, LeetCode
 * practice references, and a straight line into every playable game.
 */
export function PatternsView() {
  const [filter, setFilter] = useState('')
  useEffect(()=>{const p=new URLSearchParams(window.location.search);setFilter(p.get('q')??'');setCompletion(p.get('completion')??'all')},[])
  const filters=(q:string,c:string)=>window.history.replaceState(null,'',`/patterns?${new URLSearchParams({q,completion:c})}`)
  const [completion, setCompletion] = useState('all')
  const { progress } = useAdventure()
  const patterns = useMemo(() => {
    const text = filter.trim().toLowerCase()
    const eligible = DSA_PATTERNS.filter(p => completion === 'all' || (completion === 'done' ? p.playIds.length > 0 && p.playIds.every(id => progress.completed[id]) : !p.playIds.length || p.playIds.some(id => !progress.completed[id])))
    if (!text) return eligible
    return eligible.filter(
      (p) =>
        p.name.toLowerCase().includes(text) ||
        p.whenToUse.toLowerCase().includes(text) ||
        p.leetcode.some((ref) => ref.name.toLowerCase().includes(text)),
    )
  }, [filter, completion, progress.completed])

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
            onChange={(e) => {setFilter(e.target.value);filters(e.target.value,completion)}}
          />
        </label>
<label className="block mt-2">Completion<select className="input" value={completion} onChange={e => {setCompletion(e.target.value);filters(filter,e.target.value)}}><option value="all">All patterns</option><option value="new">Not completed</option><option value="done">Games completed</option></select></label>
        <p className="mt-2 text-xs text-[var(--dsa-ink-faint)]">
          {patterns.length} of {DSA_PATTERNS.length} patterns · {DSA_PATTERNS.filter((p) => p.playIds.length > 0).length} playable here
        </p>
      </Panel>

      {patterns.map((pattern) => (
        <details id={pattern.id} key={pattern.id} className="adventure-drawer">
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
<Link className="btn mb-3" href={chatLink(`Explain the ${pattern.name} pattern: ${pattern.whenToUse}. Include an example and code.`)}>Explain in Chat</Link><a className="btn mb-3 ml-2" href={`#${pattern.id}`}>Link to this pattern</a>
            <p className="text-sm text-[var(--dsa-muted)]">{pattern.whenToUse}</p>
            {TOPIC_LESSONS.find(l=>l.topic===getProblem(pattern.playIds[0]??'')?.topic) && <p className="mt-3 text-sm"><strong>Foundation example: </strong>{TOPIC_LESSONS.find(l=>l.topic===getProblem(pattern.playIds[0]??'')?.topic)?.example}</p>}
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
