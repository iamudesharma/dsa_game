import {writeFile,mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp} from '../services/api/src/app.js'
import {createDecisionEngine} from '../packages/decision-layer/src/engine.js'
import {TemplateProvider} from '../packages/provider-chain/src/providers/template.js'
process.env.DSA_DB_PATH=join(await mkdtemp(join(tmpdir(),'dsa-game-validation-')),'fixture.sqlite')
const app=createApp({chain:[new TemplateProvider()],decisions:createDecisionEngine({backend:'heuristic',offline:true}),version:'test'})
const requests:any[]=[]
for(const body of [null,{},[],{problemId:''},{problemId:'unknown'},{problemId:'binary-search',seed:-1},{problemId:'binary-search',seed:1.5},{problemId:'binary-search',seed:'7'},{problemId:'binary-search',seed:9007199254740992},{problemId:'binary-search',difficulty:'low'},{problemId:'binary-search',freeText:'x'.repeat(501)}])requests.push({path:'/api/generate',body})
for(const path of ['/api/action','/api/undo','/api/hint'])for(const body of [null,{},[],{gameId:''},{gameId:'unknown'},{gameId:'unknown',action:{type:'bogus'}},{gameId:'unknown',action:{type:'selectObject'}},{gameId:'unknown',action:{type:'selectObject',objectId:'x'}},{gameId:'unknown',action:{type:'comparePair',aId:'x',bId:'y',relation:'no'}}])requests.push({path,body})
const cases=[]
for(const req of requests){const response=await app.request(req.path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req.body)});cases.push({...req,status:response.status,response:await response.json()})}
await writeFile(new URL('../services/api-rust/tests/fixtures/game-validation.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} Node game validation/error responses`)
