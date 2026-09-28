import type { ReactNode } from 'react'
import { cn } from '@/lib/format'

export interface PanelProps {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  as?: 'section' | 'aside' | 'div'
}

export function Panel({ title, subtitle, action, children, className, bodyClassName, as = 'section' }: PanelProps) {
  const Tag = as
  return (
    <Tag className={cn('panel p-4 sm:p-5', className)}>
      {(title || action) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-wide text-[var(--dsa-ink)] uppercase">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-[var(--dsa-muted)]">{subtitle}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn('min-w-0', bodyClassName)}>{children}</div>
    </Tag>
  )
}
