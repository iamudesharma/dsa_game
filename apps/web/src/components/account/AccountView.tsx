'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { Resume, Target } from '@dsa/account'
import { useAuth } from '@/components/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { DsaApiError, getCompanies, getMe, type CompanyProfileDto } from '@/lib/api'
import { InterviewTab } from './InterviewTab'
import { ResumeTab } from './ResumeTab'
import { TargetTab } from './TargetTab'

type Tab = 'resume' | 'target' | 'interview'

/**
 * The account hub: Resume · Target · Interview prep.
 *
 * Gated on auth (redirects to `/login` when signed out). Data loads once from
 * `/api/auth/me`; each tab owns its own save back to the server.
 */
function AccountContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, ready, logout, busy } = useAuth()
  const [tab, setTab] = useState<Tab>('resume')
  const [savedResume, setSavedResume] = useState('')
  useEffect(() => { const t = params.get('tab'); if (t === 'resume' || t === 'target' || t === 'interview') setTab(t) }, [params])
  const [resume, setResume] = useState<Resume | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [companies, setCompanies] = useState<CompanyProfileDto[]>([])
  const [error, setError] = useState<DsaApiError | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await getMe()
      setSavedResume(JSON.stringify(me.resume))
      let stored: string | null = null
      try { stored = localStorage.getItem(`dsa-resume-draft:${me.user.id}`) } catch { /* Account remains usable without browser storage. */ }
      try { setResume(stored ? JSON.parse(stored) : me.resume) } catch { setResume(me.resume) }
      setTarget(me.target)
      try {
        setCompanies(await getCompanies())
      } catch {
        setCompanies([])
      }
    } catch (cause) {
      setError(cause instanceof DsaApiError ? cause : new DsaApiError({ kind: 'unknown', code: 'ACCOUNT', message: 'Could not load your account.', retryable: true }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent('/account'+window.location.search)}`)
      return
    }
    void load()
  }, [ready, user, router, load])

  if (!ready || !user) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <p className="text-sm text-[var(--dsa-muted)]">Loading…</p>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <nav className="mb-5 flex flex-wrap items-center justify-between gap-2" aria-label="Account navigation">
        <Link href="/" className="btn">← Map</Link>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--dsa-muted)]">{user.email}</span>
          <Button size="sm" disabled={busy} onClick={() => { void logout().then(() => router.push('/')) }}>Sign out</Button>
        </div>
      </nav>
      <p className="eyebrow">INTERVIEW PREP</p>
      <h1 className="text-2xl font-bold text-[var(--dsa-ink)]">Your profile</h1>
      <p className="mt-1 text-sm text-[var(--dsa-muted)]">Add your experience, pick a target, and get interview questions grounded in both — with practice boards one click away.</p>

      <div className="mt-5 flex gap-2" role="tablist" aria-label="Account sections">
        {(['resume', 'target', 'interview'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
                  onKeyDown={event => { const keys = ['ArrowLeft','ArrowRight','Home','End']; if (!keys.includes(event.key)) return; event.preventDefault(); const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []); const i = tabs.indexOf(event.currentTarget); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next]?.focus(); tabs[next]?.click() }}
            aria-selected={tab === t}
            onClick={() => {setTab(t);window.history.replaceState(null,'',`/account?tab=${t}`)}}
            className={tab === t ? 'btn btn-primary' : 'btn'}
          >
            {t === 'resume' ? 'Resume' : t === 'target' ? 'Target' : 'Interview'}
          </button>
        ))}
      </div>

      {error && <div className="mt-4"><ErrorState error={error} onRetry={() => void load()} /></div>}
      {loading && <p role="status" className="mt-6 text-sm text-[var(--dsa-muted)]">Loading your profile…</p>}

      {!loading && resume && JSON.stringify(resume) !== savedResume && <p role="status" className="mt-3 text-sm">Resume has unsaved changes. Review extracted fields before saving.</p>}
      {!loading && !error && resume && (
        <div className="mt-5" role="tabpanel">
          {tab === 'resume' && <ResumeTab resume={resume} onChange={r => { setResume(r); try { localStorage.setItem(`dsa-resume-draft:${user.id}`, JSON.stringify(r)) } catch {} }} onSaved={r => { setSavedResume(JSON.stringify(r)); try { localStorage.removeItem(`dsa-resume-draft:${user.id}`) } catch {} }} />}
          {tab === 'target' && <TargetTab target={target} companies={companies} onChange={setTarget} />}
          {tab === 'interview' && <InterviewTab resume={resume} target={target} onTargetChange={setTarget} />}
        </div>
      )}
    </main>
  )
}

export function AccountView() { const { user } = useAuth(); return <AccountContent key={user?.id ?? "guest"} /> }
