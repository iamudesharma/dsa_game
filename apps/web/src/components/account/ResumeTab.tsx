'use client'

import { useState } from 'react'
import type { Resume } from '@dsa/account'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { DsaApiError, postParseResume, putResume } from '@/lib/api'
import { extractTextFromFile } from '@/lib/extract'

function nid(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

const inputCls = 'w-full rounded-xl border border-[var(--dsa-border)] bg-white px-3 py-2 text-[var(--dsa-ink)]'
const labelCls = 'mb-1 block text-xs font-medium text-[var(--dsa-ink)]'

/**
 * All three ingest paths in one tab: manual structured form (the source of
 * truth), paste + deterministic parse (the fast path), and PDF/DOCX upload
 * (extracted in the browser; the server only ever receives text).
 */
export function ResumeTab({ resume, onChange, onSaved }: { resume: Resume; onChange: (r: Resume) => void; onSaved?: (r: Resume) => void }) {
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [parsing, setParsing] = useState(false)
  const [unparsed, setUnparsed] = useState<string[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extraction, setExtraction] = useState<{ source: string; notes: string[]; rejected: string[] } | null>(null)

  const set = (patch: Partial<Resume>) => onChange({ ...resume, ...patch })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const saved = await putResume(resume)
      onChange(saved)
      onSaved?.(saved)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (cause) {
      setError(cause instanceof DsaApiError ? cause.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const parse = async (text: string, saveIt: boolean) => {
    if (!text.trim()) return
    setParsing(true)
    setError(null)
    try {
      const res = await postParseResume(text, saveIt)
      onChange(res.resume)
      setUnparsed(res.unparsed)
      setExtraction({ source: res.source ?? 'deterministic', notes: res.notes ?? [], rejected: res.rejected ?? [] })
      if (saveIt) { onSaved?.(res.resume); setSavedAt(new Date().toLocaleTimeString()) }
    } catch (cause) {
      setError(cause instanceof DsaApiError ? cause.message : 'Could not parse.')
    } finally {
      setParsing(false)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setExtracting(true)
    setError(null)
    try {
      const text = await extractTextFromFile(file)
      setPaste(text.slice(0, 20000))
      await parse(text, false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file. Paste the text instead.')
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Import" subtitle="Paste or upload your resume. Review the extracted fields and fix anything unclear before clicking Save resume.">
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          placeholder="Paste your resume text here…"
          className={inputCls}
          aria-label="Paste resume text"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={parsing || !paste.trim()} onClick={() => void parse(paste, false)}>
            {parsing ? 'Parsing…' : 'Parse into the form'}
          </Button>
          <label className="btn cursor-pointer">
            {extracting ? 'Reading…' : 'Upload PDF / DOCX'}
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="sr-only"
              disabled={extracting}
              onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
            />
          </label>
        </div>
        {extraction && (
          <p className="mt-2 text-xs text-[var(--dsa-muted)]">
            Extracted by <strong className="text-[var(--dsa-ink)]">{extraction.source === 'model' ? 'the language model' : 'the built-in parser'}</strong>
            {extraction.rejected.length > 0 && ` · ${extraction.rejected.length} invented field${extraction.rejected.length === 1 ? '' : 's'} dropped`}
            {extraction.notes.filter((n) => n !== extraction.source).map((n) => ` · ${n}`).join('')}
          </p>
        )}
        {unparsed.length > 0 && (
          <div className="mt-3 rounded-xl border border-[var(--dsa-border)] p-3">
            <p className="text-xs font-semibold text-[var(--dsa-ink)]">Couldn&apos;t place {unparsed.length} line{unparsed.length === 1 ? '' : 's'} — copy them into the form below:</p>
            <ul className="mt-1 max-h-32 list-disc overflow-auto pl-5 text-xs text-[var(--dsa-muted)]">
              {unparsed.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="Basics">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className={labelCls}>Name</span><input value={resume.contact.name} onChange={(e) => set({ contact: { ...resume.contact, name: e.target.value } })} className={inputCls} /></label>
          <label className="block text-sm"><span className={labelCls}>Email</span><input value={resume.contact.email} onChange={(e) => set({ contact: { ...resume.contact, email: e.target.value } })} className={inputCls} /></label>
        </div>
        <label className="mt-3 block text-sm"><span className={labelCls}>Summary</span><textarea value={resume.summary} onChange={(e) => set({ summary: e.target.value })} rows={3} className={inputCls} /></label>
      </Panel>

      <Panel title="Experience" action={<Button size="sm" onClick={() => set({ experience: [...resume.experience, { id: nid('exp'), title: '', company: '', start: '', end: 'Present', bullets: [] }] })}>Add role</Button>}>
        {resume.experience.length === 0 && <p className="text-sm text-[var(--dsa-muted)]">No roles yet. Add one, or import above.</p>}
        {resume.experience.map((e, i) => (
          <div key={e.id} className="mb-3 rounded-xl border border-[var(--dsa-border)] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm"><span className={labelCls}>Title</span><input value={e.title} onChange={(ev) => set({ experience: resume.experience.map((x, j) => j === i ? { ...x, title: ev.target.value } : x) })} className={inputCls} /></label>
              {/* An empty company is a real state, not a bug: the parser and the
                  grounding validator both refuse to guess one, so the field is
                  left blank and the placeholder says why. */}
              <label className="block text-sm"><span className={labelCls}>Company</span><input value={e.company} placeholder="Not stated in the resume" onChange={(ev) => set({ experience: resume.experience.map((x, j) => j === i ? { ...x, company: ev.target.value } : x) })} className={inputCls} /></label>
              <label className="block text-sm"><span className={labelCls}>Start</span><input value={e.start} placeholder="2021" onChange={(ev) => set({ experience: resume.experience.map((x, j) => j === i ? { ...x, start: ev.target.value } : x) })} className={inputCls} /></label>
              <label className="block text-sm"><span className={labelCls}>End</span><input value={e.end} placeholder="Present" onChange={(ev) => set({ experience: resume.experience.map((x, j) => j === i ? { ...x, end: ev.target.value } : x) })} className={inputCls} /></label>
            </div>
            <label className="mt-2 block text-sm"><span className={labelCls}>Highlights (one per line)</span><textarea value={e.bullets.join('\n')} onChange={(ev) => set({ experience: resume.experience.map((x, j) => j === i ? { ...x, bullets: ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12) } : x) })} rows={3} className={inputCls} /></label>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ experience: resume.experience.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
      </Panel>

      <Panel title="Skills" action={<Button size="sm" onClick={() => set({ skills: [...resume.skills, { id: nid('skill'), name: '' }] })}>Add skill</Button>}>
        {resume.skills.length === 0 && <p className="text-sm text-[var(--dsa-muted)]">No skills yet.</p>}
        <div className="flex flex-wrap gap-2">
          {resume.skills.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full border border-[var(--dsa-border)] bg-white px-2 py-1">
              <input
                value={s.name}
                aria-label={`Skill ${i + 1}`}
                onChange={(ev) => set({ skills: resume.skills.map((x, j) => j === i ? { ...x, name: ev.target.value } : x) })}
                className="w-28 bg-transparent text-sm text-[var(--dsa-ink)] outline-none"
                placeholder="Python"
              />
              <button aria-label={`Remove ${s.name || 'skill'}`} className="text-xs text-[var(--dsa-muted)]" onClick={() => set({ skills: resume.skills.filter((_, j) => j !== i) })}>✕</button>
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="Projects" action={<Button size="sm" onClick={() => set({ projects: [...resume.projects, { id: nid('proj'), name: '', description: '', tech: [], link: '' }] })}>Add project</Button>}>
        {resume.projects.length === 0 && <p className="text-sm text-[var(--dsa-muted)]">No projects yet.</p>}
        {resume.projects.map((p, i) => (
          <div key={p.id} className="mb-3 rounded-xl border border-[var(--dsa-border)] p-3">
            <label className="block text-sm"><span className={labelCls}>Name</span><input value={p.name} onChange={(ev) => set({ projects: resume.projects.map((x, j) => j === i ? { ...x, name: ev.target.value } : x) })} className={inputCls} /></label>
            <label className="mt-2 block text-sm"><span className={labelCls}>Description</span><textarea value={p.description} onChange={(ev) => set({ projects: resume.projects.map((x, j) => j === i ? { ...x, description: ev.target.value } : x) })} rows={2} className={inputCls} /></label>
            <label className="mt-2 block text-sm"><span className={labelCls}>Tech (comma separated)</span><input value={p.tech.join(', ')} onChange={(ev) => set({ projects: resume.projects.map((x, j) => j === i ? { ...x, tech: ev.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) } : x) })} className={inputCls} /></label>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ projects: resume.projects.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
      </Panel>

      <Panel title="Education" action={<Button size="sm" onClick={() => set({ education: [...resume.education, { id: nid('edu'), school: '', degree: '', field: '', start: '', end: '' }] })}>Add education</Button>}>
        {resume.education.length === 0 && <p className="text-sm text-[var(--dsa-muted)]">No education yet.</p>}
        {resume.education.map((e, i) => (
          <div key={e.id} className="mb-3 grid gap-2 rounded-xl border border-[var(--dsa-border)] p-3 sm:grid-cols-2">
            <label className="block text-sm"><span className={labelCls}>School</span><input value={e.school} onChange={(ev) => set({ education: resume.education.map((x, j) => j === i ? { ...x, school: ev.target.value } : x) })} className={inputCls} /></label>
            <label className="block text-sm"><span className={labelCls}>Degree</span><input value={e.degree} onChange={(ev) => set({ education: resume.education.map((x, j) => j === i ? { ...x, degree: ev.target.value } : x) })} className={inputCls} /></label>
            <div className="sm:col-span-2"><Button size="sm" variant="ghost" onClick={() => set({ education: resume.education.filter((_, j) => j !== i) })}>Remove</Button></div>
          </div>
        ))}
      </Panel>

      {error && <p role="alert" className="text-sm text-[var(--dsa-danger)]">{error}</p>}
      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save resume'}</Button>
        {savedAt && <span className="text-xs text-[var(--dsa-muted)]">Saved at {savedAt}</span>}
      </div>
    </div>
  )
}
