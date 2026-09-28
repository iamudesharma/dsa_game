# services/local-llm — provider tier 3

An offline `llama.cpp` server running **Qwen2.5-0.5B-Instruct (Q4_K_M)**, used
as the third fallback in `@dsa/provider-chain`.

## Why this tier exists

The chain has four tiers:

| # | tier | needs | failure mode |
|---|------|-------|--------------|
| 1 | `opencode` | a local `opencode serve` or the CLI | not running / no funds |
| 2 | `openrouter` | an API key + internet | blank key, 429, 402 |
| 3 | **`local-llm`** | **nothing but 0.5 GB of RAM** | **not running** |
| 4 | `template` | nothing at all | unreachable |

Tiers 1 and 2 are both *remote* in practice: tier 1 talks to a hosted provider
through opencode even when the server itself is local, and tier 2 is a hosted
API. This tier is the first one that works on a plane, on a dead network, or
with every credential expired. That is the whole point — it is the difference
between "the app degrades to the template and everything still works" and "the
app is unplayable".

It is also the reason `LOCAL_LLM_ENABLED=1` ships on by default in
`.env.example`: an idle `llama-server` costs no CPU, and a cold one is ready in
a couple of seconds.

## What it costs

- **~0.5 GB resident RAM** for the model, plus ~0.3 GB for an 8k context.
  Budget ~1 GB headroom on an 8 GB machine.
- **No GPU offload by default.** On an 8 GB M1, Metal offload (`-ngl`) competes
  with the browser for unified memory and buys little for a 0.5B model. The
  script defaults to CPU with `-t 6`, leaving two cores for the Next.js dev
  server and the API.
- **~490 MB download** (469 MiB), once, resumable.

## Grammar-constrained decoding

This is the part that makes a 0.5B model usable. A GameSpec is a strict,
20-field JSON object with enums, bounds and nested objects. Asking a 0.5B model
to produce that reliably is a losing bet — it will drop fields, invent
`correct: true`, or wrap the whole thing in prose.

So tier 3 does not ask the model to be careful. It removes the possibility:
llama.cpp's `response_format` / GBNF support constrains the **sampler**, so only
token sequences that already satisfy the JSON Schema are reachable. The model
only has to make good *choices* — which noun is a lantern, what tone, what story
— not good *syntax*.

The provider tries three transports in order, downgrading only on rejection:

1. `response_format: { type: 'json_schema', json_schema: { schema } }` —
   recent llama.cpp builds. The schema is generated from the zod definition by
   `gameSpecJsonSchema()`, so it can never drift from the validator.
2. `grammar: "<GBNF>"` — older builds that only understand a raw grammar. The
   GBNF is compiled from the same JSON Schema by `jsonSchemaToGbnf`, which
   returns `null` (i.e. skips the attempt) rather than emitting a grammar that
   might be subtly wrong.
3. `response_format: { type: 'json_object' }` — last resort, at least valid JSON.

Each transport is **validated by parsing its output**, not just by whether the
server accepted the request. That distinction is load-bearing on 0.5.0: the
`grammar` transport returns HTTP 200 with unparseable output, and a loop that
only downgraded on rejection would hand that garbage to the caller.

Because the grammar already guarantees shape, a parse failure is nearly
impossible — but if one happens the tier is allowed to be **partially salvaged**:
whatever theme/genre/tone/story the model produced is kept, and the structural
fields are filled from the deterministic template. That is safe precisely
because tier 4's content is derived from the problem registry rather than
invented, so a salvaged spec can be thinner but never wrong.

## Three things that had to be measured, not assumed

Everything below was found by probing a real `llama-server` (llama.cpp 0.5.0,
Qwen2.5-0.5B-Instruct Q4_K_M), not by reading docs. The grammars in
`packages/provider-chain/src/grammar.ts` carry the same notes inline.

**1. `json_schema` mode rejects the GameSpec schema as-is.** zod emits
`"items": false` for tuples, and llama.cpp's converter throws:

```
Unable to generate parser for this template. Automatic parser generation
failed: JSON schema error at #/properties/debrief/properties/mapping/items/items:
schema must be an object
```

`schemaForLlamaCpp()` strips `items: false` before sending. That relaxes the
`mapping` tuple to "2 or more elements" instead of failing the request — safe,
because the response is still validated by the strict `GameSpecSchema`
afterwards. The grammar is a convenience for the model, never the thing that
makes the output safe.

