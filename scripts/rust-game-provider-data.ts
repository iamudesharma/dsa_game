/** Static schemas and system prose only. No provider or JavaScript runtime is deployed. */
import {readFile,writeFile} from 'node:fs/promises'
import {PROBLEMS,MECHANICS,gameSpecJsonSchema,toStrictJsonSchema} from '../packages/game-schema/src/index.js'
import {systemPrompt} from '../packages/provider-chain/src/prompt.js'
import {schemaForProblem,schemaForLlamaCpp,jsonSchemaToGbnf} from '../packages/provider-chain/src/grammar.js'
const schemas:Record<string,unknown>={},byProblem:Record<string,string>={}
for(const problem of PROBLEMS) {
 const key=problem.allowedMechanics.join(',')
 byProblem[problem.id]=key
 if(schemas[key])continue
 const schema=schemaForProblem(gameSpecJsonSchema(),problem.allowedMechanics.map(id=>({id,op:MECHANICS[id].op})))
 const llama=schemaForLlamaCpp(schema)
 schemas[key]={normal:schema,strict:toStrictJsonSchema(schema),llama,grammar:jsonSchemaToGbnf(llama)}
}
const output=new URL('../services/api-rust/data/game-provider.json',import.meta.url)
const text=JSON.stringify({system:systemPrompt(),schemas,byProblem})+'\n'
if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==text)throw new Error('Game provider data drifted')}else await writeFile(output,text)
console.log(`Exported ${Object.keys(schemas).length} shared schema combinations`)
