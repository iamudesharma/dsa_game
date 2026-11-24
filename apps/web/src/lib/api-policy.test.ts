import { expect, it } from 'vitest'
import { createApiPolicy } from './api-policy'

it('allows disabling retries without changing deadlines', () => {
  expect(createApiPolicy({ readRetries: '0', retryDelayMs: '5' })).toMatchObject({ readRetries: 0, retryDelayMs: 5, requestTimeoutMs: 30000 })
})
it.each(['', '-1', '6', 'Infinity', 'NaN', '1.5'])('falls back from invalid retry setting %s', readRetries => {
  expect(createApiPolicy({ readRetries }).readRetries).toBe(2)
})
it('rejects invalid deadline/backoff values and freezes the policy', () => {
  const policy = createApiPolicy({ retryDelayMs: '-1', streamIdleTimeoutMs: '0', requestTimeoutMs: '99999999' })
  expect(policy).toMatchObject({ retryDelayMs: 250, streamIdleTimeoutMs: 190000, requestTimeoutMs: 30000 })
  expect(Object.isFrozen(policy)).toBe(true)
})
