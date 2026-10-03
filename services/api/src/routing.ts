import type { DecisionEngine } from '@dsa/decision-layer'
import { OpencodeGoChatTransport, OpenRouterChatTransport, type ChatTransport, type ChatRequest, type SpecProvider } from '@dsa/provider-chain'

/** Intent is advisory. Provider preference stays unchanged until downstream evaluation. */
export class RoutingPolicy {
  private failures = new Map<string, number>()
  constructor(private readonly decisions: DecisionEngine) {}
  record(id: string, ok: boolean, ms?: number) {
    if (ok) this.failures.delete(id)
    else this.failures.set(id, Date.now() + 15_000)
    console.info(JSON.stringify({ event: 'routing-provider', provider: id, ok, ms, fallbackReason: ok ? undefined : 'provider failed; cooldown enabled' }))
  }
  private cooling(id: string) { return (this.failures.get(id) ?? 0) > Date.now() }
  async classify(text: string, signal?: AbortSignal) {
    if (signal?.aborted) return
    const started = performance.now()
    const decision = await this.decisions.classifyIntent?.(text.slice(0, 2000))
    // Never log user text. Intent labels are diagnostics, not authorization.
    if (decision) console.info(JSON.stringify({ event: 'routing-intent', intent: decision.choice, source: decision.source, model: decision.model, ms: performance.now() - started, fallbackReason: decision.fallbackReason }))
  }
  async providers(providers: SpecProvider[], text: string, signal?: AbortSignal): Promise<SpecProvider[]> {
    await this.classify(text, signal)
    const active = providers.filter(p => p.tier === 'template' || !this.cooling(p.tier))
    return active.length ? active : providers
  }
  chat(candidates: ChatTransport[] = [new OpencodeGoChatTransport(), new OpenRouterChatTransport()]): ChatTransport {
    const policy = this
    async function available() {
      const result: ChatTransport[] = []
      for (const candidate of candidates) {
        if (!policy.cooling(candidate.id) && await candidate.isAvailable()) result.push(candidate)
      }
      return result
    }
    async function start(request: ChatRequest) {
      await policy.classify([...request.messages].reverse().find(m => m.role === 'user')?.content ?? '', request.signal)
      if (request.signal?.aborted) throw new Error('Chat cancelled')
      return available()
    }
    return {
      id: 'local-policy', model: 'resolved-per-request',
      isAvailable: async () => (await available()).length > 0,
      async chat(request) {
        for (const candidate of await start(request)) {
          const started = performance.now()
          try { const reply = await candidate.chat(request); policy.record(candidate.id, true, performance.now() - started); return reply }
          catch (error) { if (request.signal?.aborted) throw error; policy.record(candidate.id, false, performance.now() - started) }
        }
        throw new Error('No chat provider succeeded')
      },
      async *stream(request) {
        for (const candidate of await start(request)) {
          const started = performance.now()
          let emitted = false
          try {
            if (candidate.stream) {
              for await (const delta of candidate.stream(request)) { if (delta) { emitted = true; yield delta } }
            } else { const reply = await candidate.chat(request); if (reply.text) { emitted = true; yield reply.text } }
            if (!emitted) throw new Error('Empty provider response')
            policy.record(candidate.id, true, performance.now() - started); return
          } catch (error) {
            policy.record(candidate.id, false, performance.now() - started)
            if (emitted || request.signal?.aborted) throw error
          }
        }
        throw new Error('No streaming provider succeeded')
      },
    }
  }
}
