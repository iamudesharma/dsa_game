import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PROBLEMS } from '../packages/game-schema/src/index.js'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { buildTemplateSpec } from '../packages/provider-chain/src/providers/template.js'
function stable(v:any):any {if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
const cases=[]
for(const problem of PROBLEMS) for(let seed=0;seed<30;seed++) for(const difficulty of ['easy','medium','hard'] as const) {
 const instance=ORACLES[problem.id]!.buildInstance({seed,difficulty})
 const spec=buildTemplateSpec({problem,instance,seed,difficulty,language:'en'})
 cases.push({id:problem.id,seed,difficulty,hash:createHash('sha256').update(JSON.stringify(stable(spec))).digest('hex')})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/templates.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} Node template specs before Rust implementation`)
