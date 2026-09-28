/**
 * Post-parse guards shared by the LLM tiers.
 *
 * The JSON Schema can express "this id is a mechanic id" but not "this id is
 * allowed *for this problem*" — the allowed set lives in `ProblemMeta`. So the
 * strongest enforcement available on the decode side is the narrowed schema
 * (`schemaForProblem`), and this module is the second line of defence for the
 * tiers whose transport cannot take a per-request schema at all.
 */

import { MECHANICS, type GameSpec, type MechanicId } from '@dsa/game-schema'

/**
 * Drop mechanics the problem cannot render.
 *
 * Returns a new spec, or `null` when nothing legal survives — in which case the
 * caller must treat the response as a failure so the chain can fall through (or
 * run one repair round-trip) rather than hand the engine an unplayable spec.
 *
 * Also repairs a mechanic whose `boundDsaOp` contradicts the catalog, and
 * truncates to the 4-mechanic ceiling, so a model cannot smuggle in a duplicate
 * or an over-long list either.
 */
export function enforceAllowedMechanics(
  spec: GameSpec,
  allowed: readonly MechanicId[],
): GameSpec | null {
  const seen = new Set<MechanicId>()
  const mechanics: GameSpec['mechanics'] = []
  for (const m of spec.mechanics) {
    if (!allowed.includes(m.id) || seen.has(m.id)) continue
    seen.add(m.id)
    const def = MECHANICS[m.id]
    mechanics.push({
      ...m,
      // The catalog is authoritative for the op; a model that disagrees is
      // describing a different interaction than the one it named.
      boundDsaOp: def.op,
    })
    if (mechanics.length === 4) break
  }
  if (mechanics.length === 0) return null
  return { ...spec, mechanics }
}
