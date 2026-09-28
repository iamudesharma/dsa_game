/**
 * JSON Schema -> GBNF, the subset llama.cpp's `grammar` field understands.
 *
 * Only the constructs that `z.toJSONSchema(GameSpecSchema, { io: 'output' })`
 * actually emits are supported. Anything else returns `null` rather than a
 * wrong grammar — a subtly wrong grammar constrains the model to the wrong
 * shape, which is worse than no grammar at all.
 *
 * Supported: object (properties/required), array (items / prefixItems with
 * `items: false`), string (enum, const), integer, number, boolean, null, and a
 * bare `true` (any JSON value, via the `json` helper rule).
 *
 * ── GBNF dialect notes, all verified against llama.cpp's parser ──────────────
 * 1. Braces and brackets are literals ONLY when quoted. A bare `[` starts a
 *    character range, and `"\{"` is a hard parse error. So every `[`, `]`,
 *    `{` and `}` in this file is written as `"["`, `"]"`, `"{"`, `"}"`.
 * 2. A bare `,` and a bare `-` are GBNF reserved characters and are parse
 *    errors, even inside a tuple. They must be the literals `","` and `"-"`.
 * 3. A backslash escape inside a character class is written `[\\]`, and an
 *    alternation like `\\"` is rejected — the escape set has to be a class.
 * 4. Rather than model the full JSON escape set (which needs `"` inside a
 *    character class, see 3), the string rule simply *excludes* the backslash.
 *    Every string in the GameSpec is prose, an enum, or an identifier, so no
 *    value genuinely needs an escape, and "no backslash" is trivially correct
 *    JSON — which is the whole point of constraining the sampler.
 *
 * `chain.test.ts` asserts (1) and (2) structurally, so a future edit that
 * drops a quote fails the suite instead of failing silently at runtime.
 */

/** GBNF has no `any` builtin, so unconstrained nodes reference a helper rule. */
const HELPERS = String.raw`json ::= object | array | string | number | "true" | "false" | "null"
object ::= "{" ws ( string ws ":" ws json ( ws "," ws string ws ":" ws json )* )? ws "}"
array ::= "[" ws ( json ( ws "," ws json )* )? ws "]"
string ::= "\"" ([^"\\\x00-\x1F])* "\""
number ::= "-"? ("0" | [1-9] [0-9]*) ( "." [0-9]+ )? ( [eE] [-+]? [0-9]+ )?
ws ::= [ \t\n\r]*`

const ANY_RULE = 'json'

