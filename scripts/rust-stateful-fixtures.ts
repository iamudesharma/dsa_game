/** Oracle-level fixtures; no model calls or runtime JS dependency. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import type { Action } from '../packages/game-schema/src/index.js'
function stable(v:unknown):unknown{if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
function hash(v:unknown){return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}
const ids=['bubble-sort','selection-sort','binary-search']
const cases=[]
for(const id of ids)for(let seed=0;seed<30;seed++)for(const difficulty of ['easy','medium','hard'] as const){
  const oracle=ORACLES[id]!;const instance=oracle.buildInstance({seed,difficulty});let state=oracle.initState(instance)
  const canonical=oracle.canonicalTrace(state)
  const initial=hash(state);const moves=[];const metadata=hash({pseudocode:oracle.pseudocode(),complexity:oracle.complexity(),code:Object.fromEntries(['javascript','typescript','python','java','cpp'].map(language=>[language,oracle.code(language as any)]))})
  for(const [i,frame]of canonical.entries()){
    const checks=[]
    for(const invalid of [{type:'submitAnswer',targetId:'missing',value:'-1'},{type:'assignValue',targetId:'dp_0',value:'wrong'}] as Action[]){const r=oracle.applyAction(state,invalid);checks.push({action:invalid,result:hash(r)})}
    const alternatives:Action[]=[{type:'selectObject',objectId:'missing'},{type:'submitAnswer',targetId:'order',value:'ascending'},{type:'swapPair',aId:'v0',bId:'v1'}]
    if(frame.action.type==='comparePair')alternatives.push({...frame.action,relation:frame.action.relation==='lt'?'gt':'lt'},{...frame.action,aId:frame.action.bId,bId:frame.action.aId})
    if(id==='binary-search')alternatives.push({type:'selectObject',objectId:'target'},{type:'selectObject',objectId:'v0'},{type:'assignValue',targetId:'lo',value:'0'},{type:'assignValue',targetId:'mid',value:'1'},{type:'submitAnswer',targetId:'answer',value:'index 0'},{type:'choosePath',fromId:'v0',pathId:'right'})
    if(frame.action.type==='choosePath')alternatives.push({...frame.action,pathId:frame.action.pathId==='left'?'right':'left'},{...frame.action,pathId:'eq'},{...frame.action,pathId:'s999'})
    if(frame.action.type==='swapPair')alternatives.push({...frame.action,aId:frame.action.bId,bId:frame.action.aId})
    for(const action of alternatives)checks.push({action,result:hash(oracle.applyAction(state,action))})
    const action={...frame.action,...(i%2===0?{actionId:`request-${i}`}:{})}
    const legal=hash(oracle.legalActions!(state));const r=oracle.applyAction(state,action);moves.push({action,legal,result:hash(r),checks});state=r.nextState
  }
  cases.push({id,seed,difficulty,initial,metadata,moves,canonical:hash(canonical),answer:hash(oracle.answerSummary(state)),terminal:hash(oracle.applyAction(state,{type:'selectObject',objectId:'v0'})),terminalLegal:hash(oracle.legalActions!(state))})
}
const output=new URL('../services/api-rust/tests/fixtures/stateful.json',import.meta.url)
const encoded=JSON.stringify(cases)+'\n'
if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==encoded)throw new Error('Rust oracles reference fixtures drifted')}else await writeFile(output,encoded)
console.log(`Captured ${cases.length} complete oracle journeys with invalid actions`)
