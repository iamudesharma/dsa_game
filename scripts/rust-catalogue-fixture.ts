import { writeFile } from 'node:fs/promises'
import { createApp } from '../services/api/src/app.js'
import { createDecisionEngine } from '../packages/decision-layer/src/engine.js'
const app=createApp({chain:[],decisions:createDecisionEngine({backend:'heuristic',offline:true}),version:'test'})
const response=await app.request('/api/catalogue')
if(response.status!==200)throw new Error('Catalogue failed')
const text=await response.text(), body=JSON.parse(text)
await writeFile(new URL('../services/api-rust/tests/fixtures/catalogue.json',import.meta.url),text+'\n')
await writeFile(new URL('../services/api-rust/data/catalogue.json',import.meta.url),JSON.stringify({topics:body.topics.map(({id,label}:any)=>({id,label})),tiers:body.tiers},null,2)+'\n')
console.log(`Captured ${body.topics.length} topics with ${body.topics.flatMap((t:any)=>t.problems).length} problems`)
