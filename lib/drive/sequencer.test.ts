import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  pickEvenly,
  mergeChronological,
  collectImagesUnder,
  resolveSubfolderId,
} from './sequencer'

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

describe('collectImagesUnder', () => {
  afterEach(() => vi.unstubAllGlobals())

  function makeListResponse(files: unknown[]) {
    return { ok: true, json: () => Promise.resolve({ files }) }
  }

  function img(id: string) {
    return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', modifiedTime: '2026-01-01T00:00:00Z' }
  }

  function folder(id: string, name: string) {
    return { id, name, mimeType: 'application/vnd.google-apps.folder' }
  }

  it('returns images from a single folder', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse([img('a'), img('b')]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await collectImagesUnder('root', 'tok')
    expect(result.map((f) => f.id)).toEqual(['a', 'b'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recurses into subfolders', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse([folder('sub', 'spring'), img('a')]))
      .mockResolvedValueOnce(makeListResponse([img('b'), img('c')]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await collectImagesUnder('root', 'tok')
    expect(result.map((f) => f.id).sort()).toEqual(['a', 'b', 'c'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('terminates on cycles via seenFolders', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse([folder('sub', 'a'), img('a')]))
      .mockResolvedValueOnce(makeListResponse([folder('root', 'root'), img('b')]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await collectImagesUnder('root', 'tok')
    expect(result.map((f) => f.id).sort()).toEqual(['a', 'b'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns empty for an empty folder', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeListResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    expect(await collectImagesUnder('root', 'tok')).toEqual([])
  })

  it('throws on Drive API error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('boom') })
    vi.stubGlobal('fetch', fetchMock)

    await expect(collectImagesUnder('root', 'tok')).rejects.toThrow(/Drive list failed/)
  })
})

describe('resolveSubfolderId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the subfolder id when found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [{ id: 'sub1' }] }),
    }))

    expect(await resolveSubfolderId('parent', 'Lucas', 'tok')).toBe('sub1')
  })

  it('returns null when no folder matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    }))

    expect(await resolveSubfolderId('parent', 'Lucas', 'tok')).toBeNull()
  })

  it('throws on Drive API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve('forbidden'),
    }))

    await expect(resolveSubfolderId('parent', 'Lucas', 'tok')).rejects.toThrow(/Drive folder lookup failed/)
  })
})
