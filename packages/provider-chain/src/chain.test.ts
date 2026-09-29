/**
 * The provider-chain guarantees.
 *
 * The template-tier tests are the important ones: tier 4 is the reason the app
 * is always playable, so it is exercised across every problem, every difficulty
 * and a wide seed range rather than on one happy-path example.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DIFFICULTIES,
  GameSpecSchema,
  MECHANICS,
  PROBLEMS,
  getProblem,
  parseGameSpecLoose,
  type Difficulty,
  type GameSpec,
  type ProblemInstance,
  type ProblemMeta,
  type ProviderAttempt,
  type ProviderTier,
} from '@dsa/game-schema'
import { chainGenerateSpec } from './chain.js'
import { jsonSchemaToGbnf, schemaForLlamaCpp, schemaForProblem } from './grammar.js'
import { enforceAllowedMechanics } from './guards.js'
import { buildPrompts, estimateTokens, repairPrompt, systemPrompt, userPrompt } from './prompt.js'
import { chooseTemplateMechanics, TemplateProvider, buildTemplateSpec } from './providers/template.js'
import {
  extractAssistantText,
  opencodeConfigFromEnv,
  textFromOpencodeOutput,
  OpencodeProvider,
} from './providers/opencode.js'
import { contentFromChatCompletion, openrouterConfigFromEnv, OpenrouterProvider } from './providers/openrouter.js'
import {
  opencodeGoConfigFromEnv,
  OpencodeGoProvider,
  pickPreferredModel,
  type OpencodeGoConfig,
} from './providers/opencode-go.js'
import { localLlmConfigFromEnv, salvageSpec, LocalLlmProvider } from './providers/local-llm.js'
import { TEMPLATE_THEMES } from './themes.js'
import { SpecValidationError, type GenerateSpecInput, type SpecProvider } from './types.js'
import { defaultChain } from './index.js'
import { gameSpecJsonSchema } from '@dsa/game-schema'

const SEEDS = [0, 1, 2, 3, 7, 8, 42, 99, 1234, 65535, 2 ** 31, 4_294_967_295]

function instanceFor(problem: ProblemMeta, seed: number, n = 7): ProblemInstance {
  const values = Array.from({ length: n }, (_, i) => (i * 13 + seed) % 97)
  return {
    problemId: problem.id,
    seed,
    values,
    ...(problem.instanceHints.targetGuaranteed ? { target: values[3] } : {}),
    ...(problem.instanceHints.tokenAlphabet ? { tokens: ['(', ')', '['] } : {}),
    slots: [],
  }
}

function inputFor(problem: ProblemMeta, seed: number, difficulty: Difficulty = 'medium'): GenerateSpecInput {
  return { problem, instance: instanceFor(problem, seed), seed, difficulty }
}

// ---------------------------------------------------------------- tier 4

describe('buildTemplateSpec', () => {
  it('is deterministic for a fixed seed', () => {
    for (const problem of PROBLEMS) {
      const a = buildTemplateSpec(inputFor(problem, 4242, 'medium'))
      const b = buildTemplateSpec(inputFor(problem, 4242, 'medium'))
      expect(a).toEqual(b)
    }
  })

  it('produces a different theme for different seeds', () => {
    const problem = PROBLEMS[0]!
    const titles = SEEDS.map((seed) => buildTemplateSpec(inputFor(problem, seed)).theme.title)
    expect(new Set(titles).size).toBeGreaterThan(1)
    // And the spread should actually cover the table, not just two entries.
    const overMany = Array.from({ length: 64 }, (_, s) => buildTemplateSpec(inputFor(problem, s)).theme.title)
    expect(new Set(overMany).size).toBeGreaterThanOrEqual(TEMPLATE_THEMES.length)
  })

  it('uses every theme in the table across seeds', () => {
    // Match on the theme's own object noun, which is unique per theme — more
    // meaningful than string-matching a rendered title.
    const problem = PROBLEMS[0]!
    const seen = new Set<string>()
    for (let seed = 0; seed < 256; seed++) {
      const spec = buildTemplateSpec(inputFor(problem, seed))
      for (const theme of TEMPLATE_THEMES) {
        if (spec.vocabulary.object === theme.object) seen.add(theme.key)
      }
    }
    expect(seen.size).toBe(TEMPLATE_THEMES.length)
  })

  it('validates against GameSpecSchema for all 12 problems and every difficulty', () => {
    const failures: string[] = []
    for (const problem of PROBLEMS) {
      for (const difficulty of DIFFICULTIES) {
        for (const seed of SEEDS) {
          const spec = buildTemplateSpec(inputFor(problem, seed, difficulty))
          const res = GameSpecSchema.safeParse(spec)
          if (!res.success) {
            failures.push(`${problem.id}/${difficulty}/${seed}: ${res.error.issues[0]?.message ?? 'invalid'}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('never emits duplicate mechanic ids', () => {
    for (const problem of PROBLEMS) {
      for (const difficulty of DIFFICULTIES) {
        for (const seed of SEEDS) {
          const ids = buildTemplateSpec(inputFor(problem, seed, difficulty)).mechanics.map((m) => m.id)
          expect(new Set(ids).size).toBe(ids.length)
        }
      }
    }
  })

  it('only uses mechanics from the problem allowedMechanics', () => {
    for (const problem of PROBLEMS) {
      for (const difficulty of DIFFICULTIES) {
        for (const seed of SEEDS) {
          const spec = buildTemplateSpec(inputFor(problem, seed, difficulty))
          expect(spec.mechanics.length).toBeGreaterThanOrEqual(1)
          expect(spec.mechanics.length).toBeLessThanOrEqual(4)
          for (const m of spec.mechanics) {
            expect(problem.allowedMechanics).toContain(m.id)
          }
        }
      }
    }
  })

  it('always includes submitAnswer when the problem allows it', () => {
    for (const problem of PROBLEMS) {
      if (!problem.allowedMechanics.includes('submitAnswer')) continue
      for (const difficulty of DIFFICULTIES) {
        const ids = chooseTemplateMechanics(
          problem.allowedMechanics,
          difficulty,
          problem.requiredMechanics,
        )
        expect(ids).toContain('submitAnswer')
      }
    }
  })

  it('never omits a required mechanic, at any difficulty', () => {
    // Regression: the old rule took the first N allowed mechanics, which for
    // binary search dropped choosePath — the only way lo/hi move — and made the
    // generated game unwinnable while still validating against the schema.
    for (const problem of PROBLEMS) {
      for (const difficulty of DIFFICULTIES) {
        const ids = chooseTemplateMechanics(
          problem.allowedMechanics,
          difficulty,
          problem.requiredMechanics,
        )
        for (const need of problem.requiredMechanics) {
          expect(
            ids,
            `${problem.id}/${difficulty} dropped required mechanic ${need}`,
          ).toContain(need)
        }
      }
    }
  })

  it('keeps binary search completable: the window can actually move', () => {
    // The concrete failure this guards: no choosePath means lo/hi never change,
    // so the player loops forever and the game can never be won.
    const bs = PROBLEMS.find((p) => p.id === 'binary-search')
    expect(bs).toBeDefined()
    for (const difficulty of DIFFICULTIES) {
      const ids = chooseTemplateMechanics(
        bs!.allowedMechanics,
        difficulty,
        bs!.requiredMechanics,
      )
      expect(ids).toContain('choosePath')
      expect(ids).toContain('comparePair')
      expect(ids).toContain('submitAnswer')
    }
  })

  it('rejects a required mechanic that is not in the allowed set', () => {
    expect(() =>
      chooseTemplateMechanics(['comparePair', 'submitAnswer'], 'easy', ['choosePath']),
    ).toThrow(/required but not in the allowed set/)
  })

  it('every problem declares required mechanics as a subset of allowed', () => {
    for (const problem of PROBLEMS) {
      for (const need of problem.requiredMechanics) {
        expect(
          problem.allowedMechanics,
          `${problem.id} requires ${need} but does not allow it`,
        ).toContain(need)
      }
    }
  })

  it('scales mechanic count with difficulty, capped by the allowed set', () => {
    for (const problem of PROBLEMS) {
      const easy = chooseTemplateMechanics(problem.allowedMechanics, 'easy').length
      const hard = chooseTemplateMechanics(problem.allowedMechanics, 'hard').length
      expect(easy).toBe(Math.min(3, problem.allowedMechanics.length))
      expect(hard).toBe(Math.min(4, problem.allowedMechanics.length))
      expect(hard).toBeGreaterThanOrEqual(easy)
    }
  })

  it('stamps identity from the input, not from any model', () => {
    const problem = PROBLEMS[3]!
    const spec = buildTemplateSpec({ ...inputFor(problem, 77, 'hard'), language: 'en' })
    expect(spec.problemId).toBe(problem.id)
    expect(spec.seed).toBe(77)
    expect(spec.generatedBy).toBe('template')
    expect(spec.specVersion).toBe(1)
  })

  /**
   * The pool used to be `canonicalAlgorithm` split on sentence punctuation, on
   * the argument that a hint "cannot be false because it IS the algorithm".
   * That shipped the algorithm in `lo=0, hi=n-1` notation, as an ordered recipe,
   * after three requests on the default tier. It is now a ladder keyed by
   * operation, which is exhaustive by construction instead of by inspection.
   *
   * `template-prose.test.ts` covers the content guarantees in detail. This is
   * the schema-level floor that the pool still exists, is bounded, and is
   * problem-specific.
   */
  it('builds a problem-specific hintPool within the schema bounds', () => {
    for (const problem of PROBLEMS) {
      const spec = buildTemplateSpec(inputFor(problem, 5, 'medium'))
      expect(spec.narration.hintPool.length).toBeGreaterThanOrEqual(2)
      expect(spec.narration.hintPool.length).toBeLessThanOrEqual(6)
      for (const hint of spec.narration.hintPool) {
        expect(hint.trim()).not.toBe('')
        expect(hint).not.toMatch(/\{[a-zA-Z]+\}/)
      }
    }
  })

  it('gives different problems different hint pools', () => {
    // Keyed by the problem's own operations, so two problems with disjoint
    // required mechanics cannot produce the same pool.
    const pools = PROBLEMS.map(
      (problem) => buildTemplateSpec(inputFor(problem, 5, 'medium')).narration.hintPool.join('|'),
    )
    expect(new Set(pools).size).toBeGreaterThan(1)
  })

  it('never leaks a correctness claim into narration or debrief', () => {
    const banned = /\bthe answer is\b|\bcorrect (?:answer|index|value|order)\b|\byou (?:should|must) pick\b/i
    for (const problem of PROBLEMS) {
      const spec = buildTemplateSpec(inputFor(problem, 11, 'medium'))
      const prose = [
        spec.objective,
        spec.narration.intro,
        spec.narration.win,
        spec.narration.lose,
        ...spec.narration.hintPool,
        spec.debrief.summary,
        ...Object.values(spec.debrief.actionMeaning),
      ].join('\n')
      expect(banned.test(prose)).toBe(false)
    }
  })
})

