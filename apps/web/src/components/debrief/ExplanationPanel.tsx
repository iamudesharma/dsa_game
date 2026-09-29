'use client'

import { useState } from 'react'
import type { DebriefResponse } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Panel } from '@/components/ui/Panel'
import { normalizeMapping } from '@/lib/mapping'
import { linesTouchedBy, type ScoreResult } from '@/lib/score'
import { echoBridge, reflectionsAnswered, type ReflectionAnswers } from '@/lib/self-explanation'
import { cn } from '@/lib/format'

/**
 * The theme -> algorithm dictionary.
 *
 * `debrief.actionMeaning` is keyed by action type and `debrief.mapping` is the
 * explicit metaphor table; both are shown because they answer different
 * questions. `actionMeaning` explains "what was I just asked to do", while
 * `mapping` is the "say this game word, get this code word" crib sheet.
 */
export function ExplanationPanel({
  debrief,
  reflections,
}: {
  debrief: DebriefResponse
  /**
   * The learner's own self-explanation answers (R2.2). Echoed back above the
   * recap so the learner sees their production mattered — never scored, never
   * judged. Null (or skipped) renders the explanation exactly as before.
   */
  reflections?: ReflectionAnswers | null
}) {
  const [tab, setTab] = useState<'story' | 'terms' | 'mapping'>('story')
  const meaningEntries = Object.entries(debrief.actionMeaning)
  const touched = linesTouchedBy(debrief.playedTrace)
  const mapping = normalizeMapping(debrief.mapping)
  const echoed = reflections && !reflections.skipped && reflectionsAnswered(reflections) ? reflections : null

  return (
    <Panel
      title="What just happened"
      subtitle="The same three facts, read three ways."
      action={
        <div className="flex gap-1" role="tablist" aria-label="Explanation view">
          {(['story', 'terms', 'mapping'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn('btn !px-2.5 !py-1 text-xs', tab === id && 'btn-accent')}
            >
              {id === 'story' ? 'Recap' : id === 'terms' ? 'Actions' : 'Crib sheet'}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'story' && (
        <div className="space-y-3">
          {echoed && (
            <div className="rounded-lg border border-[color-mix(in_oklab,var(--dsa-accent)_40%,var(--dsa-border))] bg-[color-mix(in_oklab,var(--dsa-accent)_8%,transparent)] p-3">
              <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-[var(--dsa-ink-faint)] uppercase">
                you said
              </p>
              <blockquote className="mt-1 text-sm text-[var(--dsa-ink)]">
                “{echoed.retention.trim()}”
              </blockquote>
              <blockquote className="mt-1 text-sm text-[var(--dsa-ink)]">
                “{echoed.integration.trim()}”
              </blockquote>
              <p className="mt-2 text-xs text-[var(--dsa-muted)]">{echoBridge(debrief.problemId)}</p>
            </div>
          )}
          <p className="prose-block text-sm">{debrief.summary}</p>
          <p className="text-[0.65rem] text-[var(--dsa-ink-faint)]">
            {debrief.playedTrace.length} step{debrief.playedTrace.length === 1 ? '' : 's'} taken,{' '}
            {touched.size} distinct code line{touched.size === 1 ? '' : 's'} reached.
          </p>
        </div>
      )}

      {tab === 'terms' && meaningEntries.length > 0 && (
        <dl className="space-y-2">
          {meaningEntries.map(([action, meaning]) => (
            <div key={action} className="rounded-lg border border-[var(--dsa-border)] p-2.5">
              <dt className="mono text-[0.65rem] font-semibold text-[var(--dsa-accent)]">{action}</dt>
              <dd className="mt-1 text-sm text-[var(--dsa-ink)]">{meaning}</dd>
            </div>
          ))}
        </dl>
      )}

      {tab === 'terms' && meaningEntries.length === 0 && (
        <p className="text-sm text-[var(--dsa-ink-faint)]">This spec did not provide an action glossary.</p>
      )}

      {tab === 'mapping' && mapping.length === 0 && (
        <p className="text-sm text-[var(--dsa-ink-faint)]">This spec did not provide a metaphor table.</p>
      )}

      {tab === 'mapping' && mapping.length > 0 && (
        <div className="board-scroll">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--dsa-border)] text-left">
                <th className="py-1.5 pr-3 text-[0.6rem] font-semibold tracking-[0.14em] text-[var(--dsa-ink-faint)] uppercase">
                  in the game
                </th>
                <th className="py-1.5 text-[0.6rem] font-semibold tracking-[0.14em] text-[var(--dsa-ink-faint)] uppercase">
                  in the algorithm
                </th>
              </tr>
            </thead>
            <tbody>
              {mapping.map(([gameTerm, algorithmTerm], index) => (
                <tr
                  key={`${gameTerm}-${index}`}
                  className="border-b border-[color-mix(in_oklab,var(--dsa-border)_50%,transparent)]"
                >
                  <td className="py-1.5 pr-3 text-[var(--dsa-ink)]">{gameTerm}</td>
                  <td className="mono py-1.5 text-[var(--dsa-accent)]">{algorithmTerm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/** `AnswerSummary` — text / value / details. */
export function AnswerCard({ debrief }: { debrief: DebriefResponse }) {
  const { answer } = debrief
  return (
    <Panel title="The answer" subtitle="What the algorithm was looking for.">
      <p className="text-lg font-semibold text-[var(--dsa-ink)]">{answer.text}</p>
      {answer.value !== undefined && answer.value !== null && (
        <div className="mt-2">
          <Chip tone="accent">
            <span className="mono">{String(answer.value)}</span>
          </Chip>
        </div>
      )}
      {answer.details && answer.details.length > 0 && (
        <dl className="mt-3 space-y-1.5">
          {answer.details.map((detail) => (
            <div key={detail.label} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-[var(--dsa-muted)]">{detail.label}</dt>
              <dd className="mono text-[var(--dsa-ink)]">{String(detail.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  )
}

/** `Complexity` as chips plus a plain-language reading. */
export function ComplexityChips({ debrief }: { debrief: DebriefResponse }) {
  const c = debrief.complexity
  const chips: [string, string | undefined][] = [
    ['time', c.time],
    ['space', c.space],
    ['best', c.best],
    ['average', c.average],
    ['worst', c.worst],
  ]
  return (
    <Panel title="Complexity" subtitle="What this costs as the input grows.">
      <ul className="flex flex-wrap gap-1.5">
        {chips
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([label, value]) => (
            <li key={label}>
              <Chip tone={label === 'time' ? 'primary' : label === 'space' ? 'accent' : 'muted'}>
                <span className="text-[var(--dsa-ink-faint)]">{label}</span>
                <span className="mono font-semibold">{value}</span>
              </Chip>
            </li>
          ))}
      </ul>
      {c.note && <p className="mt-3 text-sm text-[var(--dsa-muted)]">{c.note}</p>}
      <p className="mt-2 text-xs text-[var(--dsa-ink-faint)]">
        Read it as: this is how the cost scales when the data doubles. <span className="mono">O(1)</span> does not
        grow, <span className="mono">O(log n)</span> adds only a step or two, <span className="mono">O(n)</span> doubles,
        and <span className="mono">O(n²)</span> quadruples.
      </p>
    </Panel>
  )
}

/**
 * `misconception-naming` -> "naming".
 *
 * The tag is a kebab-case SLUG because it is computed from a histogram and
 * needs to be stable on the wire. Slugs are for the database; the learner gets
 * a phrase. The word is also negated: a learner does not have a "misconception",
 * they have a habit of doing something, and the phrasing is the difference
 * between a diagnosis and a coaching note.
 */
function humaniseMisconception(slug: string): string {
  const words = slug.replace(/-/g, ' ').trim()
  if (words === '') return ''
  return `You ${/^[aeiou]/i.test(words) ? 'an' : 'a'} habit of ${words} — worth naming on purpose next time.`
}

/** The player's stats, the misconception tag, and a transparent score. */
export function StatsPanel({
  debrief,
  score,
  onNewGame,
  newGameLabel,
  newGameBusy,
}: {
  debrief: DebriefResponse
  score: ScoreResult
  onNewGame: () => void
  newGameLabel: string
  newGameBusy: boolean
}) {
  const { stats } = debrief
  const mistakes = Object.entries(stats.mistakesByMechanic)
  return (
    <div className="space-y-4">
      <Panel title="Score" subtitle="Computed in your browser from the debrief — nothing hidden.">
        <div className="flex items-center gap-4">
          <div
            className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-[var(--dsa-primary)] text-xl font-bold"
            aria-label={`Score ${score.score} out of 100, grade ${score.grade}`}
          >
            {score.score}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--dsa-ink)]">Grade {score.grade}</p>
            <p className="text-sm text-[var(--dsa-muted)]">{score.verdict}</p>
          </div>
        </div>
        <ul className="mt-3 space-y-1">
          {score.lines.map((line) => (
            <li key={line.label} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-[var(--dsa-muted)]">
                {line.label} <span className="text-[var(--dsa-ink-faint)]">({line.detail})</span>
              </span>
              <span
                className={cn(
                  'mono font-semibold',
                  line.delta >= 0 ? 'text-[var(--dsa-success)]' : 'text-[var(--dsa-danger)]',
                )}
              >
                {line.delta >= 0 ? '+' : ''}
                {line.delta}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="This run" subtitle={`${debrief.phase === 'won' ? 'Solved' : 'Ended without the answer'}.`}>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'steps', value: stats.steps },
            { label: 'mistakes', value: stats.mistakes },
            { label: 'hints', value: stats.hintsUsed },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-[var(--dsa-border)] px-2 py-1.5">
              <dt className="text-[0.6rem] tracking-wide text-[var(--dsa-ink-faint)] uppercase">{stat.label}</dt>
              <dd className="mono text-lg font-bold text-[var(--dsa-ink)]">{stat.value}</dd>
            </div>
          ))}
        </dl>

        {mistakes.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {mistakes.map(([mechanic, count]) => (
              <li key={mechanic} className="chip !py-0 text-[0.6rem]">
                <span className="mono">{mechanic}</span>
                <span className="text-[var(--dsa-danger)]">{count}</span>
              </li>
            ))}
          </ul>
        )}

        {/* The misconception tag is for the learner only when there IS one, and
            the model name is not for the learner ever. "likely misconception:
            no-mistakes" read as a diagnosis to a child who had not made a
            mistake, and "Laya confidence 100%" is pipeline telemetry — the same
            reasoning `ProgressRail` already applied when it collapsed the
            provider cascade "because it explains the app to its author, not to
            its learner". The confidence stays available as a tooltip for
            whoever is debugging, which is the audience that can act on it. */}
        {stats.misconception ? (
          <div
            className="mt-3 rounded-lg border border-[color-mix(in_oklab,var(--dsa-accent)_40%,var(--dsa-border))] bg-[color-mix(in_oklab,var(--dsa-accent)_8%,transparent)] p-3"
            title={
              typeof stats.confidence === 'number'
                ? `Decision-layer confidence: ${Math.round(stats.confidence * 100)}%`
                : undefined
            }
          >
            <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-[var(--dsa-ink-faint)] uppercase">
              worth a second look
            </p>
            <p className="mt-1 text-sm text-[var(--dsa-ink)]">
              {humaniseMisconception(stats.misconception)}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onNewGame} disabled={newGameBusy}>
            {newGameLabel}
          </Button>
        </div>
      </Panel>
    </div>
  )
}
