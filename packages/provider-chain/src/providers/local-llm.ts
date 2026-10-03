/**
 * TIER 3 — an offline `llama-server` (llama.cpp) running Qwen2.5-0.5B-Instruct.
 *
 * Why grammar-constrained decoding matters here: a 0.5B model cannot be
 * *trusted* to emit a 20-field strict JSON object. It does not need to be —
 * llama.cpp's `response_format`/GBNF path constrains the sampler so only
 * schema-conforming token sequences are reachable. The model then only has to
 * make good *choices*, not good *syntax*.
 *
 * Recent llama.cpp builds accept `response_format: { type: 'json_schema' }`;
 * older ones only understand `{ type: 'json_object' }` or a raw GBNF `grammar`
 * string.
 *
 * Three transports are tried in order, and each is validated by *parsing* its
 * output rather than by whether the server accepted the request — see
 * `ask()` for why that matters on llama.cpp 0.5.0.
 *
 * Because a 0.5B model can still produce a schema-valid object that is
 * semantically thin, this tier is allowed to be *partially salvaged*: whatever
 * theme text it produced is kept, and everything else is filled from
 * `buildTemplateSpec`. That is safe precisely because the template's content is
 * derived from the problem, not invented.
 *
 * The llama.cpp-specific findings (schema normalisation, the quote-stripping
 * bug, the GBNF dialect) are documented in `services/local-llm/README.md` and
 * in `grammar.ts`.
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
import { jsonSchemaToGbnf, schemaForLlamaCpp, schemaForProblem } from '../grammar.js'
import { buildPrompts, repairPrompt } from '../prompt.js'
import { SpecValidationError, type GenerateSpecInput, type SpecProvider } from '../types.js'
import { buildTemplateSpec } from './template.js'

export interface LocalLlmConfig {
  enabled: boolean
  baseUrl: string
  model: string
  timeoutMs: number
  temperature: number
  maxTokens: number
  /** Health probe budget. Must stay short: this gates every generate. */
  healthTimeoutMs: number
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8081'
const DEFAULT_MODEL = 'local-model'

function flag(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase())
}

