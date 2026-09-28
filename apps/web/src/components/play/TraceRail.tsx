'use client'

import { useEffect, useRef } from 'react'
import type { TraceFrame } from '@dsa/game-schema'
import { dsaOpLabel } from '@/lib/contract'
import { cn } from '@/lib/format'

/**
 * What you did, in order.
 *
 * This used to render a code line under every frame (`mono 0.6rem`, a `<pre>`
 * with the source text) plus a `line 7` chip plus a `#3` index plus a dsaOp
 * chip. Four bits of wire metadata per move, in a column, for the length of the
 * run. That is the single densest block of the old play screen and none of it
 * changed a decision the learner was making.
 *
 * What is left is the sentence the engine wrote about what happened, the
 * operation it maps to, and a correct/wrong mark. That is a readable log of
 * their own run. The code lives in the debrief, where the whole run is on
 * screen at once and the code is the point.
 */
export function TraceRail({ trace, activeIndex }: { trace: TraceFrame[]; activeIndex: number | null }) {
  const endRef = useRef<HTMLOListElement | null>(null)

  useEffect(() => {
    // Follow the tail, but only if the player has not scrolled up to read.
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [trace.length])

  const ordered = [...trace].reverse()

  return (
    <section className="panel p-4" aria-label="What you have done">
      <details>
        <summary className="cursor-pointer select-none">
          <h2 className="text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-faint)] uppercase">
            Your run so far
          </h2>
          <p className="mt-0.5 text-[0.8rem] text-[var(--dsa-muted)]">
            {trace.length === 0
              ? 'Nothing yet. Your first move will show up here.'
              : `${trace.length} move${trace.length === 1 ? '' : 's'} — open to read the log.`}
          </p>
        </summary>

        {ordered.length === 0 ? null : (
          <ol ref={endRef} className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {ordered.map((frame) => {
              const isActive = activeIndex === frame.index
              return (
                <li
                  key={frame.index}
                  className={cn(
                    'rounded-lg border px-2.5 py-2',
                    frame.correct
                      ? 'border-[color:color-mix(in_oklab,var(--dsa-success)_32%,var(--dsa-border))]'
                      : 'border-[color:color-mix(in_oklab,var(--dsa-danger)_40%,var(--dsa-border))]',
                    isActive && 'ring-1 ring-[var(--dsa-accent)]',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        'text-[0.7rem] font-bold',
                        frame.correct ? 'text-[var(--dsa-success)]' : 'text-[var(--dsa-danger)]',
                      )}
                    >
                      {frame.correct ? '✓' : '✕'}
                    </span>
                    <span className="chip !px-2 !py-0 text-[0.62rem]">{dsaOpLabel(frame.dsaOp)}</span>
                  </div>
                  <p className="mt-1 text-[0.85rem] leading-snug text-[var(--dsa-ink)]">{frame.note}</p>
                  <p className="sr-only">{frame.correct ? 'This one worked.' : 'This one did not work.'}</p>
                </li>
              )
            })}
          </ol>
        )}
      </details>
    </section>
  )
}
