import { describe, it, expect } from 'vitest'
import { pickEvenly, mergeChronological } from './sequencer'

describe('pickEvenly', () => {
  it('returns all items when count >= available', () => {
    const items = [{ date: 1 }, { date: 2 }, { date: 3 }]
    expect(pickEvenly(items, 5)).toHaveLength(3)
  })

  it('picks first, last and evenly distributed items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((date) => ({ date }))
    const picked = pickEvenly(items, 4)
    expect(picked).toHaveLength(4)
    expect(picked[0].date).toBe(1)
    expect(picked[1].date).toBe(4)
    expect(picked[2].date).toBe(7)
    expect(picked[picked.length - 1].date).toBe(10)
  })

  it('returns empty array for empty input', () => {
    expect(pickEvenly([], 4)).toEqual([])
  })
})

describe('mergeChronological', () => {
  it('merges and sorts items from multiple players by date', () => {
    const playerImages = [
      [{ playerId: 'a', date: 3 }, { playerId: 'a', date: 1 }],
      [{ playerId: 'b', date: 2 }, { playerId: 'b', date: 4 }],
    ]
    const result = mergeChronological(playerImages)
    expect(result.map((x) => x.date)).toEqual([1, 2, 3, 4])
  })

  it('handles players with no images', () => {
    expect(mergeChronological([[], [{ playerId: 'a', date: 1 }]])).toHaveLength(1)
  })
})
