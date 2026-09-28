import type { ReactNode } from 'react'
import { cn } from '@/lib/format'

export function StatusDot({ ok, title }: { ok: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        ok ? 'bg-[var(--dsa-success)]' : 'bg-[var(--dsa-ink-faint)]',
      )}
      aria-hidden
    />
  )
}

export interface StatusRowProps {
  label: ReactNode
  ok: boolean
  detail?: string
}

export function StatusRow({ label, ok, detail }: StatusRowProps) {
  return (
    <div
      className="flex items-center gap-2 py-0.5 text-xs text-[var(--dsa-ink)]"
      title={detail}
      data-ok={ok}
    >
      <StatusDot ok={ok} title={detail} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('text-xs', ok ? 'text-[var(--dsa-muted)]' : 'text-[var(--dsa-ink-faint)]')}>
        {ok ? (detail ?? 'ready') : 'unavailable'}
      </span>
    </div>
  )
}
