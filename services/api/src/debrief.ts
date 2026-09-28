/**
 * Composes a `DebriefResponse`: the post-game teaching payload.
 *
 * Three independent sources are merged here, and it is worth being explicit
 * about who owns what:
 *   - the ORACLE owns truth: answer, canonical trace, pseudocode, code, complexity
 *   - the ENGINE owns accounting: stats, optimisation score, code-line highlights
 *   - the SPEC (LLM) owns prose: summary, action meanings, metaphor mapping
 *   - the DECISION LAYER (Laya) owns the misconception tag, best-effort
 */

import type {
  DebriefResponse,
  MappingRow,
  ProviderTier,
  DebriefResponse as Debrief,
} from '@dsa/game-schema'
import type { GameSpec, GameState, TraceFrame } from '@dsa/game-schema'
import type { Oracle } from '@dsa/game-schema'
import {
  mistakeSummary,
  optimisationScore,
  traceCodeHighlights,
  mapGameActionToCode,
} from '@dsa/game-engine'
import { tagMisconceptionDetailed } from '@dsa/decision-layer'
import type { MisconceptionLabel } from '@dsa/decision-layer'

export interface BuildDebriefInput {
  spec: GameSpec
  state: GameState
  oracle: Oracle
  usedTier: ProviderTier
}

export async function buildDebrief(input: BuildDebriefInput): Promise<Debrief> {
  const { spec, state, oracle } = input

  const playedTrace: TraceFrame[] = state.trace
  const canonicalTrace = safeCanonicalTrace(oracle, state, playedTrace)

  const stats = {
    steps: state.progress.steps,
    mistakes: state.progress.mistakes,
    hintsUsed: state.progress.hintsUsed,
    mistakesByMechanic: state.progress.mistakesByMechanic,
  }

  const score = optimisationScore(playedTrace, canonicalTrace)

  // Tagging a misconception from a mistake histogram is arithmetic, not
  // judgement, so it is done deterministically. Laya's multilingual checkpoint
  // measures barely above chance on this shape of task (0.352 argmax vs 0.318
  // random on its own typed-decisions benchmark) and ships without fitted
  // calibration temperatures, so sending it here would add latency and a
  // wrong-label risk for no gain.
  const tag = tagMisconceptionDetailed(playedTrace)

  const mapping = mergeMappings(spec.debrief.mapping, mapGameActionToCode(playedTrace))

  return {
    problemId: spec.problemId,
    phase: state.phase === 'won' ? 'won' : 'lost',
    playedTrace,
    canonicalTrace,
    answer: safeAnswer(oracle, state),
    pseudocode: oracle.pseudocode(),
    code: {
      javascript: oracle.code('javascript'),
      python: oracle.code('python'),
      typescript: oracle.code('typescript'),
    },
    complexity: oracle.complexity(),
    summary: composeSummary(spec, score, tag.label),
    actionMeaning: spec.debrief.actionMeaning,
    mapping,
    stats: {
      ...stats,
      misconception: tag.label,
      confidence: tag.totalMistakes === 0 ? 1 : tag.count / tag.totalMistakes,
    },
    hintPool: spec.narration.hintPool,
  }
}

/**
 * Lines the player actually executed, useful for highlighting in the code
 * view. Kept out of the wire type for now but exposed via a helper so the
 * client can derive it from the trace if it prefers.
 */
export function highlightsFor(debrief: Debrief): number[] {
  return traceCodeHighlights(debrief.playedTrace)
}

function composeSummary(
  spec: GameSpec,
  score: { score: number; ratio: number; note: string },
  misconception: MisconceptionLabel,
): string {
  const parts = [spec.debrief.summary, score.note]
  if (misconception !== 'no-mistakes') {
    parts.push(`A pattern we noticed: ${misconception.replace(/-/g, ' ')}.`)
  }
  return parts.filter(Boolean).join(' ')
}

/**
 * Merge the spec's themed mapping with the engine's neutral fallback rows.
 *
 * The spec's rows win: they are the ones written in the game's own vocabulary
 * ("pitch" -> "one array element"). The engine may only add a row for a
 * mechanic the generator did not already describe, otherwise the player sees the
 * same operation twice — once in theme, once in flat generic English.
 */
function mergeMappings(
  specRows: readonly (readonly [string, string])[] | MappingRow[],
  engineRows: { gameTerm: string; algorithmTerm: string }[],
): MappingRow[] {
  const out: MappingRow[] = []
  const seenGame = new Set<string>()

  for (const row of specRows) {
    const [gameTerm, algorithmTerm] = row as readonly [string, string]
    if (!gameTerm || !algorithmTerm) continue
    const key = gameTerm.toLowerCase()
    if (seenGame.has(key)) continue
    seenGame.add(key)
    out.push({ gameTerm, algorithmTerm })
  }

  // Only add an engine row when the themed table says nothing about it. A rough
  // overlap check is enough here: the themed rows are authored per problem, so
  // if any of their algorithm terms shares a head word with this mechanic, the
  // generator already covered it.
  const themedAlgorithmText = out.map((r) => r.algorithmTerm.toLowerCase()).join(' | ')
  for (const row of engineRows) {
    if (out.length >= 10) break
    if (!row.gameTerm || !row.algorithmTerm) continue
    const head = (row.algorithmTerm.toLowerCase().split(' ')[0] ?? '').replace(/[^a-z]/g, '')
    if (head.length >= 4 && themedAlgorithmText.includes(head)) continue
    const key = row.gameTerm.toLowerCase()
    if (seenGame.has(key)) continue
    seenGame.add(key)
    out.push({ gameTerm: row.gameTerm, algorithmTerm: row.algorithmTerm })
  }

  return out.slice(0, 12)
}

function safeCanonicalTrace(
  oracle: Oracle,
  state: GameState,
  played: TraceFrame[],
): TraceFrame[] {
  try {
    const frames = oracle.canonicalTrace(state, played)
    return Array.isArray(frames) ? frames : []
  } catch {
    // A broken oracle should degrade the bonus view, not the whole debrief.
    return []
  }
}

function safeAnswer(oracle: Oracle, state: GameState) {
  try {
    return oracle.answerSummary(state)
  } catch {
    return { text: 'unavailable', value: null, details: [] }
  }
}
