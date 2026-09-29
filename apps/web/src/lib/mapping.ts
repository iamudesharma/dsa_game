import type { MappingRow } from '@dsa/game-schema'

/**
 * The debrief's metaphor table, as a display-friendly tuple list.
 *
 * `GameSpec.debrief.mapping` used to be an array of `[gameTerm, algorithmTerm]`
 * tuples while `DebriefResponse.mapping` was `MappingRow[]`, so every consumer
 * had to normalise two shapes of the same data. The spec now authors objects —
 * a tuple compiles to JSON Schema's tuple form (`items: [ ... ]`), which
 * opencode-go rejects — so the two agree and this is a pure formatting helper.
 *
 * The tuple branch is kept for one reason: a spec persisted by an older build
 * may still be in sessionStorage when the app is hot-reloaded, and dropping its
 * table silently would look like a bug rather than a migration.
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
