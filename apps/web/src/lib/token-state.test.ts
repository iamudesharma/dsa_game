import { expect, it } from 'vitest'
import { displayTokenState, tokenIsInert } from './token-state'
it('keeps a held, scanned value available to compare', () => {
  expect(displayTokenState({ id:'v1', kind:'number', label:'1', state:'eliminated' }, true)).toBe('selected')
  expect(tokenIsInert('selected', 'array-max-min')).toBe(false)
})
it('allows fixed comparison targets without unlocking unavailable pieces', () => {
  expect(displayTokenState({ id:'zero', kind:'target', label:'zero', state:'locked' }, false)).toBe('idle')
  expect(displayTokenState({ id:'v1', kind:'number', label:'1', state:'locked' }, false)).toBe('locked')
  expect(tokenIsInert('locked', 'move-zeroes')).toBe(true)
})
it('keeps discarded binary-search values disabled', () => {
  expect(tokenIsInert('eliminated', 'binary-search')).toBe(true)
  expect(tokenIsInert('eliminated', 'array-max-min')).toBe(false)
})