// ------------------------------------------------------------- parseability

describe('parseGameSpecLoose', () => {
  const valid = buildTemplateSpec(inputFor(PROBLEMS[0]!, 3, 'medium'))
  const raw = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>

  it('accepts a fenced ```json block', () => {
    const fenced = '```json\n' + JSON.stringify(raw) + '\n```'
    expect(parseGameSpecLoose(fenced)?.problemId).toBe(valid.problemId)
  })

  it('accepts a { spec: { ... } } wrapper', () => {
    const wrapped = JSON.stringify({ spec: raw })
    expect(parseGameSpecLoose(wrapped)?.problemId).toBe(valid.problemId)
  })

  it('rejects an object carrying a forbidden `correct` key', () => {
    const polluted = JSON.stringify({ ...raw, correct: true })
    expect(parseGameSpecLoose(polluted)).toBeNull()
  })
})

// ------------------------------------------------------------------ prompts

describe('prompts', () => {
  it('stays inside the token budget and embeds the schema exactly once', () => {
    const system = systemPrompt()
    const { system: s2, user } = buildPrompts(inputFor(PROBLEMS[0]!, 1, 'medium'))
    expect(s2).toBe(system)
    // The schema is the bulk; a duplicate copy would blow the budget.
    expect(system.split('"specVersion"').length - 1).toBeLessThanOrEqual(2)
    expect(estimateTokens(system) + estimateTokens(user)).toBeLessThan(6000)
  })

  it('includes the real instance so labels can reference real positions', () => {
    const problem = PROBLEMS[0]!
    const user = userPrompt(inputFor(problem, 3, 'easy'))
    expect(user).toContain(JSON.stringify(instanceFor(problem, 3).values))
    expect(user).toContain('target')
    expect(user).toContain('seed: 3')
    expect(user).toContain('difficulty')
  })

  it('includes freeText only when the player supplied some', () => {
    const problem = PROBLEMS[0]!
    expect(userPrompt(inputFor(problem, 3))).not.toContain('PLAYER REQUEST')
    expect(userPrompt({ ...inputFor(problem, 3), freeText: 'make it about bees' })).toContain('make it about bees')
  })

  it('names the forbidden keys in the hard rules', () => {
    const system = systemPrompt()
    for (const key of ['correct', 'expected', 'solution', 'code', 'answer']) {
      expect(system).toContain(`"${key}"`)
    }
  })

  it('builds a repair prompt that quotes the issues', () => {
    const p = repairPrompt('theme.genre: invalid enum value')
    expect(p).toContain('theme.genre: invalid enum value')
    expect(p).toContain('JSON')
  })
})

// ----------------------------------------------------------------- grammar

