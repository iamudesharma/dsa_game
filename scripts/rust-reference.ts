/** Capture the deterministic Node reference without invoking paid providers.
 * Run: pnpm --filter @dsa/api exec tsx ../../scripts/rust-reference.ts
 * Fixtures go under ignored run/rust-reference, never into the user database.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { createHash, scryptSync } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { createGameRuntime } from '../packages/game-engine/src/index.js'
import { makeRng } from '../packages/game-schema/src/index.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const directory = resolve(root, 'run/rust-reference')
await mkdir(directory, { recursive: true })
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, v]) => [key, stable(v)]),
  )
  return value
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex') }

const sources = ['services/api/src/app.ts', 'services/api/src/learning/routes.ts']
const routes = (await Promise.all(sources.map(async path => {
  const source = await readFile(resolve(root, path), 'utf8')
  return [...source.matchAll(/app\.(get|post|put|delete|patch)\('([^']+)'/g)].map(m => ({ method: m[1]!.toUpperCase(), path: m[2], source: path }))
}))).flat()
const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
const hash = `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync('password123', salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`
const random = [0, 1, -1, 4294967297, 123.9].map(seed => {
  const rng = makeRng(seed); return { seed, values: Array.from({ length: 10 }, () => rng()) }
})
await writeFile(resolve(directory, 'contracts.json'), JSON.stringify({ routes, password: { input: 'password123', hash }, random, problems: Object.keys(ORACLES) }, null, 2))

let count = 0
for (const [problemId, oracle] of Object.entries(ORACLES)) {
  const output = createWriteStream(resolve(directory, `${problemId}.jsonl.gz`))
  const gzip = createGzip()
  const completion = finished(output)
  gzip.on('error', error => output.destroy(error))
  output.on('error', error => gzip.destroy(error))
  gzip.pipe(output)
  const runtime = createGameRuntime(oracle)
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    for (let seed = 1; seed <= 30; seed++) {
      const instance = oracle.buildInstance({ seed, difficulty })
      const initial = oracle.initState(instance)
      const canonicalTrace = oracle.canonicalTrace(initial)
      let state = runtime.init(seed, difficulty)
      const steps: { action: unknown; stateDigest: string; outcome: unknown; warnings: string[] }[] = []
      for (const frame of canonicalTrace) {
        if (state.phase !== 'playing') break
        const result = runtime.apply(state, frame.action)
        state = result.state
        steps.push({ action: frame.action, stateDigest: digest(state), outcome: result.outcome, warnings: result.warnings })
      }
      if (state.phase !== 'won') throw new Error(`${problemId}/${difficulty}/${seed} did not win`)
      const record = { problemId, seed, difficulty, instance, initial, canonicalTrace, steps, terminal: state.phase }
      if (!gzip.write(`${JSON.stringify(record)}\n`)) await once(gzip, 'drain')
      count++
    }
  }
  gzip.end(); await completion
  console.log(`[rust-reference] ${problemId}: 90 winning runs`)
}
await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, complete: true, runs: count, problems: Object.keys(ORACLES).length, seeds: 30, difficulties: ['easy', 'medium', 'hard'], stateDigest: 'SHA-256 of recursively key-sorted JSON using en localeCompare', apiResponseFixturesComplete: false }, null, 2))
console.log(`[rust-reference] ${count} runs written to ${directory}; API response parity still pending`)
