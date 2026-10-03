'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { Resume, Target } from '@dsa/account'
import { Button } from '@/components/ui/Button'
import { chatLink } from '@/lib/learning-api'
import { Panel } from '@/components/ui/Panel'
import {
  DsaApiError,
  getInterviewKits,
  getInterviewKit,
  postInterviewGenerate,
  type InterviewKitResult,
  type InterviewKitSummary,
} from '@/lib/api'

const TYPE_LABEL: Record<string, string> = {
  behavioral: 'Behavioral',
  coding: 'Coding',
  concepts: 'Concepts',
  'system-design': 'System design',
  'resume-deep-dive': 'Resume deep-dive',
  ml: 'Machine learning',
}

/**
 * Interview prep: generate a grounded kit, read each question with its
 * source, and jump into a playable board where one is mapped.
 *
 * Every card shows WHY it fits and what the interviewer listens for — both
 * deterministic template text from the company profile, never model-authored
 * process claims. `sourceRef` chips prove the grounding: each question points
 * at the resume item (or `general`) it came from.
 */
export function InterviewTab({ resume, target, onTargetChange }: { resume: Resume; target: Target | null; onTargetChange: (t: Target) => void }) {
  const [kit, setKit] = useState<InterviewKitResult | null>(null)
  const [history, setHistory] = useState<InterviewKitSummary[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  void onTargetChange

  useEffect(() => {
    let alive = true
    void getInterviewKits().then(h => { if (alive) setHistory(h) }).catch(() => { if (alive) setError('Could not load past kits. Retry by reopening this section.') })
    const id = new URLSearchParams(window.location.search).get('kit')
    if (id) void getInterviewKit(id).then(k => { if (alive) setKit(k) }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [])

  const generate = async (newAngle: boolean) => {
    if (!target) return
    setGenerating(true)
    setError(null)
    try {
      const res = await postInterviewGenerate({ newAngle })
      setKit(res)
      setHistory(await getInterviewKits().catch(() => history))
    } catch (cause) {
      setError(cause instanceof DsaApiError ? cause.message : 'Could not generate questions.')
    } finally {
      setGenerating(false)
    }
  }

  const sourceLabel = (ref: string): string => {
    if (ref === 'general') return 'general'
    const exp = resume.experience.find((e) => e.id === ref)
    if (exp) return `${exp.title} @ ${exp.company}`
    const skill = resume.skills.find((s) => s.id === ref)
    if (skill) return skill.name
    const proj = resume.projects.find((p) => p.id === ref)
    if (proj) return proj.name
    const edu = resume.education.find((e) => e.id === ref)
    if (edu) return edu.school
    return ref
  }

  if (!target) {
    return (
      <Panel title="Set your target first" subtitle="Pick a goal and a company on the Target tab — questions are generated from that plus your resume.">
        <p className="text-sm text-[var(--dsa-muted)]">Once your target is saved, come back here for a tailored question set.</p><Link className="btn mt-3" href="/account?tab=target">Set interview target →</Link>
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <Panel title="Generate questions" subtitle={`Goal: ${target.goal}`}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={generating} onClick={() => void generate(false)}>
            {generating ? 'Generating…' : kit ? 'Regenerate' : 'Generate my questions'}
          </Button>
          {kit && (
            <Button disabled={generating} onClick={() => void generate(true)}>
              New angle
            </Button>
          )}
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-[var(--dsa-danger)]">{error}</p>}
        {kit && <p className="mt-2 text-xs text-[var(--dsa-muted)]">Generated via {kit.usedTier === 'template' ? 'built-in template' : kit.usedTier} · {kit.questions.length} questions{kit.notes.length > 0 ? ` · ${kit.notes[0]}` : ''}</p>}
      </Panel>

      {kit && (
        <div className="space-y-3">
          {kit.questions.map((q) => (
            <article key={q.id} className="panel p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-[var(--dsa-border)] px-2 py-0.5 font-semibold text-[var(--dsa-ink)]">{TYPE_LABEL[q.type] ?? q.type}</span>
                <span className="rounded-full border border-[var(--dsa-border)] px-2 py-0.5 text-[var(--dsa-muted)]">{q.difficulty}</span>
                <span className="rounded-full border border-[var(--dsa-border)] px-2 py-0.5 text-[var(--dsa-muted)]" title="The resume item this question is grounded in">from: {sourceLabel(q.sourceRef)}</span>
              </div>
              <p className="mt-2 font-medium text-[var(--dsa-ink)]">{q.prompt}</p>
              <p className="mt-1 text-sm text-[var(--dsa-muted)]"><strong className="text-[var(--dsa-ink)]">Why this question:</strong> {q.whyItFits}</p>
<details className="mt-2"><summary>Show evaluation guidance</summary><p className="mt-1 text-sm text-[var(--dsa-muted)]">{q.listeningFor}</p></details><Link className="btn mt-2" href={chatLink(`Practise this interview question with me one step at a time: ${q.prompt}`,{type:'interview',kitId:kit.kitId,questionId:q.id})}>Practise in Chat</Link>
              {q.followUps.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-[var(--dsa-muted)]">
                  {q.followUps.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              )}
              {q.practice && (
                <Link href={`/problem/${q.practice.problemId}`} className="btn mt-3">Practise this →</Link>
              )}
            </article>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <Panel title="Past kits" subtitle="Your previous question sets.">
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.kitId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--dsa-muted)]">{new Date(h.createdAt).toLocaleString()} · {h.count} questions · {h.usedTier}</span>
                <button className="btn" onClick={() => { setError(null); void getInterviewKit(h.kitId).then(setKit).catch(e => setError(e.message)) }}>Open question set</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
