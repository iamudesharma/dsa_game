'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { CoachResponse, CoachTurn } from '@dsa/game-schema'

import { Button } from '@/components/ui/Button'
import { DsaApiError, deleteCoachThread, getCoachThreads, isCoachUnavailable, postCoachAsk } from '@/lib/api'
import type { CoachThreadSummary } from '@/lib/api'
import { cn } from '@/lib/format'
import { API_BASE_URL, getAuthToken } from '@/lib/api'

type Availability = 'checking' | 'ready' | 'unavailable' | 'broken'

export interface CoachPanelProps {
  gameId: string
  /** 0..1, the algorithm's own progress. Shown so a question has context. */
  progress: number
  /** Turn ids the engine is currently pointing at, for the "what do I press" chip row. */
  onClose?: () => void
}

/**
 * Ask a question, in your own words, while the game keeps running.
 *
 * WHY THIS EXISTS: a learner who does not know what to do next has two options —
 * guess, or read a canned hint. Guessing costs a mistake; canned hints cover
 * only the mistakes the engine anticipated. A coach covers "no, I meant the other
 * one", which is the question a real teacher gets asked all day.
 *
 * DEGRADATION IS THE HARD PART, not an afterthought. `/api/coach/*` is the
 * newest surface in the API and will 404 on an older build, so the panel has
 * three states that must each be a real screen rather than an error:
 *
 *   checking    — one line of copy, no spinner theatre
 *   unavailable — a friendly, non-alarming explanation, the composer disabled
 *                 and visibly so, and the HINT BUTTON still offered instead.
 *                 "Not ready" is a normal state for a moving codebase, not a
 *                 failure the learner caused.
 *   broken      — the coach IS supposed to be there and something else went
 *                 wrong. This one gets a retry.
 *
 * A redacted reply is shown with a small, matter-of-fact "I held this back"
 * disclosure. The coach is built so it never gives the answer away, and a
 * curious learner absolutely deserves to be told when that happened rather than
 * shown a reply with a suspicious gap in it. Hiding the guardrail would teach
 * them the wrong thing about the system.
 */
