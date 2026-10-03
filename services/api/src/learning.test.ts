import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { createApp } from './app.js'
import { createDecisionEngine } from '@dsa/decision-layer'
import { TemplateProvider, type ChatTransport } from '@dsa/provider-chain'
import { PROBLEMS } from '@dsa/game-schema'
import { getOracle } from '@dsa/dsa-oracles'
import { getDb, closeDb } from './db/index.js'
import { createThread, appendTurn, resetThreads } from './coach/threads.js'
import { resetStore } from './store.js'
import { dashboard } from './learning/store.js'
import { setLearningTransportForTests } from './learning/routes.js'
import { resetRateLimits } from './auth/rate-limit.js'
import { createGameRuntime } from '@dsa/game-engine'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
let dir: string
const makeApp = () =>
  createApp({
    chain: [new TemplateProvider()],
    decisions: createDecisionEngine({ enabled: false }),
    version: 'test',
  })
const jsonHeaders = (token?: string) => ({
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})
async function req(
  app: ReturnType<typeof makeApp>,
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
) {
  const r = await app.request(path, {
    method,
    headers: { ...jsonHeaders(token), origin: 'http://localhost:3000' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { headers: r.headers, status: r.status, data: (await r.json()) as any }
}
async function signup(app: ReturnType<typeof makeApp>, email: string) {
  return (await req(app, '/api/auth/signup', 'POST', { email, password: 'testing-password-123' })).data
}
const context = { history: true, resume: false, target: false }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsa-learning-'))
  process.env.DSA_DB_PATH = join(dir, 'db.sqlite')
  process.env.INTERVIEW_TRANSPORT = '0'
  closeDb()
  resetStore()
  resetRateLimits()
  setLearningTransportForTests(null)
})
afterEach(() => {
  closeDb()
  resetStore()
  setLearningTransportForTests(undefined)
  delete process.env.DSA_DB_PATH
  delete process.env.INTERVIEW_TRANSPORT
  rmSync(dir, { recursive: true, force: true })
})

describe('durable account-scoped learning', () => {
  it('restores owned coach transcripts without exposing them to another account', async () => {
    let app = makeApp()
    const a = await signup(app, 'coach-a@example.com'),
      b = await signup(app, 'coach-b@example.com')
    const g = (
      await req(app, '/api/generate', 'POST', { problemId: 'binary-search', forceTemplate: true }, a.token)
    ).data
    const t = createThread({ userId: a.user.id, gameId: g.gameId, problemId: 'binary-search' })
    appendTurn(t.id, {
      id: 'test-learner',
      role: 'learner',
      text: 'Explain the rule',
      at: Date.now(),
      approxTokens: 4,
    })
    resetThreads()
    resetStore()
    closeDb()
    app = makeApp()
    const restored = await req(app, `/api/coach/threads/${t.id}`, 'GET', undefined, a.token)
    expect(restored.status).toBe(200)
    expect(restored.data.thread.turns[0].text).toBe('Explain the rule')
    expect((await req(app, `/api/coach/threads/${t.id}`, 'GET', undefined, b.token)).status).toBe(404)
    expect(
      (await req(app, `/api/coach/threads?gameId=${g.gameId}`, 'GET', undefined, a.token)).data.threads,
    ).toHaveLength(1)
  })

  it('requires login and prevents cross-account game, chat, and reflection access', async () => {
    const app = makeApp(),
      a = await signup(app, 'a@example.com'),
      b = await signup(app, 'b@example.com')
    expect((await req(app, '/api/learning/dashboard')).status).toBe(401)
    const game = (
      await req(app, '/api/generate', 'POST', { problemId: 'binary-search', forceTemplate: true }, a.token)
    ).data
    for (const token of [b.token, undefined]) {
      expect((await req(app, `/api/game/${game.gameId}`, 'GET', undefined, token)).status).toBe(404)
      expect((await req(app, '/api/hint', 'POST', { gameId: game.gameId }, token)).status).toBe(404)
      expect(
        (
          await req(
            app,
            '/api/action',
            'POST',
            { gameId: game.gameId, action: { type: 'selectObject', objectId: 'v0' } },
            token,
          )
        ).status,
      ).toBe(404)
    }
    const t = (await req(app, '/api/learning/threads', 'POST', {}, a.token)).data.thread
    expect((await req(app, `/api/learning/threads/${t.id}`, 'GET', undefined, b.token)).status).toBe(404)
    expect((await req(app, `/api/learning/threads/${t.id}`, 'DELETE', undefined, b.token)).status).toBe(404)
    expect(
      (
        await req(
          app,
          `/api/learning/history/${game.gameId}/reflection`,
          'POST',
          { retention: 'test', integration: 'test', skipped: false },
          b.token,
        )
      ).status,
    ).toBe(404)
    expect((await req(app, '/api/learning/dashboard', 'GET', undefined, b.token)).data.records).toHaveLength(
      0,
    )
  })
  it('restores snapshots and completed debriefs after clearing memory and reopening SQLite', async () => {
    let app = makeApp()
    const a = await signup(app, 'persist@example.com')
    for (const difficulty of ['easy', 'medium', 'hard']) {
      const game = (
        await req(
          app,
          '/api/generate',
          'POST',
          { problemId: 'binary-search', forceTemplate: true, difficulty, seed: 42 },
          a.token,
        )
      ).data
      const first = { type: 'selectObject', objectId: `v${game.state.variables.mid}` }
      expect(
        (await req(app, '/api/action', 'POST', { gameId: game.gameId, action: first }, a.token)).status,
      ).toBe(200)
      resetStore()
      closeDb()
      app = makeApp()
      let state = (await req(app, `/api/game/${game.gameId}`, 'GET', undefined, a.token)).data.state
      expect(state.trace.length).toBe(1)
      for (let guard = 0; state.phase === 'playing' && guard < 100; guard++) {
        const mid = Number(state.internal.mid),
          target = state.instance.target,
          values = state.instance.values
        const action =
          state.internal.terminated === true
            ? {
                type: 'submitAnswer',
                targetId: `v${state.internal.targetIndex}`,
                value: String(state.internal.targetIndex),
              }
            : state.internal.midChosen !== true
              ? { type: 'selectObject', objectId: `v${mid}` }
              : state.internal.hasComparison !== true
                ? {
                    type: 'comparePair',
                    aId: `v${mid}`,
                    bId: 'target',
                    relation: values[mid] < target ? 'gt' : values[mid] > target ? 'lt' : 'eq',
                  }
                : values[mid] === target
                  ? state.internal.terminated === true
                    ? { type: 'submitAnswer', targetId: `v${mid}`, value: String(mid) }
                    : { type: 'choosePath', fromId: `v${mid}`, pathId: 'found' }
                  : { type: 'choosePath', fromId: `v${mid}`, pathId: values[mid] < target ? 'right' : 'left' }
        const result = await req(app, '/api/action', 'POST', { gameId: game.gameId, action }, a.token)
        state = result.data.state
      }
      expect(state.phase).toBe('won')
      resetStore()
      closeDb()
      app = makeApp()
      expect((await req(app, `/api/game/${game.gameId}/debrief`, 'GET', undefined, a.token)).status).toBe(200)
    }
    expect((await req(app, '/api/learning/dashboard', 'GET', undefined, a.token)).data.records).toHaveLength(
      3,
    )
  })
  it('persists and restores every registered game at every difficulty', async () => {
    const app = makeApp(),
      a = await signup(app, 'catalogue@example.com')
    for (const p of PROBLEMS)
      for (const difficulty of ['easy', 'medium', 'hard']) {
        const g = await req(
          app,
          '/api/generate',
          'POST',
          { problemId: p.id, difficulty, forceTemplate: true, seed: 42 },
          a.token,
        )
        expect(g.status, `${p.id} ${difficulty}`).toBe(200)
        resetStore()
        const restored = await req(app, `/api/game/${g.data.gameId}`, 'GET', undefined, a.token)
        expect(restored.status, `${p.id} ${difficulty} restored`).toBe(200)
        expect(restored.data.state).toEqual(g.data.state)
      }
  })
  it('keeps imported stamps completion-only and schedules recorded repeat wins deterministically', async () => {
    const app = makeApp(),
      a = await signup(app, 'review@example.com')
    await req(
      app,
      '/api/me/progress',
      'POST',
      { completed: { 'array-max-min': '2026-01-01T00:00:00.000Z' } },
      a.token,
    )
    let d = dashboard(a.user.id)
    expect(d.completed['array-max-min']).toBeTruthy()
    expect(d.records).toHaveLength(0)
    expect(d.reviews).toHaveLength(0)
    const { getSession, putSession } = await import('./store.js')
    for (const [i, mistakes] of [0, 0, 1, 0].entries()) {
      const g = (
        await req(
          app,
          '/api/generate',
          'POST',
          { problemId: 'array-max-min', forceTemplate: true, seed: i },
          a.token,
        )
      ).data
      const s = getSession(g.gameId)!
      s.state.phase = 'won'
      s.state.progress.mistakes = mistakes
      putSession(s)
      d = dashboard(a.user.id)
      expect(d.reviews[0]!.stage).toBe([0, 1, 0, 1][i])
    }
  })
  it('streams and persists conversations, handles duplicates, sources, search, and opt-in profile context', async () => {
    const app = makeApp(),
      a = await signup(app, 'chat@example.com')
    await req(app, '/api/generate', 'POST', { problemId: 'array-max-min', forceTemplate: true }, a.token)
    let captured = ''
    let calls = 0
    const transport: ChatTransport = {
      id: 'test',
      model: 'test',
      isAvailable: async () => true,
      chat: async () => ({ text: 'unused', model: 'test', approxTokens: 1 }),
      async *stream(r) {
        calls++
        captured = JSON.stringify(r.messages)
        yield 'Here is '
        yield 'your study plan. '.repeat(12)
      },
    }
    setLearningTransportForTests(transport)
    const t = (await req(app, '/api/learning/threads', 'POST', {}, a.token)).data.thread
    const send = () =>
      app.request(`/api/learning/threads/${t.id}/messages`, {
        method: 'POST',
        headers: jsonHeaders(a.token),
        body: JSON.stringify({
          requestId: 'request-12345',
          text: 'Create a plan to practise array max min',
          context,
        }),
      })
    const result = await send()
    const sse = await result.text()
    expect(sse).toContain('"type":"text"')
    expect(sse).toContain('"type":"complete"')
    expect(captured).toContain('array-max-min')
    expect(captured).not.toContain('chat@example.com')
    const before = (await req(app, `/api/learning/threads/${t.id}`, 'GET', undefined, a.token)).data.messages
    expect(before).toHaveLength(2)
    expect(before[1].actions.some((x: any) => x.type === 'plan')).toBe(true)
    expect(before[1].sources.length).toBe(1)
    await (await send()).text()
    expect(calls).toBe(1)
    closeDb()
    const reopened = makeApp()
    expect(
      (await req(reopened, `/api/learning/threads/${t.id}`, 'GET', undefined, a.token)).data.messages,
    ).toHaveLength(2)
    expect(
      (await req(reopened, '/api/learning/threads?q=plan', 'GET', undefined, a.token)).data.threads,
    ).toHaveLength(1)
    const m = before[1],
      index = m.actions.findIndex((x: any) => x.type === 'plan')
    for (let i = 0; i < 2; i++)
      expect(
        (
          await req(
            reopened,
            `/api/learning/threads/${t.id}/actions`,
            'POST',
            { messageId: m.id, index, requestId: 'save-plan-1234' },
            a.token,
          )
        ).status,
      ).toBe(200)
    expect((await req(reopened, '/api/learning/plans', 'GET', undefined, a.token)).data.plans).toHaveLength(1)
  })
  it('honestly degrades without a model and does not offer unsupported games', async () => {
    const app = makeApp(),
      a = await signup(app, 'offline@example.com'),
      t = (await req(app, '/api/learning/threads', 'POST', {}, a.token)).data.thread
    const res = await app.request(`/api/learning/threads/${t.id}/messages`, {
      method: 'POST',
      headers: jsonHeaders(a.token),
      body: JSON.stringify({
        requestId: 'offline-1234',
        text: 'Generate a game for quantum teleportation',
        context,
      }),
    })
    expect(await res.text()).toContain('unavailable')
    const ms = (await req(app, `/api/learning/threads/${t.id}`, 'GET', undefined, a.token)).data.messages
    expect(ms[1].actions).toHaveLength(0)
  })
  it('cancels an active response, blocks concurrent sends, and persists the interruption', async () => {
    const app = makeApp(),
      a = await signup(app, 'cancel@example.com'),
      t = (await req(app, '/api/learning/threads', 'POST', {}, a.token)).data.thread
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    setLearningTransportForTests({
      id: 'slow',
      model: 'slow',
      isAvailable: async () => true,
      chat: async () => ({ text: '', model: 'slow', approxTokens: 0 }),
      async *stream(r) {
        yield 'Partial response'
        entered()
        await new Promise<void>((resolve, reject) => {
          r.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
    })
    const response = await app.request(`/api/learning/threads/${t.id}/messages`, {
      method: 'POST',
      headers: jsonHeaders(a.token),
      body: JSON.stringify({ requestId: 'cancel-first-123', text: 'Explain binary search', context }),
    })
    const output = response.text()
    await started
    expect(
      (
        await req(
          app,
          `/api/learning/threads/${t.id}/messages`,
          'POST',
          { requestId: 'cancel-second-123', text: 'Another question', context },
          a.token,
        )
      ).status,
    ).toBe(409)
    expect((await req(app, `/api/learning/threads/${t.id}/cancel`, 'POST', {}, a.token)).status).toBe(200)
    await output
    const ms = (await req(app, `/api/learning/threads/${t.id}`, 'GET', undefined, a.token)).data.messages
    expect(ms[1].status).toBe('interrupted')
    expect(ms[1].text).toBe('Partial response')
  })
  it('retains partial output after provider failure and regenerates without another user turn', async () => {
    const app = makeApp(),
      a = await signup(app, 'failure@example.com'),
      t = (await req(app, '/api/learning/threads', 'POST', {}, a.token)).data.thread
    setLearningTransportForTests({
      id: 'broken',
      model: 'broken',
      isAvailable: async () => true,
      chat: async () => ({ text: '', model: 'broken', approxTokens: 0 }),
      async *stream() {
        yield 'Partial'
        throw new Error('upstream secret must not escape')
      },
    })
    const send = async (requestId: string, regenerate = false) => {
      const r = await app.request(`/api/learning/threads/${t.id}/messages`, {
        method: 'POST',
        headers: jsonHeaders(a.token),
        body: JSON.stringify({ requestId, text: 'Explain binary search', context, regenerate }),
      })
      return r.text()
    }
    const failed = await send('failure-first-123')
    expect(failed).toContain('"type":"error"')
    expect(failed).not.toContain('upstream secret')
    let ms = (await req(app, `/api/learning/threads/${t.id}`, 'GET', undefined, a.token)).data.messages
    expect(ms[1].status).toBe('failed')
    expect(ms[1].text).toBe('Partial')
    setLearningTransportForTests(null)
    await send('retry-next-123', true)
    ms = (await req(app, `/api/learning/threads/${t.id}`, 'GET', undefined, a.token)).data.messages
    expect(ms.filter((m: any) => m.role === 'user')).toHaveLength(1)
    expect(ms.at(-1).status).toBe('complete')
  })
  it('game action cards generate once and preserve all three difficulty journeys', async () => {
    const app = makeApp(),
      a = await signup(app, 'actions@example.com')
    for (const level of ['low', 'medium', 'high']) {
      const t = (await req(app, '/api/learning/threads', 'POST', {}, a.token)).data.thread
      const r = await app.request(`/api/learning/threads/${t.id}/messages`, {
        method: 'POST',
        headers: jsonHeaders(a.token),
        body: JSON.stringify({
          requestId: `card-${level}-123`,
          text: `Generate a ${level} binary-search game`,
          context,
        }),
      })
      await r.text()
      const ms = (await req(app, `/api/learning/threads/${t.id}`, 'GET', undefined, a.token)).data.messages,
        m = ms[1]
      expect(m.actions[0].difficulty).toBe(level === 'low' ? 'easy' : level === 'high' ? 'hard' : 'medium')
      const body = { messageId: m.id, index: 0, requestId: `generate-${level}-123` }
      const one = await req(app, `/api/learning/threads/${t.id}/actions`, 'POST', body, a.token),
        two = await req(app, `/api/learning/threads/${t.id}/actions`, 'POST', body, a.token)
      expect(one.status).toBe(200)
      expect(one.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
      expect(two.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
      expect(two.data.gameId).toBe(one.data.gameId)
      const instant = await req(app, `/api/learning/threads/${t.id}/actions`, 'POST', {...body,forceTemplate:true}, a.token)
      expect(instant.data.gameId).toBe(one.data.gameId)
    }
    expect(dashboard(a.user.id).records).toHaveLength(3)
  })
  it('rejects corrupt stored snapshots rather than rendering invalid state', async () => {
    const app = makeApp(),
      a = await signup(app, 'corrupt@example.com'),
      g = (
        await req(app, '/api/generate', 'POST', { problemId: 'array-max-min', forceTemplate: true }, a.token)
      ).data
    getDb().prepare('UPDATE practice_runs SET snapshot_json=? WHERE game_id=?').run('{}', g.gameId)
    resetStore()
    expect((await req(app, `/api/game/${g.gameId}`, 'GET', undefined, a.token)).status).toBe(404)
  })
})

describe('contextual learning journeys', () => {
  it('paginates and filters owned history and returns the exact resumable game', async () => {
    const app=makeApp(),a=await signup(app,'pages@example.com'),b=await signup(app,'other-pages@example.com')
    for(const problemId of ['binary-search','array-max-min','binary-search']) await req(app,'/api/generate','POST',{problemId,forceTemplate:true},a.token)
    const first=await req(app,'/api/learning/history?topic=binary-search&limit=1','GET',undefined,a.token)
    expect(first.data.total).toBe(2);expect(first.data.records).toHaveLength(1);expect(first.data.nextCursor).toBeTruthy()
    const next=await req(app,`/api/learning/history?topic=binary-search&limit=1&cursor=${first.data.nextCursor}`,'GET',undefined,a.token)
    expect(next.data.records).toHaveLength(1);expect(next.data.records[0].gameId).not.toBe(first.data.records[0].gameId)
    expect((await req(app,`/api/learning/history/${first.data.records[0].gameId}`,'GET',undefined,b.token)).status).toBe(404)
    const d=(await req(app,'/api/learning/dashboard','GET',undefined,a.token)).data
    expect(d.recommendation.action).toBe('resume');expect(d.records.some((r:any)=>r.gameId===d.recommendation.gameId)).toBe(true)
  })
  it('preserves typed context, validates ownership, and regenerates the question once', async () => {
    const app=makeApp(),a=await signup(app,'refs@example.com'),b=await signup(app,'refs-other@example.com')
    const g=(await req(app,'/api/generate','POST',{problemId:'binary-search',forceTemplate:true},a.token)).data
    const t=(await req(app,'/api/learning/threads','POST',{},a.token)).data.thread
    let prompts: readonly {role:string;content:string}[]=[]
    setLearningTransportForTests({id:'test',model:'test',isAvailable:async()=>true,chat:async()=>({text:'{"actions":[]}',model:'test',approxTokens:1}),async *stream(r){prompts=r.messages;yield 'Explanation.'}})
    const send=async(token:string,rid:string,regenerate=false)=>{
      const response=await app.request(`/api/learning/threads/${t.id}/messages`,{method:'POST',headers:jsonHeaders(token),body:JSON.stringify({text:'Explain this attempt.',requestId:rid,regenerate,context:{...context,reference:{type:'run',gameId:g.gameId}}})});return {status:response.status,text:await response.text()}
    }
    expect((await send(a.token,'reference-request-1')).status).toBe(200)
    expect((await send(a.token,'reference-request-2',true)).status).toBe(200)
    expect(prompts.filter(m=>m.role==='user'&&m.content==='Explain this attempt.')).toHaveLength(1)
    expect(prompts[0]!.content).toContain(JSON.stringify(g.state.instance))
    expect(prompts[0]!.content).toContain('recentSteps')
    const data=(await req(app,`/api/learning/threads/${t.id}`,'GET',undefined,a.token)).data
    expect(data.messages[0].context.reference.gameId).toBe(g.gameId)
    const other=(await req(app,'/api/learning/threads','POST',{},b.token)).data.thread
    const denied=await app.request(`/api/learning/threads/${other.id}/messages`,{method:'POST',headers:jsonHeaders(b.token),body:JSON.stringify({text:'Explain this',requestId:'foreign-reference',context:{...context,reference:{type:'run',gameId:g.gameId}}})})
    expect(denied.status).toBe(404)
  })
  it('resolves follow-up action proposals using conversation and rejects unsupported proposals', async () => {
    const app=makeApp(),a=await signup(app,'followup@example.com'),t=(await req(app,'/api/learning/threads','POST',{},a.token)).data.thread
    let planned=''
    setLearningTransportForTests({id:'test',model:'test',isAvailable:async()=>true,chat:async(r)=>{planned=r.messages[1]!.content;return {text:JSON.stringify({actions:[{type:'game',problemId:'binary-search',difficulty:'hard'}]}),model:'test',approxTokens:1}},async *stream(){yield 'Here is a practice option.'}})
    for(const [i,text] of ['Help me with binary search','Give me medium practice','Make that harder'].entries())await (await app.request(`/api/learning/threads/${t.id}/messages`,{method:'POST',headers:jsonHeaders(a.token),body:JSON.stringify({text,requestId:`followup-request-${i}`,context})})).text()
    expect(planned).toContain('binary search');expect(planned).toContain('medium practice')
    const transcript=(await req(app,`/api/learning/threads/${t.id}`,'GET',undefined,a.token)).data.messages
    expect(transcript.at(-1).actions[0]).toEqual({type:'game',problemId:'binary-search',difficulty:'hard'})
    const {validateProposals}=await import('./learning/actions.js')
    expect(validateProposals({actions:[{type:'game',problemId:'invented-game',difficulty:'hard'}]})).toEqual([])
    expect(validateProposals({actions:[{type:'execute-code',command:'anything'}]})).toEqual([])
  })
  it('paginates conversation transcripts without dropping saved messages', async () => {
    const app=makeApp(),a=await signup(app,'transcript-page@example.com')
    const t=(await req(app,'/api/learning/threads','POST',{},a.token)).data.thread
    const {saveMessage}=await import('./learning/store.js')
    for(let i=0;i<5;i++)saveMessage(t.id,{id:`message-${i}`,role:'user',text:`Question ${i}`,status:'complete',createdAt:i,requestId:`request-${i}`,actions:[],sources:[]})
    const first=(await req(app,`/api/learning/threads/${t.id}?limit=2`,'GET',undefined,a.token)).data
    expect(first.messages.map((m:any)=>m.id)).toEqual(['message-0','message-1'])
    const next=(await req(app,`/api/learning/threads/${t.id}?limit=2&cursor=${first.nextCursor}`,'GET',undefined,a.token)).data
    expect(next.messages.map((m:any)=>m.id)).toEqual(['message-2','message-3'])
  })
})
