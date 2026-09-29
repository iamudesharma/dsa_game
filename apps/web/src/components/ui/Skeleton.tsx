import { cn } from '@/lib/format'

/**
 * Generation on tier 1 is an LLM call and can take several seconds, so the
 * waiting state has to look intentional rather than broken.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-lg bg-[color-mix(in_oklab,var(--dsa-border)_70%,transparent)]', className)}
    />
  )
}

export function GeneratingSkeleton({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <p className="text-sm text-[var(--dsa-muted)]">{label}</p>
      {detail && <p className="text-xs text-[var(--dsa-ink-faint)]">{detail}</p>}
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <div className="flex gap-2 pt-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-12" />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  )
}
