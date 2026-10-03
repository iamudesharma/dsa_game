import { describe, it, expect } from 'vitest'
import { readChatStream } from './chat.js'
const body = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(new TextEncoder().encode(s))
      c.close()
    },
  })
const collect = async (stream: ReadableStream<Uint8Array>) => {
  let text = ''
  for await (const s of readChatStream(stream)) text += s
  return text
}
describe('chat stream transport', () => {
  it('parses fragmented SSE with comments, CRLF, Unicode and a done marker', async () => {
    const data =
      ': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"Hello 🌱"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
    expect(await collect(body([data.slice(0, 13), data.slice(13, 40), data.slice(40)]))).toBe('Hello 🌱')
  })
  it('does not report a truncated stream as a complete response', async () => {
    await expect(collect(body(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']))).rejects.toThrow(
      'before completion',
    )
  })
  it('surfaces provider error events', async () => {
    await expect(collect(body(['data: {"error":{"message":"failed"}}\n\n']))).rejects.toThrow('stream failed')
  })
})
