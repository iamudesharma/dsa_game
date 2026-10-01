'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

/**
 * Sign in. Play stays anonymous — this only gates resume/interview. On
 * success the adventure progress merges server-side (see AdventureProvider).
 */
export function LoginView() {
  const router = useRouter()
  const { login, busy, error, clearError, user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (user) {
    router.replace('/account')
    return null
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    clearError()
    if (await login(email.trim(), password)) router.push('/account')
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <p className="eyebrow">ACCOUNT</p>
      <h1 className="text-2xl font-bold text-[var(--dsa-ink)]">Sign in</h1>
      <p className="mt-1 text-sm text-[var(--dsa-muted)]">Your games stay playable without an account. Signing in unlocks your resume and interview prep.</p>
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
            <span className="mb-1 block font-medium text-[var(--dsa-ink)]">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[var(--dsa-border)] bg-white px-3 py-2 text-[var(--dsa-ink)]"
            />
          </label>
          {error && <p role="alert" className="text-sm text-[var(--dsa-danger)]">{error}</p>}
          <Button variant="primary" size="lg" type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Panel>
      <p className="mt-4 text-sm text-[var(--dsa-muted)]">No account yet? <Link href="/signup" className="underline underline-offset-4">Create one</Link> · <Link href="/" className="underline underline-offset-4">Back to the map</Link></p>
    </main>
  )
}
