'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

export function SignupView() {
  const router = useRouter()
  const { signup, busy, error, clearError, user } = useAuth()
  const [returnQuery, setReturnQuery] = useState('')
  useEffect(() => { setReturnQuery(window.location.search) }, [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => { if (user) router.replace(safeDestination()) }, [user, router])
  if (user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    clearError()
    if (await signup(email.trim(), password)) router.push(safeDestination())
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <p className="eyebrow">ACCOUNT</p>
      <h1 className="text-2xl font-bold text-[var(--dsa-ink)]">Create your account</h1>
      <p className="mt-1 text-sm text-[var(--dsa-muted)]">One account holds your resume, target company, interview kits, and progress across devices.</p>
      <Panel className="mt-5">
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-[var(--dsa-ink)]">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-[var(--dsa-border)] bg-white px-3 py-2 text-[var(--dsa-ink)]"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-[var(--dsa-ink)]">Password (8+ characters)</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[var(--dsa-border)] bg-white px-3 py-2 text-[var(--dsa-ink)]"
            />
          </label>
          {error && <p role="alert" className="text-sm text-[var(--dsa-danger)]">{error}</p>}
          <Button variant="primary" size="lg" type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      </Panel>
      <p className="mt-4 text-sm text-[var(--dsa-muted)]">Already have one? <Link href={`/login${returnQuery}`} className="underline underline-offset-4">Sign in</Link> · <Link href="/" className="underline underline-offset-4">Back to the map</Link></p>
    </main>
  )
}

function safeDestination(){if(typeof window==='undefined')return '/account';const next=new URLSearchParams(window.location.search).get('next');return next?.startsWith('/')&&!next.startsWith('//')&&!next.includes('\\')?next:'/account'}
