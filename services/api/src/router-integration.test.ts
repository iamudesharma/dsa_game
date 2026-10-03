import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { createDecisionEngine } from '@dsa/decision-layer'
import { TemplateProvider } from '@dsa/provider-chain'
import { PROBLEMS } from '@dsa/game-schema'
import { getOracle } from '@dsa/dsa-oracles'

afterEach(() => vi.restoreAllMocks())
function request(path: string, body: object) { return new Request(`http://localhost${path}`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}) }
describe('local router HTTP integration', () => {
  it('returns semantic metadata and only supplies playable catalogue choices', async () => {
    const decisions = createDecisionEngine({backend:'heuristic'})
    const decide = vi.spyOn(decisions,'decide').mockResolvedValue({choice:'two-sum',confidence:.72,source:'semantic',scoreKind:'cosine-similarity',model:'test-encoder',score:.72,margin:.12})
    const app = createApp({decisions,chain:[new TemplateProvider()],version:'test'})
    const response = await app.fetch(request('/api/suggest',{freeText:'Find a pair reaching a target'}))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({problemId:'two-sum',source:'semantic',scoreKind:'cosine-similarity',model:'test-encoder'})
    const options = decide.mock.calls[0]![0].options
    expect(Object.keys(options)).toEqual(PROBLEMS.filter(p=>getOracle(p.id)).map(p=>p.id))
  })
  it('exact explicit problem selections bypass inference', async () => {
    const decisions = createDecisionEngine({backend:'heuristic'})
    const decide = vi.spyOn(decisions,'decide')
    const app = createApp({decisions,chain:[new TemplateProvider()],version:'test'})
    const response = await app.fetch(request('/api/suggest',{freeText:'binary-search'}))
    expect(await response.json()).toMatchObject({problemId:'binary-search',source:'heuristic'})
    expect(decide).not.toHaveBeenCalled()
  })
  it('forceTemplate bypasses routing and still creates a playable game', async () => {
    const decisions = createDecisionEngine({backend:'heuristic'})
    const classify = vi.spyOn(decisions,'classifyIntent')
    const app = createApp({decisions,chain:[new TemplateProvider()],version:'test'})
    const response = await app.fetch(request('/api/generate',{problemId:'binary-search',seed:7,difficulty:'medium',forceTemplate:true}))
    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.usedTier).toBe('template')
    expect(body.state.phase).toBeDefined()
    expect(classify).not.toHaveBeenCalled()
  })
  it('exposes neutral health without falsely claiming that Laya is active', async () => {
    const app=createApp({decisions:createDecisionEngine({backend:'heuristic'}),chain:[new TemplateProvider()],version:'test'})
    const response=await app.fetch(new Request('http://localhost/api/health'))
    expect(await response.json()).toMatchObject({decision:{backend:'heuristic',available:true},laya:{enabled:false,available:false}})
  })
})
