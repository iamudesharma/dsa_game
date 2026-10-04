/** Authored routing tables only; no JavaScript executes in the Rust service. */
import { readFile, writeFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const source=await readFile(new URL('../packages/decision-layer/src/heuristics.ts',import.meta.url),'utf8')
const tree=ts.createSourceFile('heuristics.ts',source,ts.ScriptTarget.Latest,true)
const names=['INFLECTIONS','KEYWORDS','STOPWORDS','TOPIC_ENTRY','DSA_OP_HINT_WORDS','MISCONCEPTION_LABELS','OP_TO_LABEL','LABEL_PRIORITY']
const data:Record<string,unknown>={}
for(const statement of tree.statements) {
 if(!ts.isVariableStatement(statement))continue
 for(const declaration of statement.declarationList.declarations){
  const name=declaration.name.getText(tree);if(!names.includes(name)||!declaration.initializer)continue
  const code=ts.transpileModule(`const data=${declaration.initializer.getText(tree)};data`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const value=runInNewContext(code,{}, {timeout:1000});data[name]=name==='STOPWORDS'?Array.from(value):value
 }
}
if(Object.keys(data).length!==names.length)throw new Error('Missing routing constants')
const text=JSON.stringify(data,null,2)+'\n';const output=new URL('../services/api-rust/data/decisions.json',import.meta.url)
if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==text)throw new Error('Decision data drifted')}else await writeFile(output,text)