interface Json {
  [key: string]: unknown
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Escapes a property name or enum value for a GBNF double-quoted literal. */
function lit(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

/**
 * Every constant below is written with `String.raw` on purpose. GBNF is full of
 * backslashes (\" for a quote, \x1F for a control char), and in a normal TS
 * literal the same source text silently produces something else — a real NUL
 * byte, or an unterminated string rule. `String.raw` makes the emitted grammar
 * byte-identical to what is written here, which is the only sane way to keep
 * this file and llama.cpp's parser in agreement.
 */
const INTEGER = String.raw`"-"? ("0" | [1-9] [0-9]*)`
const NUMBER = String.raw`"-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?`
const WS = String.raw`[ \t\n\r]*`
/** A JSON string: no escapes, so no backslash. See note 4 above. */
const STR = String.raw`"\"" ([^"\\\x00-\x1F])* "\""`

/** Element separator inside a tuple. The comma must be quoted — see note 2. */
const TUPLE_SEP = `"," ${WS}`

interface Compiled {
  rule: string
  /** Whether the result references the `json` helper rule. */
  usesAny: boolean
}

function compile(schema: unknown): Compiled | null {
  if (schema === true || schema === undefined) return { rule: ANY_RULE, usesAny: true }
  if (schema === false) return null
  if (!isObj(schema)) return null

  if (Array.isArray(schema['anyOf']) || Array.isArray(schema['oneOf'])) {
    const branches = (schema['anyOf'] ?? schema['oneOf']) as unknown[]
    const parts: string[] = []
    let usesAny = false
    for (const sub of branches) {
      const c = compile(sub)
      if (!c) continue
      parts.push(c.rule)
      usesAny ||= c.usesAny
    }
    if (parts.length === 0) return null
    if (parts.length === 1) return { rule: parts[0] as string, usesAny }
    return { rule: `( ${parts.join(' | ')} )`, usesAny }
  }

  if (schema['const'] !== undefined) {
    const value = schema['const']
    if (typeof value === 'string') return { rule: lit(value), usesAny: false }
    return { rule: lit(JSON.stringify(value)), usesAny: false }
  }

  const type = schema['type']
  if (Array.isArray(type)) {
    const parts: string[] = []
    let usesAny = false
    for (const t of type) {
      const c = compile({ ...schema, type: t })
      if (!c) continue
      parts.push(c.rule)
      usesAny ||= c.usesAny
    }
    if (parts.length === 0) return null
    return { rule: `( ${parts.join(' | ')} )`, usesAny }
  }

  switch (type) {
    case 'string': {
      const values = schema['enum']
      if (Array.isArray(values) && values.length > 0) {
        return { rule: `( ${values.map((v) => lit(String(v))).join(' | ')} )`, usesAny: false }
      }
      // minLength/maxLength are upper-biased hints in our schema and constraining
      // them buys nothing; one unbounded char class keeps the grammar small.
      return { rule: STR, usesAny: false }
    }
    case 'integer':
      return { rule: INTEGER, usesAny: false }
    case 'number':
      return { rule: NUMBER, usesAny: false }
    case 'boolean':
      return { rule: `("true" | "false")`, usesAny: false }
    case 'null':
      return { rule: `"null"`, usesAny: false }

    case 'array': {
      const prefix = schema['prefixItems']
      const tuple: string[] = []
      if (Array.isArray(prefix)) {
        for (const sub of prefix) {
          const c = compile(sub)
          if (!c) return null
          tuple.push(c.rule)
        }
      }
      const minItems = typeof schema['minItems'] === 'number' ? schema['minItems'] : 0

      if (tuple.length > 0) {
        // zod tuple: minItems cannot exceed the declared prefix length.
        if (minItems > tuple.length) return null
        if (schema['items'] === false) {
          return { rule: `"[" ${WS} ${tuple.join(TUPLE_SEP)} ${WS} "]"`, usesAny: false }
        }
        const item = compile(schema['items'] ?? true)
        if (!item) return null
        return {
          rule: `"[" ${WS} ${tuple.join(TUPLE_SEP)} ${WS} ( "," ${WS} ${item.rule} )* ${WS} "]"`,
          usesAny: item.usesAny,
        }
      }

      const item = compile(schema['items'] ?? true)
      if (!item) return null
      const head =
        minItems > 0 ? `${item.rule} ( "," ${WS} ${item.rule} ){ ${minItems - 1} }` : item.rule
      return {
        rule: `"[" ${WS} ( ${head} ( "," ${WS} ${item.rule} )* )? ${WS} "]"`,
        usesAny: item.usesAny,
      }
    }

    case 'object': {
      const properties = isObj(schema['properties']) ? schema['properties'] : {}
      const names = Object.keys(properties)

      if (names.length === 0) {
        // No declared properties. If `additionalProperties` is itself a schema
        // this is a map type (`Record<string, Line>` — e.g. objectGlyphs,
        // actionMeaning) and must allow arbitrary keys. Forcing `{}` here would
        // silently make those fields unpopulatable by the model.
        const ap = schema['additionalProperties']
        if (isObj(ap)) {
          const value = compile(ap)
          if (!value) return null
          const pair = `${STR} ${WS} ":" ${WS} ${value.rule}`
          return {
            rule: `"{" ${WS} ( ${pair} ( ${WS} "," ${WS} ${pair} )* )? ${WS} "}"`,
            usesAny: value.usesAny,
          }
        }
        return { rule: `"{" ${WS} "}"`, usesAny: false }
      }

      const required = new Set(
        Array.isArray(schema['required'])
          ? schema['required'].filter((k): k is string => typeof k === 'string')
          : [],
      )
      const sep = `${WS} "," ${WS}`
      const members: string[] = []
      const optionals: string[] = []
      let usesAny = false
      for (const name of names) {
        const prop = compile(properties[name])
        if (!prop) return null
        usesAny ||= prop.usesAny
        const member = `${lit(name)} ${WS} ":" ${WS} ${prop.rule}`
        if (required.has(name)) members.push(member)
        else optionals.push(member)
      }

      if (members.length === 0) {
        // Every key optional. Allow `{}` or exactly one member: enough for the
        // all-optional nodes in this spec (objectGlyphs, actionMeaning) without
        // the k! blowup of full key permutation.
        return { rule: `"\\{" ${WS} ( ${optionals.join(` | ${sep} `)} )? ${WS} "\\}"`, usesAny }
      }
      // JSON key order carries no meaning, so we fix it as required-then-optional
      // and let each remaining key be independently omitted.
      const body = `${members.join(sep)} ${optionals.map((m) => `(${sep} ${m})?`).join(' ')}`
      return { rule: `"{" ${WS} ${body} ${WS} "}"`, usesAny }
    }

    default:
      return { rule: ANY_RULE, usesAny: true }
  }
}

/**
 * Build a GBNF grammar, or return `null` if the schema uses a construct this
 * compiler does not model.
 */
export function jsonSchemaToGbnf(schema: unknown): string | null {
  const compiled = compile(schema)
  if (!compiled) return null
  const lines = compiled.usesAny ? `${HELPERS}\n` : ''
  return `${lines}root ::= ${compiled.rule}\n`
}

/**
 * Rewrite a JSON Schema into one llama.cpp's built-in converter accepts.
 *
 * Measured against llama.cpp 0.5.0: its `json_schema` -> grammar converter
 * throws on `items: false` (zod emits that for tuples), e.g.
 *   "Unable to generate parser for this template. Automatic parser generation
 *    failed: JSON schema error at #/properties/debrief/properties/mapping/
 *    items/items: schema must be an object"
 *
 * Dropping `items: false` relaxes the tuple to "2 or more elements" instead of
 * rejecting the whole request. That is safe here because the response is still
 * validated by the strict `GameSpecSchema` afterwards — the grammar is a
 * convenience for the model, never the thing that makes the output safe.
 *
 * Returns a deep copy; the input is not mutated.
 */
export function schemaForLlamaCpp(schema: unknown): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!isObj(node)) return node
    const out: Json = {}
    for (const [key, value] of Object.entries(node)) {
      // `false` as a schema means "nothing is allowed", which is not a valid
      // schema object for the converter.
      if (key === 'items' && value === false) continue
      out[key] = walk(value)
    }
    return out
  }
  return walk(schema)
}

