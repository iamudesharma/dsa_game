'use client'
import Link from 'next/link'
import { useEffect, useState, type CSSProperties } from 'react'
import { getProblem } from '@dsa/game-schema'
import { learningRequest, type LearningDashboard } from '@/lib/learning-api'
import type { CatalogueResponse, HealthResponse } from '@dsa/game-schema'
import { DsaApiError, getCatalogue, getHealth } from '@/lib/api'
import { WORLDS, completedWorlds, nextMission } from '@/lib/adventure'
import { useAdventure } from '@/components/adventure/AdventureProvider'
import { useAuth } from '@/components/auth/AuthProvider'
import { WorldScene, RobotGuide } from '@/components/adventure/WorldScene'
import { ErrorState } from '@/components/ui/ErrorState'
import { topicLabel, PROVIDER_TIER_LABELS } from '@/lib/contract'
import { ONBOARDING_TIPS, dismissOnboarding, resetOnboarding, shouldShowOnboarding } from '@/lib/onboarding'

export function HomeView() {
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthFailed, setHealthFailed] = useState(false)
  const [error, setError] = useState<DsaApiError | null>(null)
  const [reload, setReload] = useState(0)
  const [showTips, setShowTips] = useState(false)
  const [search, setSearch] = useState('')
  useEffect(() => { const q = new URLSearchParams(window.location.search); setSearch(q.get('q') ?? ''); setTopicFilter(q.get('topic') ?? 'all'); setCompletionFilter(q.get('completion') ?? 'all') }, [])
  const persistFilters = (q: string, topic: string, completion: string) => { const params = new URLSearchParams({q,topic,completion}); window.history.replaceState(null,'',`/?${params}`) }
  const [topicFilter, setTopicFilter] = useState('all')
  const [completionFilter, setCompletionFilter] = useState('all')
  const [ongoing, setOngoing] = useState<LearningDashboard['records'][number] | null>(null)
  const [suggestion, setSuggestion] = useState<LearningDashboard['recommendation']>(null)
  const { progress, ready, warning, selectFrame } = useAdventure()
  const { user, ready: authReady } = useAuth()
  const badges = completedWorlds(progress)
  const next = (user && suggestion ? getProblem(suggestion.problemId) : null) ?? nextMission(progress)
  useEffect(() => { let alive = true; setSuggestion(null); setOngoing(null); if (user) void learningRequest<LearningDashboard>('/dashboard').then(d => { if (alive) { setSuggestion(d.recommendation); setOngoing(d.records.find(r => r.outcome === 'playing') ?? null) } }).catch(() => {}); return () => { alive = false } }, [user?.id])
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
  // First visit only: the tips dismiss forever (see `lib/onboarding`), so a
  // returning learner never sees this strip again.
  useEffect(() => {
    setShowTips(shouldShowOnboarding())
  }, [])
  return <main className="adventure-home" style={frame ? { '--map-frame': frame.color } as CSSProperties : undefined}>
    <header className="adventure-hero">
      <div><p className="eyebrow">YOUR NEXT LITTLE BIG ADVENTURE</p><h1>Big ideas.<br/><span>Small adventures.</span></h1><p className="hero-copy">Swap, stack, search, and explore. Discover how algorithms work, one playful move at a time.</p>
        {catalogue && ready && <Link className="btn btn-primary hero-cta" href={next ? `/problem/${next.id}` : '/problem/array-max-min'}>{Object.keys(progress.completed).length ? 'Keep exploring' : 'Let’s play'} <span aria-hidden="true">→</span></Link>}
        <p className="hero-note">{WORLDS.length} worlds · {catalogue?.topics.reduce((sum, t) => sum + t.problems.length, 0) ?? '…'} missions · your own pace</p>
      </div>
      <div className="hero-diorama" aria-hidden="true"><span className="orbit-star star-one">✦</span><span className="orbit-star star-two">✧</span><div className="diorama-label">A WORLD OF AHA!</div><WorldScene world={WORLDS[0]!}/><div className="diorama-pieces"><span>3</span><span>1</span><span>7</span></div><RobotGuide/><span className="diorama-caption">Curiosity is your superpower.</span></div>
    </header>
    {ongoing && <section className="panel p-4"><h2 className="font-bold">Resume your run</h2><Link className="btn btn-primary mt-2" href={`/play/${ongoing.gameId}`}>{getProblem(ongoing.problemId)?.title} →</Link></section>}
    <section className="journey-heading"><div><p className="eyebrow">THE ADVENTURE MAP</p><h2>Where shall we go?</h2></div><p>Every world is open. Pick what sparks your curiosity.</p></section>
    {showTips && <section className="panel p-5" aria-label="How to play">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="eyebrow">FIRST VISIT · HOW TO PLAY</p><h2 className="text-lg font-bold text-[var(--dsa-ink)]">Three things, then go explore</h2></div>
        <button className="btn" onClick={() => { dismissOnboarding(); setShowTips(false) }}>Got it — hide these</button>
      </div>
      <ul className="mt-3 space-y-2">{ONBOARDING_TIPS.map(tip => <li key={tip.id} className="text-sm text-[var(--dsa-muted)]"><strong className="text-[var(--dsa-ink)]">{tip.title}.</strong> {tip.body}</li>)}</ul>
    </section>}
    {!showTips && <p className="px-1 text-xs text-[var(--dsa-ink-faint)]"><button className="underline underline-offset-4 hover:text-[var(--dsa-accent)]" onClick={() => { resetOnboarding(); setShowTips(true) }}>Show the how-to-play tips</button></p>}
    {error && <ErrorState error={error} onRetry={() => setReload(r => r + 1)}/>}
    {!catalogue && !error && <div className="map-loading" role="status"><RobotGuide>Unfolding your adventure map…</RobotGuide></div>}
    <div className="panel p-4 flex flex-wrap gap-3"><label>Search missions<input className="input" value={search} onChange={e => { setSearch(e.target.value); persistFilters(e.target.value,topicFilter,completionFilter) }} placeholder="Problem or topic" /></label><label>Topic<select className="input" value={topicFilter} onChange={e => { setTopicFilter(e.target.value); persistFilters(search,e.target.value,completionFilter) }}><option value="all">All topics</option>{WORLDS.map(w => <option key={w.id} value={w.id}>{w.id}</option>)}</select></label><label>Completion<select className="input" value={completionFilter} onChange={e => { setCompletionFilter(e.target.value); persistFilters(search,topicFilter,e.target.value) }}><option value="all">All missions</option><option value="new">Not completed</option><option value="done">Completed</option></select></label></div>
    {user && suggestion && <p className="text-sm px-2">Suggested next: {suggestion.reason}</p>}
    <div className="flex flex-wrap gap-2"><Link className="btn" href="/patterns">Learn a concept</Link><a className="btn" href="#mission-search">Practise DSA</a><Link className="btn" href="/account?tab=interview">Prepare for an interview</Link></div>
    <div id="mission-search" className="world-map">
      {catalogue && WORLDS.map(world => {
        const topic = catalogue.topics.find(t => t.id === world.id)
        if (!topic || (topicFilter !== 'all' && topicFilter !== world.id)) return null
        const visible = topic.problems.filter(p => `${p.title} ${topic.label}`.toLowerCase().includes(search.toLowerCase()) && (completionFilter === 'all' || (completionFilter === 'done' ? !!progress.completed[p.id] : !progress.completed[p.id])))
        if (!visible.length) return null
        const count = topic.problems.filter(p => progress.completed[p.id]).length
        return <section key={world.id} className="world-island" style={{ '--world-color': world.color, '--world-pale': world.pale } as CSSProperties}>
          <div className="island-scenery"><span className="world-number">{world.mark}</span><WorldScene world={world}/><span className="world-completion">{count === topic.problems.length ? '★ World complete' : `${count}/${topic.problems.length} explored`}</span></div>
          <div className="island-content"><p className="eyebrow">{topicLabel(topic.id, topic.label)}</p><h3>{world.name}</h3><p className="world-subtitle">{world.subtitle}</p>
            <ul className="mission-list">{visible.map((problem, index) => <li key={problem.id}><Link href={`/problem/${problem.id}`} className="mission-node"><span className={progress.completed[problem.id] ? 'mission-stamp solved' : 'mission-stamp'} aria-label={progress.completed[problem.id] ? 'Completed' : 'Available'}>{progress.completed[problem.id] ? '✓' : String(index + 1).padStart(2,'0')}</span><span>{problem.title}{next?.id === problem.id && <small>Suggested next adventure</small>}</span><span aria-hidden="true">↗</span></Link></li>)}</ul>
          </div>
        </section>
      })}
    </div>
    {catalogue && !catalogue.topics.some(t => (topicFilter === 'all' || t.id === topicFilter) && t.problems.some(p => `${p.title} ${t.label}`.toLowerCase().includes(search.toLowerCase()) && (completionFilter === 'all' || (completionFilter === 'done' ? !!progress.completed[p.id] : !progress.completed[p.id])))) && <section className="panel p-4"><h2>No missions match</h2><button className="btn" onClick={() => { setSearch(''); setTopicFilter('all'); setCompletionFilter('all'); persistFilters('','all','all') }}>Clear filters</button></section>}
    <details id="collection" className="adventure-drawer collection-drawer"><summary>✧ Your collection <span>{Object.keys(progress.completed).length} mission stamps · {badges.length} world badges</span></summary><div className="p-5"><RobotGuide>Every solved mission earns a stamp. Explore a whole world to collect its badge and map frame. Hints are always welcome.</RobotGuide><div className="collection-items">{WORLDS.map(w => <div key={w.id} className={badges.some(b => b.id === w.id) ? 'collection-badge earned' : 'collection-badge'}><span aria-hidden="true">{badges.some(b => b.id === w.id) ? '★' : '☆'}</span><strong>{w.name}</strong><small>{badges.some(b => b.id === w.id) ? 'Collected!' : 'Complete this world'}</small></div>)}</div><div className="flex flex-wrap gap-2" role="group" aria-label="Map frame"><button className="btn" aria-pressed={progress.preferences.mapFrame === 'default'} onClick={() => selectFrame('default')}>Original frame</button>{badges.map(w => <button key={w.id} className="btn" aria-pressed={progress.preferences.mapFrame === w.id} onClick={() => selectFrame(w.id)}>{w.name} frame</button>)}</div><p className="mt-4 text-sm">Saved in this browser. No account needed.</p></div></details>
    {warning && <p role="status" className="storage-notice">Progress storage is unavailable or was reset. You can keep playing; new stamps may not survive closing this browser.</p>}
    <footer className="adventure-footer"><p>Made for curious minds. Take your time.</p><details className="adventure-drawer"><summary>Connection & diagnostics</summary><div className="p-4 text-sm">{healthFailed && <p>Service status is unavailable. Missions can still be started.</p>}{(health?.tiers ?? catalogue?.tiers ?? []).map(t => <p key={t.tier}>{PROVIDER_TIER_LABELS[t.tier]} · {t.available ? 'Available' : 'Unavailable'}</p>)}<button className="btn mt-3" onClick={() => setReload(r => r + 1)}>Refresh connection</button></div></details></footer>
  </main>
}
