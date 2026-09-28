'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  Action,
  ActionOutcome,
  DebriefResponse,
  Difficulty,
  GamePhase,
  GameSpec,
  GameState,
  MechanicId,
  PlayerFeedback,
  ProviderAttempt,
  ProviderTier,
  TurnPrompt,
} from '@dsa/game-schema'

import { DsaApiError, isDsaApiError, postAction, postGenerate, postHint } from '@/lib/api'
import { mechanicForAction } from '@/lib/contract'
import { asFeedback, fallbackTurnPrompt } from '@/lib/guidance'

/**
 * One store for the whole play session.
 *
 * WHY sessionStorage persistence: the API has no "get game by id" endpoint
 * (`GET /api/catalogue` is the only GET besides health), so a hard reload or a
 * pasted `/play/<id>` link cannot be rehydrated from the server. Keeping the
 * last session in `sessionStorage` means refresh, back/forward, and the
 * play -> debrief navigation all work in the same tab; a genuinely cold visit
 * renders an explicit "not loaded in this tab" recovery screen instead of
 * pretending.
 *
 * The persisted slice is deliberately plain JSON: no functions, no class
 * instances, no `DsaApiError` (errors are re-derived, never persisted).
 */

export interface RevealedHint {
  hint: string
  source: 'laya' | 'heuristic'
  confidence?: number
}

export type StorePhase = 'idle' | 'generating' | 'playing' | 'won' | 'lost'

/** Remembered so "Play a new version" can re-issue the same request. */
export interface GenerateIntent {
  problemId: string
  difficulty?: Difficulty
  freeText?: string
  /** Set when the round was restarted with the same seed (the "undo"). */
  seed?: number
}

interface PersistedSlice {
  gameId: string | null
  problemId: string | null
  spec: GameSpec | null
  state: GameState | null
  outcome: ActionOutcome | null
  debrief: DebriefResponse | null
  usedTier: ProviderTier | null
  attempts: ProviderAttempt[]
  notes: string[]
  hints: RevealedHint[]
  activeMechanicId: MechanicId | null
  lastIntent: GenerateIntent | null
  /** Round the player is on, used to key the transition to the debrief. */
  round: number
  /**
   * The oracle-derived "what to do next". Persisted because a reload must not
   * land the learner on a board with no instruction.
   *
   * Nullable on purpose: an older API build does not send it, and rather than
   * let the play screen invent an instruction the store records `null` and
   * `turnPromptOrFallback` derives a state-only one at read time.
   */
  turnPrompt: TurnPrompt | null
  /** Explanatory feedback for the last action, same nullable-when-absent story. */
  feedback: PlayerFeedback | null
}

interface TransientSlice {
  phase: StorePhase
  busy: boolean
  generating: boolean
  error: DsaApiError | null
  /** Monotonic guard so a slow response cannot clobber a newer one. */
  requestSeq: number
}

export interface GameStore extends PersistedSlice, TransientSlice {
  hydrateFromGenerate: (payload: {
    gameId: string
    spec: GameSpec
    state: GameState
    usedTier: ProviderTier
    attempts: ProviderAttempt[]
    notes: string[]
    intent: GenerateIntent
    /** Absent on an API build that predates the guidance contract. */
    turnPrompt?: TurnPrompt | null
  }) => void
  /** Adopt a debrief fetched from the server, for a cold deep link. */
  setDebrief: (debrief: DebriefResponse) => void
  /** Restore a game from the server, for a cold deep link with no session state. */
  hydrateFromServer: (game: {
    gameId: string
    problemId: string
    seed: number
    spec: GameSpec
    state: GameState
    usedTier: ProviderTier
  }) => void
  generate: (intent: GenerateIntent, options?: { newSeed?: boolean }) => Promise<string | null>
  dispatch: (action: Action) => Promise<ActionOutcome | null>
  requestHint: () => Promise<void>
  /** Restarts the round from the same seed. This is the honest "undo". */
  restartSameSeed: () => Promise<string | null>
  setActiveMechanic: (id: MechanicId) => void
  clearError: () => void
  reset: () => void
}

function phaseFromState(state: GameState | null): StorePhase {
  if (!state) return 'idle'
  return state.phase
}

