import type { GameState, TraceFrame } from '@dsa/game-schema'

/**
 * The debrief replay.
 *
 * The contract ships `TraceFrame.pointers` (current / compare / eliminated /
 * swapped / read) plus `variables`, but no snapshots of the data structure. So
 * the replay draws a *pointer visualiser*: the full board is derived once from
 * the final `GameState` (the stored one) and each frame lights up exactly the
 * ids the algorithm was pointing at. That is the standard "algorithm
 * visualisation" people already know how to read, and it needs no per-frame
 * data snapshots that the API does not send.
 */

export type ReplayRole = 'current' | 'compare' | 'eliminated' | 'swapped' | 'read'

export interface ReplayCell {
  id: string
  label: string
  index: number
  /** Lines hit at this cell, for a subtle "you were here" marker. */
  objectId?: string
  slotIndex?: number
}

export interface ReplayModel {
  cells: ReplayCell[]
  /** Map any pointer id the trace emits onto a cell id. */
  resolve: (id: string) => string | undefined
}

function labelFor(state: GameState, id: string, cellId: string): string {
  const object = state.objects[id]
  if (object) return object.label || object.id
  const slot = state.slots[cellId]
  if (slot) return slot.label ?? `#${slot.index}`
  return cellId
}

export function buildReplayModel(frames: readonly TraceFrame[], state: GameState): ReplayModel {
  const cellIds: string[] = []
  const cellIdFor = new Map<string, string>()

  const addCell = (id: string): void => {
    if (cellIdFor.has(id)) return
    cellIdFor.set(id, id)
    cellIds.push(id)
  }

  for (const slot of Object.values(state.slots).sort((a, b) => a.index - b.index)) {
    addCell(slot.id)
  }
  // Any id the trace points at that is not a slot gets its own cell, appended in
  // first-seen order so the layout is still stable across frames.
  const seenInTrace: string[] = []
  const traceIds = (frame: TraceFrame): string[] => [
    ...(frame.pointers.current ? [frame.pointers.current] : []),
    ...(frame.pointers.compare ?? []),
    ...(frame.pointers.read ?? []),
    ...(frame.pointers.swapped ?? []),
    ...(frame.pointers.eliminated ?? []),
  ]
  for (const frame of frames) {
    for (const id of traceIds(frame)) {
      if (cellIdFor.has(id)) continue
      const object = state.objects[id]
      const home = object?.slotId
      if (home && cellIdFor.has(home)) cellIdFor.set(id, home)
      else {
        cellIdFor.set(id, id)
        seenInTrace.push(id)
      }
    }
  }
  for (const id of seenInTrace) if (!cellIds.includes(id)) addCell(id)

  const cells: ReplayCell[] = cellIds.map((id, index) => ({
    id,
    index,
    label: labelFor(state, id, id),
    slotIndex: state.slots[id]?.index,
    objectId: state.objects[id]?.id,
  }))

  return {
    cells,
    resolve: (id: string) => cellIdFor.get(id),
  }
}

export function rolesForFrame(frame: TraceFrame, model: ReplayModel): Record<string, ReplayRole[]> {
  const out: Record<string, ReplayRole[]> = {}
  const put = (id: string, role: ReplayRole): void => {
    const cell = model.resolve(id)
    if (!cell) return
    const list = out[cell]
    if (list) {
      if (!list.includes(role)) list.push(role)
    } else out[cell] = [role]
  }
  if (frame.pointers.current) put(frame.pointers.current, 'current')
  for (const id of frame.pointers.compare ?? []) put(id, 'compare')
  for (const id of frame.pointers.eliminated ?? []) put(id, 'eliminated')
  for (const id of frame.pointers.swapped ?? []) put(id, 'swapped')
  for (const id of frame.pointers.read ?? []) put(id, 'read')
  return out
}
