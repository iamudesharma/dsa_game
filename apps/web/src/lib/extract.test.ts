import { describe, expect, it } from 'vitest'
import { assemblePdfLines } from './extract.js'

/**
 * pdfjs returns a flat stream of positioned glyph runs with no newlines, so
 * the line structure the resume parser depends on has to be rebuilt from the
 * y-coordinates. These are the shapes a real resume PDF produces.
 */
describe('assemblePdfLines', () => {
  it('starts a new line when the y-coordinate drops', () => {
    // 720 → 700 → 660 are real line gaps in a 12pt document.
    const items = [
      { str: 'Jane Doe', transform: [1, 0, 0, 1, 72, 720] },
      { str: 'jane@example.com', transform: [1, 0, 0, 1, 200, 700] },
      { str: 'Summary', transform: [1, 0, 0, 1, 72, 660] },
    ]
    expect(assemblePdfLines(items).split('\n')).toEqual([
      'Jane Doe',
      'jane@example.com',
      'Summary',
    ])
  })

  it('joins runs that share a baseline', () => {
    // Two-column contact blocks sit on one baseline and must stay one line.
    const items = [
      { str: 'Berlin', transform: [1, 0, 0, 1, 72, 700] },
      { str: '·', transform: [1, 0, 0, 1, 110, 700] },
      { str: 'jane@example.com', transform: [1, 0, 0, 1, 120, 700] },
    ]
    expect(assemblePdfLines(items)).toBe('Berlin · jane@example.com')
  })

  it('keeps same-line runs on one line', () => {
    const items = [
      { str: 'Senior', transform: [1, 0, 0, 1, 72, 600] },
      { str: 'Engineer,', transform: [1, 0, 0, 1, 110, 600] },
      { str: 'Northwind', transform: [1, 0, 0, 1, 160, 600] },
      { str: 'Labs', transform: [1, 0, 0, 1, 215, 600] },
    ]
    expect(assemblePdfLines(items)).toBe('Senior Engineer, Northwind Labs')
  })

  it('drops blank runs and collapses repeated whitespace', () => {
    const items = [
      { str: 'Skills', transform: [1, 0, 0, 1, 72, 500] },
      { str: '   ', transform: [1, 0, 0, 1, 72, 500] },
      { str: 'Go,', transform: [1, 0, 0, 1, 72, 500] },
      { str: ' Postgres', transform: [1, 0, 0, 1, 100, 500] },
    ]
    expect(assemblePdfLines(items)).toBe('Skills Go, Postgres')
  })

  it('survives items with no transform at all', () => {
    expect(assemblePdfLines([{ str: 'Plain' }, { str: 'text' }])).toBe('Plain text')
  })

  it('returns empty for an empty stream', () => {
    expect(assemblePdfLines([])).toBe('')
  })
})
