'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { GameSpec, GameState, TraceFrame } from '@dsa/game-schema'
import { Button } from '@/components/ui/Button'
import { buildReplayModel, rolesForFrame, type ReplayRole } from '@/lib/replay'
import { cn } from '@/lib/format'

/**
 * The replay.
 *
 * There is no per-frame data snapshot in the contract, only pointers, so the
 * replay is a pointer visualiser: the full board is derived once, and each frame
 * lights up exactly what `pointers` says the algorithm was looking at. Play /
 * pause / step / scrub, and the same model is reused for the side-by-side
 * canonical comparison.
 *
 * `prefers-reduced-motion` is honoured twice: `useReducedMotion()` disables the
 * transition, and autoplay is *off* by default when the user asks for less
 * motion, because a self-advancing animation is exactly the thing that setting
 * is meant to suppress.
 */

const ROLE_STYLE: Record<ReplayRole, { ring: string; label: string }> = {
  current: { ring: 'border-[var(--dsa-accent)] ring-2 ring-[color:var(--dsa-accent)]', label: 'current' },
  compare: { ring: 'border-[var(--dsa-primary)] bg-[color-mix(in_oklab,var(--dsa-primary)_20%,transparent)]', label: 'compare' },
  eliminated: { ring: 'opacity-40 grayscale line-through border-[var(--dsa-border)]', label: 'eliminated' },
  swapped: { ring: 'border-[var(--dsa-success)] bg-[color-mix(in_oklab,var(--dsa-success)_20%,transparent)]', label: 'swapped' },
  read: { ring: 'border-[var(--dsa-accent)] border-dashed', label: 'read' },
}

export interface ReplayPlayerProps {
  frames: TraceFrame[]
  state: GameState
  spec: GameSpec
  title: string
  subtitle?: string
  /** Play/pause/step controls are hidden for the small canonical strip. */
  compact?: boolean
}

export function ReplayPlayer({ frames, state, spec, title, subtitle, compact = false }: ReplayPlayerProps) {
  const reduceMotion = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const model = useMemo(() => buildReplayModel(frames, state), [frames, state])
  const frame = frames[Math.min(index, Math.max(0, frames.length - 1))] ?? null
  const roles = useMemo(() => (frame ? rolesForFrame(frame, model) : {}), [frame, model])

  useEffect(() => {
    if (!playing || frames.length === 0) return
    if (index >= frames.length - 1) {
      setPlaying(false)
      return
    }
    // Reduced motion: do not self-advance. The user steps manually instead.
    if (reduceMotion) {
      setPlaying(false)
      return
    }
    timer.current = setTimeout(() => setIndex((i) => Math.min(i + 1, frames.length - 1)), 900 / speed)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [playing, index, frames.length, speed, reduceMotion])

  const step = useCallback(
    (delta: number) => {
      setPlaying(false)
      setIndex((i) => Math.min(Math.max(0, i + delta), Math.max(0, frames.length - 1)))
    },
    [frames.length],
  )

  if (frames.length === 0) {
    return (
      <div className="panel p-4">
        <h3 className="text-sm font-semibold text-[var(--dsa-ink)]">{title}</h3>
        <p className="mt-1 text-sm text-[var(--dsa-ink-faint)]">No frames were recorded for this run.</p>
      </div>
    )
  }

  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--dsa-ink)] uppercase">{title}</h3>
          {subtitle && <p className="mt-1 text-xs text-[var(--dsa-muted)]">{subtitle}</p>}
        </div>
        {!compact && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (index >= frames.length - 1) setIndex(0)
                setPlaying((p) => !p)
              }}
              aria-label={playing ? 'Pause replay' : 'Play replay'}
            >
              {playing ? '⏸ Pause' : index >= frames.length - 1 ? '↺ Replay' : '▶ Play'}
            </Button>
            <Button size="sm" disabled={index === 0} onClick={() => step(-1)} aria-label="Previous step">
              ◀
            </Button>
            <Button
              size="sm"
              disabled={index >= frames.length - 1}
              onClick={() => step(1)}
              aria-label="Next step"
            >
              ▶
            </Button>
            <select
              className="input !w-auto !py-1 text-xs"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              aria-label="Replay speed"
            >
              {[0.5, 1, 2].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* The board cells. `key` on the wrapper restarts the transition when the
          frame changes so a swap visibly moves. */}
      <div className="board-scroll -mx-1 mt-3 px-1 pb-1">
        <div className="flex min-w-max items-stretch gap-1.5">
          {model.cells.map((cell) => {
            const cellRoles = roles[cell.id] ?? []
            const primary = cellRoles[0] as ReplayRole | undefined
            return (
              <div
                key={cell.id}
                className={cn(
                  'relative flex min-h-14 min-w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--dsa-border)] px-2 py-1.5',
                  primary ? ROLE_STYLE[primary].ring : '',
                )}
              >
                <span className="mono text-[0.6rem] text-[var(--dsa-ink-faint)]">
                  {cell.slotIndex !== undefined ? cell.slotIndex : cell.index}
                </span>
                <span className="mono text-xs font-semibold text-[var(--dsa-ink)]">{cell.label}</span>
                {cellRoles.length > 0 && (
                  <span className="mono text-[0.55rem] text-[var(--dsa-accent)]">{cellRoles.join(' ')}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={index}
          onChange={(e) => {
            setPlaying(false)
            setIndex(Number(e.target.value))
          }}
          className="h-1 flex-1 cursor-pointer appearance-none rounded bg-[var(--dsa-border)] accent-[var(--dsa-accent)]"
          aria-label="Replay position"
        />
        <span className="mono text-xs text-[var(--dsa-muted)]">
          {index + 1} / {frames.length}
        </span>
      </div>

      <AnimatePresence mode="wait">
        {frame && (
          <motion.div
            key={frame.index}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mt-3 space-y-2"
          >
            <p className="text-sm text-[var(--dsa-ink)]">
              {frame.correct ? (
                <span className="text-[var(--dsa-success)]">✓ </span>
              ) : (
                <span className="text-[var(--dsa-danger)]">✕ </span>
              )}
              {frame.note}
            </p>
            <p className="mono text-[0.65rem] text-[var(--dsa-ink-faint)]">
              step {frame.index} · {frame.dsaOp} · line {frame.codeLine}
            </p>
            {frame.codeLineText && (
              <pre className="mono overflow-x-auto rounded-lg border border-[var(--dsa-border)] bg-[color-mix(in_oklab,#020617_50%,transparent)] p-2 text-[0.65rem] text-[var(--dsa-ink-muted)]">
                {frame.codeLineText.trim()}
              </pre>
            )}
            {Object.keys(frame.variables).length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {Object.entries(frame.variables)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, value]) => (
                    <li key={name} className="chip !py-0 text-[0.6rem]">
                      <span className="mono text-[var(--dsa-ink-faint)]">{name}</span>
                      <span className="mono text-[var(--dsa-ink)]">{value === null ? 'null' : String(value)}</span>
                    </li>
                  ))}
              </ul>
            )}
            <p className="text-[0.65rem] text-[var(--dsa-ink-faint)]">
              Board tinted by each frame&apos;s pointers. {spec.visual.boardLabel ?? 'The board'} had{' '}
              <span className="mono">{state.instance.values.length}</span> positions.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
