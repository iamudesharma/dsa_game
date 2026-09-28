'use client'

import { useEffect, useState } from 'react'

/**
 * Rehydrates the persisted Zustand store on the client.
 *
 * Server-rendered HTML has no sessionStorage, so the first paint of
 * `/play/<id>` must not assume a game exists. This returns `false` on the first
 * render and then flips to `true`, letting the play/debrief screens render a
 * "not loaded in this tab" state instead of flashing an empty board or, worse,
 * a crash on `state.objects[...]`.
 */
export function useStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    // The store's persist middleware rehydrates in a microtask on mount; a
    // macrotask guarantees we read it afterwards.
    const id = setTimeout(() => setHydrated(true), 0)
    return () => clearTimeout(id)
  }, [])
  return hydrated
}
