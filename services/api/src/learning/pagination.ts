/** Stable, opaque cursors identify the last item rather than its changing offset. */
export function page<T>(items: T[], id: (item: T) => string, cursor?: string, limit = 30) {
  let after: string | undefined
  try { after = cursor ? Buffer.from(cursor, 'base64url').toString('utf8') : undefined } catch {}
  const start = after ? items.findIndex(item => id(item) === after) + 1 : 0
  const size = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 30))
  const result = items.slice(start, start + size)
  return { items: result, nextCursor: start + size < items.length && result.length ? Buffer.from(id(result[result.length-1]!)).toString('base64url') : null }
}