const EMPTY_PERSISTED: PersistedSlice = {
  gameId: null,
  problemId: null,
  spec: null,
  state: null,
  outcome: null,
  debrief: null,
  usedTier: null,
  attempts: [],
  notes: [],
  hints: [],
  activeMechanicId: null,
  lastIntent: null,
  round: 0,
  turnPrompt: null,
  feedback: null,
}

function toApiError(cause: unknown): DsaApiError {
  if (isDsaApiError(cause)) return cause
  return new DsaApiError({
    kind: 'unknown',
    code: 'UNEXPECTED',
    message: cause instanceof Error ? cause.message : 'Something went wrong.',
    retryable: true,
  })
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      ...EMPTY_PERSISTED,
      phase: 'idle',
      busy: false,
      generating: false,
      error: null,
      requestSeq: 0,

      clearError: () => set({ error: null }),

      reset: () => set({ ...EMPTY_PERSISTED, phase: 'idle', busy: false, generating: false, error: null }),

      setActiveMechanic: (id) => set({ activeMechanicId: id }),

      /** Adopt a debrief fetched from the server (cold deep link). */
      setDebrief: (debrief) => set({ debrief }),

      /**
       * Restore a game the server already knows about.
       *
       * sessionStorage covers refresh and back/forward, but not a pasted or
       * bookmarked `/play/<id>` link opened in a cold tab. The server holds the
       * authoritative spec and state, so one GET brings the game back instead of
       * telling the player to regenerate it.
       */
      hydrateFromServer: (game) =>
        set((prev) =>
          prev.gameId === game.gameId && prev.state && !prev.busy && !prev.generating
            ? prev
            : {
                gameId: game.gameId,
                problemId: game.problemId,
                seed: game.seed,
                spec: game.spec,
                state: game.state,
                usedTier: game.usedTier,
                outcome: null,
                debrief: null,
                hints: [],
                error: null,
                phase: phaseFromState(game.state),
                busy: false,
                generating: false,
                requestSeq: prev.requestSeq,
                // A restored game has no live prompt, so the play screen falls
                // back to the state-derived one until the first action.
                turnPrompt: null,
                feedback: null,
              },
        ),

      hydrateFromGenerate: (payload) =>
        set((prev) => ({
          gameId: payload.gameId,
          problemId: payload.spec.problemId,
          spec: payload.spec,
          state: payload.state,
          outcome: null,
          feedback: null,
          debrief: null,
          usedTier: payload.usedTier,
          attempts: payload.attempts,
          notes: payload.notes,
          hints: [],
          // The last intent keeps the seed so an undo is one call away.
          lastIntent: payload.intent,
          activeMechanicId: prev.activeMechanicId ?? payload.spec.mechanics[0]?.id ?? null,
          phase: phaseFromState(payload.state),
          busy: false,
          generating: false,
          error: null,
          round: prev.round + 1,
          turnPrompt: payload.turnPrompt ?? null,
        })),

      /**
       * `POST /api/generate`.
       *
       * When `intent.seed` is present the server replays that exact seed, which
       * yields the identical instance. That is how we implement "undo": reset
       * the round server-side rather than faking a local state rollback, because
       * the server's trace is authoritative and a local-only restore would leave
       * the two out of sync.
       *
       * `newSeed: true` drops the seed, which is the "Play a new version of this
       * game" button: fresh data, fresh theme.
       */
      generate: async (intent, options) => {
        const seq = get().requestSeq + 1
        set({ requestSeq: seq, generating: true, busy: true, error: null, phase: 'generating' })
        const body = {
          problemId: intent.problemId,
          ...(options?.newSeed ? {} : intent.seed !== undefined ? { seed: intent.seed } : {}),
          ...(intent.difficulty ? { difficulty: intent.difficulty } : {}),
          ...(intent.freeText ? { freeText: intent.freeText } : {}),
        }
        try {
          const res = await postGenerate(body)
          if (get().requestSeq !== seq) return null
          get().hydrateFromGenerate({
            gameId: res.gameId,
            spec: res.spec,
            state: res.state,
            usedTier: res.usedTier,
            attempts: res.attempts,
            notes: res.notes,
            intent: { ...intent, seed: res.seed },
            turnPrompt: res.turnPrompt,
          })
          return res.gameId
        } catch (cause) {
          if (get().requestSeq !== seq) return null
          const error = toApiError(cause)
          set((prev) => ({ error, busy: false, generating: false, phase: prev.state ? prev.phase : 'idle' }))
          return null
        }
      },

      restartSameSeed: async () => {
        const { lastIntent, generating } = get()
        if (!lastIntent || generating) return null
        // Re-posting the same seed is a full server-side reset of the round.
        return get().generate({ ...lastIntent, seed: lastIntent.seed })
      },

      dispatch: async (action) => {
        const { gameId, busy, requestSeq, state, spec } = get()
        if (!gameId || busy) return null
        const seq = requestSeq + 1
        set({ requestSeq: seq, busy: true, error: null })
        try {
          const res = await postAction(gameId, action)
          if (get().requestSeq !== seq) return null
          set((prev) => ({
            state: res.state,
            outcome: res.outcome,
            // Explanatory feedback always reaches the screen. If the server
            // predates the guidance contract, derive it from the outcome it did
            // send rather than dropping to a bare "correct".
            feedback:
              spec && res.outcome
                ? asFeedback(res.feedback, res.outcome, res.state, spec)
                : (res.feedback ?? prev.feedback),
            turnPrompt: res.turnPrompt ?? null,
            debrief: res.debrief ?? prev.debrief,
            usedTier: res.usedTier,
            phase: phaseFromState(res.state),
            busy: false,
            // If the engine corrected us, jump the player to the renderer that
            // can express the expected action instead of making them hunt.
            activeMechanicId:
              !res.outcome.correct && res.outcome.expected?.type
                ? mechanicForAction(res.outcome.expected as Action)
                : prev.activeMechanicId,
          }))
          return res.outcome
        } catch (cause) {
          if (get().requestSeq !== seq) return null
          set({ error: toApiError(cause), busy: false })
          return null
        }
      },

      requestHint: async () => {
        const { gameId, busy } = get()
        if (!gameId || busy) return
        set({ busy: true, error: null })
        try {
          const res = await postHint(gameId)
          set((prev) => ({
            busy: false,
            hints: [...prev.hints, { hint: res.hint, source: res.source, confidence: res.confidence }],
          }))
        } catch (cause) {
          set({ error: toApiError(cause), busy: false })
        }
      },
    }),
    {
      name: 'dsa-game-session',
      version: 1,
      // sessionStorage, not localStorage: a game is a short, private session and
      // two tabs playing different games should not fight over one slot.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (store): PersistedSlice => ({
        gameId: store.gameId,
        problemId: store.problemId,
        spec: store.spec,
        state: store.state,
        outcome: store.outcome,
        debrief: store.debrief,
        usedTier: store.usedTier,
        attempts: store.attempts,
        notes: store.notes,
        hints: store.hints,
        activeMechanicId: store.activeMechanicId,
        lastIntent: store.lastIntent,
        round: store.round,
        turnPrompt: store.turnPrompt,
        feedback: store.feedback,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // `generating`/`busy` are never persisted; a reload always lands idle.
        state.phase = phaseFromState(state.state)
        state.busy = false
        state.generating = false
        state.error = null
      },
    },
  ),
)

/** Convenience selector: the binding for the mechanic the player is on. */
export function useActiveBinding(): GameSpec['mechanics'][number] | null {
  const spec = useGameStore((s) => s.spec)
  const active = useGameStore((s) => s.activeMechanicId)
  if (!spec) return null
  return spec.mechanics.find((m) => m.id === active) ?? spec.mechanics[0] ?? null
}

/**
 * The prompt to render, guaranteed non-null once a game is loaded.
 *
 * `TurnPrompt` is the contract's answer to "what do I do next" and the play
 * screen is built around it, so it must never be absent while a game is in play.
 * When the server did not send one (an older build, or a game restored from a
 * cold deep link where no action has been taken yet) this derives one from state
 * facts alone — never from a guess about the answer.
 */
export function useTurnPrompt(): TurnPrompt | null {
  const turnPrompt = useGameStore((s) => s.turnPrompt)
  const state = useGameStore((s) => s.state)
  const spec = useGameStore((s) => s.spec)
  if (!state || !spec) return null
  if (turnPrompt) return turnPrompt
  return fallbackTurnPrompt(state, spec)
}
