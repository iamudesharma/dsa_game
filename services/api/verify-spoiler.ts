import { getOracle } from '@dsa/dsa-oracles'
import { createGameRuntime, deriveTurnPrompt } from '@dsa/game-engine'
import { buildTemplateSpec } from '@dsa/provider-chain'
import { getProblem } from '@dsa/game-schema'
import type { GameState, GameSpec, Action } from '@dsa/game-schema'

const oracle = getOracle('binary-search')!
const problem = getProblem('binary-search')!
const runtime = createGameRuntime(oracle)

let state: GameState = runtime.init(31337, 'easy')
const spec: GameSpec = buildTemplateSpec({ problem, instance: state.instance, seed: 31337, difficulty: 'easy' })
const answerIndex = Number(state.internal['targetIndex'])

console.log('target index (the secret) :', answerIndex)
console.log('')

// Play to the FINAL turn — the one where mid === targetIndex — and inspect
// everything the UI would show.
const v = state.instance.values
const t = state.instance.target!
let guard = 0
while (state.phase === 'playing' && guard++ < 20) {
  const mid = Number(state.variables['mid'])
  if (state.internal['midChosen'] !== true) {
    state = runtime.apply(state, { type: 'selectObject', objectId: `v${mid}` } as Action).state
    continue
  }
  const rel = v[mid]! < t ? 'gt' : v[mid]! > target2(mid) ? 'lt' : 'eq'
  function target2(m: number) { return t }
  state = runtime.apply(state, { type: 'comparePair', aId: `v${mid}`, bId: 'target', relation: rel } as Action).state
  if (rel === 'eq') break
  if (state.phase !== 'playing') break
  state = runtime.apply(state, { type: 'choosePath', fromId: `v${mid}`, pathId: v[mid]! < t ? 'right' : 'left' } as Action).state
}

const p = deriveTurnPrompt({ state, oracle, spec })
const blob = JSON.stringify(p)

console.log('--- FINAL TURN prompt as the UI would receive it ---')
console.log('mechanic   :', p.mechanic, '->', p.dsaOp)
console.log('instruction:', p.instruction)
console.log('reason     :', p.reason)
console.log('targets    :', p.targets.map((x) => `${x.label} [${x.role}]`).join(' | '))
console.log('indicator  :', p.indicator.detail)
console.log('')

// The secret is the INDEX. The value is printed on the board already, so only
// the index is a spoiler.
const leaksIndex = new RegExp(`\\b(index|position|spot|slot|#)\\s*${answerIndex}\\b`, 'i').test(blob)
const bareIndex = new RegExp(`(^|[^\\d])${answerIndex}([^\\d]|$)`).test(
  [p.instruction, p.reason, ...p.targets.map((x) => `${x.label} ${x.hint}`)].join(' '),
)
console.log('mentions the target INDEX as a position? :', leaksIndex)
console.log('contains the bare number anywhere?        :', bareIndex)
console.log('prompt json contains "index"?             :', /index/i.test(blob))
console.log('')
console.log('VERDICT:', leaksIndex ? 'SPOILER — turnPrompt leaks the answer' : 'clean — turnPrompt does not name the answer position')
