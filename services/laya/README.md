# Laya sidecar

Laya ([github.com/NandhaKishorM/laya](https://github.com/NandhaKishorM/laya), Apache 2.0) is a
**non-autoregressive "System 1" decision engine**. It reads a state and answers any number of
**typed questions** about it in a single forward pass — 33 ms on a T4, tens of ms on this M1.

## What it is, and the one thing it is not

Laya answers exactly three question kinds:

| kind | output | used here for |
|---|---|---|
| `choice` | one key from a fixed label set, plus per-key probabilities | routing a player to a problem, picking a theme/hint/tag/difficulty |
| `score` | a number across described ordinal levels | available, unused by the MVP |
| `noul` | a calibrated probability of yes/no | available, unused by the MVP |

> **Laya CANNOT generate text.** It is not an LLM. It will not write a debrief, a problem statement,
> a hint, a spec, or a line of code. There is no sampling loop and no token stream.
>
> That is exactly why we use it, and exactly why it is confined to `@dsa/decision-layer`.
> **Game authoring is never routed to Laya.** Specs, narration, hints and code come from the
> provider chain (`opencode` → `openrouter` → `local-llm` → `template`). Laya only ever picks one
> key out of a set the TypeScript layer already defined.

## Which checkpoint we pin, and why

Laya ships three checkpoints and a `Router` that picks between them by detected script/language.

| `LAYA_MODELS` entry | encoder | params | context | notes |
|---|---|---|---|---|
| `english` | ModernBERT-large | **421M** | 512 | best on English; collapses on non-Latin scripts |
| `multilingual` | **mmBERT-base** | **322M** | 1024 (up to 8192) | smallest, ~2x faster, weakest at this task |
| `typed-decisions` | ModernBERT-large | **421M** | 1024 | **we pin this one** — fine-tuned for exactly this |

**We pin `typed-decisions`.** Every question this sidecar is asked — pick one of N labels, score
this, is this true — *is* a typed decision, which is exactly what this checkpoint was fine-tuned
for. It scores **0.766** on the typed-decisions benchmark against **0.352** for `multilingual`
(0.318 is random). Choosing the smaller checkpoint to save memory would have been optimising the
wrong thing: the extra ~100M params is roughly 200 MB in bf16, and this sidecar is opt-in and
off by default, so the memory is not the binding constraint — task fit is.

Set `LAYA_MODELS=multilingual` if you want the smallest possible resident set and can accept
answers that are close to a coin flip.

Pinning one checkpoint also means the lazy router can never build a second one, so the resident set
is bounded by construction.

Whichever you pick, `@dsa/decision-layer` is built so the heuristic path is the product and Laya is
only ever a tie-breaker behind a confidence gate. See "Confidence" below.

## Expected memory

| | resident |
|---|---|
| one 421M checkpoint, loaded, MPS | **~1.0–1.4 GB** |
| all three checkpoints (upstream `LAYA_PRELOAD=1` default) | ~2.5–3.5 GB |
| this MacBook Air, total | **8 GB** |

8 GB is *unified* memory shared with macOS, the Next.js dev server, the Flutter app, and
sometimes a llama.cpp server (`scripts/local-llm.sh`). So `scripts/laya.sh start` sets:

| var | value | why |
|---|---|---|
| `LAYA_DEVICE` | `mps` | Metal GPU. Drops a forward pass from ~200–450 ms (CPU) to tens of ms and leaves the CPU free. **Fallback: `LAYA_DEVICE=cpu`** if MPS misbehaves — see "Troubleshooting". |
| `LAYA_MODELS` | `typed-decisions` | the task-matched checkpoint, and the only one ever built |
| `LAYA_PRELOAD` | `0` | upstream defaults to `1` (build at startup) and with an empty `LAYA_MODELS` it builds **all three**. Lazy loading is what keeps RSS down. Cost: a slow first request. |
| `LAYA_THREADS` | `4` | caps torch intra-op threads at 4 of 8 cores so the sidecar cannot starve the web app. |
| `LAYA_HOST` | `127.0.0.1` | upstream defaults to `0.0.0.0` (whole LAN). `LAYA_API_KEY` is unset, so the endpoint is unauthenticated — do not expose it. |
| `LAYA_PORT` | `8000` | matches `LAYA_BASE_URL` in `.env.example` |

`scripts/laya.sh status` prints resident MB and warns above 1200 MB, which would mean a second
checkpoint got built despite `LAYA_MODELS`.

## Install and run

```bash
bash scripts/laya.sh setup    # one-time, into services/laya/.venv. NOT automatic: it is a large install.
bash scripts/laya.sh start    # 127.0.0.1:8000
bash scripts/laya.sh status   # pid, resident MB, /health
bash scripts/laya.sh test     # in-process smoke test + HTTP contract check
bash scripts/laya.sh stop
```

`setup` installs PyTorch (platform-appropriate: the single macOS arm64 wheel already includes
Metal — there is no separate "CPU-only macOS build" — and on Linux it defaults to the CPU index so
it does not pull a multi-GB CUDA wheel) and then `laya[serve]`, which adds fastapi + uvicorn +
python-multipart.

Checkpoint weights are **not** downloaded by `setup`. They arrive on the first inference call
(~1.7 GB for `laya-typed-decisions`, plus a 34 MB / 256k-vocab `tokenizer.json`). The first `start` +
`test` will therefore block on that download. Set `HF_HOME` to move the cache off a small volume.

Nothing here is required. If the sidecar is not running, `@dsa/decision-layer` answers every
decision with a deterministic heuristic; the game is fully playable.

## Environment variables

Read by **our** client (`packages/decision-layer/src/laya-client.ts`, via `readLayaEnv`), from
`.env.example`:

| var | default | meaning |
|---|---|---|
| `LAYA_BASE_URL` | `http://127.0.0.1:8000` | sidecar base URL |
| `LAYA_ENABLED` | `1` when unset | `0`/`false`/`off`/`no` forces the heuristic path and skips all network calls |
| `LAYA_MODEL` | `typed-decisions` | checkpoint name sent as the request's `model` field |
| `LAYA_TIMEOUT_MS` | `1500` | extension, not in `.env.example`. Per-request budget. |

Read by the **server** (`scripts/laya.sh start` / `laya/serve.py`): `LAYA_HOST`, `LAYA_PORT`,
`LAYA_DEVICE`, `LAYA_PRELOAD`, `LAYA_MODELS`, `LAYA_THREADS`, `LAYA_LOG_LEVEL`, `LAYA_API_KEY`.

## HTTP contract

`laya-serve` implements the same `POST /v1/systemone` wire protocol as TypeSafe's hosted Jev API.

### Request

```bash
curl -s localhost:8000/v1/systemone -H 'content-type: application/json' -d '{
  "state": "I need help debugging why my brackets are unbalanced.",
  "model": "typed-decisions",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "arrays": "sorting, scanning, rearranging numbers",
        "structures": "stacks, queues, linked lists, parentheses"
      }
    }
  }
}'
```

- `state` — a string, object, or list. **We always send a string**, built by the caller. Note the
  server rejects a missing/`null` `state` with 400, because `null` would otherwise be serialised to
  the literal text `"null"` and answered at ~0.94 confidence.
- `model` — honoured when it names a checkpoint (`english`/`multilingual`/`typed-decisions`);
  otherwise the router auto-selects by script/language. We always send it, so the pinned
  checkpoint cannot be second-guessed.
- `questions` — a map of name → question. **One question, named after the `DecisionKind`**
  (`route-problem`, `pick-theme`, ...), so the answer can be looked up by that name.
- A `choice` question's `criteria` is an **object** `{ key: description }` — not an array of
  strings. A `score` question's `criteria` is an **array** of level descriptions. A `noul`
  question has **no** criteria.

### Response

```json
{
  "model": "laya-rl-agent",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "structures",
      "probabilities": { "arrays": 0.12, "structures": 0.88 },
      "confidence": 0.74,
      "answer_confidence": 0.88
    }
  },
  "usage": { "input_tokens": 21, "output_tokens": 0 },
  "routing": { "model": "typed-decisions", "repo": "convaiinnovations/laya/typed-decisions", "reason": "pinned" }
}
```

Two fields that are easy to get wrong, and that `laya-client.ts` handles explicitly:

1. **The per-option distribution is `probabilities`, not `distribution`.** (`distribution` is
   accepted as a tolerated alias for Jev-shaped proxies.)
2. **`confidence` on a `choice`/`score` answer is `1 - normalised entropy`** — a *concentration*
   measure of the output distribution, **not** a probability of being right. Laya's README is
   explicit that a threshold carried over from Jev does not transfer, and tells clients to gate on
   **`answer_confidence`**, which is the probability of the reported answer and is defined for all
   three question types. We prefer `answer_confidence`, fall back to `confidence`, then to
   `max(probabilities)`.

`GET /health` returns `{"status":"ok","loaded":[...],"revisions":{...},"device":"mps"}`. The
decision layer probes this at most once per 15 s and treats any non-2xx as "not running".

### Label budget

Options share a fixed `head_max_len` token budget (192 on `english`, 256 on `multilingual`). With
short keys that is fine well past 12 options, but it is a hard architectural limit: past ~20
options with a description each, every option gets trimmed and long or similar labels can reach the
model reading the same. Our largest label set is 12 problem ids, so we are comfortably inside it.

## Confidence, and why there is a gate

Laya's own README says plainly that **both shipped checkpoints are over-confident as shipped and
that `laya-multilingual` has no fitted calibration temperatures at all** — and gives the canonical
example: Khmer scores **0.000 accuracy at 0.952 confidence**. The model stays confidently wrong
rather than hedging, so confidence cannot save you.

`@dsa/decision-layer` therefore gates on `MIN_CONFIDENCE` (default `0.35`) and falls back to a
heuristic below it. 0.35 is deliberately low: a weak Laya label is usually still better than a
keyword match, so we only discard answers that are near a coin flip. Retune it per deployment with
`DecisionEngineOptions.minConfidence` against held-out data — it is a policy choice, not a
property of the model.

## Troubleshooting

- **Everything is heuristic and `status` says "not running"** — expected when the sidecar is down.
  Check `${LOGFILE}` (`services/laya/laya.log`) and `LAYA_ENABLED`.
- **First request hangs for a minute or two** — the checkpoint download. Check `HF_HOME`.
- **`MPS backend out of memory`, a hang, or a segfault on a question shape** —
  `LAYA_DEVICE=cpu bash scripts/laya.sh start`. Slower, always correct. Verify with
  `bash scripts/laya.sh status`, which reports the live `device`.
- **No such module: laya** — you ran the system Python. Use
  `services/laya/.venv/bin/python services/laya/smoke.py`, or re-run `scripts/laya.sh setup`.
- **A dependency fails to build on Python 3.13** — Laya's floor is 3.10, so use an older
  interpreter: `uv venv --python 3.12 .venv` (uv is already installed) then re-run setup.
- **401** — `LAYA_API_KEY` is set on the server; export the same value as `LAYA_API_KEY` for the
  client.
- **422** — a malformed question. A `choice` `criteria` sent as an array, or a `score` level
  sent as `null`, are the two we have actually hit.
