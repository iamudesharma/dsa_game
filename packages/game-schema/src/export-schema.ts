/**
 * Writes the GameSpec JSON Schema to `prompts/game-spec.schema.json` and a
 * GBNF-grammar-ready copy next to it. Run via `pnpm --filter @dsa/game-schema export-schema`.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gameSpecJsonSchema } from './json-schema.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../../../prompts')
mkdirSync(outDir, { recursive: true })

const schema = gameSpecJsonSchema()
const target = resolve(outDir, 'game-spec.schema.json')
writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')

console.log(`wrote ${target}`)
