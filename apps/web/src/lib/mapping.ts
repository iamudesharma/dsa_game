import type { MappingRow } from '@dsa/game-schema'

/**
 * `DebriefResponse.mapping` is typed as `MappingRow[]` (objects with
 * `gameTerm` / `algorithmTerm`), but `GameSpec.debrief.mapping` — the block the
 * provider actually authors — is an array of `[gameTerm, algorithmTerm]` tuples,
 * and the engine is free to forward the spec's array straight through.
 *
 * Rather than pick a side and crash on the other, this normalises both shapes.
 * (`Row` is the tuple form; the two are structurally distinguishable.)
 */
export type MappingEntry = [gameTerm: string, algorithmTerm: string]
type MappingInput = MappingRow | readonly [string, string]

function isTupleRow(value: MappingInput): value is readonly [string, string] {
  return Array.isArray(value)
}

export function normalizeMapping(rows: readonly MappingInput[] | undefined): MappingEntry[] {
  if (!rows) return []
  const out: MappingEntry[] = []
  for (const row of rows) {
    if (isTupleRow(row)) {
      const [gameTerm, algorithmTerm] = row
      if (typeof gameTerm === 'string' && typeof algorithmTerm === 'string') out.push([gameTerm, algorithmTerm])
    } else if (row && typeof row.gameTerm === 'string' && typeof row.algorithmTerm === 'string') {
      out.push([row.gameTerm, row.algorithmTerm])
    }
  }
  return out
}
