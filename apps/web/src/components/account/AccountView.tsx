'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
export function AccountView() {
  const router = useRouter()
  const { user, ready, logout, busy } = useAuth()
  const [tab, setTab] = useState<Tab>('resume')
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
      setResume(me.resume)
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
      router.replace('/login')
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
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={tab === t ? 'btn btn-primary' : 'btn'}
          >
            {t === 'resume' ? 'Resume' : t === 'target' ? 'Target' : 'Interview'}
          </button>
        ))}
      </div>

      {error && <div className="mt-4"><ErrorState error={error} onRetry={() => void load()} /></div>}
      {loading && <p role="status" className="mt-6 text-sm text-[var(--dsa-muted)]">Loading your profile…</p>}

      {!loading && !error && resume && (
        <div className="mt-5" role="tabpanel">
          {tab === 'resume' && <ResumeTab resume={resume} onChange={setResume} />}
          {tab === 'target' && <TargetTab target={target} companies={companies} onChange={setTarget} />}
          {tab === 'interview' && <InterviewTab resume={resume} target={target} onTargetChange={setTarget} />}
        </div>
      )}
    </main>
  )
}
