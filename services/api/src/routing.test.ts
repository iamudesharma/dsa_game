import { describe, expect, it, vi } from 'vitest'
import { RoutingPolicy } from './routing.js'
import { createDecisionEngine } from '@dsa/decision-layer'
import type { ChatTransport } from '@dsa/provider-chain'
const request = { messages: [{ role: 'user' as const, content: 'Explain binary search' }], sessionId: 'preserved-session' }
function transport(id: string, stream: ChatTransport['stream']): ChatTransport {
  return { id, model: id, isAvailable: async () => true, chat: async () => ({ text: id, model: id, approxTokens: 1 }), stream }
}
function policy() { return new RoutingPolicy(createDecisionEngine({ backend: 'heuristic' })) }
describe('provider routing preserves stream boundaries', () => {
  it('fails over before any text, preserving the original request', async () => {
    const first = transport('first', async function* () { throw new Error('connection refused') })
    const second = transport('second', async function* (received) { expect(received).toBe(request); yield 'safe reply' })
    const chunks: string[] = []
    for await (const chunk of policy().chat([first, second]).stream!(request)) chunks.push(chunk)
    expect(chunks).toEqual(['safe reply'])
  })
  it('never switches providers after emitting a delta', async () => {
    const fallback = vi.fn(async function* () { yield 'duplicate response' })
    const first = transport('first', async function* () { yield 'partial'; throw new Error('dropped connection') })
    const chunks: string[] = []
    await expect((async () => { for await (const chunk of policy().chat([first, transport('second', fallback)]).stream!(request)) chunks.push(chunk) })()).rejects.toThrow('dropped connection')
    expect(chunks).toEqual(['partial']); expect(fallback).not.toHaveBeenCalled()
  })
  it('preserves preferred transport when both are available', async () => {
    const first = transport('first', undefined), second = transport('second', undefined)
    expect((await policy().chat([first,second]).chat(request)).model).toBe('first')
  })
  it('cancellation does not call any provider', async () => {
    const first = transport('first', undefined); const chat = vi.spyOn(first,'chat')
    const controller = new AbortController(); controller.abort()
    await expect(policy().chat([first]).chat({ ...request, signal:controller.signal })).rejects.toThrow('cancelled')
    expect(chat).not.toHaveBeenCalled()
  })
  it('temporarily skips failed providers without removing template', async () => {
    const p = policy(); p.record('opencode-go',false)
    const providers = [{tier:'opencode-go'}, {tier:'openrouter'}, {tier:'template'}] as any
    expect((await p.providers(providers,'practice')).map(x=>x.tier)).toEqual(['openrouter','template'])
    p.record('opencode-go',true)
    expect((await p.providers(providers,'practice')).map(x=>x.tier)).toEqual(['opencode-go','openrouter','template'])
  })
})
