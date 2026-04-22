import { describe, it, expect } from 'vitest'

describe('GET /drive/folders', () => {
  it('exports a GET handler', async () => {
    const mod = await import('./route')
    expect(typeof mod.GET).toBe('function')
  })
})
