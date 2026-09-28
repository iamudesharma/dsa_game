'use client'

import { motion } from 'framer-motion'
import type { BoardCell, BoardModel } from '@/lib/board'
import type { GameSpec, GameState } from '@dsa/game-schema'
import type { CellWindowRole, TargetMarker, TargetStrength } from '@/lib/guidance'
import { targetStrength } from '@/lib/guidance'
import { cn } from '@/lib/format'
import { ObjectToken } from './ObjectToken'

export interface SlotCellProps {
  cell: BoardCell
  model: BoardModel
  spec: GameSpec
  state: GameState
  picked: readonly string[]
  /** Highlighted while a pointer drag hovers this slot. */
  dropActive: boolean
  /** Slots that accept a drop / tap target in the current mechanic. */
  interactive: boolean
  disabled: boolean
  draggingObjectId?: string | null
  marker?: TargetMarker | null
  /** Where this cell sits relative to the algorithm's lo…hi range. */
  windowRole?: CellWindowRole
  onObjectActivate: (id: string) => void
  onSlotActivate: (slotId: string) => void
}

/**
 * A slot in the board — the cell that carries the `lo` / `mid` / `hi` brackets.
 *
 * WHY BRACKETS AND NOT LABELS: `lo`, `mid` and `hi` are not three things that
 * happen to sit on a row, they are two ends and a middle of one range. A learner
 * who has to read three numbers and imagine a span between them is doing
 * arithmetic in their head, which is exactly the extraneous load the redesign
 * exists to remove. So the range is DRAWN: a top and bottom rail on every cell
 * inside the window, bridged across the gap (see `.range-cell` in globals.css),
 * plus a vertical cap on the first and last cell. The window becomes a single
 * object you can see, and "the search space got smaller" is a visual event
 * rather than a subtraction.
 *
 * The `mid` cell additionally scales and rings, so within the window there is
 * still an obvious "start here".
 */
const KIND_ACCENT: Partial<Record<BoardCell['kind'], string>> = {
  target: 'border-[color:color-mix(in_oklab,var(--dsa-accent)_45%,var(--dsa-border))]',
  left: 'border-[color:color-mix(in_oklab,var(--dsa-primary)_45%,var(--dsa-border))]',
  right: 'border-[color:color-mix(in_oklab,var(--dsa-primary)_45%,var(--dsa-border))]',
  mid: 'border-[color:color-mix(in_oklab,var(--dsa-accent)_50%,var(--dsa-border))]',
  source: 'border-[color:color-mix(in_oklab,var(--dsa-success)_45%,var(--dsa-border))]',
  sink: 'border-[color:color-mix(in_oklab,var(--dsa-danger)_45%,var(--dsa-border))]',
}

/** Pointer role → the word a learner should read. `lo`/`mid`/`hi` stay literal. */
const ROLE_WORD: Readonly<Record<string, string>> = {
  lo: 'lo',
  mid: 'mid',
  hi: 'hi',
  i: 'i',
  j: 'j',
  best: 'best',
  current: 'here',
  prev: 'prev',
}

