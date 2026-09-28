'use client'

import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import type { GameObject, GameSpec, ObjectState } from '@dsa/game-schema'
import type { TargetMarker, TargetStrength } from '@/lib/guidance'
import { targetStrength } from '@/lib/guidance'
import { cn } from '@/lib/format'
import { ObjectGlyph, glyphFor } from './ObjectGlyph'

/**
 * A tile on the board.
 *
 * COGNITIVE-LOAD RULE: every `ObjectState` gets a treatment that differs in
 * SHAPE, not only in colour, because a colour-only difference is (a) invisible
 * to a colour-blind learner and (b) lost the moment a generated palette makes
 * two states look alike. So:
 *
 *   eliminated — desaturated, lowered, hatched, struck through, non-interactive.
 *               It recedes because it is GONE. If it still competed for
 *               attention the learner would keep trying to use it.
 *   current    — scaled up, ringed, glowing. It is the one the algorithm is
 *               looking at right now.
 *   selected   — an unambiguous solid fill plus a numbered tab, so "you picked
 *               this" never reads the same as "the engine chose this".
 *   target     — a pulsing accent outline. "Touch this one" is never a puzzle.
 *   matched    — solid and settled with a tick; finished, not pending.
 *
 * `lo` / `mid` / `hi` are rendered by `SlotCell` as brackets around a range,
 * because that is literally what they are; this component only deals with the
 * object inside the cell.
 */

/** Announced to screen readers so state is never communicated by colour alone. */
export const OBJECT_STATE_LABEL: Record<ObjectState, string> = {
  idle: 'in play',
  selected: 'chosen by you',
  eliminated: 'ruled out by the algorithm',
  matched: 'matched — finished',
  swapped: 'swapped — it just moved',
  locked: 'locked — not available yet',
  current: 'where the program is looking',
  visited: 'already read',
  revealed: 'revealed',
}

interface StateLook {
  className: string
  style: CSSProperties
  /** Corner mark. Meaningful glyphs only — no decoration. */
  badge: string | null
  describe: (label: string) => string
}

function look(state: ObjectState, picked: boolean, pickIndex: number | null): StateLook {
  const base = (label: string): string => `${label} (${OBJECT_STATE_LABEL[state]})`

  if (picked) {
    return {
      className: 'z-10 scale-[1.08] ring-2 ring-[var(--dsa-accent)]',
      style: {
        borderColor: 'var(--dsa-accent)',
        background: 'color-mix(in oklab, var(--dsa-accent) 26%, var(--dsa-surface-2))',
        boxShadow: '0 0 22px -6px color-mix(in oklab, var(--dsa-accent) 85%, transparent)',
      },
      badge: pickIndex !== null ? String(pickIndex) : null,
      describe: (label) => `${label} (picked as ${pickIndex === 1 ? 'first' : 'second'})`,
    }
  }

  switch (state) {
    case 'selected':
      return {
        className: 'ring-2 ring-[color:color-mix(in_oklab,var(--dsa-primary)_70%,transparent)]',
        style: {
          borderColor: 'var(--dsa-primary)',
          background: 'color-mix(in oklab, var(--dsa-primary) 18%, var(--dsa-surface-2))',
        },
        badge: '●',
        describe: base,
      }
    case 'current':
      return {
        className: 'z-10 scale-[1.06] ring-2 ring-[color:color-mix(in_oklab,var(--dsa-accent)_70%,transparent)]',
        style: {
          borderColor: 'var(--dsa-accent)',
          background: 'color-mix(in oklab, var(--dsa-accent) 14%, var(--dsa-surface-2))',
          boxShadow: '0 0 26px -8px color-mix(in oklab, var(--dsa-accent) 90%, transparent)',
        },
        badge: '▸',
        describe: base,
      }
    case 'matched':
      return {
        className: '',
        style: {
          borderColor: 'var(--dsa-success)',
          background: 'color-mix(in oklab, var(--dsa-success) 16%, var(--dsa-surface-2))',
        },
        badge: '✓',
        describe: base,
      }
    case 'eliminated':
      // Recede. Opacity, desaturation, a hatch AND a strike-through: four
      // redundant signals, because "this is gone" is the single most important
      // thing to read correctly and cheaply.
      return {
        className: 'hatch-out opacity-40 saturate-0',
        style: {
          borderColor: 'color-mix(in oklab, var(--dsa-border) 70%, transparent)',
          background: 'color-mix(in oklab, var(--dsa-surface) 60%, transparent)',
        },
        badge: '✕',
        describe: base,
      }
    case 'swapped':
      return {
        className: '',
        style: {
          borderColor: 'var(--dsa-primary)',
          background: 'color-mix(in oklab, var(--dsa-primary) 22%, var(--dsa-surface-2))',
        },
        badge: '⇄',
        describe: base,
      }
    case 'visited':
      return {
        className: 'opacity-85',
        style: { borderColor: 'color-mix(in oklab, var(--dsa-accent) 40%, var(--dsa-border))' },
        badge: '·',
        describe: base,
      }
    case 'revealed':
      return {
        className: 'border-dashed',
        style: {},
        badge: '?',
        describe: base,
      }
    case 'locked':
      return {
        className: 'opacity-60 saturate-50',
        style: { borderStyle: 'dashed' },
        badge: '—',
        describe: base,
      }
    case 'idle':
    default:
      return { className: '', style: {}, badge: null, describe: base }
  }
}

function describeForA11y(lookStyle: StateLook, object: GameObject, serverSelected: boolean, marker: TargetMarker | null): string {
  const base = lookStyle.describe(object.label || object.id)
  const parts = [base]
  if (serverSelected) parts.push('held by the program')
  if (marker) {
    parts.push(
      marker.target.role === 'candidate'
        ? `one of the legal choices: ${marker.target.hint}`
        : `${marker.target.hint}`,
    )
  }
  return parts.join(', ')
}

