'use client'

import Link from 'next/link'
import { useMemo, useState, useEffect } from 'react'
import { getProblem } from '@dsa/game-schema'
import { chatLink } from '@/lib/learning-api'
import { Chip } from '@/components/ui/Chip'
import { Panel } from '@/components/ui/Panel'
import { useAdventure } from '@/components/adventure/AdventureProvider'
import { TRACKS, getTrack, trackItemDone, trackProgress } from '@/lib/tracks'

/**
 * Curated tracks: Blind 75 mapped to playable games, plus the full tour.
 * Progress is the adventure store's own completion map — a track item is done
 * when every game mapped to it is stamped complete.
 */
export function TracksView() {
  const [trackId, setTrackId] = useState<string>(TRACKS[0]?.id ?? 'interview-classics')
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get('track');if(id&&getTrack(id))setTrackId(id)},[])
  const { progress, ready } = useAdventure()
  const track = getTrack(trackId) ?? TRACKS[0]!
  const stats = useMemo(() => trackProgress(track, progress.completed), [track, progress.completed])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8">
      <nav className="text-xs text-[var(--dsa-ink-faint)]">
        <Link href="/" className="hover:text-[var(--dsa-accent)]">
          ← Adventure map
        </Link>
      </nav>

      <Panel
        title="Interview tracks"
        subtitle="Game completion stamps practice milestones; it does not certify independent interview readiness."
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Track">
          {TRACKS.map((t) => (
            <button
              key={t.id}
              className="btn"
              aria-pressed={trackId === t.id}
              onClick={() => {setTrackId(t.id);window.history.replaceState(null,'',`/tracks?track=${t.id}`)}}
            >
              {t.title}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--dsa-ink-faint)]">
          {track.subtitle}
        </p>
        {ready && (
          <p className="mt-2 text-sm text-[var(--dsa-ink)]">
            {stats.done} of {stats.playable} playable items stamped · {stats.total} total
          </p>
        )}
      </Panel>

      <Panel title="Next practice step">{(() => { const id = track.categories.flatMap(c => c.items).flatMap(i => i.playIds).find(id => !progress.completed[id]); return id ? <Link className="btn" href={`/problem/${id}`}>{getProblem(id)?.title} →</Link> : <p>All mapped games completed. Revisit them or practise explaining your solutions in Chat.</p> })()}</Panel>
      {track.categories.map((category) => {
        const done = category.items.filter((i) => trackItemDone(i.playIds, progress.completed)).length
        const playable = category.items.filter((i) => i.playIds.length > 0).length
        return (
          <details key={category.title} className="adventure-drawer" open={done < playable}>
            <summary>
              {category.title}{' '}
              <span>
                <Chip tone={done === playable && playable > 0 ? 'success' : 'muted'}>
                  {done}/{playable} playable
                </Chip>
              </span>
            </summary>
            <ul className="mission-list p-4">
              {category.items.map((item) => {
                const key = `${item.n}-${item.name}`
                const isDone = trackItemDone(item.playIds, progress.completed)
                return (
                  <li key={key} className="mission-node">
                    <span className={isDone ? 'mission-stamp solved' : 'mission-stamp'} aria-label={isDone ? 'Completed' : 'Available'}>
                      {isDone ? '✓' : '·'}
                    </span>
                    <span>
                      {item.n > 0 && <span className="mono text-xs">#{item.n} </span>}
                      {item.name}
                      {item.playIds.length === 0 && <small>Study question · written practice available in Chat</small>}
                    </span>
                    <Link className="btn text-xs" href={chatLink(`Teach me ${item.name}. Give an example, then ask me an interview question about it.`)}>Discuss</Link>
                    {item.playIds.length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {item.playIds.map((id) => (
                          <Link key={id} href={`/problem/${id}`} className="text-xs text-[var(--dsa-accent)] underline-offset-4 hover:underline">
                            {getProblem(id)?.title ?? id} ↗
                          </Link>
                        ))}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </details>
        )
      })}
    </main>
  )
}
