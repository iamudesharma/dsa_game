import type { ReactNode } from 'react'
import { cn } from '@/lib/format'

export type ChipTone = 'default' | 'primary' | 'accent' | 'success' | 'danger' | 'muted'

const TONE_STYLE: Record<ChipTone, React.CSSProperties> = {
  default: {},
  primary: { borderColor: 'var(--dsa-primary)', color: 'var(--dsa-primary)' },
  accent: { borderColor: 'var(--dsa-accent)', color: 'var(--dsa-accent)' },
  success: { borderColor: 'var(--dsa-success)', color: 'var(--dsa-success)' },
  danger: { borderColor: 'var(--dsa-danger)', color: 'var(--dsa-danger)' },
  muted: { color: 'var(--dsa-muted)' },
}

export interface ChipProps {
  tone?: ChipTone
  title?: string
  children: ReactNode
  className?: string
}

export function Chip({ tone = 'default', title, children, className }: ChipProps) {
  return (
    <span className={cn('chip', className)} style={TONE_STYLE[tone]} title={title}>
      {children}
    </span>
  )
}
