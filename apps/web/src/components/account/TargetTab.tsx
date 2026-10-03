'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import type { Target } from '@dsa/account'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { DsaApiError, putTarget, type CompanyProfileDto } from '@/lib/api'

const inputCls = 'w-full rounded-xl border border-[var(--dsa-border)] bg-white px-3 py-2 text-[var(--dsa-ink)]'
const labelCls = 'mb-1 block text-xs font-medium text-[var(--dsa-ink)]'

const SENIORITIES = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal'] as const

/**
 * Goal + target company + seniority + focus areas. Company process facts come
 * from the deterministic registry (`/api/companies`); the model only ever
 * rephrases them when generating questions.
 */
export function TargetTab({ target, companies, onChange }: { target: Target | null; companies: CompanyProfileDto[]; onChange: (t: Target) => void }) {
  const [draft, setDraft] = useState<Target>(
    target ?? { goal: '', companyId: 'faang-general', customCompany: '', seniority: 'mid', focusAreas: [] },
  )
  const { user }=useAuth()
  const [draftReady,setDraftReady]=useState(false)
  const [saved,setSaved]=useState(JSON.stringify(target))
  useEffect(()=>{try{const raw=localStorage.getItem(`dsa-target-draft:${user?.id}`);if(raw)setDraft(JSON.parse(raw))}catch{}setDraftReady(true)},[user?.id])
  useEffect(()=>{if(!draftReady)return;try{localStorage.setItem(`dsa-target-draft:${user?.id}`,JSON.stringify(draft))}catch{}},[draft,draftReady,user?.id])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focusInput, setFocusInput] = useState('')

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const result=await putTarget(draft); onChange(result); setSaved(JSON.stringify(result)); setDraft(result)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (cause) {
      setError(cause instanceof DsaApiError ? cause.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const company = companies.find((c) => c.id === draft.companyId)
  const isCustom = draft.companyId === 'custom' || (draft.companyId !== '' && !company)

  return (
    <div className="space-y-4"><p role="status">{JSON.stringify(draft)===saved ? 'Target saved' : 'Target has unsaved changes'}</p><p className="text-sm">Your role sets the question topics; seniority sets expected depth; focus areas steer your preparation.</p>{savedAt && <Link className="btn" href="/account?tab=interview">Generate interview questions →</Link>}
      <Panel title="Your goal" subtitle="One sentence: what role are you preparing for?">
        <input
          value={draft.goal}
          onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
          placeholder="e.g. Backend engineer at an AI lab"
          className={inputCls}
          aria-label="Your goal"
        />
      </Panel>

      <Panel title="Target company" subtitle="Company profiles are curated data — the generator rephrases them but never invents process facts.">
        <label className="block text-sm">
          <span className={labelCls}>Company</span>
          <select value={company ? draft.companyId : 'custom'} onChange={(e) => setDraft({ ...draft, companyId: e.target.value })} className={inputCls}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            <option value="custom">Custom company…</option>
          </select>
        </label>
        {(!company || draft.companyId === 'custom') && (
          <label className="mt-2 block text-sm">
            <span className={labelCls}>Company name</span>
            <input value={draft.customCompany} onChange={(e) => setDraft({ ...draft, customCompany: e.target.value, companyId: 'custom' })} placeholder="e.g. Acme Robotics" className={inputCls} />
          </label>
        )}
        {company && (
          <div className="mt-3 rounded-xl border border-[var(--dsa-border)] p-3 text-sm">
            <p className="font-semibold text-[var(--dsa-ink)]">{company.label} looks for</p>
            <ul className="mt-1 list-disc pl-5 text-[var(--dsa-muted)]">
              {company.hiringAxes.map((a) => <li key={a.id}>{a.label}</li>)}
            </ul>
            <p className="mt-2 font-semibold text-[var(--dsa-ink)]">Rounds</p>
            <ul className="mt-1 list-disc pl-5 text-[var(--dsa-muted)]">
              {company.rounds.map((r) => <li key={r.name}><strong>{r.name}:</strong> {r.focus}</li>)}
            </ul>
          </div>
        )}
        {isCustom && !company && <p className="mt-2 text-xs text-[var(--dsa-muted)]">Custom companies use generic axes: coding, behavioral, and past-work depth.</p>}
      </Panel>

      <Panel title="Seniority & focus">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Seniority">
          {SENIORITIES.map((s) => (
            <button key={s} aria-pressed={draft.seniority === s} onClick={() => setDraft({ ...draft, seniority: s })} className={draft.seniority === s ? 'btn btn-primary' : 'btn'}>
              {s}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {draft.focusAreas.map((f) => (
            <span key={f} className="flex items-center gap-1 rounded-full border border-[var(--dsa-border)] bg-white px-2 py-1 text-sm">
              {f}
              <button aria-label={`Remove ${f}`} className="text-xs text-[var(--dsa-muted)]" onClick={() => setDraft({ ...draft, focusAreas: draft.focusAreas.filter((x) => x !== f) })}>✕</button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={focusInput}
            onChange={(e) => setFocusInput(e.target.value)}
            placeholder="Add a focus area, e.g. distributed systems"
            className={inputCls}
            aria-label="Add a focus area"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && focusInput.trim()) {
                e.preventDefault()
                if (!draft.focusAreas.includes(focusInput.trim()) && draft.focusAreas.length < 12) {
                  setDraft({ ...draft, focusAreas: [...draft.focusAreas, focusInput.trim()] })
                }
                setFocusInput('')
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              if (focusInput.trim() && !draft.focusAreas.includes(focusInput.trim()) && draft.focusAreas.length < 12) {
                setDraft({ ...draft, focusAreas: [...draft.focusAreas, focusInput.trim()] })
              }
              setFocusInput('')
            }}
          >
            Add
          </Button>
        </div>
      </Panel>

      {error && <p role="alert" className="text-sm text-[var(--dsa-danger)]">{error}</p>}
      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" disabled={saving || !draft.goal.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save target'}</Button>
        {savedAt && <span className="text-xs text-[var(--dsa-muted)]">Saved at {savedAt}</span>}
      </div>
    </div>
  )
}
