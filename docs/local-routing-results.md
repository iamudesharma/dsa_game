# Local router measurements — 3 October 2026

**Selected candidate: MiniLM L3 INT8.** It passed the local memory and latency
criteria and achieved the best held-out hybrid routing accuracy in this comparison.
Semantic routing remains opt-in; deterministic rules are the default.

| Backend | Held-out accuracy | Incremental steady RSS | p95 routing latency |
|---|---:|---:|---:|
| Rules | 55.7% | 17 MB | 2.9 ms |
| MiniLM L6 INT8 | 73.8% | 156 MB | 6.7 ms |
| **MiniLM L3 INT8** | **77.0%** | **197 MB** | **5.3 ms** |
| XtremeDistil INT8 | 55.7% | 176 MB | 185 ms |
| DeBERTa xsmall INT8 | 59.0% | 283 MB | 1,032 ms |
| Laya typed-decisions, MPS | 55.7% | See below | 253 ms |

MiniLM L3 was chosen over L6 for accuracy, even though L6 happened to have lower
steady RSS in the stack run. XtremeDistil's tiny weights did not translate to
acceptable end-to-end latency or accuracy across 45 problem choices. DeBERTa
missed both resource targets. Do not infer runtime memory from download size.

Laya was evaluated separately after checkpoint loading. macOS `vmmap` reported
2.6 GB physical footprint and a 3.7 GB peak. Its approximately 106 MB `ps` RSS
excluded substantial Metal/shared allocations and must not be used as its total
memory figure. The measured checkpoint revision was
`55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851` on MPS. A prior download warmup hit its
180-second deadline; the actual comparison ran after the checkpoint finished
loading. These results do not equate its workflow benchmark to DSA quality.

## Method and limits

The 8 GB arm64 Mac ran Node 22.23.2, the API, and a Next development server with
its home page compiled. Each encoder was evaluated in a separate Node process;
Laya was stopped before those stack measurements. ONNX used two CPU threads and
four-example prototype batches. Native memory measurements fluctuate with memory
pressure; the measured Node processes' physical footprints were also recorded.

There were 61 development and 61 separately worded held-out requests covering all
45 playable problems, theme and provider intents, typos, negation, related
algorithms and unrelated input. Model prototype examples were not the test
fixtures. Thresholds were chosen only on development requests. MiniLM L3 selected
minimum similarity **0.35** and top-two margin **0.03**; its development accuracy
was 80.3%. The held-out figure is 47 correct results out of 61, including fallback
rules. It fell back on 27.9% of held-out requests and accepted eight wrong model
choices. Similarity is not a probability of correctness.

Examples of remaining errors include distinguishing reversal from traversal,
fixed-window sum from target pair sum, and rotated search from ordinary binary
search. This is a small engineering acceptance set; broader real-user evaluation
is needed before claiming a general accuracy winner. No custom training was done.

Local cache loading took about 309 ms for MiniLM L3; first inference including
prototype preparation took about 210 ms. Warm p95 was 5.3 ms. These timings exclude
model download and are not cloud generation or chat timings. The isolated worker
and 500 ms deadline keep local classification bounded, with rules during loading,
concurrent inference, uncertainty or failure.

A [frozen machine-readable summary](../packages/decision-layer/evaluation/measured-results.json)
records the comparisons. Reproduce with the commands in
[local routing](local-routing.md); full reports, scores and failure requests are
in `services/api/.dev/router-benchmarks` on this checkout.

## Integration validation

- TypeScript checks and web production build passed.
- Full suite: 828 passed, two live-provider tests skipped; final targeted checks
  passed after diagnostic changes.
- Flutter: 14 contract/router tests passed; analysis of changed models and their
  new test found no issues.
- Live local API: neutral health showed the loaded MiniLM L3; problem and theme
  selections returned `semantic` with `cosine-similarity`; exact problem-ID
  suggestions bypassed inference; template generation created a playing game.
- Provider tests verified request/session preservation, preferred provider order,
  cancellation, cooldown, fallback before output and no switching after a delta.

No authenticated cloud generation/chat runs or browser gameplay flows were
performed in this change. Intent accuracy alone does not prove better provider
mapping, so provider preference remains unchanged.
