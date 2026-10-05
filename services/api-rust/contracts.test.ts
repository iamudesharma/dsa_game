import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ResumeSchema, TargetSchema, ChatSendSchema, ChatActionSchema, ChatMessageSchema, InterviewKitSchema } from '../../packages/account/src/index.js'
import { ProgressBodySchema, ParseResumeBodySchema, InterviewGenerateBodySchema } from '../api/src/validate.js'
const { z } = createRequire(new URL('../api/package.json', import.meta.url))('zod')
describe('Rust shared contracts', () => {
  it('matches the live client/API schemas', () => {
    const schemas = { Resume: ResumeSchema, Target: TargetSchema, Progress: ProgressBodySchema, ParseResume: ParseResumeBodySchema, InterviewGenerate: InterviewGenerateBodySchema, InterviewKit: InterviewKitSchema, ChatSend: ChatSendSchema, ChatAction: ChatActionSchema, ChatMessage: ChatMessageSchema }
    expect(JSON.parse(readFileSync(new URL('./data/contracts.json', import.meta.url),'utf8'))).toMatchObject(Object.fromEntries(Object.entries(schemas).map(([name,schema])=>[name,z.toJSONSchema(schema,{io:'input'})])))
  })
  it('pins installed Zod Unicode code-point lengths', () => {
    expect(ResumeSchema.safeParse({contact:{name:'😀'.repeat(120)}}).success).toBe(true)
    expect(ResumeSchema.safeParse({contact:{name:'😀'.repeat(121)}}).success).toBe(false)
  })
})
