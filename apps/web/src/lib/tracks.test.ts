import { describe, expect, it } from 'vitest'
import { PROBLEM_IDS, PROBLEMS } from '@dsa/game-schema'
import { TRACKS, getTrack, trackItemDone, trackProgress } from './tracks'

const KNOWN = new Set(PROBLEM_IDS)

describe('curated tracks', () => {
  it('ships the interview classics and the full tour', () => {
    expect(TRACKS.map((t) => t.id)).toEqual(['interview-classics', 'full-tour'])
    expect(getTrack('interview-classics')?.title).toBe('Interview Classics')
    expect(getTrack('nope')).toBeUndefined()
  })

  it('only maps to real catalogue problems', () => {
    for (const track of TRACKS) {
      for (const category of track.categories) {
        expect(category.title.trim().length).toBeGreaterThan(0)
        expect(category.items.length).toBeGreaterThan(0)
        for (const item of category.items) {
          expect(item.name.trim().length).toBeGreaterThan(0)
          for (const id of item.playIds) {
            expect(KNOWN.has(id), `${track.id}/${item.name} maps to unknown ${id}`).toBe(true)
          }
        }
      }
    }
  })

  it('derives the full tour from the catalogue, covering every problem once', () => {
    const tour = getTrack('full-tour')!
    const mapped = tour.categories.flatMap((c) => c.items.flatMap((i) => [...i.playIds]))
    expect([...mapped].sort()).toEqual([...PROBLEM_IDS].sort())
  })

  it('scores progress from stamped games only', () => {
    expect(trackItemDone([], {})).toBe(false)
    expect(trackItemDone(['two-sum'], {})).toBe(false)
    expect(trackItemDone(['two-sum'], { 'two-sum': '2026-01-01' })).toBe(true)
    expect(trackItemDone(['two-sum', 'binary-search'], { 'two-sum': '2026-01-01' })).toBe(false)
  })

  it('reports done/playable/total per track', () => {
    const classics = getTrack('interview-classics')!
    const empty = trackProgress(classics, {})
    expect(empty.done).toBe(0)
    expect(empty.playable).toBeGreaterThan(40)
    expect(empty.total).toBeGreaterThanOrEqual(empty.playable)
    const totalItems = classics.categories.reduce((sum, c) => sum + c.items.length, 0)
    expect(empty.total).toBe(totalItems)
    const partial = trackProgress(classics, { 'two-sum': 'x', 'valid-parentheses': 'y', 'binary-search': 'z' })
    expect(partial.done).toBeGreaterThanOrEqual(3)
  })

  it('keeps LeetCode numbers unique within the classics track', () => {
    const classics = getTrack('interview-classics')!
    const numbers = classics.categories.flatMap((c) => c.items.map((i) => i.n))
    expect(numbers.every((n) => n > 0)).toBe(true)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('covers a majority of the classics with playable games', () => {
    const classics = getTrack('interview-classics')!
    const { playable, total } = trackProgress(classics, {})
    expect(playable / total).toBeGreaterThan(0.5)
  })
})
