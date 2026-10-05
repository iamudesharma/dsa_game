/** Export authored static data only; Rust never evaluates JavaScript. */
import { readFile, writeFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { MECHANICS, TOPIC_LABELS } from '../packages/game-schema/src/index.js'
import { TEMPLATE_THEMES } from '../packages/provider-chain/src/themes.js'
const source = await readFile(new URL('../packages/provider-chain/src/providers/template.ts', import.meta.url), 'utf8')
const tree = ts.createSourceFile('template.ts', source, ts.ScriptTarget.Latest, true)
const names = ['MECHANICS_WANTED', 'CONTAINER_TERM', 'SCOPE_TERM', 'HINT_LADDER']
const constants: Record<string, unknown> = {}
for (const statement of tree.statements) {
 if (!ts.isVariableStatement(statement)) continue
 for (const declaration of statement.declarationList.declarations) {
  const name = declaration.name.getText(tree)
  if (!names.includes(name) || !declaration.initializer) continue
  const code = ts.transpileModule(`const data = ${declaration.initializer.getText(tree)}; data`, {compilerOptions: {target:ts.ScriptTarget.ES2022}}).outputText
  constants[name] = runInNewContext(code, {}, {timeout:1000})
 }
}
if (Object.keys(constants).length !== names.length) throw new Error('Template constants missing')
const text = JSON.stringify({themes:TEMPLATE_THEMES, mechanics:MECHANICS, topicLabels:TOPIC_LABELS, ...constants}, null, 2)+'\n'
const output = new URL('../services/api-rust/data/templates.json', import.meta.url)
if (process.argv.includes('--check')) {if (await readFile(output,'utf8') !== text) throw new Error('Template static data drifted')} else await writeFile(output,text)
