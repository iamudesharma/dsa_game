/** Engine-level fixtures preserve rejected replay, progress and debrief telemetry. */
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { createGameRuntime } from '../packages/game-engine/src/index.js'
import type { Action } from '../packages/game-schema/src/index.js'
function stable(v:unknown):unknown{if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
function hash(v:unknown){return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}
const cases=[]
for(const [id,oracle] of Object.entries(ORACLES)){
 for(let seed=0;seed<30;seed++)for(const difficulty of ['easy','medium','hard'] as const){
  const runtime=createGameRuntime(oracle);let state=runtime.init(seed,difficulty);const initial=hash(state);const canonical=oracle.canonicalTrace(state);const moves=[]
  for(const [index,frame] of canonical.entries()){
   const action={...frame.action,...(index%2===0?{actionId:`action-${index}`}:{})};
   const invalid={type:'assignValue',targetId:'missing',value:'wrong'} as Action
   const checks=[{action:invalid,result:hash(runtime.apply(state,invalid))}]
   if(frame.action.type==='comparePair'){const wrong={...frame.action,relation:frame.action.relation==='lt'?'gt':'lt'} as Action;checks.push({action:wrong,result:hash(runtime.apply(state,wrong))})}
   const result=runtime.apply(state,action);moves.push({action,result:hash(result),checks});state=result.state
  }
  cases.push({id,seed,difficulty,initial,moves,debrief:hash(runtime.debrief(state))})
 }
 console.log(`Captured runtime ${id}`)
}
await writeFile(new URL('../services/api-rust/tests/fixtures/runtime.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} engine journeys`)
