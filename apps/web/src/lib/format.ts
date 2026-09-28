import { clsx, type ClassValue } from 'clsx'
import type { Variables } from '@dsa/game-schema'

export function cn(...values: ClassValue[]): string {
  return clsx(values)
}

/** Sorted key order keeps a variable grid from jittering between renders. */
export function orderedVariableEntries(variables: Variables): [string, Variables[string]][] {
  return Object.entries(variables).sort(([a], [b]) => a.localeCompare(b))
}

export function formatDuration(uptimeSec: number): string {
  if (!Number.isFinite(uptimeSec) || uptimeSec < 0) return '—'
  if (uptimeSec < 60) return `${Math.round(uptimeSec)}s`
  const minutes = Math.floor(uptimeSec / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(uptimeSec % 60)}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
