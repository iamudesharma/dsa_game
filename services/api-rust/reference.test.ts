import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PROBLEMS, TOPIC_LESSONS } from '@dsa/game-schema'
import { COMPANY_PROFILES } from '@dsa/account'
describe('Rust static data compatibility', () => {
  it('matches the current client/server reference exports', () => {
    const actual = JSON.parse(readFileSync(new URL('./data/reference.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(JSON.parse(JSON.stringify({ problems: PROBLEMS, lessons: TOPIC_LESSONS, companies: COMPANY_PROFILES })))
  })
})
