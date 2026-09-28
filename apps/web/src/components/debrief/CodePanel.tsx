'use client'

import { useState } from 'react'
import type { DebriefResponse, TraceFrame } from '@dsa/game-schema'
import { Panel } from '@/components/ui/Panel'
import { linesTouchedBy } from '@/lib/score'
import { cn } from '@/lib/format'

/**
 * Pseudocode and real code, with the lines the player actually reached.
 *
 * WHY both are highlighted: the pseudocode is the algorithm you learn; the real
 * code is the one you will write in an interview. The `codeLine` on every trace
 * frame is a 1-based index into the oracle's code list, so the highlight is
 * exact rather than heuristic — a line is lit because the algorithm executed
 * it, not because it looks related.
 */
export function CodePanel({ debrief }: { debrief: DebriefResponse }) {
  const languages = Object.keys(debrief.code)
  const [language, setLanguage] = useState<string>(languages[0] ?? 'javascript')
  const touched = linesTouchedBy(debrief.playedTrace)

  const languageTouched = (trace: TraceFrame[]): Set<number> => linesTouchedBy(trace)

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <CodeBlock
        title="Pseudocode"
        subtitle="Lit lines are the ones your run executed."
        lines={debrief.pseudocode}
        touched={touched}
      />
      <Panel
        title="Real code"
        subtitle="The same algorithm, written out."
        action={
          languages.length > 1 && (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Programming language">
              {languages.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  role="tab"
                  aria-selected={lang === language}
                  onClick={() => setLanguage(lang)}
                  className={cn('btn !px-2.5 !py-1 text-xs', lang === language && 'btn-accent')}
                >
                  {lang}
                </button>
              ))}
            </div>
          )
        }
      >
        <CodeLines lines={debrief.code[language] ?? []} touched={touched} />
        {touched.size === 0 && (
          <p className="mt-2 text-xs text-[var(--dsa-ink-faint)]">
            Your run never reached a line of this listing, which is worth noticing.
          </p>
        )}
      </Panel>
    </div>
  )
}

function CodeBlock({
  title,
  subtitle,
  lines,
  touched,
}: {
  title: string
  subtitle: string
  lines: string[]
  touched: Set<number>
}) {
  return (
    <Panel title={title} subtitle={subtitle}>
      <CodeLines lines={lines} touched={touched} />
    </Panel>
  )
}

function CodeLines({ lines, touched }: { lines: string[]; touched: Set<number> }) {
  if (lines.length === 0) {
    return <p className="text-sm text-[var(--dsa-ink-faint)]">No listing was returned for this problem.</p>
  }
  return (
    <ol className="mono board-scroll overflow-x-auto rounded-lg border border-[var(--dsa-border)] bg-[color-mix(in_oklab,#020617_55%,transparent)] p-2 text-[0.7rem] leading-relaxed">
      {lines.map((line, index) => {
        const number = index + 1
        const hit = touched.has(number)
        return (
          <li
            key={number}
            className={cn(
              'flex gap-3 rounded px-1',
              hit && 'bg-[color-mix(in_oklab,var(--dsa-accent)_18%,transparent)] text-[var(--dsa-ink)]',
            )}
          >
            <span
              className={cn(
                'w-6 shrink-0 select-none text-right text-[0.6rem]',
                hit ? 'text-[var(--dsa-accent)]' : 'text-[var(--dsa-ink-faint)]',
              )}
              aria-hidden
            >
              {number}
            </span>
            <span className="min-w-0 whitespace-pre">{line}</span>
            {hit && <span className="sr-only">executed in your run</span>}
          </li>
        )
      })}
    </ol>
  )
}
