import { describe, it, expect } from 'vitest'

describe('team route', () => {
  it('exports PATCH and DELETE handlers', async () => {
    const mod = await import('./route')
    expect(typeof mod.PATCH).toBe('function')
    expect(typeof mod.DELETE).toBe('function')
  })
})
