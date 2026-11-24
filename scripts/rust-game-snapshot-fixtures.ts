/** Node-created legacy snapshots; no database or providers are invoked. */
import { writeFile } from 'node:fs/promises'
import { PROBLEMS } from '../packages/game-schema/src/index.js'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { createGameRuntime } from '../packages/game-engine/src/index.js'
import { buildTemplateSpec } from '../packages/provider-chain/src/providers/template.js'
const snapshots=[]
for(const problem of PROBLEMS) for(const difficulty of ['easy','medium','hard'] as const) {
 const seed=7, oracle=ORACLES[problem.id]!, runtime=createGameRuntime(oracle)
 const prior=runtime.init(seed,difficulty), move=oracle.canonicalTrace(prior)[0]
 const state=move?runtime.apply(prior,move.action).state:prior
 const spec=buildTemplateSpec({problem,instance:prior.instance,seed,difficulty,language:'en'})
 snapshots.push({userId:'alice',gameId:`${problem.id}-${difficulty}`,problemId:problem.id,seed,difficulty,spec,state,undo:move?[prior]:[],usedTier:'template',createdAt:1,lastAccessedAt:1})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/game-snapshots.json',import.meta.url),JSON.stringify(snapshots)+'\n')
console.log(`Captured ${snapshots.length} Node legacy snapshots`)
