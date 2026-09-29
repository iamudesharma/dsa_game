'use client'
import Link from 'next/link'
import { useEffect, useState, type CSSProperties } from 'react'
import type { CatalogueResponse, HealthResponse } from '@dsa/game-schema'
import { DsaApiError, getCatalogue, getHealth } from '@/lib/api'
import { WORLDS, completedWorlds, nextMission } from '@/lib/adventure'
import { useAdventure } from '@/components/adventure/AdventureProvider'
import { WorldScene, RobotGuide } from '@/components/adventure/WorldScene'
import { ErrorState } from '@/components/ui/ErrorState'
import { topicLabel, PROVIDER_TIER_LABELS } from '@/lib/contract'

export function HomeView() {
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthFailed, setHealthFailed] = useState(false)
  const [error, setError] = useState<DsaApiError | null>(null)
  const [reload, setReload] = useState(0)
  const { progress, ready, warning, selectFrame } = useAdventure()
  const badges = completedWorlds(progress)
  const next = nextMission(progress)
  const frame = WORLDS.find(w => w.id === progress.preferences.mapFrame)
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    setHealthFailed(false)
    void getCatalogue(controller.signal).then(setCatalogue).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof DsaApiError ? cause : new DsaApiError({ kind: 'unknown', code: 'CATALOGUE', message: 'The adventure map could not load.', retryable: true }))
    })
    void getHealth(controller.signal).then(setHealth).catch(() => { if (!controller.signal.aborted) setHealthFailed(true) })
    return () => controller.abort()
  }, [reload])
  return <main className="adventure-home" style={frame ? { '--map-frame': frame.color } as CSSProperties : undefined}>
    <nav className="adventure-nav" aria-label="Main navigation">
      <Link href="/" className="brand"><span className="brand-icon" aria-hidden="true">✦</span> PLAY THE ALGORITHMS</Link>
      <div className="flex flex-wrap gap-2"><Link href="/learn/linked-list" className="btn">Field notebook ↗</Link><Link href="/patterns" className="btn">Patterns ↗</Link><Link href="/tracks" className="btn">Tracks ↗</Link><a href="#collection" className="btn">✧ Collection · {Object.keys(progress.completed).length}/{catalogue?.topics.reduce((sum, t) => sum + t.problems.length, 0) ?? '…'}</a></div>
    </nav>
    <header className="adventure-hero">
      <div><p className="eyebrow">YOUR NEXT LITTLE BIG ADVENTURE</p><h1>Big ideas.<br/><span>Small adventures.</span></h1><p className="hero-copy">Swap, stack, search, and explore. Discover how algorithms work, one playful move at a time.</p>
        {catalogue && ready && <Link className="btn btn-primary hero-cta" href={next ? `/problem/${next.id}` : '/problem/array-max-min'}>{Object.keys(progress.completed).length ? 'Keep exploring' : 'Let’s play'} <span aria-hidden="true">→</span></Link>}
        <p className="hero-note">{WORLDS.length} worlds · {catalogue?.topics.reduce((sum, t) => sum + t.problems.length, 0) ?? '…'} missions · your own pace</p>
      </div>
      <div className="hero-diorama" aria-hidden="true"><span className="orbit-star star-one">✦</span><span className="orbit-star star-two">✧</span><div className="diorama-label">A WORLD OF AHA!</div><WorldScene world={WORLDS[0]!}/><div className="diorama-pieces"><span>3</span><span>1</span><span>7</span></div><RobotGuide/><span className="diorama-caption">Curiosity is your superpower.</span></div>
    </header>
    <section className="journey-heading"><div><p className="eyebrow">THE ADVENTURE MAP</p><h2>Where shall we go?</h2></div><p>Every world is open. Pick what sparks your curiosity.</p></section>
    {error && <ErrorState error={error} onRetry={() => setReload(r => r + 1)}/>}
    {!catalogue && !error && <div className="map-loading" role="status"><RobotGuide>Unfolding your adventure map…</RobotGuide></div>}
    <div className="world-map">
      {catalogue && WORLDS.map(world => {
        const topic = catalogue.topics.find(t => t.id === world.id)
        if (!topic) return null
        const count = topic.problems.filter(p => progress.completed[p.id]).length
        return <section key={world.id} className="world-island" style={{ '--world-color': world.color, '--world-pale': world.pale } as CSSProperties}>
          <div className="island-scenery"><span className="world-number">{world.mark}</span><WorldScene world={world}/><span className="world-completion">{count === topic.problems.length ? '★ World complete' : `${count}/${topic.problems.length} explored`}</span></div>
          <div className="island-content"><p className="eyebrow">{topicLabel(topic.id, topic.label)}</p><h3>{world.name}</h3><p className="world-subtitle">{world.subtitle}</p>
            <ul className="mission-list">{topic.problems.map((problem, index) => <li key={problem.id}><Link href={`/problem/${problem.id}`} className="mission-node"><span className={progress.completed[problem.id] ? 'mission-stamp solved' : 'mission-stamp'} aria-label={progress.completed[problem.id] ? 'Completed' : 'Available'}>{progress.completed[problem.id] ? '✓' : String(index + 1).padStart(2,'0')}</span><span>{problem.title}{next?.id === problem.id && <small>Suggested next adventure</small>}</span><span aria-hidden="true">↗</span></Link></li>)}</ul>
          </div>
        </section>
      })}
    </div>
    <details id="collection" className="adventure-drawer collection-drawer"><summary>✧ Your collection <span>{Object.keys(progress.completed).length} mission stamps · {badges.length} world badges</span></summary><div className="p-5"><RobotGuide>Every solved mission earns a stamp. Explore a whole world to collect its badge and map frame. Hints are always welcome.</RobotGuide><div className="collection-items">{WORLDS.map(w => <div key={w.id} className={badges.some(b => b.id === w.id) ? 'collection-badge earned' : 'collection-badge'}><span aria-hidden="true">{badges.some(b => b.id === w.id) ? '★' : '☆'}</span><strong>{w.name}</strong><small>{badges.some(b => b.id === w.id) ? 'Collected!' : 'Complete this world'}</small></div>)}</div><div className="flex flex-wrap gap-2" role="group" aria-label="Map frame"><button className="btn" aria-pressed={progress.preferences.mapFrame === 'default'} onClick={() => selectFrame('default')}>Original frame</button>{badges.map(w => <button key={w.id} className="btn" aria-pressed={progress.preferences.mapFrame === w.id} onClick={() => selectFrame(w.id)}>{w.name} frame</button>)}</div><p className="mt-4 text-sm">Saved in this browser. No account needed.</p></div></details>
    {warning && <p role="status" className="storage-notice">Progress storage is unavailable or was reset. You can keep playing; new stamps may not survive closing this browser.</p>}
    <footer className="adventure-footer"><p>Made for curious minds. Take your time.</p><details className="adventure-drawer"><summary>Connection & diagnostics</summary><div className="p-4 text-sm">{healthFailed && <p>Service status is unavailable. Missions can still be started.</p>}{(health?.tiers ?? catalogue?.tiers ?? []).map(t => <p key={t.tier}>{PROVIDER_TIER_LABELS[t.tier]} · {t.available ? 'Available' : 'Unavailable'}</p>)}<button className="btn mt-3" onClick={() => setReload(r => r + 1)}>Refresh connection</button></div></details></footer>
  </main>
}