describe('jsonSchemaToGbnf', () => {
  /**
   * Collect identifiers that appear *outside* quoted literals and character
   * classes — i.e. the only places a GBNF rule name can legally occur.
   *
   * A regex strip is not good enough here: GBNF escapes an inner quote as `\"`,
   * and a char class may contain a raw `"`, so any naive "remove the quoted
   * runs" pass desynchronises and invents phantom tokens.
   */
  function ruleReferences(gbnf: string): Set<string> {
    const out = new Set<string>()
    let i = 0
    while (i < gbnf.length) {
      const c = gbnf[i]
      // A backslash escapes the next character, so `\"` is a literal quote and
      // not a delimiter. Without this the scanner opens a phantom string at
      // every escaped quote and desynchronises from there on.
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '"') {
        i++
        while (i < gbnf.length) {
          if (gbnf[i] === '\\') {
            i += 2
            continue
          }
          if (gbnf[i] === '"') {
            i++
            break
          }
          i++
        }
        continue
      }
      if (c === '[') {
        while (i < gbnf.length && gbnf[i] !== ']') i++
        i++
        continue
      }
      if (/[A-Za-z_]/.test(c as string)) {
        let j = i
        while (j < gbnf.length && /[A-Za-z0-9_]/.test(gbnf[j] as string)) j++
        out.add(gbnf.slice(i, j))
        i = j
        continue
      }
      i++
    }
    return out
  }

  it('compiles the real GameSpec schema into a GBNF with no dangling rules', () => {
    const gbnf = jsonSchemaToGbnf(gameSpecJsonSchema())
    expect(gbnf).not.toBeNull()
    const text = gbnf ?? ''
    expect(text).toContain('root ::=')
    const defined = new Set(
      text
        .split('\n')
        .map((l) => l.split('::=')[0]?.trim())
        .filter((n): n is string => typeof n === 'string' && n.length > 0),
    )
    // Every referenced rule must be defined, otherwise llama.cpp rejects the
    // grammar and we silently lose the constraint.
    const referenced = ruleReferences(text)
    expect(referenced.size).toBeGreaterThan(0)
    for (const name of referenced) {
      expect(defined.has(name)).toBe(true)
    }
    expect(defined).toContain('root')
  })

  it('emits no unquoted GBNF metacharacter', () => {
    // llama.cpp rejects the whole grammar if a reserved character appears
    // outside a quoted literal or a character class. Every one of these was a
    // real parse error at some point: "\{", a bare "[", and a bare ",".
    const gbnf = jsonSchemaToGbnf(gameSpecJsonSchema()) ?? ''
    const bare: string[] = []
    let i = 0
    let inClass = false
    while (i < gbnf.length) {
      const c = gbnf[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (inClass) {
        if (c === ']') inClass = false
        i++
        continue
      }
      if (c === '[') {
        inClass = true
        i++
        continue
      }
      if (c === '"') {
        i++
        while (i < gbnf.length) {
          if (gbnf[i] === '\\') {
            i += 2
            continue
          }
          if (gbnf[i] === '"') {
            i++
            break
          }
          i++
        }
        continue
      }
      // `{`/`}` are legitimate only as the `){ N }` repetition operator directly
      // after a closing paren; anywhere else they are reserved.
      if (c === '{' || c === '}') {
        const before = gbnf.slice(0, i).trimEnd()
        const afterParen = before.endsWith(')')
        const opensRepetition = c === '{' ? afterParen : afterParen || /\{\s*\d+\s*$/.test(before)
        if (!opensRepetition) bare.push(c)
        i++
        continue
      }
      // `( )` and `|` are ordinary GBNF operators and need no quoting. Only the
      // comma and the minus sign are reserved, plus bare braces outside `{ N }`.
      if (c === ',' || c === '-') bare.push(c)
      i++
    }
    expect(bare).toEqual([])
  })

  it('quotes every array bracket and tuple comma', () => {
    // Fed a synthetic schema rather than the real one: the GameSpec no longer
    // contains a tuple (its `mapping` became objects, because opencode-go
    // rejects `items: [ ... ]`), but the converter must still quote a bare `[`
    // and a tuple comma if one ever appears, or a following schema change
    // reintroduces a silent grammar bug.
    // Shaped exactly as zod emits a `z.tuple`, so this exercises the real
    // construct rather than a hand-written approximation.
    const withTuple = {
      type: 'object',
      properties: {
        pair: {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'string' }],
          items: false,
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ['pair'],
      additionalProperties: false,
    }
    const gbnf = jsonSchemaToGbnf(withTuple) ?? ''
    // A bare `[` would be read as the start of a character range.
    expect(gbnf).toContain('"["')
    expect(gbnf).toContain('"]"')
    expect(gbnf).toContain('""," ')
  })

  it('allows map types to be populated instead of forcing an empty object', () => {
    // `actionMeaning` is a Record<string, string>; a grammar that only admitted
    // "{}" would make that field impossible for a model to fill. Synthetic
    // schema, so the test does not depend on whether the GameSpec happens to
    // contain a map today.
    const gbnf =
      jsonSchemaToGbnf({
        type: 'object',
        properties: {
          objectGlyphs: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['objectGlyphs'],
        additionalProperties: false,
      }) ?? ''
    const i = gbnf.indexOf('"objectGlyphs"')
    expect(i).toBeGreaterThan(-1)
    const around = gbnf.slice(i, i + 400)
    expect(around).toContain('"{"')
    // An empty-object-only rule is exactly `{ ws }` with no key/value pair.
    expect(around).not.toMatch(/"\{ "\[ \\t\\n\\r\]\* "\}"/)
    // It must instead allow a quoted key, a colon, and a quoted value.
    expect(around).toMatch(/"\\"" \(\[\^"/)
  })

  it('emits the helper rules only when the schema actually needs them', () => {
    expect(jsonSchemaToGbnf({ type: 'string' })).not.toContain('json ::=')
    expect(jsonSchemaToGbnf({})).toContain('json ::=')
  })

  it('strips items:false so llama.cpp can build a parser from the schema', () => {
    // Synthetic input again: the GameSpec itself is free of `items:false` now,
    // but the converter's whole job is surviving a schema that has one, so the
    // behaviour must stay tested against a schema that does.
    const raw = {
      type: 'object',
      properties: { nothing: { type: 'array', items: false }, list: { type: 'array', items: { type: 'string' } } },
      required: ['list'],
      additionalProperties: false,
    } as unknown as Record<string, never>
    expect(JSON.stringify(raw)).toContain('"items":false')
    const normalised = schemaForLlamaCpp(raw) as Record<string, never>
    expect(JSON.stringify(normalised)).not.toContain('"items":false')
    // And it must be a copy, not an in-place mutation of the caller's object.
    expect(JSON.stringify(raw)).toContain('"items":false')
  })

  it('returns null for a construct it cannot model rather than guessing', () => {
    expect(jsonSchemaToGbnf({ type: 'string', enum: [] })).not.toBeNull()
    expect(jsonSchemaToGbnf(false)).toBeNull()
    expect(jsonSchemaToGbnf({ type: 'array', prefixItems: [{ type: 'string' }], minItems: 4 })).toBeNull()
  })
})

// --------------------------------------------------------- transport shapes

describe('opencode response parsing', () => {
  it('reads the JSONL envelope that `opencode run --format json` emits', () => {
    const stdout = [
      JSON.stringify({ type: 'step_start', timestamp: 1, part: { type: 'step-start' } }),
      JSON.stringify({ type: 'text', timestamp: 2, part: { type: 'text', text: '{"a":1}' } }),
    ].join('\n')
    expect(textFromOpencodeOutput(stdout)).toBe('{"a":1}')
  })

  it('reads a single-object envelope', () => {
    expect(textFromOpencodeOutput(JSON.stringify({ data: { text: 'PONG' } }))).toBe('PONG')
  })

  it('reads the v2 message list content array', () => {
    const list = { data: [{ type: 'assistant', content: [{ type: 'text', text: 'hello' }] }] }
    expect(extractAssistantText(list)).toBe('hello')
  })

  it('returns empty rather than throwing on junk', () => {
    expect(textFromOpencodeOutput('')).toBe('')
    expect(extractAssistantText(null)).toBe('')
    expect(extractAssistantText(42)).toBe('')
  })
})

describe('openrouter envelope', () => {
  it('reads choices[0].message.content', () => {
    const body = { choices: [{ message: { content: '{"specVersion":1}' } }] }
    expect(contentFromChatCompletion(body)).toBe('{"specVersion":1}')
  })

  it('returns empty for an error envelope', () => {
    expect(contentFromChatCompletion({ error: { message: 'nope' } })).toBe('')
  })
})

describe('local-llm salvage', () => {
  it('keeps the small model theme text and fills the rest from the template', () => {
    const input = inputFor(PROBLEMS[5]!, 8, 'medium')
    const base = buildTemplateSpec(input)
    const salvaged = salvageSpec(
      {
        theme: { title: 'A Very Odd Kitchen', story: 'Something happened in the kitchen.', tone: 'not-an-enum' },
        narration: { intro: 'The pass is stacked.' },
      },
      input,
    )
    expect(salvaged).not.toBeNull()
    expect(salvaged?.theme.title).toBe('A Very Odd Kitchen')
    // A bad enum falls back rather than invalidating the whole spec.
    expect(salvaged?.theme.tone).toBe(base.theme.tone)
    expect(salvaged?.generatedBy).toBe('template')
    // Structural fields are never taken from the small model.
    expect(salvaged?.mechanics).toEqual(base.mechanics)
    expect(salvaged?.visual.palette).toEqual(base.visual.palette)
    expect(GameSpecSchema.safeParse(salvaged).success).toBe(true)
  })

  it('returns null when there is nothing to salvage', () => {
    expect(salvageSpec(null, inputFor(PROBLEMS[0]!, 1))).toBeNull()
  })
})

// ------------------------------------------------------- provider configuration

describe('provider configuration', () => {
  it('applies the documented opencode defaults and honours overrides', () => {
    const d = opencodeConfigFromEnv({} as NodeJS.ProcessEnv)
    expect(d.baseUrl).toBe('http://127.0.0.1:4096')
    expect(d.model).toBe('opencode/gemini-3.5-flash-lite')
    expect(d.agent).toBe('dsa-game-gen')
    expect(d.enabled).toBe(true)

    const o = opencodeConfigFromEnv({
      OPENCODE_BASE_URL: 'http://localhost:9999/',
      OPENCODE_MODEL: 'opencode/qwen3.8-flash',
      OPENCODE_ENABLED: '0',
    } as NodeJS.ProcessEnv)
    // The trailing slash must go or every route would end up `//api/...`.
    expect(o.baseUrl).toBe('http://localhost:9999')
    expect(o.model).toBe('opencode/qwen3.8-flash')
    expect(o.enabled).toBe(false)
  })

  it('applies the documented openrouter and local-llm defaults', () => {
    const r = openrouterConfigFromEnv({} as NodeJS.ProcessEnv)
    expect(r.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(r.model).toBe('google/gemini-2.0-flash-001')
    expect(r.temperature).toBeCloseTo(0.85)
    expect(r.maxTokens).toBe(2500)

    const l = localLlmConfigFromEnv({} as NodeJS.ProcessEnv)
    expect(l.baseUrl).toBe('http://127.0.0.1:8081')
    expect(l.enabled).toBe(true)
    expect(l.healthTimeoutMs).toBe(800)
  })

  it('keeps openrouter dormant with a blank key and needs no I/O to say so', async () => {
    const p = new OpenrouterProvider({ apiKey: '' })
    expect(await p.isAvailable()).toBe(false)
    await expect(p.generate(inputFor(PROBLEMS[0]!, 1))).rejects.toThrow(/OPENROUTER_API_KEY is empty/)
  })

  it('reports opencode and local-llm as unavailable when switched off, with no I/O', async () => {
    expect(await new OpencodeProvider({ enabled: false }).isAvailable()).toBe(false)
    expect(await new LocalLlmProvider({ enabled: false }).isAvailable()).toBe(false)
  })

  it('always reports the template tier as available', async () => {
    expect(await new TemplateProvider().isAvailable()).toBe(true)
  })

  it('defaultChain builds the five tiers in the documented order', () => {
    const tiers = defaultChain().map((p) => p.tier)
    expect(tiers).toEqual(['opencode-go', 'opencode', 'openrouter', 'local-llm', 'template'])
    // The two invariants the learner-facing order depends on: the paid direct
    // provider leads, and the deterministic floor is never moved up.
    expect(tiers[0]).toBe('opencode-go')
    expect(tiers[tiers.length - 1]).toBe('template')
  })
})

/** A minimal GameSpec for the fake-transport tests, with a recognisable title. */
function validSpecJson(): { theme: { title: string } } & Record<string, unknown> {
  const spec = buildTemplateSpec(inputFor(PROBLEMS[1]!, 4, 'easy'))
  return { ...JSON.parse(JSON.stringify(spec)), theme: { ...spec.theme, title: 'From The Model' } }
}

describe('local-llm transport selection', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  /** Build a minimal OpenAI-compatible envelope. */
  const completion = (content: string): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

  it('falls through transports that return 200 but unparseable output', async () => {
    // The scenario this guards: llama.cpp 0.5.0 accepts the raw-`grammar`
    // transport and answers 200 with quote-stripped JSON. A loop that stopped at
    // the first 200 would hand that garbage to the caller; validating per
    // transport is what makes this reach the `json_object` transport instead.
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      const fmt = body['response_format'] as Record<string, string> | undefined
      const label = 'grammar' in body ? 'grammar' : fmt?.['type'] === 'json_schema' ? 'json_schema' : 'json_object'
      seen.push(label)
      // The first two transports answer 200 with something that will not parse.
      if (label !== 'json_object') return completion('{"specVersion": 1, "theme": broken')
      return completion(JSON.stringify(validSpecJson()))
    }) as unknown as typeof fetch

    const p = new LocalLlmProvider({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 5000 })
    const spec = await p.generate(inputFor(PROBLEMS[1]!, 4, 'easy'))
    expect(spec.generatedBy).toBe('local-llm')
    expect(spec.theme.title).toBe('From The Model')
    // All three transports were tried, in order, before giving up on any of them.
    expect(seen).toEqual(['json_schema', 'grammar', 'json_object'])
  })

  it('returns the first transport that parses, without trying the rest', async () => {
    let call = 0
    globalThis.fetch = vi.fn(async () => {
      call++
      return completion(JSON.stringify(validSpecJson()))
    }) as unknown as typeof fetch

    const p = new LocalLlmProvider({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 5000 })
    const spec = await p.generate(inputFor(PROBLEMS[1]!, 4, 'easy'))
    expect(spec.theme.title).toBe('From The Model')
    expect(call).toBe(1)
  })

  it('downgrades on a 400 but stops on a real outage', async () => {
    let call = 0
    globalThis.fetch = vi.fn(async () => {
      call++
      // 503 is an outage, not "unsupported field": do not burn the budget
      // retrying the same dead server.
      return new Response(JSON.stringify({ error: 'boom' }), { status: 503 })
    }) as unknown as typeof fetch

    const p = new LocalLlmProvider({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 5000 })
    await expect(p.generate(inputFor(PROBLEMS[1]!, 4, 'easy'))).rejects.toThrow(/no transport produced a valid GameSpec/)
    expect(call).toBe(1)
  })
})

