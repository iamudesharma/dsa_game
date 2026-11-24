/** Public build-time policy. Mutations and streams always have zero retries. */
export interface ApiPolicy {
  readRetries: number
  retryDelayMs: number
  requestTimeoutMs: number
  streamConnectTimeoutMs: number
  streamIdleTimeoutMs: number
}

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function createApiPolicy(values: Partial<Record<keyof ApiPolicy, string>> = {}): Readonly<ApiPolicy> {
  return Object.freeze({
    readRetries: bounded(values.readRetries, 2, 0, 5),
    retryDelayMs: bounded(values.retryDelayMs, 250, 0, 10_000),
    requestTimeoutMs: bounded(values.requestTimeoutMs, 30_000, 1, 300_000),
    streamConnectTimeoutMs: bounded(values.streamConnectTimeoutMs, 30_000, 1, 300_000),
    streamIdleTimeoutMs: bounded(values.streamIdleTimeoutMs, 190_000, 1, 600_000),
  })
}

// Explicit property access lets Next.js inline these into the browser bundle.
export const API_POLICY = createApiPolicy({
  readRetries: process.env.NEXT_PUBLIC_API_READ_RETRIES,
  retryDelayMs: process.env.NEXT_PUBLIC_API_RETRY_DELAY_MS,
  requestTimeoutMs: process.env.NEXT_PUBLIC_API_TIMEOUT_MS,
  streamConnectTimeoutMs: process.env.NEXT_PUBLIC_API_STREAM_CONNECT_TIMEOUT_MS,
  streamIdleTimeoutMs: process.env.NEXT_PUBLIC_API_STREAM_IDLE_TIMEOUT_MS,
})
