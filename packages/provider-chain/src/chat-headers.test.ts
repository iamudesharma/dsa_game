/**
 * The opencode-go CHAT transport's required headers.
 *
 * Measured live: the endpoint answers
 *   400 MissingSessionID — "Request is missing x-opencode-session and cannot be
 *   routed efficiently"
 * unless the request carries a client-specific `user-agent` AND a stable
 * `x-opencode-session`. The spec provider has always sent both; the chat
 * adapter did not, so every coach and resume-extraction call against the
 * default tier failed with an error that blamed routing rather than naming the
 * missing header.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpencodeGoChatTransport } from './chat.js'

const KEY = 'test-key'

function stubFetch(capture: { headers?: Record<string, string> }, body: unknown = { content: 'hi' }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      capture.headers = init.headers
      return {
        ok: true,
        json: async () => ({ choices: [{ message: body }] }),
      } as unknown as Response
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpencodeGoChatTransport routing headers', () => {
  it('sends a client user-agent and a session id', async () => {
    const capture: { headers?: Record<string, string> } = {}
    stubFetch(capture)
    const transport = new OpencodeGoChatTransport({
      apiKey: KEY,
      model: 'test-model',
      baseUrl: 'https://example.invalid/v1',
      enabled: true,
      timeoutMs: 1000,
      temperature: 0.5,
      maxTokens: 100,
      userAgent: 'dsa-game/0.1.0',
      sessionId: '',
    })
    await transport.chat({ messages: [{ role: 'user', content: 'hello' }] })
    expect(capture.headers?.['user-agent']).toBe('dsa-game/0.1.0')
    expect(capture.headers?.['x-opencode-session']).toMatch(/^chat-/)
    expect(capture.headers?.['authorization']).toBe(`Bearer ${KEY}`)
  })

  it('gives each call its own session id, so conversations are not merged', async () => {
    const seen: (string | undefined)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
        seen.push(init.headers['x-opencode-session'])
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) } as unknown as Response
      }),
    )
    const transport = new OpencodeGoChatTransport({
      apiKey: KEY,
      model: 'test-model',
      baseUrl: 'https://example.invalid/v1',
      enabled: true,
      timeoutMs: 1000,
      temperature: 0.5,
      maxTokens: 100,
      userAgent: 'dsa-game/0.1.0',
      sessionId: '',
    })
    await transport.chat({ messages: [{ role: 'user', content: 'one' }] })
    await transport.chat({ messages: [{ role: 'user', content: 'two' }] })
    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
  })

  it('honours a pinned session id from the env', async () => {
    const capture: { headers?: Record<string, string> } = {}
    stubFetch(capture)
    const transport = new OpencodeGoChatTransport({
      apiKey: KEY,
      model: 'test-model',
      baseUrl: 'https://example.invalid/v1',
      enabled: true,
      timeoutMs: 1000,
      temperature: 0.5,
      maxTokens: 100,
      userAgent: 'dsa-game/0.1.0',
      sessionId: 'pinned-session',
    })
    await transport.chat({ messages: [{ role: 'user', content: 'hello' }] })
    expect(capture.headers?.['x-opencode-session']).toBe('pinned-session')
  })

  it('names the routing cause when a 400 mentions the session header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ error: { type: 'MissingSessionID', message: 'Request is missing x-opencode-session' } }),
      })) as unknown as typeof fetch,
    )
    const transport = new OpencodeGoChatTransport({
      apiKey: KEY,
      model: 'test-model',
      baseUrl: 'https://example.invalid/v1',
      enabled: true,
      timeoutMs: 1000,
      temperature: 0.5,
      maxTokens: 100,
      userAgent: 'dsa-game/0.1.0',
      sessionId: '',
    })
    await expect(transport.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/routing/i)
  })
})
