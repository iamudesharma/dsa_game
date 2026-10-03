'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import type { ReactNode } from 'react'
export function LearningGate({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const path = usePathname()
  if (!ready)
    return (
      <main className="mx-auto max-w-5xl p-6" role="status">
        Loading your account…
      </main>
    )
  if (!user)
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-bold">Your learning, in one place</h1>
        <p className="my-4">
          Sign in to save conversations and see your practice history. You can keep playing as a guest.
        </p>
        <Link
          className="btn btn-primary"
          href={`/login?next=${encodeURIComponent(path + (typeof window !== 'undefined' ? window.location.search : ''))}`}
        >
          Sign in
        </Link>
      </main>
    )
  return <div key={user.id}>{children}</div>
}
