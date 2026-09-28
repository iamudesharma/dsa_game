/**
 * TIER 2 — OpenRouter.
 *
 * Dormant unless `OPENROUTER_API_KEY` is set: `isAvailable()` is a pure
 * `Boolean(apiKey)`, so the chain records a cheap skip instead of burning a
 * request on a 401.
 *
 * We use the OpenAI-compatible `/chat/completions` endpoint with
 * `response_format: { type: 'json_schema', strict: true }` so the router
 * constrains decoding server-side. `temperature` is deliberately high (0.85):
 * every other tier is a correctness guarantee, this one exists to be surprising.
 */

import {
  explainGameSpecError,
  gameSpecJsonSchema,
  MECHANICS,
  parseGameSpecLoose,
  type GameSpec,
  type ProviderTier,
} from '@dsa/game-schema'
import { enforceAllowedMechanics } from '../guards.js'
import { schemaForProblem } from '../grammar.js'
import { buildPrompts, repairPrompt } from '../prompt.js'
import { SpecValidationError, type GenerateSpecInput, type SpecProvider } from '../types.js'

export interface OpenrouterConfig {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
  temperature: number
  maxTokens: number
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'

export function openrouterConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OpenrouterConfig {
  const num = (v: string | undefined, d: number): number => {
    const n = v === undefined ? NaN : Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() ?? '',
    model: env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: (env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs: num(env.OPENROUTER_TIMEOUT_MS, 40_000),
    temperature: num(env.OPENROUTER_TEMPERATURE, 0.85),
    maxTokens: num(env.OPENROUTER_MAX_TOKENS, 2500),
  }
}

interface Json {
  [key: string]: unknown
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Pull `choices[0].message.content` out of an OpenAI-compatible envelope. */
export function contentFromChatCompletion(body: unknown): string {
  if (!isObj(body)) return ''
  const choices = body['choices']
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0]
  if (!isObj(first)) return ''
  const message = first['message']
  if (isObj(message) && typeof message['content'] === 'string') return message['content']
  // Some gateways answer a json_schema request with a `text` field instead.
  if (typeof first['text'] === 'string') return first['text']
  return ''
}

export class OpenrouterProvider implements SpecProvider {
  readonly tier: ProviderTier = 'openrouter'
  private readonly cfg: OpenrouterConfig

  constructor(cfg: Partial<OpenrouterConfig> = {}) {
    this.cfg = { ...openrouterConfigFromEnv(), ...cfg }
  }

  async isAvailable(): Promise<boolean> {
    return this.cfg.apiKey.length > 0
  }

  async generate(input: GenerateSpecInput): Promise<GameSpec> {
    const { system, user } = buildPrompts(input)
    return this.ask(system, user, input)
  }

  async repair(input: GenerateSpecInput, issues: string): Promise<GameSpec> {
    const { system, user } = buildPrompts(input)
    return this.ask(system, `${user}\n\n---\n\n${repairPrompt(issues)}`, input)
  }

  private async ask(system: string, user: string, input: GenerateSpecInput): Promise<GameSpec> {
    if (this.cfg.apiKey.length === 0) {
      throw new Error('OPENROUTER_API_KEY is empty; tier 2 cannot run')
    }
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://github.com/dsa-game',
        'x-title': 'dsa-game provider-chain',
      },
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: this.cfg.temperature,
        max_tokens: this.cfg.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          // Narrowed to this problem's allowed mechanics so OpenRouter's strict
          // mode enforces the per-problem invariant, not just the id enum.
          json_schema: {
            name: 'game_spec',
            strict: true,
            schema: schemaForProblem(
              gameSpecJsonSchema(),
              input.problem.allowedMechanics.map((id) => ({ id, op: MECHANICS[id].op })),
            ),
          },
        },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`openrouter ${res.status}: ${detail.slice(0, 400)}`)
    }

    let body: unknown
    try {
      body = await res.json()
    } catch (e) {
      throw new Error(`openrouter response was not JSON: ${e instanceof Error ? e.message : String(e)}`)
    }

    const text = contentFromChatCompletion(body)
    if (text.length === 0) {
      const err = isObj(body) ? body['error'] : undefined
      throw new Error(`openrouter returned no content${err ? `: ${JSON.stringify(err).slice(0, 300)}` : ''}`)
    }

    const spec = parseGameSpecLoose(text)
    if (!spec) throw new SpecValidationError(explainGameSpecError(text) || 'response was not a GameSpec')

    // Server-authoritative identity, exactly as tier 1 does it, plus the
    // per-problem mechanic guard: the strict `response_format` schema pins the
    // mechanic *ids* but cannot know which ones this problem allows.
    const guarded = enforceAllowedMechanics(spec, input.problem.allowedMechanics)
    if (!guarded) {
      throw new SpecValidationError(
        `mechanics[] had nothing in common with allowedMechanics [${input.problem.allowedMechanics.join(', ')}]`,
      )
    }
    return {
      ...guarded,
      problemId: input.problem.id,
      seed: input.seed,
      language: input.language ?? guarded.language,
      generatedBy: this.tier,
    }
  }
}
