import {readFile,writeFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from '../services/api/node_modules/typescript/lib/typescript.js'
const source=await readFile(new URL('../services/api/src/coach/fallback.ts',import.meta.url),'utf8');const ast=ts.createSourceFile('fallback.ts',source,ts.ScriptTarget.Latest,true)
const names=['INTENTS','INTENT_FALLBACK_ORDER'];const chunks:string[]=[]
for(const s of ast.statements)if(ts.isVariableStatement(s))for(const d of s.declarationList.declarations)if(ts.isIdentifier(d.name)&&names.includes(d.name.text))chunks.push(`const ${d.getText(ast)};`)
if(chunks.length!==names.length)throw new Error('Fallback declarations changed')
const context=vm.createContext({});vm.runInContext(ts.transpileModule(chunks.join('\n')+`\nglobalThis.result={${names.join(',')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context)
await writeFile(new URL('../services/api-rust/data/coach-fallback.json',import.meta.url),JSON.stringify(context.result,(_,v)=>v&&typeof v.source==='string'&&typeof v.flags==='string'?{source:v.source,flags:v.flags}:v)+'\n')
console.log('Exported coach fallback intents')
