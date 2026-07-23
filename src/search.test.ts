import { describe, expect, it } from 'vitest'
import { compileSearchMatcher, findSearchMatchRanges, matchesSearchText } from './search'

describe('search matcher', () => {
  it('matches literal text with optional case sensitivity', () => {
    const insensitive = compileSearchMatcher('fatal', { matchCase: false })
    expect(matchesSearchText('FATAL EXCEPTION', insensitive, 'fatal exception')).toBe(true)

    const sensitive = compileSearchMatcher('fatal', { matchCase: true })
    expect(matchesSearchText('FATAL EXCEPTION', sensitive)).toBe(false)
  })

  it('requires whole word boundaries when enabled', () => {
    const matcher = compileSearchMatcher('art', { wholeWords: true })

    expect(matchesSearchText('art runtime', matcher, 'art runtime')).toBe(true)
    expect(matchesSearchText('start runtime', matcher, 'start runtime')).toBe(false)
  })

  it('supports regex matching and highlight ranges', () => {
    const matcher = compileSearchMatcher('io_[a-z]+', { regex: true })

    expect(matchesSearchText('tag io_stats is active', matcher)).toBe(true)
    expect(findSearchMatchRanges('tag io_stats is active', matcher)).toEqual([{ start: 4, end: 12 }])
  })

  it('treats invalid regex patterns as non-matching', () => {
    const matcher = compileSearchMatcher('[', { regex: true })

    expect(matcher.error).toBeTruthy()
    expect(matchesSearchText('anything', matcher)).toBe(false)
    expect(findSearchMatchRanges('anything', matcher)).toEqual([])
  })
})
