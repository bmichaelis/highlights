import { describe, it, expect } from 'vitest'

describe('thumbnail file route', () => {
  it('exports a GET handler', async () => {
    const mod = await import('./route')
    expect(typeof mod.GET).toBe('function')
  })
})
