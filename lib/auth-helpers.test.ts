import { describe, it, expect } from 'vitest'
import { slugify } from './auth-helpers'

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Springfield Soccer Club')).toBe('springfield-soccer-club')
  })
  it('strips special characters', () => {
    expect(slugify('FC Dallas & Austin!')).toBe('fc-dallas-austin')
  })
  it('collapses multiple hyphens', () => {
    expect(slugify('A  B')).toBe('a-b')
  })
})
