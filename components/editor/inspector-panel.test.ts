import { describe, it, expect } from 'vitest'
import { formatMMSS, parseMMSS } from './inspector-panel'

describe('formatMMSS', () => {
  it('formats 0 as "0:00.0"', () => {
    expect(formatMMSS(0)).toBe('0:00.0')
  })

  it('formats sub-minute values with leading zero in seconds', () => {
    expect(formatMMSS(12)).toBe('0:12.0')
    expect(formatMMSS(5.5)).toBe('0:05.5')
  })

  it('formats values over a minute', () => {
    expect(formatMMSS(65.5)).toBe('1:05.5')
  })

  it('formats values over an hour without rolling over to hours', () => {
    expect(formatMMSS(3661)).toBe('61:01.0')
  })
})

describe('parseMMSS', () => {
  it('parses plain seconds with decimals', () => {
    expect(parseMMSS('12.0')).toBe(12)
    expect(parseMMSS('5.5')).toBe(5.5)
  })

  it('parses M:SS.S format', () => {
    expect(parseMMSS('0:12.0')).toBe(12)
    expect(parseMMSS('1:05.5')).toBe(65.5)
  })

  it('returns null on garbage input', () => {
    expect(parseMMSS('garbage')).toBeNull()
    expect(parseMMSS('')).toBeNull()
    expect(parseMMSS(':12')).toBeNull()
    expect(parseMMSS('1:')).toBeNull()
  })

  it('returns null when seconds component is >= 60', () => {
    expect(parseMMSS('1:60')).toBeNull()
    expect(parseMMSS('0:99.9')).toBeNull()
  })

  it('returns null on negative values', () => {
    expect(parseMMSS('-5')).toBeNull()
  })
})
