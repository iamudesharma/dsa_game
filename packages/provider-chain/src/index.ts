/**
 * `@dsa/provider-chain` — the generative provider chain.
 *
 * Five tiers, tried in order, with a deterministic template as the floor:
 *
 *   1. opencode-go  direct HTTPS to opencode.ai/zen/go, OpenAI-compatible
 *   2. opencode     local `opencode serve` HTTP gateway, else the `opencode` CLI
 *   3. openrouter   OpenAI-compatible chat completions with a strict JSON schema
 *   4. local-llm    offline llama.cpp, grammar-constrained, partially salvageable
 *   5. template     zero I/O, always available, driven entirely by ProblemMeta
 *
 * Every tier is configured from the environment. `.env.example` documents the
 * ones needed for a normal setup; these are the optional extras, all with
 * sensible defaults, read at construction time by `*ConfigFromEnv`:
 *
 *   OPENCODE_GO_API_KEY         falls back to OPENCODE_API_KEY
 *   OPENCODE_GO_BASE_URL        (default https://opencode.ai/zen/go/v1)
 *   OPENCODE_GO_MODEL           empty = resolve from the live GET /models list
 *   OPENCODE_GO_TEMPERATURE     (default 0.9 — variety is the point)
 *   OPENCODE_GO_MAX_TOKENS      (default 4000)
 *   OPENCODE_GO_TIMEOUT_MS      (default 180000)
 *   OPENCODE_AGENT               agent name to pin (default dsa-game-gen)
 *   OPENCODE_PASSWORD            basic-auth password printed by `opencode serve`
 *   OPENCODE_STANDALONE          pass --standalone to the CLI (default 1)
 *   OPENCODE_TIMEOUT_MS          per-transport HTTP budget   (default 45000)
 *   OPENCODE_SUBPROCESS_TIMEOUT_MS  CLI budget               (default 45000)
 *   OPENROUTER_TIMEOUT_MS        (default 40000)
 *   OPENROUTER_TEMPERATURE       (default 0.85 — variety is the point)
 *   OPENROUTER_MAX_TOKENS        (default 2500)
 *   LOCAL_LLM_MODEL              label only; llama-server ignores it
 *   LOCAL_LLM_TIMEOUT_MS         (default 60000)
 *   LOCAL_LLM_TEMPERATURE        (default 0.7)
 *   LOCAL_LLM_MAX_TOKENS         (default 2000 — raise for a 0.5B model)
 *   CHAIN_TIMEOUT_MS             per-tier wall clock in chainGenerateSpec
 *
 * `OPENCODE_STANDALONE` defaults to 1 because the CLI's background service can
 * fail to bootstrap (observed: a 2-minute timeout), while `--standalone` spins up
 * a private server per call and always works.
 */

export type {
  ChainOptions,
  GenerateSpecInput,
  GenerateSpecResult,
  SpecProvider,
} from './types.js'
export { SpecValidationError, isSpecValidationError, errorText } from './types.js'

export { chainGenerateSpec } from './chain.js'

export {
  buildPrompts,
  estimateTokens,
  repairPrompt,
  systemPrompt,
  userPrompt,
} from './prompt.js'

export { jsonSchemaToGbnf, schemaForLlamaCpp, schemaForProblem } from './grammar.js'
export { enforceAllowedMechanics } from './guards.js'

/**
 * The chat transport is deliberately NOT part of the tier chain: it has no
 * structured output to fall back through and exactly one caller (the coach).
 */
export {
  OpenRouterChatTransport,
  OpencodeGoChatTransport,
  approxChatTokens,
  chatConfigFromEnv,
  defaultChatTransport,
  type ChatConfig,
  type ChatMessage,
  type ChatReply,
  type ChatRequest,
  type ChatRole,
  type ChatTransport,
  type OpencodeGoChatConfig,
} from './chat.js'

export { TEMPLATE_THEMES, type ThemeDef } from './themes.js'

export {
  OpencodeGoProvider,
  opencodeGoConfigFromEnv,
  pickPreferredModel,
  type OpencodeGoConfig,
} from './providers/opencode-go.js'

export {
  OpencodeProvider,
  opencodeConfigFromEnv,
  extractAssistantText,
  textFromOpencodeOutput,
  type OpencodeConfig,
} from './providers/opencode.js'

export {
  OpenrouterProvider,
  openrouterConfigFromEnv,
  contentFromChatCompletion,
  type OpenrouterConfig,
} from './providers/openrouter.js'

export {
  LocalLlmProvider,
  localLlmConfigFromEnv,
  salvageSpec,
  type LocalLlmConfig,
} from './providers/local-llm.js'

export {
  TemplateProvider,
  buildTemplateSpec,
  chooseTemplateMechanics,
} from './providers/template.js'

import { LocalLlmProvider } from './providers/local-llm.js'
import { OpencodeGoProvider } from './providers/opencode-go.js'
import { OpencodeProvider } from './providers/opencode.js'
import { OpenrouterProvider } from './providers/openrouter.js'
import { TemplateProvider } from './providers/template.js'
import type { SpecProvider } from './types.js'

/**
 * The canonical tier order, built from the environment.
 *
 * `opencode-go` leads because it is a direct HTTPS call with no local process to
 * install or keep alive; the `opencode serve` tier stays second as a fallback
 * for anyone already running it, and the template stays last because it is the
 * guarantee that the app is always playable.
 *
 * Env is read at call time, not module load, so a caller can construct a fresh
 * chain after mutating `process.env` (and so tests are not order-dependent).
 */
export function defaultChain(): SpecProvider[] {
  return [
    new OpencodeGoProvider(),
    new OpencodeProvider(),
    new OpenrouterProvider(),
    new LocalLlmProvider(),
    new TemplateProvider(),
  ]
}
