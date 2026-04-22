import { describe, it, expect } from 'vitest'

describe('project folder route', () => {
  it('exports a PATCH handler', async () => {
    const mod = await import('./route')
    expect(typeof mod.PATCH).toBe('function')
  })
})
