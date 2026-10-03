'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import { useAdventure } from '@/components/adventure/AdventureProvider'
export function AppNavigation() {
  const path = usePathname(),
    { user } = useAuth(),
    { guestImportAvailable, importGuest } = useAdventure()
  return (
    <>
      <a className="sr-only focus:not-sr-only" href="#app-content">
        Skip to content
      </a>
      <nav className="app-navigation" aria-label="App navigation">
        <Link className="font-bold" href="/">
          ✦ Play the Algorithms
        </Link>
        <div className="flex flex-wrap gap-2">
          {[
            ['/', 'Explore'],
            ['/learn', 'Learn'],
            ['/dashboard', 'Progress'],
            ['/chat', 'Chat'],
            ['/account', 'Profile'],
          ].map(([href, label]) => (
            <Link
              key={href}
              className="btn"
              href={href!}
              aria-current={
                path === href || (href === '/learn' && (path.startsWith('/learn/') || path === '/patterns' || path === '/tracks')) || (href !== '/' && path.startsWith(href! + '/')) ? 'page' : undefined
              }
            >
              {label}
            </Link>
          ))}
          {!user && (
            <Link className="btn" href={`/login?next=${encodeURIComponent(path)}`}>
              Sign in
            </Link>
          )}
        </div>
      </nav>
      {user && guestImportAvailable && (
        <div className="px-4 py-3 border-b border-[var(--dsa-border)] text-sm flex flex-wrap gap-3 items-center">
          <span>This browser has guest completion stamps. Import them into this account?</span>
          <button className="btn" onClick={() => void importGuest()}>
            Import guest stamps
          </button>
          <span>Only completion dates are imported.</span>
        </div>
      )}
      <span id="app-content" tabIndex={-1} />
    </>
  )
}
