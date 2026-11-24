import { Effect } from 'effect'

/** Keep expected failures intact when crossing back into Promise-based UI code. */
export async function runClientEffect<A, E>(program: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> {
  signal?.throwIfAborted()
  try {
    const result = await Effect.runPromise(program.pipe(Effect.match({
      onSuccess: value => ({ ok: true as const, value }),
      onFailure: error => ({ ok: false as const, error }),
    })), { signal })
    if (!result.ok) throw result.error
    return result.value
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    throw error
  }
}
