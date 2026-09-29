/**
 * JSON Schema generation for the GameSpec.
 *
 * The same JSON Schema is used in three places:
 *   1. the system prompt, so opencode/OpenRouter know the exact shape,
 *   2. OpenRouter's `response_format: json_schema`,
 *   3. llama.cpp's GBNF grammar for the tiny local model, which is what makes
 *      tier 3 structurally incapable of emitting invalid JSON.
 */

import { z } from 'zod'
import { GameSpecSchema } from './game-spec.js'

let cached: Record<string, unknown> | null = null

export function gameSpecJsonSchema(): Record<string, unknown> {
  if (cached) return cached
  // zod v4 exposes JSON Schema conversion natively.
  const schema = z.toJSONSchema(GameSpecSchema, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>
  cached = schema
  return schema
}

/** A trimmed copy suitable for embedding in a prompt. */
export function gameSpecJsonSchemaForPrompt(): string {
  return JSON.stringify(gameSpecJsonSchema(), null, 2)
}

/**
 * Reduce a JSON Schema to the subset OpenAI-style strict structured output
 * accepts, which is what opencode-go enforces.
 *
 * Measured against the live endpoint, all of these are rejected with a bare
 * `400 [invalid_request_error] invalid request` — no field name, no clue:
 *
 *   - `propertyNames`             (from a Zod `record(keySchema, ...)`)
 *   - `additionalProperties: {...}` (an open map; strict mode wants `false`)
 *   - `items: [ ... ]`            (JSON-Schema tuple form, from `z.tuple`)
 *
 * The GameSpec schema is authored to avoid all three, so this is a guard rail
 * rather than a crutch: if someone reintroduces a record or a tuple, this
 * rewrites it instead of shipping a request the endpoint rejects with an error
 * that identifies nothing. Loosening here is safe because the matching Zod
 * schema still validates the reply — a missing constraint yields a laxer reply,
 * never a wrong one that passes.
 */
export function toStrictJsonSchema<T>(schema: T): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node

    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // A map keyed by arbitrary strings is not expressible in strict mode.
      if (key === 'propertyNames') continue
      if (key === 'additionalProperties') {
        out[key] = false
        continue
      }
      if (key === 'items' && Array.isArray(value)) {
        // Tuple form: keep the first element as the item schema so the field
        // still reads as "an array of X" rather than nothing at all.
        out[key] = walk(value[0] ?? { type: 'string' })
        continue
      }
      out[key] = walk(value)
    }
    return out
  }
  return walk(schema) as T
}
