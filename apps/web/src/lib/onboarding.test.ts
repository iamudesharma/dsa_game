import { describe, expect, it } from 'vitest'
import { ONBOARDING_TIPS, dismissOnboarding, resetOnboarding, shouldShowOnboarding } from './onboarding'

function storage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
    removeItem: (key: string) => {
      delete values[key]
    },
  }
}

describe('onboarding tips', () => {
  it('ships three short tips with stable ids', () => {
    expect(ONBOARDING_TIPS.length).toBe(3)
    expect(new Set(ONBOARDING_TIPS.map((t) => t.id)).size).toBe(3)
    for (const tip of ONBOARDING_TIPS) {
      expect(tip.title.trim().length).toBeGreaterThan(0)
      expect(tip.body.trim().length).toBeGreaterThan(0)
    }
  })

  it('shows until dismissed, hides after, and comes back on reset', () => {
    const disk = storage()
    expect(shouldShowOnboarding(disk)).toBe(true)
    expect(dismissOnboarding(disk)).toBe(true)
    expect(shouldShowOnboarding(disk)).toBe(false)
    expect(resetOnboarding(disk)).toBe(true)
    expect(shouldShowOnboarding(disk)).toBe(true)
  })

  it('degrades to visible when storage is missing or throws', () => {
    expect(shouldShowOnboarding(null)).toBe(true)
    expect(dismissOnboarding(null)).toBe(false)
    expect(resetOnboarding(null)).toBe(false)
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(shouldShowOnboarding(blocked)).toBe(true)
    expect(dismissOnboarding(blocked)).toBe(false)
    expect(resetOnboarding(blocked)).toBe(false)
  })
})
