/** Shared schemas exported at development time; Rust has no JS dependency. */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { ResumeSchema, TargetSchema, ChatSendSchema, ChatActionSchema, ChatMessageSchema, InterviewKitSchema } from '../packages/account/src/index.js'
import { ProgressBodySchema, ParseResumeBodySchema, InterviewGenerateBodySchema, GenerateBodySchema, ActionBodySchema, UndoBodySchema, HintBodySchema, DecideBodySchema, CoachAskBodySchema, CoachThreadsQuerySchema } from '../services/api/src/validate.js'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { GameSpecSchema, DSA_OPS } from '../packages/game-schema/src/index.js'
const { z } = createRequire(new URL('../services/api/package.json', import.meta.url))('zod')
const schemas = { Resume: ResumeSchema, Target: TargetSchema, Progress: ProgressBodySchema, ParseResume: ParseResumeBodySchema, InterviewGenerate: InterviewGenerateBodySchema, InterviewKit: InterviewKitSchema, ChatSend: ChatSendSchema, ChatAction: ChatActionSchema, ChatMessage: ChatMessageSchema, Generate: GenerateBodySchema, Action: ActionBodySchema, Undo: UndoBodySchema, Hint: HintBodySchema, Decide: DecideBodySchema, CoachAsk: CoachAskBodySchema, CoachThreadsQuery: CoachThreadsQuerySchema, GameSpec: GameSpecSchema }
// Export private legacy persistence schemas without importing the database module.
const legacySource = readFileSync(new URL('../services/api/src/learning/store.ts', import.meta.url), 'utf8')
const legacyTree = ts.createSourceFile('store.ts', legacySource, ts.ScriptTarget.Latest, true)
const legacyNames = ['scalar','count','objectState','slot','instance','StoredStateSchema','SnapshotSchema']
const legacyStatements = legacyTree.statements.filter(s => ts.isVariableStatement(s) && s.declarationList.declarations.every(d => legacyNames.includes(d.name.getText(legacyTree))))
if (legacyStatements.length !== legacyNames.length) throw new Error('Legacy persistence schema declarations changed')
const legacyCode = ts.transpileModule(legacyStatements.map(s => s.getText(legacyTree)).join(';\n') + ';\n({StoredStateSchema,SnapshotSchema})', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const legacy = runInNewContext(legacyCode, {z,GameSpecSchema,ActionBodySchema,DSA_OPS}, {timeout:1000})
Object.assign(schemas, {StoredState:legacy.StoredStateSchema, GameSnapshot:legacy.SnapshotSchema})
const data = Object.fromEntries(Object.entries(schemas).map(([name,schema]) => [name, z.toJSONSchema(schema, { io: 'input' })]))
const output = new URL('../services/api-rust/data/contracts.json', import.meta.url)
const text = JSON.stringify(data, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(output,'utf8') !== text) throw new Error('Rust contracts drifted; regenerate with scripts/rust-contracts.ts')
} else writeFileSync(output,text)
