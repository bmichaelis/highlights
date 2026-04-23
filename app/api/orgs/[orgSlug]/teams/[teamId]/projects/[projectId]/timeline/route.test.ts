import { describe, it, expect } from 'vitest'

describe('timeline route', () => {
  it('exports GET and PUT handlers', async () => {
    const mod = await import('./route')
    expect(typeof mod.GET).toBe('function')
    expect(typeof mod.PUT).toBe('function')
  })
})
