import { describe, it, expect } from 'vitest'

describe('audio route', () => {
  it('exports a GET handler', async () => {
    const mod = await import('./route')
    expect(typeof mod.GET).toBe('function')
  })
})
