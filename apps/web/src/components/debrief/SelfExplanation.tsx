'use client'

import { useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { learningRequest } from '@/lib/learning-api'
import { Panel } from '@/components/ui/Panel'
import {
  emptyReflections,
  reflectionsAnswered,
  saveReflections,
  selfExplanationPrompts,
  type ReflectionAnswers,
} from '@/lib/self-explanation'

/**
 * The debrief's retrieval turn (R2.1 / R2.2).
 *
 * Two free-response prompts sit IN FRONT of the explanation: the learner
 * produces the reason before reading anything. Answers are echoed back above
 * the explanation once revealed, and are stored in localStorage only — they
 * are never sent to the server and never scored, because a wrong attempt is
 * still retrieval practice and judging it would punish the attempt.
 *
 * Deliberately no multiple choice, no select, no radio: free response only.
 * Skipping is explicit and recorded, so "revealed" never silently means
 * "answered".
 */
export function SelfExplanation({
  problemId,
  gameId,
  initial,
  onReveal,
}: {
  problemId: string
  gameId: string
  initial: ReflectionAnswers | null
  onReveal: (answers: ReflectionAnswers) => void
}) {
  const { user } = useAuth()
  const [saveStatus, setSaveStatus] = useState('')
  const prompts = selfExplanationPrompts(problemId)
  const [draft, setDraft] = useState<ReflectionAnswers>(initial ?? emptyReflections())

  const reveal = (answers: ReflectionAnswers): void => {
    saveReflections(window.localStorage, gameId, answers)
    onReveal(answers)
  }

  return (
    <Panel
      title="Before the explanation — in your own words"
      subtitle="Retrieval beats rereading. Write what you think first; the explanation comes after."
    >
      <div className="space-y-4">{user && <div><button className="btn" onClick={() => { setSaveStatus('Saving…'); void learningRequest(`/history/${gameId}/reflection`, { method: 'POST', body: JSON.stringify(draft) }).then(() => setSaveStatus('Saved to account history; Chat can use this reflection.')).catch(e => setSaveStatus(e.message)) }}>Save reflection to history</button><p role="status" className="text-sm">{saveStatus}</p><p className="text-xs">Only this action makes your reflection available to Chat.</p></div>}
        <div>
          <label htmlFor="reflect-retention" className="text-sm font-semibold text-[var(--dsa-ink)]">
            {prompts.retention}
          </label>
          <textarea
            id="reflect-retention"
            rows={3}
            value={draft.retention}
            onChange={(event) => setDraft({ ...draft, retention: event.target.value })}
            placeholder="A sentence or two is enough — a guess still counts."
            className="mt-1.5 w-full rounded-lg border border-[var(--dsa-border)] bg-[var(--dsa-surface)] p-2.5 text-sm text-[var(--dsa-ink)]"
          />
        </div>
        <div>
          <label htmlFor="reflect-integration" className="text-sm font-semibold text-[var(--dsa-ink)]">
            {prompts.integration}
          </label>
          <textarea
            id="reflect-integration"
            rows={3}
            value={draft.integration}
            onChange={(event) => setDraft({ ...draft, integration: event.target.value })}
            placeholder="What never changed, from the first move to the last?"
            className="mt-1.5 w-full rounded-lg border border-[var(--dsa-border)] bg-[var(--dsa-surface)] p-2.5 text-sm text-[var(--dsa-ink)]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-accent"
            disabled={!reflectionsAnswered(draft)}
            onClick={() => reveal({ ...draft, skipped: false })}
          >
            Show the explanation
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => reveal({ ...draft, skipped: true })}
          >
            Skip for now
          </button>
        </div>
        {!reflectionsAnswered(draft) && (
          <p className="text-xs text-[var(--dsa-ink-faint)]">
            Answer both in your own words to continue — or skip, and the explanation shows right away.
          </p>
        )}
      </div>
    </Panel>
  )
}