// ------------------------------------------------------------ tier 1: opencode-go

describe('opencode-go provider', () => {
  const originalFetch = globalThis.fetch
  const KEY = 'ocgo-test-key'
  const PROBLEM = PROBLEMS[1]!

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  interface Call {
    url: string
    init: RequestInit
  }

  /** A 200 OpenAI-shaped envelope carrying `content` verbatim. */
  const completion = (
    content: string,
    finishReason = 'stop',
    extra: Record<string, unknown> = {},
  ): Response =>
    new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }], ...extra }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )

  /** The exact body a bad key produces, per the verified contract. */
  const authFailure = (): Response =>
    new Response(JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'Invalid API key.' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })

  /** Stub fetch and record every request so headers and body can be asserted. */
  function stubFetch(respond: (url: string, init: RequestInit) => Response): Call[] {
    const calls: Call[] = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const recorded: Call = { url: String(url), init: init ?? {} }
      calls.push(recorded)
      return respond(recorded.url, recorded.init)
    }) as unknown as typeof fetch
    return calls
  }

  const headersOf = (call: Call): Record<string, string> => (call.init.headers ?? {}) as Record<string, string>
  const bodyOf = (call: Call): Record<string, unknown> => JSON.parse(String(call.init.body)) as Record<string, unknown>
  /** A provider with the model pinned, so only `/chat/completions` is called. */
  const pinned = (over: Partial<OpencodeGoConfig> = {}): OpencodeGoProvider =>
    new OpencodeGoProvider({ enabled: true, apiKey: KEY, baseUrl: 'https://go.test/v1', model: 'test-model', ...over })

  describe('configuration', () => {
    it('applies the documented defaults', () => {
      const c = opencodeGoConfigFromEnv({ OPENCODE_GO_API_KEY: KEY } as NodeJS.ProcessEnv)
      expect(c.baseUrl).toBe('https://opencode.ai/zen/go/v1')
      expect(c.enabled).toBe(true)
      expect(c.apiKey).toBe(KEY)
      // Empty means "resolve from the live /models list", never a hardcoded guess.
      expect(c.model).toBe('')
      expect(c.temperature).toBeCloseTo(0.9)
      expect(c.timeoutMs).toBe(180_000)
      expect(c.maxTokens).toBeGreaterThanOrEqual(4000)
    })

    it('falls back from OPENCODE_GO_API_KEY to OPENCODE_API_KEY', () => {
      const c = opencodeGoConfigFromEnv({ OPENCODE_API_KEY: 'shared-key' } as NodeJS.ProcessEnv)
      expect(c.apiKey).toBe('shared-key')
      // The dedicated name still wins when both are set.
      const both = opencodeGoConfigFromEnv({
        OPENCODE_GO_API_KEY: '  specific  ',
        OPENCODE_API_KEY: 'shared',
      } as NodeJS.ProcessEnv)
      expect(both.apiKey).toBe('specific')
    })

    it('honours overrides and normalises the base url', () => {
      const c = opencodeGoConfigFromEnv({
        OPENCODE_GO_ENABLED: '0',
        OPENCODE_GO_BASE_URL: 'http://127.0.0.1:9/v1/',
        OPENCODE_GO_MODEL: 'glm-5.3-flash',
        OPENCODE_GO_TIMEOUT_MS: '1234',
        OPENCODE_GO_TEMPERATURE: '0.5',
        OPENCODE_GO_MAX_TOKENS: '999',
      } as NodeJS.ProcessEnv)
      // A trailing slash would make every route `//chat/completions`.
      expect(c.baseUrl).toBe('http://127.0.0.1:9/v1')
      expect(c.enabled).toBe(false)
      expect(c.model).toBe('glm-5.3-flash')
      expect(c.timeoutMs).toBe(1234)
      expect(c.temperature).toBeCloseTo(0.5)
      expect(c.maxTokens).toBe(999)
    })

    it('is configured but unavailable with no key at all', async () => {
      const c = opencodeGoConfigFromEnv({} as NodeJS.ProcessEnv)
      expect(c.apiKey).toBe('')
      expect(await new OpencodeGoProvider({ ...c }).isAvailable()).toBe(false)
    })
  })

  describe('isAvailable', () => {
    it('is false with no key, true with one, and never throws', async () => {
      expect(await new OpencodeGoProvider({ enabled: true, apiKey: '' }).isAvailable()).toBe(false)
      expect(await new OpencodeGoProvider({ enabled: true, apiKey: KEY }).isAvailable()).toBe(true)
      expect(await new OpencodeGoProvider({ enabled: false, apiKey: KEY }).isAvailable()).toBe(false)
    })

    it('does no I/O, because a key present is the whole test', async () => {
      const calls = stubFetch(() => completion('{}'))
      expect(await pinned().isAvailable()).toBe(true)
      // A paid round trip on the availability path would throttle the account
      // for a question the environment can answer.
      expect(calls).toHaveLength(0)
    })
  })

  describe('live model resolution', () => {
    const catalog = (ids: readonly string[]): Response =>
      new Response(JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) }), {
        status: 200,
      })

    it('picks the cheapest preferred id the endpoint actually serves', () => {
      // Mirrors the live list shape: the preference order must survive a catalog
      // that contains only newer entries.
      expect(pickPreferredModel(['minimax-m3', 'kimi-k3', 'deepseek-v4-flash'])).toBe('deepseek-v4-flash')
      expect(pickPreferredModel(['qwen3.8-max', 'mimo-v2.6-flash'])).toBe('mimo-v2.6-flash')
      expect(pickPreferredModel(['space-bunny-free', 'glm-5'])).toBe('space-bunny-free')
      // No overlap: the caller decides how to degrade, rather than being handed
      // a model that does not exist.
      expect(pickPreferredModel(['something-else'])).toBeNull()
      expect(pickPreferredModel([])).toBeNull()
    })

    it('resolves from GET /models once and caches the answer', async () => {
      const calls = stubFetch((url) =>
        url.endsWith('/models') ? catalog(['minimax-m3', 'deepseek-flash']) : completion(JSON.stringify(validSpecJson())),
      )
      const p = pinned({ model: '' })
      await p.generate(inputFor(PROBLEM, 4, 'easy'))
      await p.generate(inputFor(PROBLEM, 4, 'easy'))

      const modelCalls = calls.filter((c) => c.url.endsWith('/models'))
      expect(modelCalls).toHaveLength(1)
      // The live list decided the model; no static guess was used.
      expect(bodyOf(calls.find((c) => c.url.endsWith('/chat/completions'))!)['model']).toBe('deepseek-flash')
    })

    it('falls back to the free model when discovery fails, and still generates', async () => {
      const calls = stubFetch((url) => {
        if (url.endsWith('/models')) throw new Error('network down')
        return completion(JSON.stringify(validSpecJson()))
      })
      const spec = await pinned({ model: '' }).generate(inputFor(PROBLEM, 4, 'easy'))
      expect(spec.generatedBy).toBe('opencode-go')
      // The fallback is the free model precisely so a discovery failure cannot
      // turn into a spend on a paid one.
      expect(bodyOf(calls[1]!)['model']).toBe('space-bunny-free')
    })
  })

  describe('generate', () => {
    it('parses a well-formed OpenAI response into a playable spec', async () => {
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      const input = inputFor(PROBLEM, 4, 'easy')
      const spec = await pinned().generate(input)

      expect(calls[0]?.url).toBe('https://go.test/v1/chat/completions')
      expect(spec.generatedBy).toBe('opencode-go')
      expect(spec.theme.title).toBe('From The Model')
      // The per-problem invariant is enforced, not merely requested.
      const guarded = enforceAllowedMechanics(spec, PROBLEM.allowedMechanics)
      expect(guarded).not.toBeNull()
      expect(guarded!.mechanics.length).toBeGreaterThan(0)
      for (const m of spec.mechanics) expect(PROBLEM.allowedMechanics).toContain(m.id)
      // Identity is server-authoritative; the model never gets to name it.
      expect(spec.problemId).toBe(PROBLEM.id)
      expect(spec.seed).toBe(4)
    })

    it('sends the headers opencode-go documents as required', async () => {
      // https://opencode.ai/docs/go/#where-can-i-use-it asks for two things
      // beyond auth: a client-specific user-agent, and a stable
      // x-opencode-session per conversation. Omitting the session header is a
      // live 400 ("Request is missing x-opencode-session and cannot be routed
      // efficiently"), which reads like a schema bug rather than a header.
      //
      // An earlier version of this test asserted the OPPOSITE — that no
      // x-opencode-* header should ever be sent — based on the wrong belief
      // that they were private to the local serve API. Corrected against the
      // published contract.
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      await pinned().generate(inputFor(PROBLEM, 4, 'easy'))

      const headers = headersOf(calls[0]!)
      const names = Object.keys(headers).map((h) => h.toLowerCase()).sort()
      expect(names).toEqual(['authorization', 'content-type', 'user-agent', 'x-opencode-session'])
      expect(headers['authorization']).toBe(`Bearer ${KEY}`)
      expect(headers['content-type']).toBe('application/json')
      // Must identify the client, not a generic SDK/HTTP library.
      expect(headers['user-agent']).toMatch(/^dsa-game\//)
      expect(headers['user-agent']).not.toMatch(/node|undici|axios|fetch/i)
      expect(headers['x-opencode-session']).toBeTruthy()
    })

    it('gives each generate call its own session id, and keeps it stable within a call', async () => {
      // A stable id is what lets opencode-go route and cache. Stable WITHIN a
      // conversation, distinct BETWEEN conversations: sharing one id across
      // unrelated GameSpecs would misattribute the traffic the header exists to
      // attribute correctly.
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      const p = pinned()
      await p.generate(inputFor(PROBLEM, 4, 'easy'))
      await p.generate(inputFor(PROBLEM, 5, 'easy'))

      const first = headersOf(calls[0]!)['x-opencode-session']
      const second = headersOf(calls[1]!)['x-opencode-session']
      expect(first).toBeTruthy()
      expect(second).toBeTruthy()
      expect(first).not.toBe(second)
    })

    it('honours an explicitly pinned session id', async () => {
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      const provider = new OpencodeGoProvider({
        enabled: true,
        apiKey: KEY,
        baseUrl: 'https://go.test/v1',
        model: 'test-model',
        sessionId: 'pinned-session',
      })
      await provider.generate(inputFor(PROBLEM, 4, 'easy'))
      expect(headersOf(calls[0]!)['x-opencode-session']).toBe('pinned-session')
    })

    it('sends the system and user prompts and a strict per-problem json_schema', async () => {
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      await pinned().generate(inputFor(PROBLEM, 4, 'easy'))

      const body = bodyOf(calls[0]!)
      const messages = body['messages'] as { role: string; content: string }[]
      expect(messages.map((m) => m.role)).toEqual(['system', 'user'])
      expect(messages[0]?.content).toBe(systemPrompt())
      expect(messages[1]?.content).toBe(userPrompt(inputFor(PROBLEM, 4, 'easy')))
      expect(body['temperature']).toBeCloseTo(0.9)

      const format = body['response_format'] as { type: string; json_schema: Record<string, unknown> }
      expect(format.type).toBe('json_schema')
      expect(format.json_schema['name']).toBe('game_spec')
      expect(format.json_schema['strict']).toBe(true)
      // The schema must be narrowed to THIS problem's mechanics, not the raw one.
      const schema = format.json_schema['schema'] as {
        properties: { mechanics: { items: { properties: { id: { enum: string[] } } } } }
      }
      expect(schema.properties.mechanics.items.properties.id.enum).toEqual([...PROBLEM.allowedMechanics])
    })

    it('gives every request a timeout', async () => {
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      await pinned({ timeoutMs: 1234 }).generate(inputFor(PROBLEM, 4, 'easy'))
      expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
    })

    it('refuses to run with no key instead of sending an unauthenticated request', async () => {
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      await expect(pinned({ apiKey: '' }).generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(/API_KEY is empty/)
      expect(calls).toHaveLength(0)
    })

    it('refuses to run when explicitly disabled, so a direct caller cannot spend', async () => {
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      await expect(pinned({ enabled: false }).generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(
        /disabled by OPENCODE_GO_ENABLED/,
      )
      expect(calls).toHaveLength(0)
    })

    it('repairs a schema violation on the single allowed round-trip', async () => {
      const calls = stubFetch((_url, init) => {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] }
        const isRepair = body.messages[1]?.content.includes('was rejected')
        return completion(isRepair ? JSON.stringify(validSpecJson()) : 'not a spec at all')
      })
      const input = inputFor(PROBLEMS[0]!, 1, 'easy')
      const providers = [pinned({ baseUrl: 'https://go.test/v1' }), new TemplateProvider()]
      const res = await chainGenerateSpec(input, { providers })
      expect(res.tier).toBe('opencode-go')
      expect(res.notes.join(' ')).toContain('repaired')
      expect(calls).toHaveLength(2)
    })
  })

  describe('status handling', () => {
    const status = async (code: number, type = 'Error'): Promise<string> => {
      stubFetch(
        () =>
          new Response(JSON.stringify({ type: 'error', error: { type, message: 'upstream detail' } }), {
            status: code,
            headers: { 'content-type': 'application/json' },
          }),
      )
      try {
        await pinned().generate(inputFor(PROBLEM, 4, 'easy'))
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
      throw new Error(`expected a ${code} to throw`)
    }

    it('names the key on 401 and 403 rather than reporting a generic failure', async () => {
      expect(await status(401, 'AuthError')).toMatch(/OPENCODE_GO_API_KEY/)
      expect(await status(401, 'AuthError')).toMatch(/missing or invalid/i)
      expect(await status(403, 'PermissionError')).toMatch(/OPENCODE_GO_API_KEY/)
    })

    it('says "no funds" on 402 — a drained account is not a slow model', async () => {
      // This is the distinction the tier exists to preserve: reporting 402 as
      // "took too long" sends the operator to tune the wrong variable.
      expect(await status(402, 'PaymentRequired')).toMatch(/no funds/i)
    })

    it('says rate limited on 429', async () => {
      expect(await status(429, 'RateLimitError')).toMatch(/rate limit/i)
    })

    it('blames upstream on 5xx and passes the detail through', async () => {
      const m = await status(503, 'ServiceUnavailable')
      expect(m).toMatch(/503/)
      expect(m).toMatch(/upstream/i)
      expect(m).toContain('upstream detail')
    })

    it('classifies a 200 that carries an error envelope', async () => {
      // Verified behaviour: a bad key on this endpoint answers HTTP 200 with
      // `{"type":"error","error":{"type":"AuthError",...}}`. Status-code-only
      // handling would report this as "no content" and the operator would go
      // hunting for a model problem instead of a key problem.
      const r = authFailure()
      globalThis.fetch = vi.fn(async () =>
        new Response(r.body, { status: 200, headers: { 'content-type': 'application/json' } }),
      ) as unknown as typeof fetch
      await expect(pinned().generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(/OPENCODE_GO_API_KEY/)
    })

    it('classifies a 200-with-error as "no funds" when that is the embedded type', async () => {
      const r = new Response(
        JSON.stringify({ type: 'error', error: { type: 'PaymentRequired', message: 'Insufficient funds.' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
      globalThis.fetch = vi.fn(async () => r) as unknown as typeof fetch
      await expect(pinned().generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(/no funds/i)
    })
  })

  describe('a 200 is not proof of success', () => {
    it('throws a parse error for a body that is not a GameSpec', async () => {
      // The lesson the llama.cpp tier already learned: validate by parsing, not
      // by status code, or the chain hands the engine unusable JSON.
      stubFetch(() => completion('{"specVersion": 1, "theme": broken'))
      await expect(pinned().generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(SpecValidationError)
    })

    it('throws a parse error when the model emits a spec with disallowed mechanics', async () => {
      const spec = JSON.parse(JSON.stringify(validSpecJson())) as GameSpec
      // Keep exactly one mechanic, and make it one this problem cannot render.
      spec.mechanics = [{ id: 'pushPop', boundDsaOp: 'push', label: 'stack a thing' }]
      stubFetch(() => completion(JSON.stringify(spec)))
      await expect(pinned().generate(inputFor(PROBLEMS[0]!, 4, 'easy'))).rejects.toThrow(SpecValidationError)
    })

    it('reports a truncated completion as a token limit, not a schema bug', async () => {
      stubFetch(() => completion('{"specVersion": 1, "theme": {"title": "cut off', 'length'))
      await expect(pinned({ maxTokens: 4000 }).generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(
        /truncated.*max_tokens/is,
      )
    })

    it('diagnoses an EMPTY reply as truncation when reasoning ate the budget', async () => {
      // Regression, and the exact failure this tier hit in production. A
      // reasoning model given max_tokens=4000 spent all 4000 on
      // `reasoning_tokens` and returned 200 with an empty message and
      // finish_reason "length". The empty-content check used to run first and
      // reported "200 with no message.content", which names neither the cause
      // nor the fix.
      stubFetch(() =>
        completion('', 'length', {
          usage: {
            prompt_tokens: 3380,
            completion_tokens: 4000,
            completion_tokens_details: { reasoning_tokens: 4000 },
          },
        }),
      )
      await expect(pinned({ maxTokens: 4000 }).generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(
        /truncated.*max_tokens=4000.*reasoning_tokens=4000/is,
      )
    })

    it('still says "no content" when the reply is empty for a NON-truncation reason', async () => {
      // The fix must not swallow the genuinely-different case: an empty reply
      // that was NOT cut off is a different problem and needs a different fix.
      stubFetch(() => completion('', 'stop', { usage: { completion_tokens: 3 } }))
      await expect(pinned().generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(
        /no choices\[0\]\.message\.content.*finish_reason=stop/is,
      )
    })

    it('throws rather than returning junk for a 200 with no choices', async () => {
      stubFetch(() => new Response(JSON.stringify({ object: 'list' }), { status: 200 }))
      await expect(pinned().generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(/no choices/i)
    })

    it('throws rather than returning junk for a 200 that is not JSON', async () => {
      stubFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 200 }))
      await expect(pinned().generate(inputFor(PROBLEM, 4, 'easy'))).rejects.toThrow(/no choices/i)
    })
  })

  describe('forceTemplate', () => {
    it('never reaches this provider', async () => {
      const calls = stubFetch(() => completion(JSON.stringify(validSpecJson())))
      const res = await chainGenerateSpec({ ...inputFor(PROBLEMS[0]!, 21, 'hard'), forceTemplate: true }, {
        providers: defaultChain(),
      })
      expect(res.tier).toBe('template')
      expect(res.spec.generatedBy).toBe('template')
      expect(calls).toHaveLength(0)
    })
  })
})


// ------------------------------------------------- per-problem mechanic guard

describe('enforceAllowedMechanics', () => {
  const allowed = getProblem('binary-search')!.allowedMechanics

  it('drops mechanics the problem cannot render', () => {
    const spec = buildTemplateSpec(inputFor(getProblem('binary-search')!, 1, 'medium'))
    const polluted = {
      ...spec,
      mechanics: [
        { id: 'pushPop' as const, boundDsaOp: 'push' as const, label: 'stack a thing' },
        ...spec.mechanics,
      ],
    }
    const fixed = enforceAllowedMechanics(polluted, allowed)
    expect(fixed).not.toBeNull()
    expect(fixed!.mechanics.map((m) => m.id)).not.toContain('pushPop')
    expect(fixed!.mechanics.length).toBe(spec.mechanics.length)
  })

  it('returns null when nothing legal survives, so the tier must fail over', () => {
    const spec = buildTemplateSpec(inputFor(getProblem('binary-search')!, 1, 'medium'))
    const allIllegal = {
      ...spec,
      mechanics: [{ id: 'pushPop' as const, boundDsaOp: 'push' as const, label: 'x' }],
    }
    expect(enforceAllowedMechanics(allIllegal, allowed)).toBeNull()
  })

  it('removes duplicate ids and repairs a wrong boundDsaOp', () => {
    const spec = buildTemplateSpec(inputFor(getProblem('binary-search')!, 1, 'medium'))
    const first = spec.mechanics[0]!
    const dupes = {
      ...spec,
      mechanics: [{ ...first, boundDsaOp: 'link' as const }, first, ...spec.mechanics.slice(1)],
    }
    const fixed = enforceAllowedMechanics(dupes, allowed)
    expect(fixed!.mechanics.map((m) => m.id)).toEqual(spec.mechanics.map((m) => m.id))
    // The catalog, not the model, decides the op.
    expect(fixed!.mechanics[0]!.boundDsaOp).toBe(first.boundDsaOp)
  })

  it('caps the list at the 4-mechanic schema ceiling', () => {
    const spec = buildTemplateSpec(inputFor(getProblem('binary-search')!, 1, 'medium'))
    const many = { ...spec, mechanics: [...spec.mechanics, ...spec.mechanics, ...spec.mechanics] }
    expect(enforceAllowedMechanics(many, allowed)!.mechanics.length).toBeLessThanOrEqual(4)
  })

  it('is a no-op on a spec that is already correct', () => {
    const spec = buildTemplateSpec(inputFor(getProblem('binary-search')!, 1, 'medium'))
    expect(enforceAllowedMechanics(spec, allowed)).toEqual(spec)
  })
})

describe('schemaForProblem', () => {
  it('pins mechanics[].id.enum to the problem allowed set', () => {
    const problem = getProblem('binary-search')!
    const schema = schemaForProblem(
      gameSpecJsonSchema(),
      problem.allowedMechanics.map((id) => ({ id, op: MECHANICS[id].op })),
    ) as { properties: { mechanics: { items: { properties: { id: { enum: string[] } } } } } }
    expect(schema.properties.mechanics.items.properties.id.enum).toEqual([...problem.allowedMechanics])
  })

  it('leaves the unrelated genre/tone enums alone', () => {
    const problem = getProblem('array-max-min')!
    const schema = schemaForProblem(
      gameSpecJsonSchema(),
      problem.allowedMechanics.map((id) => ({ id, op: MECHANICS[id].op })),
    ) as { properties: { theme: { properties: { genre: { enum: string[] } } } } }
    expect(schema.properties.theme.properties.genre.enum).toEqual([
      'fantasy',
      'sci-fi',
      'detective',
      'everyday',
      'sport',
      'cooking',
      'space',
      'nature',
    ])
  })

  it('never mutates the cached source schema', () => {
    const before = JSON.stringify(gameSpecJsonSchema())
    const problem = getProblem('two-sum')!
    schemaForProblem(
      gameSpecJsonSchema(),
      problem.allowedMechanics.map((id) => ({ id, op: MECHANICS[id].op })),
    )
    expect(JSON.stringify(gameSpecJsonSchema())).toBe(before)
  })
})

// ----------------------------------------------------------------- the chain

class StubProvider implements SpecProvider {
  available: boolean
  attempts = 0
  constructor(
    readonly tier: ProviderTier,
    private readonly behaviour: 'ok' | 'throw' | 'unavailable' | 'invalid',
    private readonly spec?: GameSpec,
  ) {
    this.available = behaviour !== 'unavailable'
  }

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async generate(): Promise<GameSpec> {
    this.attempts++
    if (this.behaviour === 'throw') throw new Error(`${this.tier} exploded`)
    if (this.behaviour === 'invalid') throw new SpecValidationError('theme.genre: invalid enum value')
    return this.spec ?? buildTemplateSpec(inputFor(PROBLEMS[0]!, 1))
  }
}

describe('chainGenerateSpec', () => {
  it('forceTemplate returns the template tier and touches no network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const providers = [
      new StubProvider('opencode', 'ok'),
      new StubProvider('openrouter', 'ok'),
      new StubProvider('local-llm', 'ok'),
      new TemplateProvider(),
    ]
    const res = await chainGenerateSpec(
      { ...inputFor(PROBLEMS[0]!, 21, 'hard'), forceTemplate: true },
      { providers },
    )
    expect(res.tier).toBe('template')
    expect(res.spec.generatedBy).toBe('template')
    expect(res.attempts).toHaveLength(1)
    expect(res.attempts[0]?.tier).toBe('template')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('falls through to the third provider and records both failures', async () => {
    const providers = [
      new StubProvider('opencode', 'throw'),
      new StubProvider('openrouter', 'throw'),
      new StubProvider('local-llm', 'ok'),
    ]
    const seen: ProviderAttempt[] = []
    const res = await chainGenerateSpec(inputFor(PROBLEMS[1]!, 2, 'easy'), {
      providers,
      onAttempt: (a) => seen.push(a),
    })
    expect(res.tier).toBe('local-llm')
    expect(res.spec.generatedBy).toBe('local-llm')
    const failures = res.attempts.filter((a) => !a.ok)
    expect(failures).toHaveLength(2)
    expect(failures[0]?.error).toContain('opencode exploded')
    expect(failures[1]?.error).toContain('openrouter exploded')
    expect(seen).toEqual(res.attempts)
  })

  it('records a skip with a reason for an unavailable tier', async () => {
    const res = await chainGenerateSpec(inputFor(PROBLEMS[1]!, 2, 'easy'), {
      providers: [new StubProvider('openrouter', 'unavailable'), new TemplateProvider()],
    })
    expect(res.attempts[0]).toMatchObject({ tier: 'openrouter', ok: false })
    expect(res.attempts[0]?.error).toContain('skipped')
    expect(res.tier).toBe('template')
  })

  it('throws an error naming every tier when all providers fail', async () => {
    const providers = [
      new StubProvider('opencode', 'throw'),
      new StubProvider('openrouter', 'unavailable'),
      new StubProvider('local-llm', 'throw'),
      new StubProvider('template', 'throw'),
    ]
    await expect(
      chainGenerateSpec(inputFor(PROBLEMS[0]!, 1, 'easy'), { providers }),
    ).rejects.toThrow(/opencode.*openrouter.*local-llm.*template/s)
  })

  it('fires onAttempt once per provider, in order', async () => {
    const providers = [
      new StubProvider('opencode', 'throw'),
      new StubProvider('openrouter', 'unavailable'),
      new StubProvider('local-llm', 'ok'),
    ]
    const seen: ProviderAttempt[] = []
    await chainGenerateSpec(inputFor(PROBLEMS[0]!, 1, 'easy'), {
      providers,
      onAttempt: (a) => seen.push(a),
    })
    expect(seen.map((a) => a.tier)).toEqual(['opencode', 'openrouter', 'local-llm'])
  })

  it('does one repair round-trip on a schema violation', async () => {
    const repairs: string[] = []
    const provider: SpecProvider = {
      tier: 'openrouter',
      isAvailable: async () => true,
      generate: async () => {
        throw new SpecValidationError('theme.tone: invalid enum value')
      },
      repair: async (input, issues) => {
        repairs.push(issues)
        return buildTemplateSpec(input)
      },
    }
    const res = await chainGenerateSpec(inputFor(PROBLEMS[0]!, 1, 'easy'), { providers: [provider] })
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toContain('theme.tone')
    expect(res.tier).toBe('openrouter')
    expect(res.notes.join(' ')).toContain('repaired')
    // Two attempts: the failure and the successful repair.
    expect(res.attempts).toHaveLength(2)
  })

  it('does not repair when maxRepairsPerTier is 0', async () => {
    const repairs: string[] = []
    const provider: SpecProvider = {
      tier: 'openrouter',
      isAvailable: async () => true,
      generate: async () => {
        throw new SpecValidationError('theme.tone: invalid enum value')
      },
      repair: async (input) => {
        repairs.push('called')
        return buildTemplateSpec(input)
      },
    }
    const res = await chainGenerateSpec(inputFor(PROBLEMS[0]!, 1, 'easy'), {
      providers: [provider, new TemplateProvider()],
      maxRepairsPerTier: 0,
    })
    expect(repairs).toEqual([])
    expect(res.tier).toBe('template')
  })

  it('contains a provider whose isAvailable throws', async () => {
    const broken: SpecProvider = {
      tier: 'opencode',
      isAvailable: async () => {
        throw new Error('probe blew up')
      },
      generate: async (i) => buildTemplateSpec(i),
    }
    const res = await chainGenerateSpec(inputFor(PROBLEMS[0]!, 1, 'easy'), {
      providers: [broken, new TemplateProvider()],
    })
    expect(res.tier).toBe('template')
    expect(res.attempts[0]?.error).toContain('isAvailable() threw')
  })

  it('rejects an empty provider list', async () => {
    await expect(
      chainGenerateSpec(inputFor(PROBLEMS[0]!, 1, 'easy'), { providers: [] }),
    ).rejects.toThrow(/no providers configured/)
  })

  it('enforces the per-tier wall clock and falls through', async () => {
    const slow: SpecProvider = {
      tier: 'opencode',
      isAvailable: async () => true,
      generate: () => new Promise<GameSpec>(() => {}),
    }
    const res = await chainGenerateSpec(inputFor(PROBLEMS[0]!, 1, 'easy'), {
      providers: [slow, new TemplateProvider()],
      timeoutMs: 40,
    })
    // A hung tier is contained, not fatal: the template still answers.
    expect(res.tier).toBe('template')
    expect(res.attempts[0]).toMatchObject({ tier: 'opencode', ok: false })
    expect(res.attempts[0]?.error).toContain('timed out')
  })
})
