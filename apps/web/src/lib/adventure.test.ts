import { describe, expect, it } from 'vitest'
import { PROBLEMS } from '@dsa/game-schema'
import { completedWorlds, freshProgress, nextMission, readProgress, recordCompletion, saveProgress, PROGRESS_KEY } from './adventure'
const time = '2026-09-29T10:00:00.000Z'
const won = { problemId: 'array-max-min', phase: 'won' }
function storage(values: Record<string, string> = {}) { return { getItem: (key: string) => values[key] ?? null, setItem: (key: string, value: string) => { values[key] = value } } }
describe('adventure rewards', () => {
  it('awards once and preserves the first completion time across replay', () => {
    const first = recordCompletion(freshProgress(), won, time)
    expect(recordCompletion(first, won, '2026-10-01T10:00:00Z')).toBe(first)
    const disk = storage(); saveProgress(disk, first)
    expect(recordCompletion(readProgress(disk).progress, won).completed).toEqual({ 'array-max-min': time })
  })
  it('never rewards playing, lost, or unknown missions', () => {
    for (const state of [{ ...won, phase: 'playing' }, { ...won, phase: 'lost' }, { ...won, problemId: 'invented' }]) expect(recordCompletion(freshProgress(), state).completed).toEqual({})
  })
  it('unlocks a world only after all its missions, independently of difficulty or hints', () => {
    let progress = freshProgress()
    const missions = PROBLEMS.filter(p => p.topic === 'arrays')
    for (const mission of missions.slice(0,-1)) progress = recordCompletion(progress, { problemId: mission.id, phase: 'won' }, time)
    expect(completedWorlds(progress)).toHaveLength(0)
    progress = recordCompletion(progress, { problemId: missions.at(-1)!.id, phase: 'won' }, time)
    expect(completedWorlds(progress).map(w => w.id)).toEqual(['arrays'])
    expect(nextMission(progress)?.topic).toBe('sorting')
  })
  it('imports linked-list markers once without changing draft keys', () => {
    const values = { 'play-the-algorithms:linked-list-solved:v1': '["count-nodes","reverse-list"]', draft: 'my code' }
    const disk = storage(values)
    const result = readProgress(disk, time)
    expect(Object.keys(result.progress.completed)).toEqual(['linked-list-traversal','reverse-linked-list'])
    saveProgress(disk, result.progress)
    expect(readProgress(disk).progress).toEqual(result.progress)
    expect(values.draft).toBe('my code')
  })
  it('recovers corrupt data and rejects unearned cosmetic frames', () => {
    expect(readProgress(storage({ [PROGRESS_KEY]: '{bad' })).warning).toBe(true)
    const progress = freshProgress(); progress.preferences.mapFrame = 'arrays'
    expect(readProgress(storage({ [PROGRESS_KEY]: JSON.stringify(progress) })).progress.preferences.mapFrame).toBe('default')
  })
  it('degrades gracefully when browser storage is blocked', () => {
    const blocked = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('quota') } }
    expect(readProgress(blocked).warning).toBe(true)
    expect(saveProgress(blocked, freshProgress())).toBe(false)
  })
})
