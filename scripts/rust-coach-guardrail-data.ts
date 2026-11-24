/** Export only trusted static pattern declarations; Rust consumes JSON, never JS. */
import { readFile,writeFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from '../services/api/node_modules/typescript/lib/typescript.js'
const path=new URL('../services/api/src/coach/guardrails.ts',import.meta.url)
const source=await readFile(path,'utf8');const ast=ts.createSourceFile('guardrails.ts',source,ts.ScriptTarget.Latest,true)
const names=['NUMBER_WORDS','CODE_LINE_SHAPES','ANSWER_CLAIM','INDEX_CLAIM','RESOLUTION_WORDS','VALUE_CLAIM','SOLUTION_STEP','SOLUTION_JOIN','FUTURE_LEAK','UNEARNED_CORRECTION','SAFE_LAST_RESORT']
const chunks:string[]=[]
for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&names.includes(declaration.name.text))chunks.push(`const ${declaration.getText(ast)};`)
if(chunks.length!==names.length)throw new Error('Static guardrail declarations changed')
const context=vm.createContext({});const js=ts.transpileModule(chunks.join('\n')+`\nglobalThis.result={${names.join(',')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
vm.runInContext(js,context)
function convert(value:any):any {if(value&&typeof value.source==='string'&&typeof value.flags==='string')return {source:value.source,flags:value.flags};if(Array.isArray(value))return value.map(convert);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,convert(v)]));return value}
await writeFile(new URL('../services/api-rust/data/coach-guardrails.json',import.meta.url),JSON.stringify(convert(context.result))+'\n')
console.log('Exported coach guardrail patterns')
