/** All seeded playable HTTP journeys; no providers except the offline template. */
import {readFile,writeFile,mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createApp} from '../services/api/src/app.js'
import {createDecisionEngine} from '../packages/decision-layer/src/engine.js'
import {TemplateProvider} from '../packages/provider-chain/src/providers/template.js'
import {ORACLES} from '../packages/dsa-oracles/src/index.js'
process.env.DSA_DB_PATH=join(await mkdtemp(join(tmpdir(),'dsa-game-node-http-')),'fixture.sqlite')
const app=createApp({chain:[new TemplateProvider()],decisions:createDecisionEngine({backend:'heuristic',offline:true}),version:'test'})
function stable(v:any):any {if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,k==='gameId'?'fixture-game':k==='ms'?0:stable(v)]));return v}
function hash(status:number,body:any){return createHash('sha256').update(JSON.stringify(stable({status,body}))).digest('hex')}
const check = process.argv.includes('--check')
const seedFilter = process.env.DSA_PARITY_SEED === undefined ? undefined : Number(process.env.DSA_PARITY_SEED)
if (seedFilter !== undefined && (!Number.isInteger(seedFilter) || seedFilter < 0 || seedFilter >= 30)) {
  throw new Error('DSA_PARITY_SEED must be an integer from 0 through 29')
}
if (seedFilter !== undefined && !check) {
  throw new Error('Seed filtering is only supported with --check; fixture generation must cover all seeds')
}
if (check && process.env.DSA_PARITY_PROBLEM) {
  throw new Error('DSA_PARITY_PROBLEM is for diagnostic generation, not --check')
}
const cases=[]
const warn=console.warn,log=console.log;console.warn=()=>{};console.log=()=>{}
try{
 for(const [id,oracle] of Object.entries(ORACLES)){
  if(process.env.DSA_PARITY_PROBLEM && id!==process.env.DSA_PARITY_PROBLEM)continue
  for(let seed=0;seed<30;seed++)for(const difficulty of ['easy','medium','hard'] as const){
   if(seedFilter !== undefined && seed !== seedFilter) continue
   const response=await app.request('/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({problemId:id,seed,difficulty,forceTemplate:true})})
   const initial=await response.json() as any;if(response.status!==200)throw new Error(`${id}: ${JSON.stringify(initial)}`)
   const gameId=initial.gameId,requests:any[]=[]
   async function request(path:string,body?:any){const response=await app.request(path,{method:body?'POST':'GET',...(body?{headers:{'content-type':'application/json'},body:JSON.stringify({...body,gameId})}:{})});const parsed=await response.json();requests.push({path:path.replace(gameId,'fixture-game'),...(body?{body}:{}),hash:hash(response.status,parsed),...(process.env.DSA_PARITY_PROBLEM?{response:parsed}:{})})}
   await request(`/api/game/${gameId}`)
   await request('/api/undo',{})
   await request('/api/hint',{})
   await request('/api/action',{action:{type:'assignValue',targetId:'missing',value:'wrong'}})
   const frames=oracle.canonicalTrace(initial.state)
   for(const [index,frame] of frames.entries()){
    await request('/api/action',{action:frame.action})
    if(index===0){await request('/api/undo',{});await request('/api/action',{action:frame.action})}
   }
   await request(`/api/game/${gameId}`)
   await request(`/api/game/${gameId}/debrief`)
   cases.push({id,seed,difficulty,generate:hash(response.status,initial),requests})
  }
  log(`Captured HTTP journeys ${id}`)
 }
}finally{console.warn=warn;console.log=log}
const output = new URL('../services/api-rust/tests/fixtures/game-http.json', import.meta.url)
if (check) {
  const expected = JSON.parse(await readFile(output, 'utf8')).filter((entry: { seed: number }) => seedFilter === undefined || entry.seed === seedFilter)
  if (JSON.stringify(expected) !== JSON.stringify(cases)) {
    throw new Error('Rust HTTP journey fixtures drifted; regenerate with scripts/rust-game-http-fixtures.ts')
  }
  console.log(`Verified ${cases.length} complete Node HTTP journeys`)
} else {
  await writeFile(process.env.DSA_PARITY_PROBLEM ? '/tmp/dsa-node-game-detail.json' : output, JSON.stringify(cases) + '\n')
}
if (!check) console.log(`Captured ${cases.length} complete Node HTTP journeys`)
