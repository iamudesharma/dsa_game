import {writeFile,mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp} from '../services/api/src/app.js'
import {createDecisionEngine} from '../packages/decision-layer/src/engine.js'
import {TemplateProvider} from '../packages/provider-chain/src/providers/template.js'
import {ORACLES} from '../packages/dsa-oracles/src/index.js'
process.env.DSA_DB_PATH=join(await mkdtemp(join(tmpdir(),'node-coach-http-')),'fixture.sqlite');process.env.COACH_TRANSPORT='0'
const app=createApp({chain:[new TemplateProvider()],decisions:createDecisionEngine({backend:'heuristic',offline:true}),version:'test'})
const cases:any[]=[]
const log=console.log;console.log=()=>{};console.warn=()=>{}
for(const [id,oracle] of Object.entries(ORACLES))for(const difficulty of ['easy','medium','hard'] as const){
 const generated=await(await app.request('/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({problemId:id,seed:7,difficulty,forceTemplate:true})})).json() as any
 const gameId=generated.gameId;const steps:any[]=[];const threads:string[]=[];const ids=new Map<string,string>([[gameId,'fixture-game']]);let turn=0
 const normalize=(v:any,key=''):any=>{if(['createdAt','updatedAt','lastAccessedAt','at','latencyMs'].includes(key))return 0;if(typeof v==='string'){if(ids.has(v))return ids.get(v);if(v.startsWith('turn-')){ids.set(v,`turn-${turn++}`);return ids.get(v)}return v}if(Array.isArray(v)){const values=v.map(x=>normalize(x));return key==='threads'?values.sort((a,b)=>a.id.localeCompare(b.id)):values;}if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x,k)]));return v}
 async function request(path:string,body?:any,method=body?'POST':'GET'){
  const response=await app.request(path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const parsed=await response.json() as any
  if(parsed.threadId&&!ids.has(parsed.threadId)){threads.push(parsed.threadId);ids.set(parsed.threadId,`thread-${threads.length-1}`)}
  steps.push({path:path.replace(threads[0]??'not-a-thread','thread-0').replace(threads[1]??'not-a-thread','thread-1').replace(gameId,'fixture-game'),method,...(body?{body:normalize(body)}:{}),status:response.status,response:normalize(parsed)});return parsed
 }
 const first=await request('/api/coach/ask',{gameId,message:'which half should I keep?',band:'builder'})
 await request('/api/coach/ask',{gameId,threadId:first.threadId,message:'which half should I keep?',band:'newcomer'})
 await request(`/api/coach/threads?gameId=${gameId}`)
 await request(`/api/coach/threads/${first.threadId}`)
 const frames=oracle.canonicalTrace(generated.state);if(frames[0])await request('/api/action',{gameId,action:frames[0].action})
 await request('/api/coach/ask',{gameId,threadId:first.threadId,message:'which value should I compare?',band:'explorer'})
 await request('/api/coach/ask',{gameId,message:'why was that wrong?'})
 await request('/api/coach/ask',{gameId,threadId:'missing-thread',message:'help'})
 await request(`/api/coach/threads/${first.threadId}`,undefined,'DELETE')
 await request(`/api/coach/threads/${first.threadId}`)
 await request(`/api/coach/threads?gameId=${gameId}`)
 cases.push({id,difficulty,steps})
}
const errors:any[]=[]
for(const [path,body,method]of [['/api/coach/ask',{},'POST'],['/api/coach/ask',{gameId:'missing',message:'help'},'POST'],['/api/coach/ask',{gameId:'x',message:'',band:'invalid'},'POST'],['/api/coach/threads',undefined,'GET'],['/api/coach/threads?gameId=missing',undefined,'GET'],['/api/coach/threads/missing',undefined,'GET'],['/api/coach/threads/missing',undefined,'DELETE']] as const){const response=await app.request(path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});errors.push({path,body,method,status:response.status,response:await response.json()})}
await writeFile(new URL('../services/api-rust/tests/fixtures/coach-http.json',import.meta.url),JSON.stringify({cases,errors})+'\n');log(`Captured ${cases.length} Node coach HTTP journeys`)