export interface ObjectTokenProps {
  object: GameObject
  spec: GameSpec
  /** Overrides `object.state` (the replay and cursor roles need this). */
  overrideState?: ObjectState
  picked?: boolean
  pickIndex?: number | null
  /** True when the ENGINE has this object in `state.selection`. */
  serverSelected?: boolean
  /** Currently held by a pointer drag. */
  dragging?: boolean
  /** The `turnPrompt` target this tile is, if any. Drives the pulsing outline. */
  marker?: TargetMarker | null
  disabled?: boolean
  onActivate?: (id: string) => void
  /** `layout` animates position changes (swap / move) with Framer. */
  layout?: boolean
  className?: string
}

export function ObjectToken({
  object,
  spec,
  overrideState,
  picked = false,
  pickIndex = null,
  serverSelected = false,
  dragging = false,
  marker = null,
  disabled = false,
  onActivate,
  layout = true,
  className,
}: ObjectTokenProps) {
  const state = overrideState ?? object.state
  const lookStyle = look(state, picked, pickIndex)
  // `eliminated` and `locked` are read-only states: clicking them is a no-op
  // rather than a legal move the oracle would reject.
  const inert = state === 'eliminated' || state === 'locked'
  const glyph = glyphFor(spec, object.id, object.kind, object.label)
  // `turnPrompt.targets` lists everything legal, with the engine's actual choice
  // tagged `current`. Puling all of them identically would be worse than useless,
  // so the role decides the loudness. See `targetStrength`.
  const strength: TargetStrength = marker ? targetStrength(marker.target.role) : 'muted'
  const isPrimary = strength === 'primary'
  const isSecondary = strength === 'secondary'
  const showValue = typeof object.value === 'number' && object.value !== Number(object.label)

  const label = object.label || object.id

  const content = (
    <>
      {/* A primary target reads as a DIFFERENT KIND OF THING, not just a
          differently-coloured value: it grows a caption bar, goes uppercase,
          and breathes. A candidate gets a quiet dashed edge. Both are shape and
          weight signals, so they survive greyscale and any generated palette. */}
      {isPrimary && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-1.5 rounded-t-[13px] bg-[var(--dsa-accent)]" />
      )}

      {lookStyle.badge && (
        <span
          aria-hidden
          className={cn(
            'absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[0.62rem] leading-none font-bold',
            picked
              ? 'bg-[var(--dsa-accent)] text-[var(--dsa-bg)]'
              : 'bg-[color-mix(in_oklab,var(--dsa-bg)_78%,transparent)] text-[var(--dsa-muted)]',
          )}
        >
          {lookStyle.badge}
        </span>
      )}

      <span className="flex min-w-0 items-center gap-1.5">
        <ObjectGlyph visual={object.visual} glyph={glyph} size={20} />
        <span
          className={cn(
            'mono truncate text-[0.95rem] leading-tight font-semibold',
            state === 'eliminated' && 'line-through',
            isPrimary && 'uppercase tracking-wide',
          )}
        >
          {label}
        </span>
      </span>

      {showValue && <span className="mono text-[0.65rem] text-[var(--dsa-faint)]">{object.value}</span>}

      {isSecondary && (
        <span
          aria-hidden
          className="absolute inset-x-3 bottom-1 h-px rounded-full bg-[color-mix(in_oklab,var(--dsa-accent)_55%,transparent)]"
        />
      )}

      {/* The engine's own `state.selection` versus the client's staged pick.
          Two different shapes — a low bar for the program, a high numbered
          corner badge for the learner — because conflating them is exactly how
          a learner ends up unsure whether their tap registered. */}
      {serverSelected && !picked && <span aria-hidden className="stage-tab bg-[var(--dsa-primary)]" />}
    </>
  )

  const baseClass = cn(
    'relative flex min-h-12 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[14px] border px-2.5 py-2 text-center',
    lookStyle.className,
    isPrimary &&
      'target-breathe border-2 border-[color:color-mix(in_oklab,var(--dsa-accent)_70%,var(--dsa-border))]',
    isSecondary && 'border-dashed border-[color:color-mix(in_oklab,var(--dsa-accent)_45%,var(--dsa-border))]',
    className,
  )

  // The board's pointer-drag handler finds its source element through this
  // attribute, which keeps drag logic out of every token.
  const dataObjectId = { 'data-object-id': object.id } as const
  const dragStyle: CSSProperties = dragging
    ? { ...lookStyle.style, boxShadow: '0 0 0 3px var(--dsa-accent)', transform: 'scale(1.1)' }
    : lookStyle.style

  if (!onActivate || inert) {
    return (
      <motion.div
        {...(layout ? { layout: true, transition: { type: 'spring', stiffness: 380, damping: 32 } } : {})}
        className={baseClass}
        style={dragStyle}
        role="img"
        aria-label={describeForA11y(lookStyle, object, serverSelected, marker)}
        {...dataObjectId}
      >
        {content}
      </motion.div>
    )
  }

  return (
    <motion.button
      type="button"
      {...(layout ? { layout: true, transition: { type: 'spring', stiffness: 380, damping: 32 } } : {})}
      className={cn(baseClass, 'hover:brightness-125', disabled && 'opacity-50')}
      style={dragStyle}
      onClick={() => onActivate(object.id)}
      disabled={disabled}
      aria-pressed={picked}
      aria-label={describeForA11y(lookStyle, object, serverSelected, marker)}
      {...dataObjectId}
    >
      {content}
    </motion.button>
  )
}
