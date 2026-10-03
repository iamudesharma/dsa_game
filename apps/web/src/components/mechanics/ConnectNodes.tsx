'use client'

import { useState } from 'react'
import type { Action, LinkKind } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { describeId } from '@/lib/board'
import { cn } from '@/lib/format'
import type { MechanicProps } from './types'

/**
 * Draw (or rewire) a `next` / `prev` pointer between two nodes.
 *
 * The first picked node is the source, the second is the target, and the kind
 * toggle is explicit because rewiring `next` versus `prev` is the entire point
 * of a pointer reversal — a default would hide the decision.
 *
 * REMOVED: the live `Sends connectNodes(n2, n1, next)` preview. It is the exact
 * wire JSON the action carries, printed as the renderer prepares to send it,
 * which is what made the old control read as a debugger. The from → to pair
 * below says the same thing in the theme's nouns.
 */
export function ConnectNodes({ spec, model, binding, disabled, picked, setPicked, dispatch }: MechanicProps) {
  const [linkKind, setLinkKind] = useState<LinkKind>('next')
  const [fromId, toId] = picked
  const ready = Boolean(fromId && toId && fromId !== toId)

  const connect = (): void => {
    if (!fromId || !toId) return
    const action: Action = { type: 'connectNodes', fromNodeId: fromId, toNodeId: toId, linkKind }
    dispatch(action)
  }

  return (
    <section className="panel p-4" aria-label={binding.label || 'ConnectNodes'}>
      {/* The host blanks `binding.label` when the instruction is already on
          screen, so this heading disappears with it rather than repeating an
          imperative the learner has just read at 2rem. */}
      {binding.label ? (
        <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      ) : null}
      <p className="mt-0.5 text-[0.85rem] text-[var(--dsa-muted)]">
        {binding.hint ?? `Wire a pointer from one to the next in the ${spec.vocabulary.place}.`}
      </p>

      <p className="mt-2 text-sm">First selection is the source; second is the destination. The preview below shows the {linkKind} link you will save.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
        <span
          className={cn(
            'rounded-xl border-2 px-3 py-1.5 text-[0.95rem] font-semibold',
            fromId
              ? 'border-[var(--dsa-primary)] text-[var(--dsa-ink)]'
              : 'border-dashed border-[var(--dsa-border)] text-[var(--dsa-faint)]',
          )}
        >
          {fromId ? describeId(model, fromId) : 'pick the first'}
        </span>
        <span aria-hidden className="text-[1.1rem] text-[var(--dsa-faint)]">
          →
        </span>
        <span
          className={cn(
            'rounded-xl border-2 px-3 py-1.5 text-[0.95rem] font-semibold',
            toId
              ? 'border-[var(--dsa-accent)] text-[var(--dsa-ink)]'
              : 'border-dashed border-[var(--dsa-border)] text-[var(--dsa-faint)]',
          )}
        >
          {toId ? describeId(model, toId) : 'pick the second'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Which way the pointer should run">
          {(['next', 'prev'] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant={linkKind === kind ? 'accent' : 'default'}
              disabled={disabled}
              onClick={() => setLinkKind(kind)}
              aria-pressed={linkKind === kind}
            >
              {kind}
            </Button>
          ))}
        </div>
        <Button variant="primary" disabled={disabled || !ready} onClick={connect} aria-label="Make this pointer">
          Connect them
        </Button>
        {picked.length === 2 && <div className="flex gap-2 mt-2"><Button size="sm" disabled={disabled} onClick={()=>setPicked([picked[1]!])}>Change first selection</Button><Button size="sm" disabled={disabled} onClick={()=>setPicked([picked[0]!])}>Change second selection</Button></div>}
      {picked.length > 0 && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setPicked([])}>
            Clear
          </Button>
        )}
      </div>

      {fromId && toId && fromId === toId ? (
        <p className="mt-2 text-[0.9rem] text-[var(--dsa-danger)]">Pick two different ones — a node cannot point at itself.</p>
      ) : null}
    </section>
  )
}
