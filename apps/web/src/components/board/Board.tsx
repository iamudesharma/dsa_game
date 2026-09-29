'use client'

import { LayoutGroup } from 'framer-motion'
import { useId, useCallback, useMemo, useRef, useState } from 'react'
import type { BoardModel } from '@/lib/board'
import type { GameSpec, GameState, TurnPrompt } from '@dsa/game-schema'
import type { TargetMarkers } from '@/lib/guidance'
import { buildTargetMarkers, deriveRangeWindow } from '@/lib/guidance'
import { BoardLaneView } from './BoardLaneView'
import { ContainerPanel } from './ContainerPanel'
import { LinkRow } from './LinkRow'

export interface BoardProps {
  state: GameState
  spec: GameSpec
  model: BoardModel
  /** The current turn's instruction; drives which tiles light up. */
  prompt: TurnPrompt | null
  picked: readonly string[]
  disabled: boolean
  /** Empty slots accept a tap-to-move in the active mechanic. */
  slotsInteractive: boolean
  /** Enables mouse/pen drag-to-slot for `moveObject`. */
  allowDrag: boolean
  onObjectActivate: (id: string) => void
  onSlotActivate: (slotId: string) => void
  onObjectDrop: (objectId: string, slotId: string) => void
}

/** Exposed so the caller can render the dragged ghost consistently. */
export type BoardDragState = DragState | null

const DRAG_THRESHOLD_PX = 5

interface DragState {
  objectId: string
  startX: number
  startY: number
  active: boolean
  hoverSlotId: string | null
}

/**
 * The board surface: lanes, containers, and the pointer-drag layer.
 *
 * WHY drag is pointer-event based and mouse/pen only: HTML5 drag-and-drop does
 * not fire on touch at all, and setting `touch-action: none` on tokens makes the
 * whole board unscrollable on a phone — which would break a game that is meant
 * to be playable on mobile web. So touch users get the equivalent
 * tap-the-object-then-tap-the-slot flow (which is also the keyboard path, so it
 * had to exist anyway), and mouse users get the nicer drag.
 */
export function Board({
  state,
  spec,
  model,
  prompt,
  picked,
  disabled,
  slotsInteractive,
  allowDrag,
  onObjectActivate,
  onSlotActivate,
  onObjectDrop,
}: BoardProps) {
  const boardId = useId()
  const [drag, setDrag] = useState<DragState | null>(null)
  // Refs mirror the drag state so the pointer handlers (which re-bind every
  // render anyway) always read the latest value without stale closures.
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  // The board is the only thing that knows about the `lo…hi` range, so it
  // derives the brackets itself. Both derivations are memoised on the two
  // things that can change them: the prompt, and the cursor.
  const markers: TargetMarkers = useMemo(() => buildTargetMarkers(prompt, state), [prompt, state])
  const rangeWindow = useMemo(() => deriveRangeWindow(state), [state])

  const slotUnderPointer = useCallback((x: number, y: number): string | null => {
    if (typeof document === 'undefined') return null
    const el = document.elementFromPoint(x, y)
    const slot = el?.closest('[data-slot-id]')
    const id = slot?.getAttribute('data-slot-id')
    return id ?? null
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!allowDrag || disabled) return
    if (event.pointerType === 'touch') return
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    const holder = target?.closest('[data-object-id]')
    const objectId = holder?.getAttribute('data-object-id')
    if (!objectId) return
    // Capture on the board root so the drag survives the pointer leaving a token.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({ objectId, startX: event.clientX, startY: event.clientY, active: false, hoverSlotId: null })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    if (!current) return
    const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
    if (!current.active && moved < DRAG_THRESHOLD_PX) return
    const hoverSlotId = slotUnderPointer(event.clientX, event.clientY)
    if (current.active && current.hoverSlotId === hoverSlotId) return
    setDrag({ ...current, active: true, hoverSlotId })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (!current) return
    const hoverSlotId = slotUnderPointer(event.clientX, event.clientY)
    if (current.active && hoverSlotId && hoverSlotId !== current.objectId) {
      onObjectDrop(current.objectId, hoverSlotId)
    }
    setDrag(null)
  }

  return (
    <LayoutGroup id={boardId}><div
      className="space-y-5"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {model.lanes.map((lane) =>
        lane.kind === 'nodes' ? (
          <LinkRow
            key={lane.id}
            model={model}
            state={state}
            spec={spec}
            picked={picked}
            markers={markers}
            disabled={disabled}
            onObjectActivate={onObjectActivate}
          />
        ) : (
          <BoardLaneView
            key={lane.id}
            lane={lane}
            model={model}
            spec={spec}
            state={state}
            picked={picked}
            dropTargetId={drag?.active ? drag.hoverSlotId : null}
            slotsInteractive={slotsInteractive}
            disabled={disabled}
            draggingObjectId={drag?.active ? drag.objectId : null}
            markers={markers}
            window={rangeWindow}
            onObjectActivate={onObjectActivate}
            onSlotActivate={onSlotActivate}
          />
        ),
      )}

      {model.containers.length > 0 && (
        <div className="space-y-3 border-t border-[var(--dsa-border)] pt-3">
          {model.containers.map((container) => (
            <ContainerPanel
              key={container.id}
              container={container}
              model={model}
              spec={spec}
              state={state}
              picked={picked}
              markers={markers}
              disabled={disabled}
              onObjectActivate={onObjectActivate}
            />
          ))}
        </div>
      )}

      {model.lanes.length === 0 && (
        <p className="panel-quiet px-3 py-4 text-sm text-[var(--dsa-muted)]">
          This board is empty right now.
        </p>
      )}
    </div></LayoutGroup>
  )
}
