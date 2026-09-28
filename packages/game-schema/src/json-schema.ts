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
