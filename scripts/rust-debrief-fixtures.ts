import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PROBLEMS } from '../packages/game-schema/src/index.js'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { createGameRuntime } from '../packages/game-engine/src/index.js'
import { buildTemplateSpec } from '../packages/provider-chain/src/providers/template.js'
import { buildDebrief } from '../services/api/src/debrief.js'
function stable(v:any):any {if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
const cases=[]
for(const problem of PROBLEMS)for(let seed=0;seed<30;seed++)for(const difficulty of ['easy','medium','hard'] as const) {
 const oracle=ORACLES[problem.id]!, runtime=createGameRuntime(oracle);let state=runtime.init(seed,difficulty)
 const spec=buildTemplateSpec({problem,instance:state.instance,seed,difficulty,language:'en'})
 const hash=async()=>createHash('sha256').update(JSON.stringify(stable(await buildDebrief({spec,state,oracle,usedTier:'template'})))).digest('hex')
 const initial=await hash();const actions=oracle.canonicalTrace(state).map(f=>f.action)
 state=runtime.apply(state,{type:'assignValue',targetId:'missing',value:'wrong'}).state
 for(const action of actions)state=runtime.apply(state,action).state
 state.progress.hintsUsed=2
 cases.push({id:problem.id,seed,difficulty,initial,terminal:await hash()})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/debriefs.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} Node debrief pairs`)
