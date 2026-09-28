// Live smoke test for tier 3 (local llama.cpp).
//
// Opt-in only, for the same reason as live-opencode.test.ts: it needs a running
// llama-server (./scripts/local-llm.sh start) and takes minutes on CPU.
//
//   ./scripts/local-llm.sh start
//   DSA_LIVE_LOCAL_LLM=1 npx vitest run packages/provider-chain/src/live-local-llm.test.ts
import { describe, expect, it } from 'vitest'
import { GameSpecSchema, getProblem, type ProblemInstance } from '@dsa/game-schema'
import { LocalLlmProvider } from './providers/local-llm.js'

const LIVE = process.env['DSA_LIVE_LOCAL_LLM'] === '1'

const problem = getProblem('array-max-min')
const instance: ProblemInstance = {
  problemId: 'array-max-min',
  seed: 3,
  values: [41, 7, 92, 18, 63, 25],
  slots: [],
}

describe.skipIf(!LIVE)('tier 3 against a live llama-server', () => {
  it('is reachable and produces a schema-valid spec', async () => {
    const p = new LocalLlmProvider()
    expect(await p.isAvailable()).toBe(true)
    const spec = await p.generate({ problem: problem!, instance, seed: 3, difficulty: 'easy' })
    expect(GameSpecSchema.safeParse(spec).success).toBe(true)
    expect(spec.problemId).toBe('array-max-min')
    expect(spec.seed).toBe(3)
    expect(spec.mechanics.every((m) => problem!.allowedMechanics.includes(m.id))).toBe(true)
    console.log('TIER:', spec.generatedBy)
    console.log('TITLE:', spec.theme.title)
    console.log('OBJECT:', spec.vocabulary.object)
    console.log('GLYPHS:', JSON.stringify(spec.visual.objectGlyphs))
    console.log('ACTION MEANING KEYS:', Object.keys(spec.debrief.actionMeaning).join(','))
    console.log('MECHANICS:', spec.mechanics.map((m) => m.id).join(','))
  }, 900_000)
})
