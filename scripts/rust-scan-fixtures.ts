/** Wrong-but-legal scan moves are part of the public teaching contract. */
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import type { Action } from '../packages/game-schema/src/index.js'
function stable(v:unknown):unknown{if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
function hash(v:unknown){return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}
const cases=[];const oracle=ORACLES['array-max-min']!
for(let seed=0;seed<30;seed++)for(const difficulty of ['easy','medium','hard'] as const){
 let state=oracle.initState(oracle.buildInstance({seed,difficulty}));const stages=[]
 for(const frame of oracle.canonicalTrace(state)){
  const actions:Action[]=[{type:'selectObject',objectId:'missing'},{type:'selectObject',objectId:'mode'},{type:'assignValue',targetId:'best',value:'0'},{type:'assignValue',targetId:'anything',value:'index 1'},{type:'submitAnswer',targetId:'best',value:'index 0'},{type:'swapPair',aId:'v0',bId:'v1'}]
  if(frame.action.type==='comparePair')actions.push({...frame.action,relation:frame.action.relation==='lt'?'gt':'lt'},{...frame.action,aId:frame.action.bId,bId:frame.action.aId})
  stages.push({action:frame.action,checks:actions.map(action=>({action,result:hash(oracle.applyAction(state,action))}))});state=oracle.applyAction(state,frame.action).nextState
 }
 cases.push({seed,difficulty,stages})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/scan.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} scan journeys with wrong-but-legal and alternate actions`)
