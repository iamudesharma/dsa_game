import { readFile,writeFile } from 'node:fs/promises'
import { createApp } from '../services/api/src/app.js'
import { createDecisionEngine } from '../packages/decision-layer/src/engine.js'
import { putSession } from '../services/api/src/store.js'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { createGameRuntime } from '../packages/game-engine/src/index.js'
const app=createApp({chain:[],decisions:createDecisionEngine({backend:'heuristic',offline:true}),version:'test'})
const snapshots=JSON.parse(await readFile(new URL('../services/api-rust/tests/fixtures/game-snapshots.json',import.meta.url),'utf8'))
const cases=[]
for(const stored of snapshots){
 const session={...stored, userId:undefined,createdAt:Date.now(),lastAccessedAt:Date.now(),oracle:ORACLES[stored.problemId]!};putSession(session)
 const path=`/api/game/${stored.gameId}/debrief`
 let response=await app.request(path);cases.push({snapshot:session,path,status:response.status,response:await response.text()})
 const runtime=createGameRuntime(session.oracle)
 let state=runtime.init(session.seed,session.difficulty)
 for(const frame of session.oracle.canonicalTrace(state))state=runtime.apply(state,frame.action).state
 const terminal={...session,state};putSession(terminal)
 response=await app.request(path);cases.push({snapshot:terminal,path,status:response.status,response:await response.text()})
}
const response=await app.request('/api/game/missing/debrief')
cases.push({path:'/api/game/missing/debrief',status:response.status,response:await response.text()})
await writeFile(new URL('../services/api-rust/tests/fixtures/game-debrief-http.json',import.meta.url),JSON.stringify(cases,(k,v)=>k==='oracle'?undefined:v)+'\n')
console.log(`Captured ${cases.length} Node game-debrief HTTP responses`)
