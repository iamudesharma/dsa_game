/** All seeded playable HTTP journeys; no providers except the offline template. */
import {writeFile,mkdtemp} from 'node:fs/promises'
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
const cases=[]
const warn=console.warn,log=console.log;console.warn=()=>{};console.log=()=>{}
try{
 for(const [id,oracle] of Object.entries(ORACLES)){
  if(process.env.DSA_PARITY_PROBLEM && id!==process.env.DSA_PARITY_PROBLEM)continue
  for(let seed=0;seed<30;seed++)for(const difficulty of ['easy','medium','hard'] as const){
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
await writeFile(process.env.DSA_PARITY_PROBLEM?'/tmp/dsa-node-game-detail.json':new URL('../services/api-rust/tests/fixtures/game-http.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} complete Node HTTP journeys`)
