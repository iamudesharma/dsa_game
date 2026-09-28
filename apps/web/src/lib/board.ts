import type {
  Container,
  Cursor,
  GameObject,
  GameSpec,
  GameState,
  Link,
  ObjectState,
  Slot,
  SlotKind,
} from '@dsa/game-schema'

/**
 * Turns the flat `GameState` records the API returns into the ordered,
 * renderable board the mechanic components draw.
 *
 * WHY: the wire format is deliberately unopinionated about presentation —
 * `objects` is a map, slots are indexed but may be empty, a list problem puts
 * its nodes in `objects` with no slot at all, and branch choices have no
 * dedicated field. Every renderer would otherwise re-derive the same layout, and
 * they would drift. This module is the one place that knows how.
 *
 * The derivation is intentionally tolerant: oracles differ per problem, so
 * whenever a dedicated field is missing we fall back to `slotId`, then to the
 * instance payload, then to stable insertion order. A slightly odd board beats
 * a blank screen.
 */

export interface BoardCell {
  /** Slot id when this cell is a slot; otherwise a synthetic `loose:<id>`. */
  id: string
  slotId?: string
  index: number
  kind: SlotKind
  label: string
  state?: ObjectState
  object?: GameObject
}

export type BoardLaneKind = 'slots' | 'loose' | 'nodes'

export interface BoardLane {
  id: string
  kind: BoardLaneKind
  label: string
  cells: BoardCell[]
}

export interface PathOption {
  id: string
  label: string
  objectId?: string
  slotId?: string
}

export interface BoardModel {
  lanes: BoardLane[]
  containers: Container[]
  links: Link[]
  /** Objects not in any slot and not in any container. */
  loose: GameObject[]
  /** Branch affordances for `choosePath`. */
  pathOptions: PathOption[]
  /** Linked-list rendering order (empty for non-list problems). */
  nodeOrder: string[]
  headNodeId?: string
  byId: Record<string, GameObject>
  /** slotId -> objectId, merged from `slot.occupantId` and `object.slotId`. */
  occupancy: Record<string, string>
  /** id -> cursor role names (`lo`, `mid`, `hi`, `i`, `j`, `best`, …). */
  cursorRoles: Record<string, string[]>
  /** Best default "from" id for choosePath / traverseNode / connectNodes. */
  defaultFromId?: string
}

const NODE_KINDS = new Set(['node'])

function cursorRoleMap(cursor: Cursor): Record<string, string[]> {
  const entries: [string, string | undefined][] = [
    ['lo', cursor.loSlotId],
    ['mid', cursor.midSlotId],
    ['hi', cursor.hiSlotId],
    ['i', cursor.iSlotId],
    ['j', cursor.jSlotId],
    ['best', cursor.bestObjectId],
    ['current', cursor.nodeId],
    ['prev', cursor.prevNodeId],
  ]
  const map: Record<string, string[]> = {}
  for (const [role, id] of entries) {
    if (!id) continue
    const list = map[id]
    if (list) list.push(role)
    else map[id] = [role]
  }
  return map
}

function labelForObject(object: Pick<GameObject, 'id' | 'label'>): string {
  return object.label || object.id
}

