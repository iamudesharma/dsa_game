'use client'

import type { ReactNode } from 'react'
import type { GameSpec } from '@dsa/game-schema'
import { paletteVars, type StyleVars } from '@/lib/palette'
import { cn } from '@/lib/format'

export interface ThemeScopeProps {
  /** Omit on screens with no game loaded; the CSS defaults apply. */
  spec?: GameSpec | null
  children: ReactNode
  className?: string
}

/**
 * Scopes a spec's palette to this subtree. Every themed colour in the app is
 * read from these custom properties, so theming a whole generated game is one
 * `style` object on one wrapper — and the home / problem screens keep the
 * neutral defaults from `globals.css`.
 */
export function ThemeScope({ spec, children, className }: ThemeScopeProps) {
  const vars: StyleVars | undefined = spec ? paletteVars(spec.visual.palette) : undefined
  return (
    <div style={vars} className={cn('min-h-dvh', className)} data-theme={spec ? 'game' : 'default'}>
      {children}
    </div>
  )
}
