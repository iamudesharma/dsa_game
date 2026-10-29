import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamLearning } from './learning-api'
import { createApiPolicy } from './api-policy'

const body = { text: 'Explain search', requestId: 'one', context: { history: true, resume: false, target: false } }
const policy = createApiPolicy({ streamConnectTimeoutMs: '30', streamIdleTimeoutMs: '30' })
const encoder = new TextEncoder()
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\r\n\r\n`
afterEach(() => vi.unstubAllGlobals())
function response(text: string, close: boolean = true) {
  const cancel = vi.fn()
  const bytes = encoder.encode(text)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3))
      if (close) controller.close()
    }, cancel,
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)))
  return { stream, cancel }
}
describe('Effect SSE ownership', () => {
  it('preserves split UTF-8/CRLF, completes without waiting for socket close, and releases the reader', async () => {
    const { stream, cancel } = response(frame({ type: 'text', text: 'λ example' }) + frame({ type: 'complete' }), false)
    const events: unknown[] = []
    await streamLearning('thread', body, new AbortController().signal, event => events.push(event), policy)
    expect(events).toEqual([{ type: 'text', text: 'λ example' }, { type: 'complete' }])
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })
  it('classifies truncated streams without replaying the message', async () => {
    const { stream } = response(frame({ type: 'text', text: 'partial' }))
    await expect(streamLearning('thread', body, new AbortController().signal, () => {}, policy)).rejects.toMatchObject({ code: 'CHAT_TRUNCATED' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })
  it('classifies invalid frames and releases the reader', async () => {
    const { stream, cancel } = response('data: invalid json\n\n', false)
    await expect(streamLearning('thread', body, new AbortController().signal, () => {}, policy)).rejects.toMatchObject({ code: 'CHAT_FRAME' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })
  it('times out a stalled reader and closes it', async () => {
    const { stream, cancel } = response('', false)
    await expect(streamLearning('thread', body, new AbortController().signal, () => {}, policy)).rejects.toMatchObject({ kind: 'timeout' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('cancels an active stream and awaits reader cleanup', async () => {
    const { stream, cancel } = response('', false)
    const controller = new AbortController()
    const pending = streamLearning('thread', body, controller.signal, () => {})
    const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(stream.locked).toBe(true))
    controller.abort()
    await check
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })
  it('cancels during connection establishment immediately', async () => {
    let transportSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      transportSignal = init.signal
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    }))
    const controller = new AbortController()
    const pending = streamLearning('thread', body, controller.signal, () => {}, createApiPolicy({ streamConnectTimeoutMs: '10000' }))
    const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(transportSignal).toBeDefined())
    controller.abort()
    await check
    expect(transportSignal?.aborted).toBe(true)
  })
  it('aborts connection establishment on timeout', async () => {
    let transportSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      transportSignal = init.signal
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    }))
    await expect(streamLearning('thread', body, new AbortController().signal, () => {}, policy)).rejects.toMatchObject({ kind: 'timeout' })
    expect(transportSignal?.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('retains HTTP status even if the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 503 })))
    await expect(streamLearning('thread', body, new AbortController().signal, () => {}, policy)).rejects.toMatchObject({ status: 503, code: 'CHAT_FAILED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
