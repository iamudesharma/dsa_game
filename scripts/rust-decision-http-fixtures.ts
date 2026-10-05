import { writeFile } from 'node:fs/promises'
import { createApp } from '../services/api/src/app.js'
import { createDecisionEngine } from '../packages/decision-layer/src/engine.js'
const app=createApp({chain:[],decisions:createDecisionEngine({backend:'heuristic',offline:true}),version:'test'})
const requests:any[]=[]
for(const freeText of ['', 'binary-search', 'I want to practise sorting', 'unknown zzz', '😀'.repeat(300)]) requests.push({path:'/api/suggest',body:{freeText}})
requests.push({path:'/api/suggest',body:null},{path:'/api/decide',body:{}},{path:'/api/decide',body:{kind:'bogus',stateText:'x',options:{},instructions:'choose'}})
for(const kind of ['route-problem','pick-theme','pick-hint','tag-misconception','difficulty'])for(const stateText of ['binary search','hintsUsed=2 lastMistakeOp=compare','compare wrong; assign mistake; choose-path wrong','steps=40 mistakes=2 hints=1','player wish: not easy, hard'])for(const options of [{},{only:'only'},{'2':'next','0':'begin','1':'more'},{'binary-search':'search','bubble-sort':'sort'},{easy:'easy',medium:'medium',hard:'hard'}])requests.push({path:'/api/decide',body:{kind,stateText,options,instructions:'choose',extra:'stripped'}})
requests.push({path:'/api/decide',body:{kind:'difficulty',stateText:'hard',options:Object.fromEntries(Array.from({length:65},(_,i)=>['k'+i,'x'])),instructions:'choose'}})
const cases=[]
for(const req of requests){const response=await app.request(req.path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req.body)});cases.push({...req,status:response.status,response:await response.text()})}
await writeFile(new URL('../services/api-rust/tests/fixtures/decision-http.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} deterministic Node HTTP responses`)
