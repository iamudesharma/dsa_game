/** Mocked Node HTTP protocol: no external calls or paid providers. */
import {writeFile} from 'node:fs/promises'
import {PROBLEMS} from '../packages/game-schema/src/index.js'
import {ORACLES} from '../packages/dsa-oracles/src/index.js'
import {buildTemplateSpec} from '../packages/provider-chain/src/providers/template.js'
import {OpencodeGoProvider,opencodeGoConfigFromEnv} from '../packages/provider-chain/src/providers/opencode-go.js'
import {OpenrouterProvider,openrouterConfigFromEnv} from '../packages/provider-chain/src/providers/openrouter.js'
const cases=[]
const fixtures:any[]=[]
for(const problem of PROBLEMS) {
 const instance=ORACLES[problem.id]!.buildInstance({seed:7,difficulty:'easy'})
 const input={problem,instance,seed:7,difficulty:'easy' as const,language:'en' as const,freeText:'A quiet garden'}
 const spec=buildTemplateSpec(input)
 fixtures.push({name:problem.id,input,body:{choices:[{message:{content:JSON.stringify({...spec,problemId:'wrong-identity',seed:999})}}]}})
}
const base=fixtures[0]
const spec=JSON.parse(base.body.choices[0].message.content)
for(const [name,content] of [['fence','```JSON\n'+JSON.stringify(spec)+'\n```'],['wrapper',JSON.stringify({spec})],['game-wrapper',JSON.stringify({game:spec})],['invalid-json','not json'],['duplicate',JSON.stringify({...spec,mechanics:[spec.mechanics[0],spec.mechanics[0]]})],['empty',''],['null','null']])fixtures.push({name,input:base.input,body:{choices:[{message:{content}}]}})
for(const [name,body,status] of [['auth-envelope',{type:'error',error:{type:'AuthError',message:'Bad key'}},200],['length',{choices:[{finish_reason:'length',message:{content:''}}]},200],['http401',{error:{message:'invalid key'}},401],['text-fallback',{choices:[{text:JSON.stringify(spec)}]},200]])fixtures.push({name,input:base.input,body,status})
const go=new OpencodeGoProvider(opencodeGoConfigFromEnv({OPENCODE_GO_ENABLED:'1',OPENCODE_GO_API_KEY:'fixture-key',OPENCODE_GO_MODEL:'fixture-model',OPENCODE_GO_BASE_URL:'http://fixture.invalid',OPENCODE_GO_SESSION:'fixture-session'}))
const router=new OpenrouterProvider(openrouterConfigFromEnv({OPENROUTER_API_KEY:'fixture-key',OPENROUTER_MODEL:'fixture-model',OPENROUTER_BASE_URL:'http://fixture.invalid'}))
const prior=globalThis.fetch
try {
 for(const tier of [go,router])for(const f of fixtures) {
  let request:any
  globalThis.fetch=async(_url,init)=>{request=JSON.parse(String(init?.body));return new Response(JSON.stringify(f.body),{status:f.status??200})}
  const c:any={...f,tier:tier.tier};try{c.spec=await tier.generate(f.input)}catch(e){c.error={name:(e as Error).name,message:(e as Error).message}}
  c.request=request;cases.push(c)
 }
}finally{globalThis.fetch=prior}
await writeFile(new URL('../services/api-rust/tests/fixtures/game-providers.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} mocked Node provider responses`)
