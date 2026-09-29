'use client'
import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { useGameStore } from '@/store/game'
import { completedWorlds, freshProgress, readProgress, recordCompletion, saveProgress, PROGRESS_KEY, type AdventureProgress, type PlayerPreferences } from '@/lib/adventure'

const Context = createContext({ progress: freshProgress(), ready: false, warning: false, selectFrame: (_: PlayerPreferences['mapFrame']) => {} })
export const useAdventure = () => useContext(Context)
export function AdventureProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<AdventureProgress>(freshProgress)
  const current = useRef(progress)
  const [ready, setReady] = useState(false)
  const [warning, setWarning] = useState(false)
  const state = useGameStore(s => s.state)
  const commit = useCallback((next: AdventureProgress) => {
    current.current = next
    setProgress(next)
    try { if (!saveProgress(window.localStorage, next)) setWarning(true) } catch { setWarning(true) }
  }, [])
  useEffect(() => {
    try {
      const result = readProgress(window.localStorage)
      setWarning(result.warning)
      commit(result.progress)
    } catch { setWarning(true) }
    setReady(true)
    const sync = (event: StorageEvent) => {
      if (event.key !== PROGRESS_KEY) return
      try {
        const result = readProgress(window.localStorage)
        const merged = { ...result.progress, completed: { ...result.progress.completed, ...current.current.completed } }
        current.current = merged
        setProgress(merged)
        setWarning(result.warning)
      } catch { setWarning(true) }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [commit])
  useEffect(() => {
    if (!ready || !state || state.phase !== 'won') return
    let base = current.current
    try {
      const disk = readProgress(window.localStorage).progress
      base = { ...base, completed: { ...disk.completed, ...base.completed } }
    } catch { setWarning(true) }
    const next = recordCompletion(base, state)
    if (next !== base) commit(next)
  }, [ready, state, commit])
  const selectFrame = (mapFrame: PlayerPreferences['mapFrame']) => {
    if (mapFrame !== 'default' && !completedWorlds(current.current).some(w => w.id === mapFrame)) return
    commit({ ...current.current, preferences: { mapFrame } })
  }
  return <Context.Provider value={{ progress, ready, warning, selectFrame }}>{children}</Context.Provider>
}
