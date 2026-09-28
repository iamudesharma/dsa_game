import type { CSSProperties } from 'react'
import type { GameSpec } from '@dsa/game-schema'

export type Palette = GameSpec['visual']['palette']

/**
 * Custom properties are not in `CSSProperties`, but the template-literal index
 * signature keeps the object literal assignable without an `any` or a double
 * cast, so the compiler still checks the keys we write.
 */
export type StyleVars = CSSProperties & Record<`--${string}`, string>

/**
 * The spec owns its palette; CSS owns the paint.
 *
 * We hand the five palette colours to CSS custom properties so a mechanic
 * renderer can theme itself with plain Tailwind classes
 * (`border-[color:var(--dsa-accent)]`) instead of threading a colour prop
 * through every component. `globals.css` holds the neutral defaults for
 * screens with no game loaded.
 */
export function paletteVars(palette: Palette): StyleVars {
  return {
    '--dsa-bg': palette.background,
    '--dsa-primary': palette.primary,
    '--dsa-accent': palette.accent,
    '--dsa-success': palette.success,
    '--dsa-danger': palette.danger,
  }
}
