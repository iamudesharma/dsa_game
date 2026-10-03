import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRouter, rankScores } from './local-router.js'
import { createDecisionEngine } from './engine.js'
import { CANDIDATES } from './candidates.js'

const req = { kind: 'route-problem' as const, stateText: 'flip next pointers backwards', options: { 'reverse-linked-list': 'reverse a chain', 'binary-search': 'search ordered values' }, instructions: 'Choose the matching problem' }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
describe('bounded local routing', () => {
  it('rejects partial, nonfinite and out-of-range score sets', () => {
    expect(rankScores({ 'binary-search': 0.9 }, req.options)).toBeNull()
    expect(rankScores({ 'binary-search': Infinity, 'reverse-linked-list': 0.2 }, req.options)).toBeNull()
    expect(rankScores({ 'binary-search': 1.4, 'reverse-linked-list': 0.2 }, req.options)).toBeNull()
  })
  it('reports a similarity margin without fabricating a probability distribution', async () => {
    const router = new LocalRouter({ minScore: 0.6, minMargin: 0.1 })
    vi.spyOn(router, 'rank').mockResolvedValue({ choice: 'reverse-linked-list', score: 0.8, margin: 0.3, scores: {} })
    expect(await router.decide(req.kind, req.stateText, req.options)).toMatchObject({ source: 'semantic', scoreKind: 'cosine-similarity', confidence: 0.8, margin: 0.3 })
    expect(await router.decide(req.kind, req.stateText, req.options)).not.toHaveProperty('distribution')
  })
  it('abstains on low scores or near ties', async () => {
    const router = new LocalRouter()
    const rank = vi.spyOn(router, 'rank')
    rank.mockResolvedValue({ choice: 'binary-search', score: 0.2, margin: 0.15, scores: {} })
    expect(await router.decide(req.kind, req.stateText, req.options)).toBeNull()
    rank.mockResolvedValue({ choice: 'binary-search', score: 0.9, margin: 0.01, scores: {} })
    expect(await router.decide(req.kind, req.stateText, req.options)).toBeNull()
  })
  it('keeps statistics deterministic and avoids model work for singleton and empty options', async () => {
    vi.spyOn(LocalRouter.prototype, 'prepare').mockResolvedValue(true)
    const inference = vi.spyOn(LocalRouter.prototype, 'decide').mockResolvedValue(null)
    const engine = createDecisionEngine({ backend: 'semantic' })
    expect((await engine.decide({ ...req, options: {} })).choice).toBe('')
    expect((await engine.decide({ ...req, options: { only: 'only option' } })).choice).toBe('only')
    expect((await engine.decide({ ...req, kind: 'difficulty', stateText: 'steps=20 mistakes=2 hintsUsed=1', options: { easy: 'easy', medium: 'medium', hard: 'hard' } })).source).toBe('heuristic')
    expect(inference).not.toHaveBeenCalled()
    await engine.dispose?.()
  })
  it('forwards accepted semantic decisions once the worker is ready', async () => {
    vi.spyOn(LocalRouter.prototype, 'prepare').mockResolvedValue(true)
    vi.spyOn(LocalRouter.prototype, 'status').mockReturnValue({ backend: 'semantic', model: CANDIDATES['minilm-l3'].model, available: true, detail: undefined })
    vi.spyOn(LocalRouter.prototype, 'decide').mockResolvedValue({ choice: 'reverse-linked-list', confidence: 0.8, source: 'semantic', scoreKind: 'cosine-similarity', model: 'test-encoder' })
    const engine = createDecisionEngine({ backend: 'semantic' })
    expect(await engine.decide(req)).toMatchObject({ choice: 'reverse-linked-list', source: 'semantic', scoreKind: 'cosine-similarity' })
    await engine.dispose?.()
  })
  it('uses the existing heuristic when semantic matching abstains', async () => {
    vi.spyOn(LocalRouter.prototype, 'prepare').mockResolvedValue(true)
    vi.spyOn(LocalRouter.prototype, 'decide').mockResolvedValue(null)
    const engine = createDecisionEngine({ backend: 'semantic' })
    expect(await engine.decide(req)).toMatchObject({ source: 'heuristic', fallbackReason: expect.any(String) })
    await engine.dispose?.()
  })
  it('offline forces rules without initializing a worker', async () => {
    const preparation = vi.spyOn(LocalRouter.prototype, 'prepare')
    const engine = createDecisionEngine({ backend: 'semantic', offline: true })
    expect((await engine.decide(req)).source).toBe('heuristic')
    expect(preparation).not.toHaveBeenCalled()
    expect(engine.isEnabled()).toBe(false)
  })
  it('disposed inference immediately declines further requests', async () => {
    const router = new LocalRouter()
    await router.dispose()
    expect(await router.rank(req.kind, req.stateText, req.options)).toBeNull()
  })
  it('terminates work at the deadline and declines concurrent inference', async () => {
    const router = new LocalRouter({ timeoutMs: 1, cacheDir: '/tmp/dsa-router-missing-cache' })
    const first = router.rank(req.kind, req.stateText, req.options)
    expect(await router.rank(req.kind, req.stateText, req.options)).toBeNull()
    expect(await first).toBeNull()
    expect(router.status().available).toBe(false)
    expect(await router.rank(req.kind, req.stateText, req.options)).toBeNull()
    await router.dispose()
  })
  it('keeps explicit difficulty wishes deterministic even with legacy Laya enabled', async () => {
    const fetchImpl = vi.fn()
    const engine = createDecisionEngine({ backend: 'laya', enabled: true, fetchImpl })
    const result = await engine.decide({ ...req, kind: 'difficulty', stateText: 'Player wish: A gentle first attempt please', options: { easy: 'low', medium: 'medium', hard: 'high' } })
    expect(result).toMatchObject({ choice: 'easy', source: 'heuristic' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('pins every candidate to a concrete Hugging Face revision', () => {
    for (const candidate of Object.values(CANDIDATES)) expect(candidate.revision).toMatch(/^[a-f0-9]{40}$/)
  })
})
