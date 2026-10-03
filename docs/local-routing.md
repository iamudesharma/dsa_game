# Small local routing

The default for a new setup is deterministic rules. `DECISION_BACKEND=semantic`
enables one locally cached encoder, while `DECISION_BACKEND=laya` selects the
existing Laya sidecar. Existing explicit `LAYA_*` configuration remains compatible
when the new backend setting is absent.

The local model selects a problem, visual theme, or request intent. Difficulty,
hints, misconception evidence, game correctness, and mastery remain deterministic.
Generation and chat keep the existing provider preference. Request intent is
advisory until an evaluated provider mapping exists; recent provider failures are
bypassed for 15 seconds. Generation retains schema repair and template fallback.
Chat can fail over before output, but never after streaming a nonempty delta.

## Prepare and evaluate

Run from the repository root:

```sh
pnpm router:prepare minilm-l6
pnpm router:prepare minilm-l3
pnpm router:prepare xtremedistil
pnpm router:prepare deberta-xsmall
pnpm router:benchmark all
```

Preparation explicitly downloads tokenizer/configuration files and the selected
quantized ONNX artifact at its pinned Hugging Face revision. Runtime initialization
only reads the cache, never downloads on an HTTP request. The default cache is
`<repository>/.cache/dsa-router` regardless of the API's working directory; set
`DECISION_CACHE_DIR` to an absolute path to relocate it. No HF credential is needed
for the public candidates.

Models are benchmarked in separate processes, not simultaneously. Outputs live
in `services/api/.dev/router-benchmarks`. Each report includes the fixture hash,
revision, development-tuned thresholds, held-out accuracy and macro-F1, accepted
wrong choices, fallback frequency, failures, cold loading, first inference,
p95 latency, process memory, and macOS physical footprint when available. Selection excludes stale fixture hashes.

The fixture set includes every currently registered playable problem, separately
worded development/test requests, theme/intent requests, typos, negation,
overlapping algorithms and unrelated requests. It is a small engineering
acceptance set, not proof of general model quality. Examples used as embedding
prototypes are separate from these test requests.

See [measured results](local-routing-results.md) for the selected candidate and proof limits.

The semantic score is the maximum cosine similarity to an option's example
embeddings. A result must clear both a minimum score and the margin over the
runner-up. `confidence` is retained for compatibility; `scoreKind` identifies
similarity or uncalibrated classifier probability. No embedding score is
represented as a calibrated probability or invented distribution.

A single worker loads one model, with two ONNX CPU threads, four-example embedding
batches and a bounded prototype cache. There is one in-flight request. Other
requests immediately use rules. A 500 ms deadline terminates hung inference and
opens a 15-second cooldown. Missing assets, failed initialization, uncertain
matches and unsupported choices all fall back. Exact problem IDs/titles bypass
inference; suggestions only contain registered playable problems.

## Laya comparison

The adapter benchmarks the existing service without substituting heuristics and
calling that a model result. Start it separately with the existing setup script;
allow its first checkpoint load to finish. Its process RSS and macOS physical footprint are recorded separately
when `run/laya/laya.pid` exists. API authentication and a remote service can be
configured through the existing `LAYA_*` variables; remote memory cannot be
measured from this machine.

Laya's upstream 76.6% accuracy is for four workflows represented in its fine-tuning
benchmark, not DSA routing. Its option token budget also matters now that this
application has 45 problems. Do not compare that published number directly to
these held-out app results.

## Enabling a measured candidate

Use `selection.json` and the measured results summary before setting:

```dotenv
DECISION_BACKEND=semantic
DECISION_CANDIDATE=minilm-l3
DECISION_MIN_SCORE=0.35
DECISION_MIN_MARGIN=0.03
```

These are MiniLM L3's development-tuned defaults from the measured evaluation.
Check held-out failure cases before enabling semantic routing. Candidate overrides do not reuse another model's thresholds
automatically. Requirements are at least the rules baseline, within one percentage
point of the best measured pretrained candidate, at most 250 MB incremental steady
RSS, and at most 100 ms warm p95 latency. Rules remain the default if no candidate
qualifies. Any custom training is a separate follow-up, not part of this change.

For deployment, prepare assets before starting the API, check neutral `decision`
health alongside legacy `laya` health, then verify suggest/generate/chat flows.
Do not start Laya and the local encoder together to judge an 8 GB memory budget.
