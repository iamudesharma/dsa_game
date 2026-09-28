import type { GameSpec, ObjectVisual } from '@dsa/game-schema'

/**
 * `ObjectVisual` covers four shapes of "how to draw a thing". The spec may also
 * supply `visual.objectGlyphs`, a loose `Record<string, string>`; the contract
 * does not say what its keys are, so we look up the most specific key first
 * (object id), then the object kind, then the label — and fall back to the
 * structured `ObjectVisual` when there is no glyph. In practice providers emit
 * either glyphs or a visual, rarely both.
 */
export function glyphFor(spec: GameSpec, objectId: string, kind: string, label: string): string | undefined {
  const glyphs = spec.visual.objectGlyphs
  return glyphs[objectId] ?? glyphs[kind] ?? glyphs[label]
}

const SHAPE_CLASS: Record<'circle' | 'square' | 'hex' | 'star', string> = {
  circle: 'rounded-full',
  square: 'rounded-[3px]',
  hex: 'rounded-[3px] [clip-path:polygon(25%_0,75%_0,100%_50%,75%_100%,25%_100%,0_50%)]',
  star: '[clip-path:polygon(50%_0,61%_35%,98%_35%,68%_57%,79%_91%,50%_70%,21%_91%,32%_57%,2%_35%,39%_35%)]',
}

export function ObjectGlyph({
  visual,
  glyph,
  size = 22,
}: {
  visual: ObjectVisual | undefined
  glyph: string | undefined
  size?: number
}) {
  if (glyph) {
    return (
      <span aria-hidden style={{ fontSize: size * 0.8, lineHeight: 1 }} className="shrink-0">
        {glyph}
      </span>
    )
  }
  if (!visual) return null
  switch (visual.kind) {
    case 'emoji':
      return (
        <span aria-hidden style={{ fontSize: size * 0.8, lineHeight: 1 }} className="shrink-0">
          {visual.glyph}
        </span>
      )
    case 'text':
      return (
        <span
          aria-hidden
          className="mono truncate text-[0.6rem] leading-none text-[var(--dsa-ink-faint)]"
          style={{ maxWidth: size * 2.2 }}
        >
          {visual.text}
        </span>
      )
    case 'bar':
      return (
        <span
          aria-hidden
          className="w-2 shrink-0 rounded-sm bg-[color-mix(in_oklab,var(--dsa-accent)_70%,transparent)]"
          style={{ height: `${Math.max(3, Math.min(100, visual.height))}%` }}
        />
      )
    case 'shape':
    default:
      return (
        <span
          aria-hidden
          className={`block shrink-0 border border-current bg-[color-mix(in_oklab,currentColor_25%,transparent)] ${SHAPE_CLASS[visual.shape]}`}
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      )
  }
}