**2. A raw GBNF `grammar` field really does constrain decoding** — `root ::=
"HELLO"` returns exactly `HELLO` — **but this build mangles the JSON it
returns**, stripping the string quotes: `root ::= "{" "a" ":" "1" "}"` comes
back as `{a:1}`. So on 0.5.0 the `grammar` transport produces unparseable
output. It is kept in the chain for builds that serialise correctly, and a
mangled payload is caught by `parseGameSpecLoose` and salvaged rather than
crashing. **On 0.5.0, `json_schema` mode is the one that works.**

**3. GBNF is fussier than it looks.** These are all hard parse errors, not
warnings, and llama.cpp's error message is the useless string `failed to parse
grammar`:

| written | result |
|---|---|
| `"{"` | ok |
| `"\{"` | **error** — braces/brackets must not be escaped |
| `[` | starts a character range, not a literal bracket |
| `,` | reserved separator; must be `","` |
| `-` | reserved; must be `"-"` |
| `\\bfnrt` (alternation) | **error** — the escape set must be a class |

`chain.test.ts` asserts there is no unquoted metacharacter in the generated
grammar, so a future edit that drops a quote fails the test suite rather than
failing silently at runtime.

## The one thing the schema cannot say on its own

`GameSpecSchema` can express "this `mechanics[].id` is *a* mechanic id" but not
"this id is allowed *for this problem*" — the allowed set lives in
`ProblemMeta`, one level above the schema. Left as a prompt instruction, that
is a real hole: asked for `binary-search`, Qwen2.5-0.5B cheerfully emitted
`pushPop`, which the engine cannot render for that problem. The spec validated
and the game was unplayable.

Three things close it, from strongest to weakest:

1. **`schemaForProblem()`** rewrites `mechanics[].id.enum` (and the matching
   `boundDsaOp.enum`) to the problem's set before the request is sent. The
   sampler then physically cannot emit an unplayable mechanic. Used by tier 3
   and by tier 2's OpenRouter `strict` mode.
2. **`enforceAllowedMechanics()`** runs after parsing in all three LLM tiers. It
   drops disallowed and duplicate ids, repairs a `boundDsaOp` that contradicts
   the catalog, and returns `null` when nothing legal survives — which makes the
   tier report a failure so the chain falls through instead of shipping a broken
   puzzle.
3. The prompt still lists the allowed set, so a non-constrained tier gets the
   hint for free.



## Commands

```bash
# 1. fetch the GGUF (~400 MB, resumable; skips if already present)
./scripts/local-llm.sh download

# 2. serve on http://127.0.0.1:8081  (installs llama.cpp via brew if missing)
./scripts/local-llm.sh start

# 3. check
./scripts/local-llm.sh status
curl -s http://127.0.0.1:8081/health

# 4. shut down
./scripts/local-llm.sh stop
```

From the repo root, `pnpm dev:llm` is a shortcut for `start`.

Actual `llama-server` invocation (log and pid land in `run/`):

```
llama-server -m services/local-llm/models/qwen2.5-0.5b-instruct-q4_k_m.gguf \
             --host 127.0.0.1 --port 8081 \
             -c 8192 -t 6 --timeout 600
```

### Tuning for an 8 GB M1

Defaults are chosen for a machine that is also running a browser and a Next.js
dev server. To trade RAM for speed, offload every layer:

```bash
LOCAL_LLM_NGL=99 LOCAL_LLM_THREADS=4 ./scripts/local-llm.sh start
```

Other overrides: `LOCAL_LLM_PORT`, `LOCAL_LLM_HOST`, `LOCAL_LLM_CTX`,
`LOCAL_LLM_TIMEOUT`, `LOCAL_LLM_MAX_TOKENS`. Dropping `-c` to `4096` is fine —
the tier-3 system prompt is trimmed to the hard rules only (the JSON Schema is
not sent, because the grammar already encodes it).

Expect a full spec to take **1–4 minutes** on CPU with a 0.5B model, and raise
`LOCAL_LLM_MAX_TOKENS` (default 2000) accordingly: the grammar guarantees valid
JSON but not that generation *finishes*, and a truncated payload fails to parse.
That failure is not fatal — the tier falls back to the salvaged template spec.

## Layout

```
services/local-llm/
  README.md      this file
  models/        the .gguf          (gitignored)
  run/           server.log, server.pid   (gitignored)
```

## Model provenance

`qwen2.5-0.5b-instruct-q4_k_m.gguf` from
<https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF> (Apache-2.0). The URL
in the script was verified to return HTTP 200 on `HEAD` and HTTP 206 with the
`GGUF` magic header on a range `GET`. The script re-checks the magic bytes after
download, so a truncated or HTML-error response fails loudly instead of being
loaded as a model.
