import { Effect } from 'effect'
import { API_POLICY, type ApiPolicy } from './api-policy'
import { runClientEffect } from './run-effect'
import { API_BASE_URL, DsaApiError, getAuthToken, request } from './api'
import type {
  ChatEvent,
  ChatContext,
  ChatAction,
  LearningDashboard,
  LearningMessage,
  LearningThread,
} from '@dsa/account'
export type { ChatContext, ChatAction, LearningDashboard, LearningMessage, LearningThread }
export function learningHeaders() {
  const token = getAuthToken()
  return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }
}
export async function learningRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(`/api/learning${path}`, {
    method: (init.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
    rawBody: init.body,
    headers: init.headers,
    signal: init.signal,
  })
}
function streamError(cause: unknown): DsaApiError {
  return cause instanceof DsaApiError ? cause : new DsaApiError({
    kind: 'network', code: 'CHAT_NETWORK', message: 'The tutor connection was interrupted. Your question is saved.',
    details: cause,
  })
}
function streamTimeout(stage: string): DsaApiError {
  return new DsaApiError({ kind: 'timeout', code: 'CHAT_TIMEOUT', message: `The tutor ${stage} timed out. Your question is saved.` })
}

export async function streamLearning(
  id: string,
  body: { text: string; requestId: string; context: ChatContext; regenerate?: boolean },
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
  policy: Readonly<ApiPolicy> = API_POLICY,
): Promise<void> {
  const open = Effect.tryPromise({
    try: async (effectSignal) => {
      const res = await fetch(`${API_BASE_URL}/api/learning/threads/${id}/messages`, {
        method: 'POST', headers: { ...learningHeaders(), accept: 'text/event-stream' },
        credentials: 'include', body: JSON.stringify(body), signal: effectSignal,
      })
      if (!res.ok) {
        let data: { error?: { message?: string } } = {}
        try { data = await res.json() } catch { /* retain HTTP status on invalid JSON */ }
        throw new DsaApiError({
          kind: 'http', code: 'CHAT_FAILED', status: res.status,
          message: res.status === 401 ? 'Your session expired. Sign in again to continue.' :
            data.error?.message ?? 'The tutor could not respond.',
        })
      }
      if (!res.body) throw new DsaApiError({ kind: 'contract', code: 'CHAT_BODY', message: 'The response could not be opened.', retryable: false })
      return res
    },
    catch: streamError,
  }).pipe(Effect.timeoutOrElse({
    duration: policy.streamConnectTimeoutMs,
    orElse: () => Effect.fail(streamTimeout('connection')),
  }))
  // Network connection is interruptible; register the reader under the masked acquisition.
  const acquire = Effect.interruptible(open).pipe(Effect.map(res => res.body!.getReader()))
  const program = Effect.acquireUseRelease(acquire, reader => Effect.gen(function* () {
    const decoder = new TextDecoder()
    let buffer = '', complete = false
    while (true) {
      const { value, done } = yield* Effect.tryPromise({ try: () => reader.read(), catch: streamError }).pipe(
        Effect.timeoutOrElse({ duration: policy.streamIdleTimeoutMs, orElse: () => Effect.fail(streamTimeout('response')) }),
      )
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (data) {
          const event = yield* Effect.try({
            try: () => JSON.parse(data) as ChatEvent,
            catch: cause => new DsaApiError({ kind: 'contract', code: 'CHAT_FRAME', message: 'The tutor sent an invalid response.', details: cause, retryable: false }),
          })
          // A callback defect remains a defect; it is not classified as network failure.
          yield* Effect.sync(() => onEvent(event))
          if (event.type === 'complete') complete = true
        }
      }
      if (complete) return
      if (done) return yield* Effect.fail(new DsaApiError({
        kind: 'contract', code: 'CHAT_TRUNCATED', message: 'The connection ended before the response finished. Your question is saved.',
      }))
    }
  }), reader => Effect.promise(() => reader.cancel().catch(() => {})).pipe(
    Effect.ensuring(Effect.sync(() => reader.releaseLock())),
  ))
  // Sending a message is a mutation: never retry or replay this stream.
  return runClientEffect(program, signal)
}
export const requestId = () => crypto.randomUUID()
export const chatLink = (prompt: string, reference?: ChatContext['reference']) => `/chat?prompt=${encodeURIComponent(prompt)}${reference ? `&reference=${encodeURIComponent(JSON.stringify(reference))}` : ''}`
export async function allMessages(id: string) {
  const result: LearningMessage[] = []; let cursor: string | null = null
  do { const page: { messages: LearningMessage[]; nextCursor?: string | null } = await learningRequest(`/threads/${id}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); result.push(...page.messages); cursor = page.nextCursor ?? null } while (cursor)
  return { messages: result }
}
