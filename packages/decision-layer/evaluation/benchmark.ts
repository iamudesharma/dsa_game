import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { LayaClient, readLayaEnv } from '../src/laya-client.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LocalRouter, DEFAULT_CACHE_DIR } from '../src/local-router.js'
import { CANDIDATES, type CandidateId } from '../src/candidates.js'
import { createDecisionEngine, heuristicFor } from '../src/engine.js'
import { ruleIntent } from '../src/examples.js'
import { fixtures, type Fixture } from './fixtures.js'

function footprint(pid: number) {
  if (process.platform !== 'darwin') return undefined
  try {
    const summary = execFileSync('vmmap', ['-summary', String(pid)], {encoding:'utf8',timeout:10_000})
    return { steady: /Physical footprint:\s+(\S+)/.exec(summary)?.[1], peak: /Physical footprint \(peak\):\s+(\S+)/.exec(summary)?.[1] }
  } catch { return undefined }
}
const candidate = process.argv[2] ?? 'minilm-l6'
const operation = process.argv[3] ?? 'benchmark'
if (!(Object.hasOwn(CANDIDATES, candidate)) && !['heuristic', 'laya'].includes(candidate)) throw new Error('Unknown benchmark candidate')
const cacheDir = resolve(process.env.DECISION_CACHE_DIR || DEFAULT_CACHE_DIR)
const baselineRSS = process.memoryUsage().rss
const measuredAt = new Date().toISOString()
const fixtureHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex')
function sidecarRSS() {
  if (candidate !== 'laya') return 0
  try {
    const pid = readFileSync(new URL('../../../run/laya/laya.pid', import.meta.url), 'utf8').trim()
    if (!/^\d+$/.test(pid)) return 0
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', pid], { encoding: 'utf8' }).trim()) * 1024
  } catch { return 0 }
}
const router = Object.hasOwn(CANDIDATES, candidate) ? new LocalRouter({ candidate: candidate as CandidateId, cacheDir, allowDownload: operation === 'prepare', timeoutMs: 30_000 }) : null
const laya = candidate === 'laya' ? createDecisionEngine({ backend: 'laya', enabled: true }) : null
const started = performance.now()
if (router && !await router.prepare()) { console.error(`Cannot load ${candidate}; prepare model explicitly first`); process.exitCode = 1; await router.dispose() }
else if (laya && !await laya.isAvailable()) { console.error('Laya unavailable: benchmark skipped, not measured as heuristics'); process.exitCode = 2 }
else if (operation === 'prepare') { console.log(JSON.stringify({ candidate, prepared: true, ms: performance.now() - started, cacheDir })); await router?.dispose() }
else {
  if (laya) {
    const config = readLayaEnv()
    const warm = await new LayaClient({ ...config, timeoutMs: 180_000 }).systemOne({ state: 'Find a target in a sorted array', questions: { warmup: {type:'choice', instructions:'Which algorithm?', criteria:{search:'Search an ordered list',sort:'Reorder a list'}} } })
    if (!warm) { console.error('Laya warmup failed; no model result measured'); process.exitCode=2; await laya.dispose?.(); process.exit(2) }
  }
  const coldLoadMs = performance.now() - started
  const rows: { fixture: Fixture; rawChoice: string | null; score: number; margin: number; ms: number; fallbackChoice: string | null; fallbackConfidence: number }[] = []
  const timer = setInterval(() => { peakRSS = Math.max(peakRSS, process.memoryUsage().rss) }, 10)
  let peakRSS = process.memoryUsage().rss
  let peakSidecarRSS = sidecarRSS()
  for (const fixture of fixtures) {
    const began = performance.now()
    const fallback = fixture.kind === 'request-intent' ? { choice: ruleIntent(fixture.text), confidence: 0 } : heuristicFor({ ...fixture, stateText: fixture.text, instructions: 'Select the matching choice.' })
    const rank = await router?.rank(fixture.kind, fixture.text, fixture.options)
    const legacy = laya && fixture.kind !== 'request-intent' ? await laya.decide({ ...fixture, stateText: fixture.text, instructions: 'Select the matching choice.' }) : null
    peakSidecarRSS = Math.max(peakSidecarRSS, sidecarRSS())
    rows.push({ fixture, rawChoice: rank?.choice ?? (legacy?.source === 'laya' ? legacy.choice : null), score: rank?.score ?? legacy?.confidence ?? 0, margin: rank?.margin ?? 0, ms: performance.now() - began, fallbackChoice: fixture.kind === 'route-problem' && fallback.confidence < 0.35 ? null : fallback.choice, fallbackConfidence: fallback.confidence })
  }
  peakRSS = Math.max(peakRSS, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024)
  clearInterval(timer)
  function metrics(split: string, minScore: number, minMargin: number) {
    const data = rows.filter(r => r.fixture.split === split)
    const predictions = data.map(r => ({ ...r, accepted: r.rawChoice !== null && r.score >= minScore && r.margin >= minMargin, prediction: r.rawChoice !== null && r.score >= minScore && r.margin >= minMargin ? r.rawChoice : r.fallbackChoice }))
    const labels = [...new Set(data.map(r => r.fixture.expected))]
    const macroF1 = labels.reduce((sum,label) => {
      const tp = predictions.filter(r => r.prediction === label && r.fixture.expected === label).length
      const fp = predictions.filter(r => r.prediction === label && r.fixture.expected !== label).length
      const fn = predictions.filter(r => r.prediction !== label && r.fixture.expected === label).length
      return sum + (2*tp/(2*tp+fp+fn) || 0)
    },0)/labels.length
    return { count: data.length, accuracy: predictions.filter(r => r.prediction === r.fixture.expected).length/data.length, macroF1, fallbackCoverage: predictions.filter(r => !r.accepted).length/data.length, wrongAccepted: predictions.filter(r => r.accepted && r.prediction !== r.fixture.expected).length, failures: predictions.filter(r => r.prediction !== r.fixture.expected).map(r => ({kind:r.fixture.kind,text:r.fixture.text,expected:r.fixture.expected,prediction:r.prediction})) }
  }
  let best = { minScore: 0.55, minMargin: 0.1, accuracy: -1 }
  for (const minScore of [0.35,0.45,0.55,0.65,0.75,0.85]) for (const minMargin of [0,0.03,0.05,0.1,0.15]) {
    const m = metrics('development', minScore, minMargin)
    if (m.accuracy > best.accuracy) best = { minScore, minMargin, accuracy: m.accuracy }
  }
  const latencies = rows.map(r => r.ms).sort((a,b)=>a-b)
  let sidecarFootprint
  try { if (candidate==='laya') sidecarFootprint=footprint(Number(readFileSync(new URL('../../../run/laya/laya.pid', import.meta.url),'utf8').trim())) } catch {}
  const steadyRSS = process.memoryUsage().rss
  peakRSS = Math.max(peakRSS, steadyRSS)
  const report = { candidate, measuredAt, fixtureHash, physicalFootprint:footprint(process.pid), sidecarPhysicalFootprint:sidecarFootprint, sidecarRSSMB:sidecarRSS()/1e6, peakSidecarRSSMB:peakSidecarRSS/1e6, revision: router ? CANDIDATES[router.candidate].revision : undefined, coldLoadMs, thresholds:best, development:metrics('development',best.minScore,best.minMargin), heldout:metrics('heldout',best.minScore,best.minMargin), firstInferenceMs:rows[0]?.ms, warmP95Ms:latencies[Math.ceil(latencies.length*.95)-1], peakIncrementalMB:(peakRSS-baselineRSS)/1e6, steadyIncrementalMB:(steadyRSS-baselineRSS)/1e6, peakProcessRSSMB:peakRSS/1e6, notes:['Laya memory is reported separately as sidecar RSS, not hidden in Node process measurements.', 'Abstention for unrelated problem requests is inferred from low heuristic confidence; suggest still returns its fallback choice.', 'Memory is process-wide RSS including the worker; initialization and inference are measured separately.', 'Provider intent accuracy does not establish generation/chat success.'], rows }
  const output=resolve('.dev/router-benchmarks'); await mkdir(output,{recursive:true}); await writeFile(resolve(output,`${candidate}.json`),JSON.stringify(report,null,2)); console.log(JSON.stringify({...report,rows:undefined},null,2)); await router?.dispose(); await laya?.dispose?.()
}
