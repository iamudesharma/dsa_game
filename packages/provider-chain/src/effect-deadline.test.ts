import { describe, expect, it, vi } from 'vitest'
import { PROBLEMS, type GameSpec } from '@dsa/game-schema'
import { chainGenerateSpec } from './chain.js'
import { TemplateProvider } from './providers/template.js'
import { SpecValidationError, type GenerateSpecInput, type SpecProvider } from './types.js'

const input: GenerateSpecInput = { problem: PROBLEMS[0]!, instance: { problemId: PROBLEMS[0]!.id, seed: 1, values: [1,2,3], slots: [] }, seed: 1, difficulty: 'easy' }
const hang = (signal?: AbortSignal): Promise<GameSpec> => new Promise((_resolve, reject) => {
  if (signal?.aborted) reject(signal.reason)
  else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
})
describe('Effect provider deadlines', () => {
  it('aborts timed-out generation and falls back without retrying it', async () => {
    let signal: AbortSignal | undefined
    const generate = vi.fn((request: GenerateSpecInput) => { signal = request.signal; return hang(signal) })
    const slow: SpecProvider = { tier: 'opencode', isAvailable: async () => true, generate }
    const result = await chainGenerateSpec(input, { providers: [slow, new TemplateProvider()], timeoutMs: 20 })
    expect(signal?.aborted).toBe(true)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.tier).toBe('template')
  })
  it('bounds and aborts hanging availability probes', async () => {
    let signal: AbortSignal | undefined
    const slow: SpecProvider = {
      tier: 'opencode', isAvailable: s => { signal = s; return hang(s).then(() => true) },
      generate: vi.fn(),
    }
    const result = await chainGenerateSpec(input, { providers: [slow, new TemplateProvider()], probeTimeoutMs: 20 })
    expect(signal?.aborted).toBe(true)
    expect(slow.generate).not.toHaveBeenCalled()
    expect(result.tier).toBe('template')
  })
  it.each(['probe', 'generate', 'repair'] as const)('propagates caller cancellation during %s without fallback', async stage => {
    const controller = new AbortController()
    let entered = false
    const run = (signal?: AbortSignal) => { entered = true; return hang(signal) }
    const provider: SpecProvider = {
      tier: 'opencode',
      isAvailable: s => stage === 'probe' ? run(s).then(() => true) : Promise.resolve(true),
      generate: req => stage === 'repair' ? Promise.reject(new SpecValidationError('broken')) : run(req.signal),
      repair: req => run(req.signal),
    }
    const fallback = new TemplateProvider()
    const generate = vi.spyOn(fallback, 'generate')
    const pending = chainGenerateSpec({ ...input, signal: controller.signal }, { providers: [provider, fallback] })
    const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(entered).toBe(true))
    controller.abort()
    await check
    expect(generate).not.toHaveBeenCalled()
  })
})
