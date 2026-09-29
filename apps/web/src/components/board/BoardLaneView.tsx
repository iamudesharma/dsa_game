'use client'

import type { BoardLane, BoardModel } from '@/lib/board'
import type { GameSpec, GameState } from '@dsa/game-schema'
import type { RangeWindow, TargetMarkers } from '@/lib/guidance'
import { findMarker, windowRoleFor } from '@/lib/guidance'
import { cn } from '@/lib/format'
import { ObjectToken } from './ObjectToken'
import { SlotCell } from './SlotCell'

export interface BoardLaneViewProps {
  lane: BoardLane
  model: BoardModel
  spec: GameSpec
  state: GameState
  picked: readonly string[]
  dropTargetId: string | null
  slotsInteractive: boolean
  disabled: boolean
  draggingObjectId?: string | null
  /** Which tiles `turnPrompt.targets` named. */
  markers: TargetMarkers
  /** The algorithm's live lo…hi range, drawn as brackets. */
  window: RangeWindow
  onObjectActivate: (id: string) => void
  onSlotActivate: (slotId: string) => void
}

/**
 * One horizontal run of cells — or a fixed-column grid when the lane says so.
 *
 * `board-scroll` + `min-w-max` is what keeps this playable on a 390px phone:
 * the board scrolls sideways instead of crushing 16 cells into unreadable
 * slivers. The tile gap is `var(--tile-gap)` rather than a Tailwind token
 * because the range-window rails in globals.css bridge exactly that much, and
 * the two must agree or the bracket breaks apart.
 *
 * A grid lane (`lane.columns`) keeps the same cells in the same order and only
 * changes the wrapping: row-major ids mean row r starts at cell r × columns,
 * so neighbours left/right stay adjacent and up/down sit exactly one row
 * apart. SlotCell itself is untouched — selection, markers and window roles
 * all key off ids, never off layout.
 */
export function BoardLaneView({
  lane,
  model,
  spec,
  state,
  picked,
  dropTargetId,
  slotsInteractive,
  disabled,
  draggingObjectId,
  markers,
  window: rangeWindow,
  onObjectActivate,
  onSlotActivate,
}: BoardLaneViewProps) {
  return (
    <div className="min-w-0">
      {lane.label ? (
        <p className="mb-1.5 text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--dsa-faint)] uppercase">
          {lane.label}
        </p>
      ) : null}
      <div className="board-scroll -mx-1 px-1 pb-2">
        <div
          className={cn(
            'min-w-max items-stretch gap-[var(--tile-gap)] pt-1',
            lane.columns !== undefined ? 'grid w-max' : 'flex',
            lane.kind === 'loose' && lane.columns === undefined && 'flex-wrap',
          )}
          style={lane.columns !== undefined ? { gridTemplateColumns: `repeat(${lane.columns}, minmax(0, 1fr))` } : undefined}
        >
          {lane.cells.map((cell) => {
            if (cell.slotId) {
              return (
                <SlotCell
                  key={cell.id}
                  cell={cell}
                  model={model}
                  spec={spec}
                  state={state}
                  picked={picked}
                  dropActive={dropTargetId === cell.slotId}
                  interactive={slotsInteractive}
                  disabled={disabled}
                  draggingObjectId={draggingObjectId}
                  marker={findMarker(markers, cell.slotId, cell.object?.id)}
                  windowRole={windowRoleFor(cell.index, rangeWindow)}
                  onObjectActivate={onObjectActivate}
                  onSlotActivate={onSlotActivate}
                />
              )
            }
            const object = cell.object
            if (!object) return null
            const index = picked.indexOf(object.id)
            return (
              <ObjectToken
                key={cell.id}
                object={object}
                spec={spec}
                picked={index >= 0}
                pickIndex={index >= 0 ? index + 1 : null}
                serverSelected={state.selection.includes(object.id)}
                dragging={draggingObjectId === object.id}
                marker={findMarker(markers, object.id)}
                disabled={disabled}
                onActivate={onObjectActivate}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
