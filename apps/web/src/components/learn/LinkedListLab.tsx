'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Panel } from '@/components/ui/Panel'
import {
  LINKED_LIST_EXAMPLES,
  LINKED_LIST_LANGUAGES,
  LINKED_LIST_LANGUAGE_LABELS,
  LINKED_LIST_QUESTIONS,
  LINKED_LIST_READINGS,
  LINKED_LIST_STARTERS,
  readSolvedLinkedListQuestions,
  type LinkedListLanguage,
  type LinkedListQuestion,
} from '@/lib/linked-list-learning'

const DIFFICULTIES = [
  { value: 'easy', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'hard', label: 'high' },
] as const

function gameHref(question: LinkedListQuestion, difficulty: (typeof DIFFICULTIES)[number]['value']): string {
  const query = new URLSearchParams({ question: question.id, difficulty })
  return `/problem/${question.gameProblemId}?${query.toString()}`
}

export function LinkedListLab() {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(LINKED_LIST_QUESTIONS[0].id)
  const [language, setLanguage] = useState<LinkedListLanguage>('javascript')
  const [draft, setDraft] = useState('')
  const [solved, setSolved] = useState<string[]>([])

  const selectedQuestion = useMemo(
    () => LINKED_LIST_QUESTIONS.find((question) => question.id === selectedQuestionId) ?? LINKED_LIST_QUESTIONS[0],
    [selectedQuestionId],
  )
  const draftKey = `play-the-algorithms:linked-list-draft:${selectedQuestion.id}:${language}`
  const starter = LINKED_LIST_STARTERS[selectedQuestion.id][language]

  useEffect(() => {
    const loadProgress = (): void => setSolved(readSolvedLinkedListQuestions())
    loadProgress()
    window.addEventListener('storage', loadProgress)
    window.addEventListener('linked-list-progress', loadProgress)
    return () => {
      window.removeEventListener('storage', loadProgress)
      window.removeEventListener('linked-list-progress', loadProgress)
    }
  }, [])

  useEffect(() => {
    try {
      setDraft(window.localStorage.getItem(draftKey) ?? starter)
    } catch {
      setDraft(starter)
    }
  }, [draftKey, starter])

  const updateDraft = (value: string): void => {
    setDraft(value)
    try {
      window.localStorage.setItem(draftKey, value)
    } catch {
      // Keep editing available even when this browser blocks local storage.
    }
  }

  const resetDraft = (): void => {
    setDraft(starter)
    try {
      window.localStorage.setItem(draftKey, starter)
    } catch {
      // Reset still works in memory when storage is disabled.
    }
  }

  return (
    <main className="field-notebook mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:py-12">
      <nav className="text-xs text-[var(--dsa-ink-faint)]">
        <Link href="/" className="hover:text-[var(--dsa-accent)]">← Adventure map</Link>
      </nav>

      <header className="max-w-3xl">
        <Chip tone="primary">read · write · play</Chip>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--dsa-ink)] sm:text-4xl">
          Your linked-list field notebook.
        </h1>
        <p className="mt-2 text-sm text-[var(--dsa-muted)] sm:text-base">
          Read the idea, write a solution in a language you know, then play a generated question. The board checks
          each pointer move against the algorithm and shows the matching code when you finish.
        </p>
      </header>

      <Panel title="The shape of a singly linked list" subtitle="Each node stores a value and a link to the next node.">
        <div className="overflow-x-auto rounded-xl border border-[var(--dsa-border)] bg-[var(--dsa-surface-2)] p-4">
          <div className="flex min-w-max items-center gap-2 mono text-sm" aria-label="head points to node 12, then node 7, then node 31, then null">
            <span className="rounded-md border border-[var(--dsa-primary)] px-3 py-2 text-[var(--dsa-primary)]">head</span>
            <span aria-hidden>→</span>
            {[12, 7, 31].map((value) => (
              <span key={value} className="flex items-center gap-2">
                <span className="rounded-lg border border-[var(--dsa-border)] px-3 py-2">value {value}<br /><span className="text-[var(--dsa-accent)]">next →</span></span>
                <span aria-hidden>→</span>
              </span>
            ))}
            <span className="rounded-md border border-dashed border-[var(--dsa-border)] px-3 py-2 text-[var(--dsa-ink-faint)]">null</span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm text-[var(--dsa-muted)] sm:grid-cols-3">
          <p><strong className="text-[var(--dsa-ink)]">Head</strong> is the only starting point. If it is null, the list is empty.</p>
          <p><strong className="text-[var(--dsa-ink)]">Next</strong> is a reference to another node, not an array index.</p>
          <p><strong className="text-[var(--dsa-ink)]">Null</strong> ends the chain. Following next links takes O(n) time.</p>
        </div>
      </Panel>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Linked list ideas">
        <Panel title="Traversal: follow the links" subtitle="The same loop solves counting, searching, and collecting values.">
          <ol className="list-inside list-decimal space-y-2 text-sm text-[var(--dsa-muted)]">
            <li>Set <code className="mono text-[var(--dsa-ink)]">current = head</code>.</li>
            <li>While current is not null, read its value and do the work for this node.</li>
            <li>Advance with <code className="mono text-[var(--dsa-ink)]">current = current.next</code>.</li>
            <li>Stop at null. Each node was visited once: O(n) time and O(1) extra space.</li>
          </ol>
        </Panel>
        <Panel title="Reversal: save, then rewire" subtitle="Keep the unvisited suffix reachable before changing next.">
          <ol className="list-inside list-decimal space-y-2 text-sm text-[var(--dsa-muted)]">
            <li>Start with previous = null and current = head.</li>
            <li>Save next = current.next before overwriting that link.</li>
            <li>Point current.next back to previous.</li>
            <li>Advance previous and current. When current is null, previous is the new head.</li>
          </ol>
        </Panel>
      </section>

      <section aria-labelledby="practice-questions">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="practice-questions" className="text-lg font-semibold text-[var(--dsa-ink)]">Questions with playable games</h2>
            <p className="text-xs text-[var(--dsa-muted)]">Choose a difficulty to generate a fresh list and solve the algorithm on the board.</p>
          </div>
          <Chip tone="muted">{solved.length} of {LINKED_LIST_QUESTIONS.length} solved</Chip>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {LINKED_LIST_QUESTIONS.map((question) => {
            const isSolved = solved.includes(question.id)
            return (
              <Panel
                key={question.id}
                title={question.title}
                subtitle={question.complexity}
                action={isSolved ? <Chip tone="success">solved</Chip> : <Chip tone="muted">question</Chip>}
              >
                <p className="text-sm text-[var(--dsa-muted)]">{question.prompt}</p>
                <p className="mt-2 text-xs text-[var(--dsa-ink-faint)]">{question.objective}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {DIFFICULTIES.map((difficulty) => (
                    <Link key={difficulty.value} className="btn btn-accent min-h-9 px-3 py-1.5 text-xs" href={gameHref(question, difficulty.value)}>
                      Play {difficulty.label}
                    </Link>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setSelectedQuestionId(question.id)} aria-pressed={selectedQuestion.id === question.id}>
                    Write solution
                  </Button>
                </div>
              </Panel>
            )
          })}
        </div>
      </section>

      <Panel
        title={`Write: ${selectedQuestion.title}`}
        subtitle="Choose a language and draft your answer. Your drafts are saved only in this browser."
        action={<Button size="sm" variant="ghost" onClick={resetDraft}>Reset starter</Button>}
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Solution language">
          {LINKED_LIST_LANGUAGES.map((item) => (
            <Button key={item} size="sm" variant={language === item ? 'primary' : 'default'} aria-pressed={language === item} onClick={() => setLanguage(item)}>
              {LINKED_LIST_LANGUAGE_LABELS[item]}
            </Button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="sr-only">Your {LINKED_LIST_LANGUAGE_LABELS[language]} solution for {selectedQuestion.title}</span>
          <textarea
            className="input mono min-h-56 w-full resize-y whitespace-pre leading-relaxed"
            spellCheck={false}
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
          />
        </label>
        <p className="mt-2 text-xs text-[var(--dsa-muted)]">
          Use the game to check your pointer-by-pointer reasoning. After you solve it, compare your draft with a worked version:
        </p>
        <details className="mt-3 rounded-lg border border-[var(--dsa-border)] p-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--dsa-ink)]">Show {LINKED_LIST_LANGUAGE_LABELS[language]} reference solution</summary>
          <pre className="mono board-scroll mt-3 overflow-x-auto rounded-lg bg-[color-mix(in_oklab,#020617_55%,transparent)] p-3 text-xs leading-relaxed">{LINKED_LIST_EXAMPLES[selectedQuestion.id][language]}</pre>
        </details>
      </Panel>

      <Panel title="Open-source further reading" subtitle="These repositories are MIT licensed. The lesson wording and examples above are written for this app.">
        <ul className="space-y-3">
          {LINKED_LIST_READINGS.map((reading) => (
            <li key={reading.href}>
              <a className="font-medium text-[var(--dsa-accent)] underline-offset-4 hover:underline" href={reading.href} target="_blank" rel="noreferrer">
                {reading.title} <span className="text-xs text-[var(--dsa-ink-faint)]">↗ {reading.source}</span>
              </a>
              <p className="text-xs text-[var(--dsa-muted)]">{reading.note}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  )
}
