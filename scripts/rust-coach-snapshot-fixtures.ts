import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PROBLEMS } from '../packages/game-schema/src/index.js'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { createGameRuntime } from '../packages/game-engine/src/index.js'
import { buildTemplateSpec } from '../packages/provider-chain/src/providers/template.js'
import { deriveTurnPrompt } from '../packages/game-engine/src/guidance.js'
import { buildSnapshot } from '../services/api/src/coach/snapshot.js'
function stable(v:any):any {if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
const cases=[]
for(const problem of PROBLEMS)for(let seed=0;seed<30;seed++)for(const difficulty of ['easy','medium','hard'] as const){
 const oracle=ORACLES[problem.id]!,runtime=createGameRuntime(oracle);let state=runtime.init(seed,difficulty)
 const spec=buildTemplateSpec({problem,instance:state.instance,seed,difficulty,language:'en'})
 const hash=()=>createHash('sha256').update(JSON.stringify(stable(buildSnapshot({spec,state,oracle,turnPrompt:deriveTurnPrompt({spec,state,oracle})})))).digest('hex')
 const initial=hash(); const actions=oracle.canonicalTrace(state).map(f=>f.action)
 for(const action of actions)state=runtime.apply(state,action).state
 cases.push({id:problem.id,seed,difficulty,initial,terminal:hash()})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/coach-snapshots.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} Node coach snapshot pairs`)
