'use client'

import { AppNavigation } from './AppNavigation'
import { AdventureProvider } from '@/components/adventure/AdventureProvider'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * Client boundary for the whole app.
 *
 * Deliberately tiny: it only owns cross-cutting browser concerns —
 *  - `MotionConfig reducedMotion="user"` so every Framer animation in the tree
 *    collapses to an instant state change when the OS asks for reduced motion,
 *    rather than each component having to opt out,
 *  - the themed page background lives in `globals.css` via custom properties
 *    that the play/debrief screens override per game spec.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user"><AuthProvider><AdventureProvider><AppNavigation />{children}</AdventureProvider></AuthProvider></MotionConfig>
}
