'use client'

/**
 * First-visit onboarding tips (Phase 7 UX layer).
 *
 * WHY a dismissible strip on the adventure map and not a tour: a tour teaches
 * the chrome, but the chrome is three buttons; what a new learner needs is
 * permission — wrong moves are free, one sentence always says what to do, and
 * stamps are the whole progression. Three tips say that, then get out of the
 * way forever.
 *
 * WHY localStorage, same as `firstRun.ts`: the decision must survive closing
 * the tab, and Safari private-mode storage failures degrade to "show the tips
 * again", never to a blank screen. Storage is injectable so tests never touch
 * `window`.
 */

export interface OnboardingTip {
  id: string
  title: string
  body: string
}

export const ONBOARDING_TIPS: readonly OnboardingTip[] = [
  {
    id: 'follow-the-sentence',
    title: 'Follow the one sentence',
    body: 'Every board tells you what to do next at the top, in one sentence. The highlighted tiles are the algorithm’s next step — try that operation.',
  },
  {
    id: 'wrong-moves-are-free',
    title: 'Wrong moves are free',
    body: 'Every move is checked by the algorithm’s own rules. A miss explains what the algorithm wanted instead — explore freely, your stamp only needs a win.',
  },
  {
    id: 'stamps-are-progress',
    title: 'Stamps are the whole progression',
    body: 'Winning a mission earns a stamp in Your collection below. Finish a whole world for its badge and map frame. Nothing is ever locked.',
  },
]

const KEY = 'dsa-onboarding-v1'

type PickStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function systemStorage(): PickStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** True when the tips should be shown (never dismissed, or storage unusable). */
export function shouldShowOnboarding(storage: PickStorage | null = systemStorage()): boolean {
  if (!storage) return true
  try {
    return storage.getItem(KEY) !== 'seen'
  } catch {
    return true
  }
}

/** Remember the dismissal. A failure keeps the tips visible — never an error. */
export function dismissOnboarding(storage: PickStorage | null = systemStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(KEY, 'seen')
    return true
  } catch {
    return false
  }
}

/** Lets a learner bring the tips back; used by the map footer link. */
export function resetOnboarding(storage: PickStorage | null = systemStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}
