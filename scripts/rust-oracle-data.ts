/** Static client-visible listings and metadata; never executed by Rust. */
import { readFile,writeFile } from 'node:fs/promises'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
const data=Object.fromEntries(Object.entries(ORACLES).map(([id,o])=>[id,{pseudocode:o.pseudocode(),complexity:o.complexity(),code:Object.fromEntries(['javascript','typescript','python','java','cpp'].map(language=>[language,o.code(language as any)]))}]))
const output=new URL('../services/api-rust/data/oracles.json',import.meta.url);const text=JSON.stringify(data,null,2)+'\n'
if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==text)throw new Error('Static oracle data drifted')}else await writeFile(output,text)
