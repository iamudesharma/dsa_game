'use client'

/**
 * First-run scaffolding, gated on `localStorage`.
 *
 * WHY localStorage and not a settings page: a worked example is only useful
 * BEFORE the first attempt, and a learner who has to go and find a switch has
 * already lost the moment. So the demonstration is offered inline, once per
 * problem, and remembered forever after. The key is per-problem rather than
 * global, so working through binary search does not suppress the introduction to
 * bubble sort.
 *
 * WHY it is not the session store: the game store is `sessionStorage` (a game
 * is a short private session), and this decision has to survive closing the tab.
 *
 * Every access is wrapped: Safari in private mode throws on `localStorage`
 * access, and a storage failure must degrade to "show the demo again", never to
 * a blank screen.
 */

const KEY = 'dsa-watched-v1'

function readStore(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function writeStore(value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, value)
  } catch {
    /* Storage unavailable (private mode, quota). Offering the demo again is a
       far better failure than a crash. */
  }
}

function parse(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/** True when this learner has never been shown the demo for this problem. */
export function shouldOfferWatchOneStep(problemId: string): boolean {
  if (!problemId) return false
  return !parse(readStore()).includes(problemId)
}

/**
 * Remember that the demo ran. Called when the demonstration STARTS, not when it
 * ends, so dismissing it half way through does not bring it back next session.
 */
export function markWatchOneStepSeen(problemId: string): void {
  if (!problemId) return
  const seen = parse(readStore())
  if (seen.includes(problemId)) return
  writeStore(JSON.stringify([...seen, problemId]))
}

/** Lets a learner replay the introduction without resetting anything else. */
export function forgetWatchOneStep(problemId: string): void {
  writeStore(JSON.stringify(parse(readStore()).filter((id) => id !== problemId)))
}