export function CoachPanel({ gameId, progress, onClose }: CoachPanelProps) {
  const [probe, setProbe] = useState(0)
  const [availability, setAvailability] = useState<Availability>('checking')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [turns, setTurns] = useState<CoachTurn[]>([])
  const [threads, setThreads] = useState<CoachThreadSummary[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [last, setLast] = useState<CoachResponse | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  // One probe on mount. `getCoachThreads` is a GET, so it is the cheapest way to
  // find out whether the routes exist at all.
  useEffect(() => {
    const controller = new AbortController()
    getCoachThreads(gameId, controller.signal)
      .then((list) => {
        setThreads(list)
        setThreadId(list[0]?.id ?? null)
        setAvailability('ready')
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        if (isCoachUnavailable(cause)) setAvailability('unavailable')
        else {
          setProblem(cause instanceof DsaApiError ? cause.message : 'The coach did not answer.')
          setAvailability('broken')
        }
      })
    return () => controller.abort()
  }, [gameId, probe])

  useEffect(() => {
    const controller = new AbortController()
    setTurns([])
    if (threadId) fetch(`${API_BASE_URL}/api/coach/threads/${threadId}`, { credentials: 'include', signal: controller.signal, headers: getAuthToken() ? { authorization: `Bearer ${getAuthToken()}` } : {} })
      .then(async res => { if (!res.ok) throw new Error('Could not load this conversation.'); return res.json() })
      .then(data => setTurns(data.thread.turns))
      .catch(error => { if (!controller.signal.aborted) setProblem(error.message) })
    return () => controller.abort()
  }, [threadId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [turns.length])

  const ask = useCallback(async () => {
    const text = message.trim()
    if (!text || sending || availability !== 'ready') return
    setSending(true)
    setProblem(null)
    const optimistic: CoachTurn = {
      id: `local-${Date.now()}`,
      role: 'learner',
      text,
      at: Date.now(),
      approxTokens: 0,
    }
    setTurns((prev) => [...prev, optimistic])
    setMessage('')
    try {
      const res = await postCoachAsk({ gameId, ...(threadId ? { threadId } : {}), message: text })
      setLast(res)
      setTurns(res.turns)
      setThreads(res.threads)
      setThreadId(res.threadId)
    } catch (cause) {
      if (isCoachUnavailable(cause)) {
        setAvailability('unavailable')
      } else {
        setProblem(cause instanceof DsaApiError ? cause.message : 'The coach did not answer.')
      }
      // Roll the optimistic turn back so the transcript does not claim a
      // question that was never received.
      setTurns((prev) => prev.filter((t) => t.id !== optimistic.id))
      setMessage(text)
    } finally {
      setSending(false)
    }
  }, [availability, gameId, message, sending, threadId])

  const forgetThread = useCallback(
    async (id: string) => {
      try {
        await deleteCoachThread(id)
      } catch (cause) {
        if (!isCoachUnavailable(cause)) {
          setProblem(cause instanceof DsaApiError ? cause.message : 'Could not clear that conversation.')
        }
        return
      }
      setThreads((prev) => prev.filter((t) => t.id !== id))
      setTurns([])
      setLast(null)
      setThreadId((prev) => (prev === id ? null : prev))
    },
    [],
  )

  return (
    <section className="panel p-4" aria-label="Ask the coach">
      <header className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-faint)] uppercase">
            Ask a coach
          </h2>
          <p className="mt-0.5 text-[0.8rem] text-[var(--dsa-muted)]">
            It will point at a region or name the next kind of step. It will not give you the answer.
          </p>
        </div>
        {onClose ? (
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close the coach">
            Hide
          </Button>
        ) : null}
      </header>

      {availability === 'checking' ? (
        <p className="text-[0.9rem] text-[var(--dsa-muted)]">Checking whether a coach is available…</p>
      ) : null}

      {availability === 'unavailable' ? (
        <NotReady />
      ) : null}

      {availability === 'broken' ? (
        <div className="rounded-xl border border-[color:color-mix(in_oklab,var(--dsa-warn)_45%,var(--dsa-border))] bg-[color-mix(in_oklab,var(--dsa-warn)_10%,transparent)] p-3">
          <p className="text-[0.92rem] text-[var(--dsa-ink)]">{problem ?? 'The coach did not answer.'}</p>
          <Button size="sm" className="mt-2.5" onClick={() => { setAvailability('checking'); setProbe(n => n + 1) }}>
            Try again
          </Button>
        </div>
      ) : null}

      {availability === 'ready' ? (
        <div className="space-y-3">
          {threads.length > 0 ? (
            <label className="block text-[0.75rem] text-[var(--dsa-muted)]">
              <span className="mb-1 block">Conversation</span>
              <select
                className="input"
                value={threadId ?? ''}
                onChange={(e) => {
                  const next = e.target.value || null
                  setThreadId(next)
                  setTurns([])
                  setLast(null)
                }}
              >
                <option value="">New conversation</option>
                {threads.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.turnCount})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {turns.length > 0 ? (
            <ol className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-live="polite">
              <AnimatePresence initial={false}>
                {turns.map((turn) => (
                  <motion.li
                    key={turn.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      'rounded-xl border px-3 py-2',
                      turn.role === 'learner'
                        ? 'ml-6 border-[color:color-mix(in_oklab,var(--dsa-primary)_40%,transparent)] bg-[color-mix(in_oklab,var(--dsa-primary)_12%,transparent)]'
                        : 'mr-2 border-[var(--dsa-border)] bg-[color-mix(in_oklab,var(--dsa-surface-2)_60%,transparent)]',
                    )}
                  >
                    <p
                      className={cn(
                        'text-[0.62rem] font-semibold tracking-[0.14em] uppercase',
                        turn.role === 'learner' ? 'text-[var(--dsa-primary)]' : 'text-[var(--dsa-faint)]',
                      )}
                    >
                      {turn.role === 'learner' ? 'you' : 'coach'}
                      {turn.synthetic ? ' · canned' : ''}
                    </p>
                    <p className="mt-1 text-[0.92rem] leading-relaxed text-[var(--dsa-ink)]">{turn.text}</p>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          ) : (
            <p className="text-[0.9rem] text-[var(--dsa-muted)]">
              Ask anything about what to do next. The board keeps going while you think.
            </p>
          )}

          <RedactionNotice redacted={last?.redacted ?? null} />

          {problem ? (
            <p className="text-[0.85rem] text-[var(--dsa-warn)]">{problem}</p>
          ) : null}

          <Button size="sm" onClick={() => { setThreadId(null); setTurns([]); setLast(null) }} disabled={sending}>New conversation</Button>
          <div>
            <label className="sr-only" htmlFor="coach-composer">
              Your question
            </label>
            <textarea
              id="coach-composer"
              className="input min-h-16 resize-y"
              value={message}
              maxLength={400}
              placeholder="e.g. why do I compare the middle one and not the first?"
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void ask()
                }
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" disabled={sending || message.trim() === ''} onClick={() => void ask()}>
                {sending ? 'Thinking…' : 'Ask'}
              </Button>
              <span className="text-[0.7rem] text-[var(--dsa-faint)]">
                {message.length}/400 · board is {Math.round(progress * 100)}% through
              </span>
              {threadId ? (
                <Button size="sm" variant="ghost" onClick={() => void forgetThread(threadId)}>
                  Clear conversation
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The honest disclosure.
 *
 * `CoachResponse.redacted` says the model was rewritten to remove something the
 * guardrail does not allow — naming an index, saying "now do X" as a whole
 * solution. That is a FEATURE and the learner should be able to see it working,
 * for the same reason the debrief shows the reference code after the run: the
 * system is not pretending to be magic, and pretending otherwise teaches
 * fourteen-year-olds to trust output they have not checked.
 */
function RedactionNotice({ redacted }: { redacted: { readonly reason: string; readonly original: string } | null | undefined }) {
  if (!redacted) return null
  return (
    <details className="rounded-lg border border-[var(--dsa-border)] bg-[color-mix(in_oklab,var(--dsa-surface-2)_45%,transparent)] px-2.5 py-1.5 text-[0.78rem] text-[var(--dsa-muted)]">
      <summary className="cursor-pointer select-none text-[var(--dsa-ink-faint)]">
        I held this back on purpose
      </summary>
      <p className="mt-1 leading-relaxed">{redacted.reason}</p>
      <p className="mt-1 text-[var(--dsa-faint)]">
        The coach is not allowed to hand over the answer — that is the rule that keeps the game worth playing.
      </p>
    </details>
  )
}

/**
 * The not-ready state. Deliberately not styled as an error: no red, no warning
 * icon, no retry button that would fail again. It is a moving codebase, and the
 * learner needs a route forward, not a diagnosis.
 */
function NotReady() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--dsa-border)] p-3">
      <p className="text-[0.95rem] text-[var(--dsa-ink)]">No coach on this server yet.</p>
      <p className="mt-1 text-[0.88rem] leading-relaxed text-[var(--dsa-muted)]">
        The coach endpoints are not mounted on this build, so there is nobody to ask. The board, the hints and the
        debrief all work exactly as they are.
      </p>
      <div className="mt-2.5">
        <textarea
          className="input min-h-14 cursor-not-allowed resize-none opacity-50"
          value=""
          disabled
          readOnly
          placeholder="Ask a question"
          aria-label="The coach is not available on this server"
        />
        <Button className="mt-2" size="sm" disabled>
          Ask
        </Button>
      </div>
    </div>
  )
}
