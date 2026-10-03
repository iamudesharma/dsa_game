import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../../../.cache/dsa-router/', import.meta.url))
import { CANDIDATES, type CandidateId } from './candidates.js'
import { examplesFor } from './examples.js'
import type { DecisionOutcome } from './types.js'

export interface LocalRouterOptions {
  candidate?: CandidateId
  cacheDir?: string
  allowDownload?: boolean
  timeoutMs?: number
  minScore?: number
  minMargin?: number
}
export interface RankedDecision { scores: Record<string, number>; choice: string; score: number; margin: number }
export function rankScores(scores: Record<string, number>, options: Record<string, string>): RankedDecision | null {
  const ranked = Object.entries(scores).filter(([key, value]) => Object.hasOwn(options, key) && Number.isFinite(value) && value >= -1 && value <= 1).sort((a, b) => b[1] - a[1])
  if (ranked.length !== Object.keys(options).length || !ranked[0]) return null
  return { scores, choice: ranked[0][0], score: ranked[0][1], margin: ranked[0][1] - (ranked[1]?.[1] ?? -1) }
}

/** One worker, one model, one in-flight inference; deadlines terminate computation. */
export class LocalRouter {
  readonly candidate: CandidateId
  private worker?: Worker
  private sequence = 0
  private busy = false
  private retryAt = 0
  private disposed = false
  private ready = false
  private pending?: { id: number; finish: (value: Record<string, unknown> | null) => void }
  constructor(private readonly opts: LocalRouterOptions = {}) { this.candidate = opts.candidate && Object.hasOwn(CANDIDATES, opts.candidate) ? opts.candidate : 'minilm-l3' }
  status() { return { backend: CANDIDATES[this.candidate].task, model: CANDIDATES[this.candidate].model, available: this.ready, detail: this.busy ? 'loading / inference' : this.ready ? undefined : 'not loaded; rules remain available' } }
  private start(): Worker {
    if (this.worker) return this.worker
    const candidate = { ...CANDIDATES[this.candidate] }
    if (candidate.task === 'semantic' && process.arch !== 'arm64') candidate.artifact = 'model_quint8_avx2' as typeof candidate.artifact
    const worker = new Worker(new URL('./inference-worker.mjs', import.meta.url), { workerData: {
      candidate, cacheDir: resolve(this.opts.cacheDir || process.env.DECISION_CACHE_DIR || DEFAULT_CACHE_DIR), allowDownload: this.opts.allowDownload ?? false,
    } })
    this.worker = worker
    worker.unref()
    worker.on('message', message => { if (message.id === this.pending?.id) this.pending?.finish(message) })
    worker.on('error', () => this.pending?.finish(null))
    worker.on('exit', () => { if (this.worker === worker) { this.worker = undefined; this.ready = false; this.pending?.finish(null) } })
    return worker
  }
  private async call(payload: object, timeoutMs: number): Promise<Record<string, unknown> | null> {
    if (this.disposed || this.busy || Date.now() < this.retryAt) return null
    this.busy = true
    return new Promise(resolveResult => {
      const id = ++this.sequence
      let timer: ReturnType<typeof setTimeout>
      const finish = (value: Record<string, unknown> | null) => {
        if (this.pending?.id !== id) return
        clearTimeout(timer); this.pending = undefined; this.busy = false
        if (!value || value.error) {
          this.ready = false; this.retryAt = Date.now() + 15_000
          const worker = this.worker; this.worker = undefined; void worker?.terminate()
          resolveResult(null)
        } else { this.ready = true; resolveResult(value) }
      }
      this.pending = { id, finish }
      timer = setTimeout(() => finish(null), timeoutMs)
      try { this.start().postMessage({ id, ...payload }) } catch { finish(null) }
    })
  }
  async prepare(): Promise<boolean> { return (await this.call({ operation: 'prepare' }, 180_000)) !== null }
  async rank(kind: string, text: string, options: Record<string, string>, timeoutMs = this.opts.timeoutMs ?? 500): Promise<RankedDecision | null> {
    if (Object.keys(options).length === 0 || Object.keys(options).length > 64) return null
    const response = await this.call({ operation: 'rank', text: text.slice(0, 2000), examples: examplesFor(kind, options) }, timeoutMs)
    return response?.scores && typeof response.scores === 'object' ? rankScores(response.scores as Record<string, number>, options) : null
  }
  async decide(kind: string, text: string, options: Record<string, string>): Promise<DecisionOutcome | null> {
    const result = await this.rank(kind, text, options)
    if (!result || result.score < (this.opts.minScore ?? (this.candidate === 'minilm-l3' ? 0.35 : 0.55)) || result.margin < (this.opts.minMargin ?? (this.candidate === 'minilm-l3' ? 0.03 : 0.1))) return null
    const semantic = CANDIDATES[this.candidate].task === 'semantic'
    return { choice: result.choice, confidence: Math.max(0, result.score), source: semantic ? 'semantic' : 'zero-shot', model: CANDIDATES[this.candidate].model, scoreKind: semantic ? 'cosine-similarity' : 'uncalibrated-probability', score: result.score, margin: result.margin }
  }
  async dispose() { this.disposed = true; this.ready = false; this.pending?.finish(null); const worker = this.worker; this.worker = undefined; await worker?.terminate() }
}