/**
 * Narrow the GameSpec schema to one problem's allowed mechanics.
 *
 * `GameSpecSchema` can only express "this id is *a* mechanic id", because the
 * allowed set is a property of the problem, not of the spec shape. That leaves
 * the single most important invariant unenforced: a model asked for
 * `binary-search` will happily emit `pushPop`, which the engine cannot render
 * for that problem. Observed in practice with Qwen2.5-0.5B.
 *
 * Pinning `mechanics[].id.enum` (and the matching `boundDsaOp` enum) to the
 * problem's set turns that prompt instruction into a decoding constraint, so a
 * constrained sampler physically cannot produce an unplayable mechanic list.
 *
 * Returns a deep copy; the cached input schema is never mutated.
 */
export function schemaForProblem(
  schema: unknown,
  allowed: readonly { id: string; op: string }[],
): unknown {
  if (allowed.length === 0) return schema
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!isObj(node)) return node
    const out: Json = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' && Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        // Replace any enum that is a subset-match of either the allowed ids or
        // their ops. Matching on the first enum entry avoids rewriting the
        // unrelated genre/tone enums that live in the same schema.
        const first = value[0]
        if (allowed.some((a) => a.id === first)) {
          out[key] = allowed.map((a) => a.id)
          continue
        }
        if (allowed.some((a) => a.op === first)) {
          out[key] = [...new Set(allowed.map((a) => a.op))]
          continue
        }
      }
      out[key] = walk(value)
    }
    return out
  }
  return walk(schema)
}
