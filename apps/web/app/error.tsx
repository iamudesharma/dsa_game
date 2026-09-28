'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

/**
 * Route-level error boundary. A thrown render error anywhere under the app
 * lands here instead of a blank page; the message is shown verbatim because
 * during development that is the fastest path to a fix.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- the only place we can surface this
    console.error('[dsa-web] render error', error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-16">
      <p className="text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-danger)] uppercase">
        Something broke
      </p>
      <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-[var(--dsa-ink)]">This screen failed to load.</h1>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-[var(--dsa-muted)]">
        That is a bug on our side, not something you did. Trying again usually works; if it does not, the details
        below are what we need to fix it.
      </p>
      <pre className="mono mt-3 max-h-48 overflow-auto rounded-xl border border-[var(--dsa-border)] p-3 text-[0.8rem] text-[var(--dsa-ink-faint)]">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ''}
      </pre>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={reset}>
          Try rendering again
        </Button>
        <a className="btn" href="/">
          Back to topics
        </a>
      </div>
    </main>
  )
}
