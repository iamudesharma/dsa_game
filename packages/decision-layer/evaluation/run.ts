import { DEFAULT_CACHE_DIR } from '../src/local-router.js'
import { createHash } from 'node:crypto'
import { fixtures } from './fixtures.js'
import { spawn } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { CANDIDATES } from '../src/candidates.js'
const mode = process.argv[2] ?? 'benchmark'
const requested = process.argv[3] ?? (mode === 'prepare' ? 'minilm-l3' : 'all')
const candidates = requested === 'all' ? (mode === 'prepare' ? Object.keys(CANDIDATES) : ['heuristic', ...Object.keys(CANDIDATES), 'laya']) : [requested]
if (!['prepare','benchmark'].includes(mode)) throw new Error('Use prepare or benchmark')
const cacheDir = resolve(process.env.DECISION_CACHE_DIR || DEFAULT_CACHE_DIR)
const entry = fileURLToPath(new URL('./benchmark.ts', import.meta.url))
const output = resolve('.dev/router-benchmarks')
await mkdir(output,{recursive:true})
for (const candidate of candidates) {
  if (!(Object.hasOwn(CANDIDATES, candidate)) && !['heuristic','laya'].includes(candidate)) throw new Error(`Unknown candidate: ${candidate}`)
  console.log(`${mode}: ${candidate} (separate process)`)
  const code = await new Promise<number|null>((done,reject) => {
    const child = spawn(process.execPath,[...process.execArgv,entry,candidate,mode],{env:{...process.env,DECISION_CACHE_DIR:cacheDir},stdio:['ignore','pipe','inherit']})
    let stdout=''; child.stdout.on('data',data=>stdout+=data); child.on('error',reject)
    child.on('close',async code=>{ await writeFile(resolve(output,`${candidate}.${mode}.log`),stdout); done(code) })
  })
  if (code && candidate !== 'laya') process.exitCode = 1
}
if (mode === 'benchmark') {
  const reports = []
  for (const candidate of ['heuristic', ...Object.keys(CANDIDATES), 'laya']) {
    try { reports.push(JSON.parse(await readFile(resolve(output,`${candidate}.json`),'utf8'))) } catch {}
  }
  const fixtureHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex')
  const current = reports.filter(r=>r.fixtureHash === fixtureHash)
  const baseline = current.find(r=>r.candidate==='heuristic')
  const measured = current.filter(r=>Object.hasOwn(CANDIDATES, r.candidate))
  const bestAccuracy = Math.max(...measured.map(r=>r.heldout.accuracy))
  const complete = Object.keys(CANDIDATES).every(id=>measured.some(r=>r.candidate===id)) && baseline !== undefined
  const eligible = (complete ? measured : []).filter(r=>r.heldout.accuracy >= bestAccuracy-.01 && r.heldout.accuracy >= (baseline?.heldout.accuracy ?? 1) && r.steadyIncrementalMB<=250 && r.warmP95Ms<=100).sort((a,b)=>a.steadyIncrementalMB-b.steadyIncrementalMB)
  const selection = { complete, selected:eligible[0]?.candidate ?? null, thresholds:eligible[0]?.thresholds, bestAccuracy, layaMeasured:current.some(r=>r.candidate==='laya'), candidates:current.map(r=>({candidate:r.candidate,measuredAt:r.measuredAt,sidecarPhysicalFootprint:r.sidecarPhysicalFootprint,sidecarRSSMB:r.sidecarRSSMB,accuracy:r.heldout.accuracy,macroF1:r.heldout.macroF1,wrongAccepted:r.heldout.wrongAccepted,steadyIncrementalMB:r.steadyIncrementalMB,peakIncrementalMB:r.peakIncrementalMB,warmP95Ms:r.warmP95Ms})), action:eligible.length?'Candidate qualifies on this fixture set; require downstream and stack checks before enabling.':'Keep deterministic defaults; report failures before proposing training.' }
  await writeFile(resolve(output,'selection.json'),JSON.stringify(selection,null,2));console.log(JSON.stringify(selection,null,2))
}
