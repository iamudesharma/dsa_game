import type { GameSpec, ObjectVisual } from '@dsa/game-schema'

/**
 * `ObjectVisual` covers four shapes of "how to draw a thing". The spec may also
 * supply `visual.objectGlyphs`, an ORDERED PALETTE of glyph strings.
 *
 * It is a list rather than a map because opencode-go enforces OpenAI's strict
 * structured-output rules, which reject JSON-Schema maps
 * (`additionalProperties: {…}`, `propertyNames`); a Record there produced a bare
 * `400 invalid_request_error`. See the note on `VisualSchema` in game-schema.
 *
 * A list has no keys, so it is indexed by object KIND. That only means
 * something when there is one entry per kind: a shorter palette is decoration
 * rather than an assignment, and showing a `target` with a `node` glyph is
 * worse than showing plain text. Below full length we ignore it and let
 * `ObjectVisual` do the work. The Flutter client applies the same rule, so the
 * two renderers agree.
 */
const KIND_ORDER = [
  'item',
  'number',
  'node',
  'token',
  'door',
  'room',
  'slot',
  'path',
  'target',
] as const

export function glyphFor(spec: GameSpec, objectId: string, kind: string, label: string): string | undefined {
  const palette = spec.visual.objectGlyphs
  if (palette.length < KIND_ORDER.length) return undefined
  const index = KIND_ORDER.indexOf(kind as (typeof KIND_ORDER)[number])
  if (index < 0) return undefined
  void objectId
  void label
  return palette[index]
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
