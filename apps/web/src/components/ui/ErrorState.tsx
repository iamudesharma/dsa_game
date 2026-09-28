'use client'

import type { ReactNode } from 'react'
import type { DsaApiError } from '@/lib/api'
import { API_ERROR_CODES } from '@/lib/contract'
import { Button } from './Button'

export interface ErrorStateProps {
  error: DsaApiError
  onRetry?: () => void
  retryLabel?: string
  children?: ReactNode
}

/**
 * The single error surface. It always says three things: what broke, what the
 * player can do about it, and where to go next. `UNKNOWN_GAME` gets a specific
 * recovery link because that is the one case where retrying cannot help.
 */
export function ErrorState({ error, onRetry, retryLabel = 'Try again', children }: ErrorStateProps) {
  const unknownGame = error.code === API_ERROR_CODES.UNKNOWN_GAME
  const unknownProblem = error.code === API_ERROR_CODES.UNKNOWN_PROBLEM
  return (
    <div
      role="alert"
      className="panel border-[color:var(--dsa-danger)]/50 bg-[color-mix(in_oklab,var(--dsa-danger)_10%,var(--dsa-surface))] p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold text-[var(--dsa-ink)]">
        {unknownGame ? 'That game is not loaded in this tab' : error.title}
      </h2>
      <p className="mt-1 text-sm text-[var(--dsa-muted)]">{error.message}</p>
      {unknownGame && (
        <p className="mt-2 text-sm text-[var(--dsa-muted)]">
          The play API has no endpoint to load a finished game by id, so a game only exists in the tab that
          started it. Generate a new one, or go back and pick a problem.
        </p>
      )}
      {unknownProblem && (
        <p className="mt-2 text-sm text-[var(--dsa-muted)]">
          The problem id the server was given is not in the problem registry.
        </p>
      )}
      {children && <div className="mt-3 text-sm">{children}</div>}
      <div className="mt-4 flex flex-wrap gap-2">
        {onRetry && error.retryable && !unknownGame && (
          <Button variant="primary" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        <a className="btn" href="/">
          All topics
        </a>
      </div>
      {error.details !== undefined && error.details !== null && (
        <details className="mt-3 text-xs text-[var(--dsa-ink-faint)]">
          <summary className="cursor-pointer select-none">Technical detail</summary>
          <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">
            {typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
