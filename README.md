# DSA Game

Learn DSA algorithms by **playing generated mini-games** instead of solving coding problems.

An LLM writes the *theme*; a deterministic engine owns the *truth*. The player
makes moves that are literally algorithm operations, and afterwards sees their
own moves replayed against the real algorithm and its code.

---

## The one idea that makes this work

There are three sources of truth, strictly separated:

| Concern | Owner | Never consulted for |
|---|---|---|
| **Truth** — is this move correct, is the game won, the canonical trace, the code | hand-written deterministic **oracle** (`packages/dsa-oracles`) | anything generative |
| **Presentation** — theme, story, labels, narration | **generative LLM** (`packages/provider-chain`) | correctness, answers, code |
| **Fast local micro-decisions** — routing, hint choice, difficulty, misconception tagging | **Laya** (`packages/decision-layer`) | anything generative |

Consequences:

- The LLM can only fill **text slots** and pick from a **fixed mechanics enum**
  (`selectObject`, `moveObject`, `comparePair`, `swapPair`, `pushPop`,
  `choosePath`, `traverseNode`, `connectNodes`, `assignValue`, `submitAnswer`).
  `GameSpecSchema` is `strict()`, so an over-eager `correct: true` is rejected.
- **The app cannot break.** If every LLM tier is down, a deterministic
  `template` tier still produces a fully playable game.
- **Both clients share one implementation of correctness.** The algorithm logic
  lives in the API service; the Next.js app and the Flutter app are
  presentation-only clients.

> **On Laya:** it is *not* a text generator. It is a non-autoregressive
> decision engine that answers `choice` / `score` / `noul` in one forward pass.
> It is therefore never used to author games — only to make fast local
> classification decisions. See `services/laya/README.md`.

---

## Layout

```
packages/
  game-schema/     Zod schemas, Action union, mechanics catalog, Oracle interface, wire types
  game-engine/     deterministic runtime: apply/undo/hints/telemetry
  dsa-oracles/     one reference algorithm per DSA problem  <- all truth lives here
  provider-chain/  4 generation tiers: opencode -> openrouter -> local qwen -> template
  decision-layer/  Laya client + deterministic heuristics
services/
  api/             Hono HTTP API (the only thing the clients talk to)
  laya/            python venv + laya-serve sidecar
  local-llm/       llama.cpp + Qwen2.5-0.5B-Instruct sidecar
apps/
  web/             Next.js client
  mobile/          Flutter client
```

## User flow

```
Select DSA -> Choose problem -> Generate game -> Play -> Algorithm visualisation
           -> Explanation -> Code -> Retry with new game
```

A new **seed** produces both new data and a new theme, which is what makes
"Retry with New Game" work even with no LLM available.

---

## Running it

```bash
pnpm install

# api + web
bash scripts/dev.sh

# add the local model sidecars (see the memory note below)
bash scripts/dev.sh --with-laya
bash scripts/dev.sh --with-llm
```

Sidecar setup happens once:

```bash
bash scripts/laya.sh setup      # python venv + laya[serve]
bash scripts/local-llm.sh download && bash scripts/local-llm.sh start
```

Copy `.env.example` to `.env.local` and add `OPENROUTER_API_KEY`.

## Memory reality (M1 / 8 GB)

This is the binding constraint on this machine, so the two model sidecars are
**opt-in**:

- **Laya** is pinned to `laya-multilingual` (mmBERT-base, 322M — the smallest
  checkpoint) with no preload and `device=mps`.
- **Qwen2.5-0.5B-Instruct Q4_K_M** is ~0.5 GB resident.

The app is fully playable with **neither** running: tier 1 is your existing
opencode auth, tier 2 is OpenRouter, and tier 4 is the built-in template.

## Testing

```bash
pnpm test              # vitest across all packages
pnpm typecheck
```

The oracle tests are the important ones: they check generated games against
brute-force ground truth, so a broken oracle fails loudly rather than quietly
teaching the wrong thing.
