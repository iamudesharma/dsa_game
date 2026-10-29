import { afterEach, describe, expect, it, vi } from 'vitest'
import { DsaApiError, getInterviewKit, request } from './api'
import { createApiPolicy } from './api-policy'
import { learningRequest } from './learning-api'

const json = (status: number, body: unknown = { error: { code: 'INTERNAL', message: 'Unavailable' } }) =>
  new Response(JSON.stringify(body), { status })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Effect API transport', () => {
  it('normalizes saved interview kits without generation diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, {
      kitId: 'saved-kit', questions: [], usedTier: 'template', createdAt: 1,
    })))
    expect((await getInterviewKit('saved-kit')).notes).toEqual([])
  })
  it('recovers a transient read and preserves credentials', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(503)).mockResolvedValueOnce(json(200, { ok: true }))
    vi.stubGlobal('fetch', fetch)
    expect(await learningRequest('/dashboard')).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include', cache: 'no-store' })
  })
  it('limits network failures to three attempts and returns the public error', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetch)
    await expect(request('/api/health')).rejects.toBeInstanceOf(DsaApiError)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it.each([400, 401, 404, 429, 500])('does not auto-retry HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValue(json(status))
    vi.stubGlobal('fetch', fetch)
    await expect(request('/api/health')).rejects.toMatchObject({ status })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('honors a policy that disables read retries', async () => {
    const fetch = vi.fn().mockResolvedValue(json(503))
    vi.stubGlobal('fetch', fetch)
    await expect(request('/api/health', { policy: createApiPolicy({ readRetries: '0' }) })).rejects.toMatchObject({ status: 503 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not replay a learning mutation', async () => {
    const fetch = vi.fn().mockResolvedValue(json(503))
    vi.stubGlobal('fetch', fetch)
    await expect(learningRequest('/threads', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 503 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not retry malformed successful JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('bad json'))
    vi.stubGlobal('fetch', fetch)
    await expect(request('/api/health')).rejects.toMatchObject({ kind: 'contract' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('cancels during backoff without starting another attempt', async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockResolvedValue(json(503))
    vi.stubGlobal('fetch', fetch)
    const pending = request('/api/health', { signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    controller.abort()
    await rejected
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps the timeout active while reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => Promise.resolve({
      ok: true, status: 200,
      text: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    })))
    await expect(request('/api/action', { method: 'POST', timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('does not retry a permanent domain error even with a transient status', async () => {
    const fetch = vi.fn().mockResolvedValue(json(503, { error: { code: 'PROBLEM_NOT_PLAYABLE', message: 'Not supported' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(request('/api/game/x')).rejects.toMatchObject({ retryable: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('never sends an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort()
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(request('/api/health', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
