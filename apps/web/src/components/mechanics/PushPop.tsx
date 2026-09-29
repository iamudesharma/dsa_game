'use client'

import { useState } from 'react'
import type { Action, StackOp } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { allObjectIds } from '@/lib/board'
import { findMarker } from '@/lib/guidance'
import { cn } from '@/lib/format'
import { objectName, type MechanicProps } from './types'

/**
 * Push into / pop from an ordered container.
 *
 * Which container kinds exist comes from `state.containers`; push needs an
 * object and pop does not. The panel shows the live stack depth so underflow
 * ("pop on an empty stack") is visibly the player's mistake rather than an
 * opaque rejection.
 *
 * REMOVED: the trailing `This is a push / pop in the algorithm` line. The
 * buttons are labelled Push and Pop, the `teach` line under every action says
 * what the operation is for, and the debrief maps it to the code. A third
 * mention of the same fact is noise.
 */
export function PushPop({ spec, model, binding, disabled, picked, setPicked, dispatch, markers }: MechanicProps) {
  const [containerId, setContainerId] = useState<string>(model.containers[0]?.id ?? '')
  const active = model.containers.find((c) => c.id === containerId) ?? model.containers[0]
  const objectId = picked[0]
  const marked = objectId ? findMarker(markers, objectId) : null

  const run = (op: StackOp): void => {
    if (!active) return
    if (op === 'push' && !objectId) return
    const action: Action = {
      type: 'pushPop',
      containerId: active.id,
      op,
      ...(op === 'push' && objectId ? { objectId } : {}),
    }
    dispatch(action)
    setPicked([])
  }

  if (model.containers.length === 0) {
    return (
      <section className="panel p-4" aria-label={binding.label}>
        {/* The host blanks `binding.label` when the instruction is already on
          screen, so this heading disappears with it rather than repeating an
          imperative the learner has just read at 2rem. */}
      {binding.label ? (
        <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      ) : null}
        <p className="mt-2 text-[0.92rem] text-[var(--dsa-muted)]">This board has nothing to push onto yet.</p>
      </section>
    )
  }

  const topId = active
    ? active.kind === 'queue'
      ? (active.order[0] ?? '')
      : (active.order[active.order.length - 1] ?? '')
    : ''
  const insertLabel = active?.kind === 'queue' ? 'Enqueue' : 'Push'
  const removeLabel = active?.kind === 'queue' ? 'Dequeue' : 'Pop'
  const empty = (active?.order.length ?? 0) === 0

  return (
    <section className="panel p-4" aria-label={binding.label}>
      {/* The host blanks `binding.label` when the instruction is already on
          screen, so this heading disappears with it rather than repeating an
          imperative the learner has just read at 2rem. */}
      {binding.label ? (
        <h2 className="text-[1.05rem] font-bold text-[var(--dsa-ink)]">{binding.label}</h2>
      ) : null}
      <p className="mt-0.5 text-[0.85rem] text-[var(--dsa-muted)]">
        {binding.hint ?? `Push onto and pop off the ${spec.vocabulary.place}.`}
      </p>

      {model.containers.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Choose a container">
          {model.containers.map((container) => (
            <Button
              key={container.id}
              size="sm"
              variant={container.id === active?.id ? 'accent' : 'default'}
              disabled={disabled}
              onClick={() => setContainerId(container.id)}
              aria-pressed={container.id === active?.id}
            >
              {container.label ?? container.id}
            </Button>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="mt-3 rounded-xl border border-[var(--dsa-border)] bg-[color-mix(in_oklab,var(--dsa-surface-2)_55%,transparent)] p-3">
          <p className="text-[0.7rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
            {active.label ?? active.id}
          </p>
          <p className="mt-1 text-[1.5rem] leading-none font-bold text-[var(--dsa-ink)] tabular-nums">
            {active.order.length}
            {typeof active.capacity === 'number' ? (
              <span className="text-[0.95rem] font-normal text-[var(--dsa-faint)]"> / {active.capacity}</span>
            ) : null}
          </p>
          <p className="mt-1 text-[0.88rem] text-[var(--dsa-muted)]">
            {empty
              ? `Empty. ${removeLabel} would underflow — there is nothing to take.`
              : `The ${active.kind === 'queue' ? 'front' : 'top'} is ${
                  topId ? objectName(model, topId) : 'nothing'
                }, so that is what ${active.kind === 'queue' ? 'dequeue' : 'pop'} takes.`}
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={disabled || !active || !objectId}
          onClick={() => run('push')}
          aria-label={objectId ? `Push ${objectName(model, objectId)}` : 'Pick something on the board to push first'}
        >
          {insertLabel}{objectId ? ` ${objectName(model, objectId)}` : ''}
        </Button>
        <Button
          variant="accent"
          disabled={disabled || !active || empty}
          onClick={() => run('pop')}
          aria-label={empty
            ? `Nothing to ${removeLabel.toLowerCase()} — this is empty`
            : active?.kind === 'queue'
              ? `Take the front of ${active.label ?? 'the queue'}`
              : `Take the top off ${active?.label ?? 'it'}`}
        >
          {removeLabel}
        </Button>
        {picked.length > 0 && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setPicked([])}>
            Put it down
          </Button>
        )}
      </div>

      {objectId ? (
        <p className={cn('mt-2 text-[0.85rem]', marked ? 'text-[var(--dsa-accent)]' : 'text-[var(--dsa-muted)]')}>
          {marked ? marked.target.hint : 'Holding that one to push.'}
        </p>
      ) : (
        <p className="mt-2 text-[0.85rem] text-[var(--dsa-muted)]">Pick something on the board to push it.</p>
      )}
    </section>
  )
}
