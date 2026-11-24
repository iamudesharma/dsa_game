import {writeFile} from 'node:fs/promises'
import {PROBLEMS} from '../packages/game-schema/src/index.js'
import {ORACLES} from '../packages/dsa-oracles/src/index.js'
import {buildTemplateSpec} from '../packages/provider-chain/src/providers/template.js'
import {chainGenerateSpec} from '../packages/provider-chain/src/chain.js'
import {SpecValidationError} from '../packages/provider-chain/src/types.js'
const problem=PROBLEMS[0]!, instance=ORACLES[problem.id]!.buildInstance({seed:7,difficulty:'easy'}),input={problem,instance,seed:7,difficulty:'easy' as const}
const spec=buildTemplateSpec(input)
const scenarios=[{name:'offline',go:'off',router:'off'},{name:'forced',go:'success',router:'success',forceTemplate:true},{name:'go-success',go:'success',router:'success'},{name:'router-fallback',go:'error',router:'success'},{name:'all-failed',go:'error',router:'error'},{name:'go-repair',go:'repair',router:'success'},{name:'repair-failed',go:'repair-failed',router:'success'}]
const cases=[]
for(const scenario of scenarios){
 const providers=['opencode-go','opencode','openrouter','local-llm','template'].map(tier=>{
  const mode=tier==='opencode-go'?scenario.go:tier==='openrouter'?scenario.router:tier==='template'?'success':'off'
  return {tier,isAvailable:async()=>mode!=='off',generate:async()=>{if(mode==='error')throw new Error('mock provider failure');if(mode.startsWith('repair'))throw new SpecValidationError('mock schema failure');return spec},repair:async()=>{if(mode==='repair-failed')throw new Error('mock repair failure');return spec}}
 })
 const result=await chainGenerateSpec({...input,forceTemplate:scenario.forceTemplate},{providers:providers as any})
 result.attempts=result.attempts.map(a=>({...a,ms:0}))
 cases.push({scenario,input,result})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/game-chain.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} Node generation chains`)