export function SlotCell({
  cell,
  model,
  spec,
  state,
  picked,
  dropActive,
  interactive,
  disabled,
  draggingObjectId,
  marker = null,
  windowRole = 'none',
  onObjectActivate,
  onSlotActivate,
}: SlotCellProps) {
  const roles = model.cursorRoles[cell.id] ?? []
  const occupant = cell.object
  const pickIndex = occupant ? picked.indexOf(occupant.id) : -1
  const serverSelected = Boolean(occupant && state.selection.includes(occupant.id))
  // See `targetStrength`: the engine lists every legal choice and tags the one
  // it wants, so the cell highlights at the strength its role earns.
  const strength: TargetStrength = marker ? targetStrength(marker.target.role) : 'muted'
  const isPrimary = strength === 'primary'
  const inWindow = windowRole !== 'none' && windowRole !== 'outside'
  const isLo = roles.includes('lo')
  const isHi = roles.includes('hi')
  const isMid = roles.includes('mid')

  return (
    <div
      data-slot-id={cell.slotId ?? cell.id}
      className={cn(
        'relative flex min-w-14 shrink-0 flex-col items-center gap-1 rounded-[14px] border border-dashed border-[var(--dsa-border)] p-1 transition-colors',
        KIND_ACCENT[cell.kind],
        inWindow && 'range-cell',
        inWindow && windowRole === 'window-start' && 'range-start',
        inWindow && windowRole === 'window-end' && 'range-end',
        // The caps. A thick solid edge on the two end cells closes the bracket.
        inWindow &&
          windowRole === 'window-start' &&
          'border-l-4 border-l-[color:color-mix(in_oklab,var(--dsa-primary)_90%,white_10%)]',
        inWindow &&
          windowRole === 'window-end' &&
          'border-r-4 border-r-[color:color-mix(in_oklab,var(--dsa-primary)_90%,white_10%)]',
        isMid && 'border-solid',
        isPrimary && 'target-breathe border-2 border-[color:color-mix(in_oklab,var(--dsa-accent)_70%,var(--dsa-border))]',
        !isPrimary &&
          strength === 'secondary' &&
          'border-dashed border-[color:color-mix(in_oklab,var(--dsa-accent)_45%,var(--dsa-border))]',
        dropActive && 'border-solid bg-[color-mix(in_oklab,var(--dsa-accent)_20%,transparent)]',
      )}
    >
      {/* The end labels, pinned to the outside of the caps so they read as the
          brackets' names rather than as cell contents. */}
      {isLo && (
        <span
          aria-hidden
          className="mono absolute -top-2.5 left-0 rounded bg-[color-mix(in_oklab,var(--dsa-primary)_88%,black)] px-1.5 py-px text-[0.6rem] leading-tight font-bold text-white"
        >
          lo
        </span>
      )}
      {isHi && (
        <span
          aria-hidden
          className="mono absolute -top-2.5 right-0 rounded bg-[color-mix(in_oklab,var(--dsa-primary)_88%,black)] px-1.5 py-px text-[0.6rem] leading-tight font-bold text-white"
        >
          hi
        </span>
      )}

      {occupant ? (
        <SlotMarkerCell
          cell={cell}
          model={model}
          spec={spec}
          picked={picked}
          pickIndex={pickIndex}
          serverSelected={serverSelected}
          draggingObjectId={draggingObjectId}
          disabled={disabled}
          marker={marker}
          isMid={isMid}
          onObjectActivate={onObjectActivate}
        />
      ) : (
        <EmptySlot
          cell={cell}
          dropActive={dropActive}
          interactive={interactive}
          disabled={disabled}
          onSlotActivate={onSlotActivate}
        />
      )}

      {/* Only the leftover pointer roles are spelled out. `lo`/`hi` are already
          shown as brackets, and repeating them here was the "debug console"
          tell: the same fact printed twice, once as a glyph and once as a word. */}
      {roles.length > 0 && (
        <span
          className={cn(
            'mono text-[0.58rem] leading-none tracking-wide text-[var(--dsa-faint)] uppercase',
            isMid && 'font-bold text-[var(--dsa-accent)]',
          )}
        >
          {roles.map((role) => ROLE_WORD[role] ?? role).join('·')}
        </span>
      )}
    </div>
  )
}

function SlotMarkerCell({
  cell,
  model,
  spec,
  picked,
  pickIndex,
  serverSelected,
  draggingObjectId,
  disabled,
  marker,
  isMid,
  onObjectActivate,
}: {
  cell: BoardCell
  model: BoardModel
  spec: GameSpec
  picked: readonly string[]
  pickIndex: number
  serverSelected: boolean
  draggingObjectId?: string | null
  disabled: boolean
  marker: TargetMarker | null
  isMid: boolean
  onObjectActivate: (id: string) => void
}) {
  const occupant = cell.object
  if (!occupant) return null
  return (
    <motion.div
      className={cn('w-full', isMid && 'scale-[1.04]')}
      initial={false}
      animate={{ scale: isMid ? 1.04 : 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      <ObjectToken
        object={occupant}
        spec={spec}
        picked={pickIndex >= 0}
        pickIndex={pickIndex >= 0 ? pickIndex + 1 : null}
        serverSelected={serverSelected}
        dragging={draggingObjectId === occupant.id}
        marker={marker}
        disabled={disabled}
        onActivate={onObjectActivate}
        className="w-full border-0 bg-transparent"
      />
    </motion.div>
  )
}

/**
 * An empty slot is a DROP ZONE, and the brief for `MoveObject` is explicit
 * about it: big, always visible when a move is in flight, and labelled. The
 * previous version showed the word "drop" in 12px grey, which on a 390px phone
 * is a smudge you have to already know the meaning of.
 */
function EmptySlot({
  cell,
  dropActive,
  interactive,
  disabled,
  onSlotActivate,
}: {
  cell: BoardCell
  dropActive: boolean
  interactive: boolean
  disabled: boolean
  onSlotActivate: (slotId: string) => void
}) {
  return (
    <motion.button
      type="button"
      onClick={() => onSlotActivate(cell.slotId ?? cell.id)}
      disabled={disabled || !interactive}
      whileTap={interactive ? { scale: 0.96 } : undefined}
      className={cn(
        'flex h-12 w-full min-w-12 items-center justify-center rounded-[10px] border text-[0.7rem] leading-tight font-semibold',
        interactive
          ? 'border-2 border-dashed border-[color:color-mix(in_oklab,var(--dsa-accent)_65%,var(--dsa-border))] bg-[color-mix(in_oklab,var(--dsa-accent)_12%,transparent)] text-[var(--dsa-accent)]'
          : 'border-[var(--dsa-border)] bg-[color-mix(in_oklab,var(--dsa-surface-2)_50%,transparent)] text-[var(--dsa-faint)]',
        dropActive && 'scale-105 border-solid bg-[color-mix(in_oklab,var(--dsa-accent)_28%,transparent)]',
      )}
      aria-label={
        interactive
          ? `Empty ${cell.label}. Tap to move the thing you picked here.`
          : `Empty ${cell.label}`
      }
    >
      {interactive ? 'put it here' : '·'}
    </motion.button>
  )
}