export function buildBoard(state: GameState, spec: GameSpec): BoardModel {
  const byId: Record<string, GameObject> = { ...state.objects }
  const slotList: Slot[] = Object.values(state.slots).sort((a, b) => a.index - b.index)

  // --- occupancy: explicit `slot.occupantId` wins, else `object.slotId`.
  const occupancy: Record<string, string> = {}
  for (const slot of slotList) {
    if (slot.occupantId && byId[slot.occupantId]) occupancy[slot.id] = slot.occupantId
  }
  for (const object of Object.values(byId)) {
    if (object.slotId && !occupancy[object.slotId] && state.slots[object.slotId]) {
      occupancy[object.slotId] = object.id
    }
  }

  const placedIds = new Set(Object.values(occupancy))
  const containerIds = new Set<string>()
  const containers = Object.values(state.containers)
  for (const container of containers) {
    for (const id of container.order) {
      containerIds.add(id)
      placedIds.add(id)
    }
  }

  // --- linked list order, when the problem actually has one.
  const instanceListIds = (state.instance.list ?? []).map((node) => node.id)
  const nextByNode = new Map<string, string>()
  const inNext = new Set<string>()
  for (const link of state.links) {
    if (link.kind !== 'next') continue
    nextByNode.set(link.from, link.to)
    inNext.add(link.to)
  }
  const hasListShape = state.links.length > 0 || instanceListIds.length > 0
  const objectNodeIds = Object.values(byId)
    .filter((o) => NODE_KINDS.has(o.kind))
    .map((o) => o.id)

  const nodeOrder: string[] = []
  if (hasListShape) {
    const knownNodes = instanceListIds.length > 0 ? instanceListIds : objectNodeIds
    const head =
      knownNodes.find((id) => !inNext.has(id)) ?? knownNodes[0] ?? objectNodeIds[0]
    if (head) {
      // Walk `next` links; stop on a cycle or a dangling tail.
      const seen = new Set<string>()
      let cursor: string | undefined = head
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor)
        nodeOrder.push(cursor)
        cursor = nextByNode.get(cursor)
      }
    }
    // Anything the walk missed (rewired lists, or objects the walk cannot see).
    for (const id of knownNodes) if (!nodeOrder.includes(id)) nodeOrder.push(id)
    for (const id of objectNodeIds) if (!nodeOrder.includes(id)) nodeOrder.push(id)
  }

  const lanes: BoardLane[] = []

  const slotCells: BoardCell[] = slotList.map((slot) => {
    const objectId = occupancy[slot.id]
    return {
      id: slot.id,
      slotId: slot.id,
      index: slot.index,
      kind: slot.kind,
      label: slot.label ?? `#${slot.index}`,
      state: slot.state,
      object: objectId ? byId[objectId] : undefined,
    }
  })

  if (slotCells.length > 0) {
    lanes.push({
      id: 'slots',
      kind: 'slots',
      label: spec.visual.boardLabel ?? 'the board',
      cells: slotCells,
    })
  }

  if (nodeOrder.length > 0) {
    const cells: BoardCell[] = nodeOrder.map((id, index) => ({
      id: `node:${id}`,
      index,
      kind: 'default',
      label: labelForObject(byId[id] ?? { id, label: id }),
      object: byId[id],
    }))
    lanes.push({ id: 'nodes', kind: 'nodes', label: 'linked nodes', cells })
  }

  // Loose objects: no slot, no container, and not part of the list walk.
  const loose: GameObject[] = Object.values(byId).filter(
    (o) => !placedIds.has(o.id) && !nodeOrder.includes(o.id) && !containerIds.has(o.id),
  )
  if (loose.length > 0) {
    const cells: BoardCell[] = loose.map((object, index) => ({
      id: `loose:${object.id}`,
      index,
      kind: 'default',
      label: labelForObject(object),
      object,
    }))
    lanes.push({ id: 'loose', kind: 'loose', label: 'to hand', cells })
  }

  // --- branch affordances for choosePath.
  const pathOptions: PathOption[] = []
  for (const object of loose) {
    if (object.kind === 'path' || object.kind === 'door' || object.kind === 'room') {
      pathOptions.push({ id: object.id, label: labelForObject(object), objectId: object.id })
    }
  }
  for (const cell of slotCells) {
    if (!cell.object && (cell.kind === 'left' || cell.kind === 'right' || cell.kind === 'source')) {
      pathOptions.push({ id: cell.slotId ?? cell.id, label: cell.label, slotId: cell.slotId })
    }
  }
  // Node-style lists can also be a "pick the next node" choice; the dedicated
  // traverseNode renderer covers those, so they are not duplicated as paths.

  const defaultFromId =
    state.cursor.nodeId ??
    state.cursor.midSlotId ??
    state.cursor.iSlotId ??
    nodeOrder[0] ??
    slotList[0]?.id

  return {
    lanes,
    containers: [...containers].sort((a, b) => a.id.localeCompare(b.id)),
    links: state.links,
    loose,
    pathOptions,
    nodeOrder,
    headNodeId: nodeOrder[0],
    byId,
    occupancy,
    cursorRoles: cursorRoleMap(state.cursor),
    defaultFromId,
  }
}

/** Human label for any id the board knows about (object id or slot id). */
export function describeId(model: BoardModel, id: string | undefined): string {
  if (!id) return '—'
  const object = model.byId[id]
  if (object) return labelForObject(object)
  const slot = Object.values(model.containers).find((c) => c.id === id)
  if (slot) return slot.label ?? id
  const occupant = model.occupancy[id]
  if (occupant && model.byId[occupant]) return labelForObject(model.byId[occupant]!)
  const cell = model.lanes.flatMap((l) => l.cells).find((c) => c.slotId === id)
  if (cell) return cell.object ? labelForObject(cell.object) : cell.label
  return id
}

/** Every object id in a stable, human order — used for a11y lists and selects. */
export function allObjectIds(model: BoardModel): string[] {
  const seen = new Set<string>()
  for (const lane of model.lanes) {
    for (const cell of lane.cells) if (cell.object) seen.add(cell.object.id)
  }
  for (const container of model.containers) for (const id of container.order) seen.add(id)
  for (const object of model.loose) seen.add(object.id)
  return [...seen]
}
