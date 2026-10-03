import { API_BASE_URL, getAuthToken } from './api'
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
  const res = await fetch(`${API_BASE_URL}/api/learning${path}`, {
    ...init,
    headers: { ...learningHeaders(), ...init.headers },
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok)
    throw new Error(
      res.status === 401
        ? 'Your session expired. Sign in again to continue.'
        : (data.error?.message ?? 'Could not complete the request.'),
    )
  return data as T
}
export async function streamLearning(
  id: string,
  body: { text: string; requestId: string; context: ChatContext; regenerate?: boolean },
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
) {
  const res = await fetch(`${API_BASE_URL}/api/learning/threads/${id}/messages`, {
    method: 'POST',
    headers: learningHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error?.message ?? 'The tutor could not respond.')
  }
  if (!res.body) throw new Error('The response could not be opened.')
  const reader = res.body.getReader(),
    decoder = new TextDecoder()
  let buffer = '', complete = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let i: number
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, i)
        buffer = buffer.slice(i + 2)
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n')
        if (data) { const event = JSON.parse(data) as ChatEvent; if (event.type === 'complete') complete = true; onEvent(event) }
      }
      if (done) { if (!complete) throw new Error('The connection ended before the response finished. Your question is saved.'); break }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export const requestId = () => crypto.randomUUID()
export const chatLink = (prompt: string, reference?: ChatContext['reference']) => `/chat?prompt=${encodeURIComponent(prompt)}${reference ? `&reference=${encodeURIComponent(JSON.stringify(reference))}` : ''}`
export async function allMessages(id: string) {
  const result: LearningMessage[] = []; let cursor: string | null = null
  do { const page: { messages: LearningMessage[]; nextCursor?: string | null } = await learningRequest(`/threads/${id}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); result.push(...page.messages); cursor = page.nextCursor ?? null } while (cursor)
  return { messages: result }
}
