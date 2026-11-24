/** Development-only reference for every registered seeded generator. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
function stable(v:unknown):unknown {
  if(Array.isArray(v))return v.map(stable)
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]))
  return v
}
const cases=[]
for(const [id,oracle] of Object.entries(ORACLES))for(const difficulty of ['easy','medium','hard'] as const){
  for(const seed of [...Array.from({length:30},(_,i)=>i),-1,0.5,4294967297,9007199254740991])for(const length of seed>=0&&seed<30?[undefined]:[undefined,1,999,3.9]){
    const input={seed,difficulty,...(length===undefined?{}:{length})}
    cases.push({id,input,sha256:createHash('sha256').update(JSON.stringify(stable(oracle.buildInstance(input)))).digest('hex')})
  }
}
const output=new URL('../services/api-rust/tests/fixtures/instances.json',import.meta.url)
const encoded=JSON.stringify(cases)+'\n'
if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==encoded)throw new Error('Rust instances reference fixtures drifted')}else await writeFile(output,encoded)
console.log(`Captured ${cases.length} seeded instance hashes across ${Object.keys(ORACLES).length} oracles`)
