'use client'
import type { ReactNode } from 'react'
import type { GameSpec } from '@dsa/game-schema'
import { worldForProblem } from '@/lib/adventure'
import type { StyleVars } from '@/lib/palette'
import { cn } from '@/lib/format'
export interface ThemeScopeProps { spec?: GameSpec | null; children: ReactNode; className?: string }
/** Curated scenery keeps generated stories inside a stable visual identity. */
export function ThemeScope({ spec, children, className }: ThemeScopeProps) {
  const world = worldForProblem(spec?.problemId)
  const vars: StyleVars = { '--world-color': world.color, '--world-pale': world.pale }
  return <div style={vars} className={cn('min-h-dvh', className)} data-theme={spec ? 'game' : 'default'} data-world={world.id}>{children}</div>
}
