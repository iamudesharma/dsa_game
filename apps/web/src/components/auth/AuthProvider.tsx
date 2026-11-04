'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  clearAuthToken,
  DsaApiError,
  getAuthToken,
  getMe,
  postLogin,
  postLogout,
  postSignup,
  setAuthToken,
  type AuthUser,
} from '@/lib/api'

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  busy: boolean
  error: string | null
  signup: (email: string, password: string) => Promise<boolean>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  clearError: () => void
}

const Context = createContext<AuthContextValue>({
  user: null,
  ready: false,
  busy: false,
  error: null,
  signup: async () => false,
  login: async () => false,
  logout: async () => {},
  clearError: () => {},
})

export const useAuth = () => useContext(Context)

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return 'Something went wrong.'
}

/**
 * Session state for the whole app.
 *
 * Play stays anonymous: this only gates resume/interview. On mount, a stored
 * token revalidates against `/api/auth/me`; progress merge happens in
 * `AdventureProvider` (which owns the completion map), not here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionAttempt, setSessionAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const token = getAuthToken()
    if (!token) {
      setReady(true)
      return
    }
    void getMe()
      .then((me) => {
        if (!cancelled) { setUser(me.user); setSessionError(null) }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          if (cause instanceof DsaApiError && cause.status === 401) clearAuthToken()
          else setSessionError(messageOf(cause))
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [sessionAttempt])

  const signup = useCallback(async (email: string, password: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await postSignup(email, password)
      setAuthToken(res.token)
      setSessionError(null)
      setUser(res.user)
      return true
    } catch (cause) {
      setError(messageOf(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await postLogin(email, password)
      setAuthToken(res.token)
      setSessionError(null)
      setUser(res.user)
      return true
    } catch (cause) {
      setError(messageOf(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const logout = useCallback(async () => {
    setBusy(true)
    try {
      await postLogout()
    } catch {
      // Server already forgot us or unreachable; clear locally regardless.
    } finally {
      clearAuthToken()
      setSessionError(null)
      setUser(null)
      setBusy(false)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const value = useMemo(
    () => ({ user, ready, busy, error, signup, login, logout, clearError }),
    [user, ready, busy, error, signup, login, logout, clearError],
  )
  return <Context.Provider value={value}>
    {sessionError && <div role="alert" className="panel m-3 p-4">
      <p>Could not verify your account: {sessionError} Your saved session is preserved.</p>
      <button className="btn mt-2" onClick={() => { setSessionError(null); setReady(false); setSessionAttempt(n => n + 1) }}>Retry account connection</button>
    </div>}
    {children}
  </Context.Provider>
}
