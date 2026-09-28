// Live smoke test for tier 1.
//
// This file matches the repo-wide packages/[*]{2}.test.ts glob, so it is gated
// on an explicit opt-in env var: a plain "vitest run packages/provider-chain"
// must stay hermetic and free, and this test needs a running opencode server
// plus a funded model.
//
//   opencode serve --port 4096            # note the password it prints
//   DSA_LIVE_OPENCODE=1 \
//     OPENCODE_BASE_URL=http://127.0.0.1:4096 \
//     OPENCODE_PASSWORD=<printed password> \
//     OPENCODE_MODEL=opencode/<some model> \
//     npx vitest run packages/provider-chain/src/live-opencode.test.ts
import { describe, expect, it } from 'vitest'
import { getProblem, type ProblemInstance } from '@dsa/game-schema'
import { OpencodeProvider } from './providers/opencode.js'

const LIVE = process.env['DSA_LIVE_OPENCODE'] === '1'

const problem = getProblem('binary-search')
const instance: ProblemInstance = {
  problemId: 'binary-search',
  seed: 7,
  values: [3, 11, 17, 22, 31, 44, 58, 69],
  target: 44,
  slots: [],
}

describe.skipIf(!LIVE)('tier 1 against a live opencode server', () => {
  it('produces a valid spec', async () => {
    const p = new OpencodeProvider()
    expect(await p.isAvailable()).toBe(true)
    const spec = await p.generate({ problem: problem!, instance, seed: 7, difficulty: 'medium' })
    expect(spec.problemId).toBe('binary-search')
    expect(spec.seed).toBe(7)
    expect(spec.generatedBy).toBe('opencode')
    expect(spec.mechanics.every((m) => problem!.allowedMechanics.includes(m.id))).toBe(true)
    console.log('TITLE:', spec.theme.title)
    console.log('OBJECT:', spec.vocabulary.object, '| PLACE:', spec.vocabulary.place)
    console.log('MECHANICS:', spec.mechanics.map((m) => m.id).join(','))
    console.log('HINTS:', spec.narration.hintPool.length)
  }, 600_000)
})
