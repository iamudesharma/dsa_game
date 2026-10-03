'use client'
import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { useGameStore } from '@/store/game'
import { useAuth } from '@/components/auth/AuthProvider'
import { getServerProgress, postServerProgress } from '@/lib/api'
import { learningRequest, type LearningDashboard } from '@/lib/learning-api'
import {
  completedWorlds,
  freshProgress,
  readProgress,
  recordCompletion,
  PROGRESS_KEY,
  type AdventureProgress,
  type PlayerPreferences,
} from '@/lib/adventure'
const Context = createContext({
  progress: freshProgress(),
  ready: false,
  warning: false,
  guestImportAvailable: false,
  importGuest: async () => {},
  selectFrame: (_: PlayerPreferences['mapFrame']) => {},
})
export const useAdventure = () => useContext(Context)
export function AdventureProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth()
  const owner = user?.id ?? 'guest'
  const key = user ? `${PROGRESS_KEY}:account:${user.id}` : PROGRESS_KEY
  const [progress, setProgress] = useState<AdventureProgress>(freshProgress),
    [loadedOwner, setLoadedOwner] = useState(''),
    [warning, setWarning] = useState(false),
    [guestImportAvailable, setGuestImport] = useState(false)
  const current = useRef(progress),
    activeKey = useRef(key)
  activeKey.current = key
  const state = useGameStore((s) => s.state)
  const commit = useCallback((next: AdventureProgress) => {
    current.current = next
    setProgress(next)
    try {
      localStorage.setItem(activeKey.current, JSON.stringify(next))
    } catch {
      setWarning(true)
    }
  }, [])
  useEffect(() => {
    if (!authReady) return
    let alive = true
    setLoadedOwner('')
    setWarning(false)
    setGuestImport(false)
    // Clear transient game data when changing accounts, without deleting browser drafts.
    useGameStore.getState().reset()
    const local = () => {
      try {
        const storage = {
          getItem: (k: string) =>
            k === PROGRESS_KEY ? localStorage.getItem(key) : user ? null : localStorage.getItem(k),
        }
        return readProgress(storage).progress
      } catch {
        setWarning(true)
        return freshProgress()
      }
    }
    const initial = local()
    current.current = initial
    setProgress(initial)
    if (user) {
      try {
        setGuestImport(
          Object.keys(readProgress(localStorage).progress.completed).length > 0 &&
            localStorage.getItem(`dsa-guest-import:${user.id}`) !== 'done',
        )
      } catch {}
      Promise.all([getServerProgress(), learningRequest<LearningDashboard>('/dashboard')])
        .then(([completed, d]) => {
          if (alive) {
            commit({ ...initial, completed: { ...completed, ...d.completed } })
            setLoadedOwner(owner)
          }
        })
        .catch(() => {
          if (alive) {
            setWarning(true)
            setLoadedOwner(owner)
          }
        })
    } else setLoadedOwner(owner)
    const sync = (event: StorageEvent) => {
      if (event.key === key && alive) {
        const value = local()
        current.current = value
        setProgress(value)
      }
    }
    window.addEventListener('storage', sync)
    return () => {
      alive = false
      window.removeEventListener('storage', sync)
    }
  }, [authReady, owner, key, commit])
  useEffect(() => {
    if (loadedOwner !== owner || !state || state.phase !== 'won') return
    const next = recordCompletion(current.current, state)
    if (next !== current.current) {
      commit(next)
      if (user) void postServerProgress(next.completed).catch(() => setWarning(true))
    }
  }, [state, loadedOwner, owner, user, commit])
  const importGuest = async () => {
    if (!user) return
    try {
      const guest = readProgress(localStorage).progress.completed
      const completed = await postServerProgress(guest)
      commit({ ...current.current, completed: { ...current.current.completed, ...completed } })
      localStorage.setItem(`dsa-guest-import:${user.id}`, 'done')
      setGuestImport(false)
    } catch {
      setWarning(true)
    }
  }
  const selectFrame = (mapFrame: PlayerPreferences['mapFrame']) => {
    if (mapFrame !== 'default' && !completedWorlds(current.current).some((w) => w.id === mapFrame)) return
    commit({ ...current.current, preferences: { mapFrame } })
  }
  const visible = loadedOwner === owner ? progress : freshProgress()
  return (
    <Context.Provider
      value={{
        progress: visible,
        ready: authReady && loadedOwner === owner,
        warning,
        guestImportAvailable,
        importGuest,
        selectFrame,
      }}
    >
      {children}
    </Context.Provider>
  )
}