export function localLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LocalLlmConfig {
  const num = (v: string | undefined, d: number): number => {
    const n = v === undefined ? NaN : Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    enabled: flag('LOCAL_LLM_ENABLED', true, env),
    baseUrl: (env.LOCAL_LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    // llama-server ignores the model field when a single model is loaded.
    model: env.LOCAL_LLM_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: num(env.LOCAL_LLM_TIMEOUT_MS, 60_000),
    temperature: num(env.LOCAL_LLM_TEMPERATURE, 0.7),
    maxTokens: num(env.LOCAL_LLM_MAX_TOKENS, 2000),
    healthTimeoutMs: 800,
  }
}

interface Json {
  [key: string]: unknown
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Read an enum straight out of the generated JSON Schema.
 *
 * Hard-coding the allowed genres/tones here would be a second source of truth
 * that silently rots the day someone adds a genre, so the schema is the only
 * place the list lives.
 */
function enumAt(path: readonly string[]): readonly string[] | null {
  let node: unknown = gameSpecJsonSchema()
  for (const key of path) {
    if (!isObj(node)) return null
    const props = node['properties']
    if (!isObj(props)) return null
    node = props[key]
  }
  if (!isObj(node)) return null
  const values = node['enum']
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : null
}

const GENRES = enumAt(['theme', 'genre'])
const TONES = enumAt(['theme', 'tone'])

/** Keep `value` only if it is a member of the schema enum (or the enum is unknown). */
function enumOr(value: unknown, allowed: readonly string[] | null, fallback: string): string {
  if (typeof value !== 'string') return fallback
  if (allowed === null) return value
  return allowed.includes(value) ? value : fallback
}

/** Same OpenAI-compatible envelope as tier 2, kept local so both can evolve apart. */
function contentOf(body: unknown): string {
  if (!isObj(body)) return ''
  const choices = body['choices']
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0]
  if (!isObj(first)) return ''
  const message = first['message']
  if (isObj(message) && typeof message['content'] === 'string') return message['content']
  if (typeof first['text'] === 'string') return first['text']
  return ''
}

/**
 * Keep whatever the small model managed, fill the rest from the template.
 *
 * A salvaged spec is still a *valid* spec (it round-trips through the schema),
 * so the only cost is thinner prose — never a wrong algorithm, because the
 * mechanics list, the ops and the debrief mapping all come from the template.
 */
export function salvageSpec(partial: unknown, input: GenerateSpecInput): GameSpec | null {
  const base = buildTemplateSpec(input)
  if (!isObj(partial)) return null

  // A partial block is merged field-by-field over the template rather than
  // replacing the block wholesale: `narration: { intro }` alone would fail the
  // schema on the missing `hintPool`/`win`/`lose`, which defeats the purpose.
  const patch: Json = {}
  const string = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.trim().length > 0 ? v : fallback

  if (typeof partial['objective'] === 'string') patch['objective'] = partial['objective']

  if (isObj(partial['theme'])) {
    const t = partial['theme']
    patch['theme'] = {
      ...base.theme,
      ...t,
      title: string(t['title'], base.theme.title),
      story: string(t['story'], base.theme.story),
      // An unrecognised enum must not invalidate the whole spec.
      genre: enumOr(t['genre'], GENRES, base.theme.genre),
      tone: enumOr(t['tone'], TONES, base.theme.tone),
    }
  }

  if (isObj(partial['vocabulary'])) {
    patch['vocabulary'] = { ...base.vocabulary, ...partial['vocabulary'] }
  }

  if (isObj(partial['visual'])) {
    // `palette` is all-required, so a partial palette is unusable: keep ours.
    patch['visual'] = {
      ...base.visual,
      ...partial['visual'],
      palette: base.visual.palette,
      objectGlyphs: isObj(partial['visual']['objectGlyphs'])
        ? { ...base.visual.objectGlyphs, ...partial['visual']['objectGlyphs'] }
        : base.visual.objectGlyphs,
    }
  }

  if (isObj(partial['narration'])) {
    const n = partial['narration']
    patch['narration'] = {
      ...base.narration,
      ...n,
      intro: string(n['intro'], base.narration.intro),
      win: string(n['win'], base.narration.win),
      lose: string(n['lose'], base.narration.lose),
      // hintPool has a hard 2..6 bound; only accept a well-formed one.
      hintPool:
        Array.isArray(n['hintPool']) && n['hintPool'].length >= 2 ? n['hintPool'] : base.narration.hintPool,
    }
  }

  if (isObj(partial['debrief'])) {
    const d = partial['debrief']
    patch['debrief'] = {
      ...base.debrief,
      ...d,
      summary: string(d['summary'], base.debrief.summary),
      actionMeaning: isObj(d['actionMeaning'])
        ? { ...base.debrief.actionMeaning, ...d['actionMeaning'] }
        : base.debrief.actionMeaning,
      mapping: Array.isArray(d['mapping']) && d['mapping'].length > 0 ? d['mapping'] : base.debrief.mapping,
    }
  }

  // Salvage is best-effort by design. Rather than all-or-nothing, retry with
  // progressively fewer salvaged fields: a 0.5B model that produced one broken
  // narration array should still get its title kept, not be thrown away.
  const attempts: Json[] = [patch]
  if (isObj(patch['theme'])) {
    const { narration: _n, debrief: _d, visual: _v, vocabulary: _vo, ...themeOnly } = patch
    void _n
    void _d
    void _v
    void _vo
    attempts.push(themeOnly as Json)
  }
  for (const candidate of attempts) {
    const spec = parseGameSpecLoose({ ...base, ...candidate })
    if (spec) return spec
  }
  return null
}

export class LocalLlmProvider implements SpecProvider {
  readonly tier: ProviderTier = 'local-llm'
  private readonly cfg: LocalLlmConfig
  /** Cached result of the GBNF compile; `false` means "not available". */
  private gbnf: string | null | undefined

  constructor(cfg: Partial<LocalLlmConfig> = {}) {
    this.cfg = { ...localLlmConfigFromEnv(), ...cfg }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.cfg.enabled) return false
    try {
      const res = await fetch(`${this.cfg.baseUrl}/health`, {
        signal: AbortSignal.timeout(this.cfg.healthTimeoutMs),
      })
      await res.text().catch(() => '')
      return res.ok
    } catch {
      return false
    }
  }

  async generate(input: GenerateSpecInput): Promise<GameSpec> {
    const { system, user } = buildPrompts(input)
    const { spec, partial, errors } = await this.ask(system, user, input)
    if (spec) return this.stamp(spec, input)

    // Grammar-constrained decoding should make this nearly unreachable, but a
    // 0.5B model on a build with no schema support (or one that mangles the
    // response, see `responseFormats`) can still land here.
    if (partial !== null) {
      const salvaged = salvageSpec(partial, input)
      if (salvaged) return { ...this.stamp(salvaged, input), generatedBy: `${this.tier}+template` }
    }
    throw new SpecValidationError(
      errors.length > 0
        ? `no transport produced a valid GameSpec -> ${errors.join(' | ')}`
        : 'local-llm produced no usable output',
    )
  }

  async repair(input: GenerateSpecInput, issues: string): Promise<GameSpec> {
    const { system, user } = buildPrompts(input)
    const { spec } = await this.ask(system, `${user}\n\n---\n\n${repairPrompt(issues)}`, input)
    return this.stamp(spec ?? buildTemplateSpec(input), input)
  }

  /**
   * Server-authoritative identity plus the per-problem mechanic guard.
   *
   * `boundDsaOp` and the allowed-mechanic set are facts about the problem, not
   * things a 0.5B model can be trusted to get right, so both are re-derived
   * here regardless of what came back.
   */
  private stamp(spec: GameSpec, input: GenerateSpecInput): GameSpec {
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

  /**
   * `response_format` shape to try, in order of preference.
   *
   * Attempt 0 is the modern `json_schema`, with the schema pre-processed by
   * `schemaForLlamaCpp` because llama.cpp's own converter rejects `items:false`.
   * Attempt 1 is a raw GBNF `grammar` string, for builds that predate
   * `json_schema`. Attempt 2 asks only for `json_object`.
   *
   * Note on attempt 1: llama.cpp 0.5.0 *accepts* a raw `grammar` field and does
   * constrain decoding with it (verified: `root ::= "HELLO"` yields exactly
   * `HELLO`), but on this build the response it hands back has its string quotes
   * stripped — `root ::= "{" "a" ":" "1" "}"` comes back as `{a:1}` — so the
   * output no longer parses. It stays in the chain for builds that serialise
   * correctly, and a mangled payload is caught by `parseGameSpecLoose` and
   * salvaged rather than crashing anything.
   *
   * Each downgrade happens only after the previous one is *rejected*, so a
   * healthy server is never needlessly retried.
   */
  /**
   * Try every `response_format` in order and return the first *parseable* spec.
   *
   * Validating per transport, rather than only on rejection, matters here: on
   * llama.cpp 0.5.0 the `grammar` transport is accepted but returns
   * quote-stripped output. If we stopped at the first 200 we would return that
   * garbage and report a baffling "expected object, received null" instead of
   * quietly succeeding via the next transport.
   */
  private async ask(
    system: string,
    user: string,
    input: GenerateSpecInput,
  ): Promise<{ spec: GameSpec | null; partial: unknown; errors: string[] }> {
    const errors: string[] = []
    let partial: unknown = null

    for (const mode of this.responseFormats(input)) {
      let text: string
      try {
        const body = await this.post(system, user, mode, input.signal)
        text = contentOf(body)
        if (text.length === 0) {
          errors.push(`${mode.label}: empty content`)
          continue
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`${mode.label}: ${msg.slice(0, 200)}`)
        // A 4xx means "this build does not support that field" — try the next
        // transport. Anything else (timeout, 500, connection refused) is a real
        // outage and retrying the same server would only waste the budget.
        if (!(e instanceof RejectedByServer)) break
        continue
      }

      const spec = parseGameSpecLoose(text)
      if (spec) return { spec, partial: null, errors }
      errors.push(`${mode.label}: ${explainGameSpecError(text) || 'output was not valid JSON'}`)
      if (partial === null) partial = maybeParse(text)
    }
    return { spec: null, partial, errors }
  }

  private responseFormats(input: GenerateSpecInput): { label: string; body: Json }[] {
    // Narrow to this problem's mechanics *and* strip `items:false`, so the
    // sampler cannot emit a mechanic the engine cannot render for this problem.
    const schema = schemaForLlamaCpp(
      schemaForProblem(
        gameSpecJsonSchema(),
        input.problem.allowedMechanics.map((id) => ({ id, op: MECHANICS[id].op })),
      ),
    )
    const base: Json = {
      model: this.cfg.model,
      temperature: this.cfg.temperature,
      max_tokens: this.cfg.maxTokens,
    }
    const modes: { label: string; body: Json }[] = [
      {
        label: 'json_schema',
        body: { ...base, response_format: { type: 'json_schema', json_schema: { schema } } },
      },
    ]
    if (this.gbnf === undefined) this.gbnf = jsonSchemaToGbnf(schema)
    if (this.gbnf) {
      modes.push({ label: 'grammar', body: { ...base, grammar: this.gbnf } })
    }
    // Last resort: at least insist on *some* JSON.
    modes.push({ label: 'json_object', body: { ...base, response_format: { type: 'json_object' } } })
    return modes
  }

  private async post(
    system: string,
    user: string,
    mode: { label: string; body: Json },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.cfg.timeoutMs)])
        : AbortSignal.timeout(this.cfg.timeoutMs),
      body: JSON.stringify({
        ...mode.body,
        messages: [
          { role: 'system', content: systemPlaceholder(system) },
          { role: 'user', content: user },
        ],
      }),
    })
    if (res.status === 400 || res.status === 422) {
      throw new RejectedByServer(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`)
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`local-llm ${res.status}: ${detail.slice(0, 300)}`)
    }
    try {
      return await res.json()
    } catch (e) {
      throw new Error(`local-llm response was not JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

/** Distinguishes "this build does not support that field" from a real outage. */
class RejectedByServer extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RejectedByServer'
  }
}

function maybeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * A 0.5B model has a small effective context for a ~3k-token system prompt.
 * We keep the rules and drop the schema (the grammar already encodes it).
 */
function systemPlaceholder(system: string): string {
  const rules = system.split('JSON SCHEMA — your output must validate against this exactly')[0]
  const trimmed = (rules ?? system).trim()
  return `${trimmed}\n\nOutput raw JSON only, no code fences.`
}
