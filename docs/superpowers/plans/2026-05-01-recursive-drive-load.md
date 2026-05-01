# Recursive Drive Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Walk player subfolders recursively to find images at any depth; recognize a `misc` folder (case-insensitive) at the top level as a special player with no image cap; replace the deterministic round-robin sequencer with a random sequencer that avoids same-regular-player adjacency.

**Architecture:** Three new pure helpers in `lib/drive/` — `partitionTopLevel` (split top-level folders into players + misc), `collectImagesUnder` (BFS recursive image collector), `interleaveRandom` (random sequencer with adjacency rule). `buildPlaylist` is rewritten to use them. The two route callers (POST `/projects`, PATCH `/playlist` resequence) are updated to pass the misc-aware `name` field through and to partition top-level folders. No schema changes; no DB migration.

**Tech Stack:** TypeScript, Vitest (`npm test`), Drizzle / D1, Drive API v3 (`files.list`).

---

## Note on testing

The spec called for a `buildPlaylist` integration test that mocks `fetch` to exercise the entire flow end-to-end. I'm deferring that test in the plan: `buildPlaylist` after rewrite is a thin orchestrator over four tested units (`partitionTopLevel`, `collectImagesUnder`, `pickEvenly`, `interleaveRandom`). An integration test would re-test what the unit tests already cover, plus add ~50 lines of mock-listing setup. Coverage on the orchestration itself is delivered by the manual verification step in Task 5. If you'd rather have the integration test in the plan, push back and I'll add a Task 4.5 with the mock fixture.

---

## File Map

| File | Change |
|------|--------|
| `lib/drive/scanner.ts` | Add `partitionTopLevel(folders)` |
| `lib/drive/scanner.test.ts` | Add `partitionTopLevel` tests |
| `lib/drive/sequencer.ts` | Add `collectImagesUnder`, `resolveSubfolderId`, `interleaveRandom`, `shuffle`; rewrite `buildPlaylist`; remove `fetchPlayerImages` and `mergeInterspersed` |
| `lib/drive/sequencer.test.ts` | Drop `mergeInterspersed` test (function deleted); add tests for new helpers and `buildPlaylist` |
| `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts` | POST: partition top-level folders; insert misc player with `name='misc'`; include `name` in `buildPlaylist` projection |
| `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts` | PATCH (resequence): include `name` in `buildPlaylist` projection (the existing query already returns it; just verify) |

---

### Task 1: Add `partitionTopLevel` to scanner

**Files:**
- Modify: `lib/drive/scanner.ts`
- Modify: `lib/drive/scanner.test.ts`

Pure function that splits a list of top-level folders into regular players and an optional misc folder. Case-insensitive match on the literal name `misc`.

- [ ] **Step 1: Write the failing tests**

In `lib/drive/scanner.test.ts`, add a new `describe` block at the bottom:

```ts
import { parseDriveFiles, pickAudioFiles, partitionTopLevel } from './scanner'

// ... existing describes for parseDriveFiles, pickAudioFiles ...

describe('partitionTopLevel', () => {
  it('returns all folders as players when no misc folder is present', () => {
    const folders = [
      { id: '1', name: 'Lucas' },
      { id: '2', name: 'Mia' },
    ]
    expect(partitionTopLevel(folders)).toEqual({
      players: [{ id: '1', name: 'Lucas' }, { id: '2', name: 'Mia' }],
      misc: null,
    })
  })

  it('extracts a misc folder (lowercase) into the misc slot', () => {
    const folders = [
      { id: '1', name: 'Lucas' },
      { id: '2', name: 'misc' },
      { id: '3', name: 'Mia' },
    ]
    const { players, misc } = partitionTopLevel(folders)
    expect(players).toEqual([
      { id: '1', name: 'Lucas' },
      { id: '3', name: 'Mia' },
    ])
    expect(misc).toEqual({ id: '2', name: 'misc' })
  })

  it('matches misc case-insensitively', () => {
    for (const variant of ['Misc', 'MISC', 'mISC', 'MiSc']) {
      const folders = [{ id: '1', name: 'Lucas' }, { id: '2', name: variant }]
      const { players, misc } = partitionTopLevel(folders)
      expect(players).toEqual([{ id: '1', name: 'Lucas' }])
      expect(misc).toEqual({ id: '2', name: variant })
    }
  })

  it('uses the last-encountered match when multiple folders look like misc', () => {
    const folders = [
      { id: '1', name: 'misc' },
      { id: '2', name: 'Misc' },
      { id: '3', name: 'MISC' },
    ]
    const { players, misc } = partitionTopLevel(folders)
    expect(players).toEqual([])
    expect(misc).toEqual({ id: '3', name: 'MISC' })
  })

  it('returns empty players and null misc for empty input', () => {
    expect(partitionTopLevel([])).toEqual({ players: [], misc: null })
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test
```

Expected: 5 failing tests in `partitionTopLevel` because the function doesn't exist yet. Existing tests pass.

- [ ] **Step 3: Implement the helper**

In `lib/drive/scanner.ts`, add at the bottom:

```ts
// Multiple folders can match `misc` (e.g., `misc/` and `Misc/`); the
// last-encountered match wins. Drive's enumeration order is not specified,
// so this is a simple "use whichever Drive listed last" rule.
export function partitionTopLevel(folders: { id: string; name: string }[]) {
  const players: typeof folders = []
  let misc: typeof folders[number] | null = null
  for (const f of folders) {
    if (f.name.toLowerCase() === 'misc') misc = f
    else players.push(f)
  }
  return { players, misc }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

Expected: all tests pass; new ones go green.

- [ ] **Step 5: Commit**

```bash
git add lib/drive/scanner.ts lib/drive/scanner.test.ts
git commit -m "feat(drive): partition top-level folders into players + misc"
```

---

### Task 2: Add `collectImagesUnder` and `resolveSubfolderId`

**Files:**
- Modify: `lib/drive/sequencer.ts`
- Modify: `lib/drive/sequencer.test.ts`

Two new helper functions in `sequencer.ts`. `collectImagesUnder` does a BFS traversal of a folder tree, returning all images. `resolveSubfolderId` looks up a subfolder by name within a parent folder. Tests use `vi.stubGlobal('fetch', ...)` to mock the Drive API.

- [ ] **Step 1: Write the failing tests**

In `lib/drive/sequencer.test.ts`, replace the entire file with:

```ts
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
    // root contains a subfolder that "contains" root again (Drive shortcut loop)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse([folder('sub', 'a'), img('a')]))
      .mockResolvedValueOnce(makeListResponse([folder('root', 'root'), img('b')]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await collectImagesUnder('root', 'tok')
    expect(result.map((f) => f.id).sort()).toEqual(['a', 'b'])
    expect(fetchMock).toHaveBeenCalledTimes(2) // root + sub; not re-entered
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
```

The existing `pickEvenly` and `mergeChronological` tests are preserved verbatim.

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test
```

Expected: ~9 failing tests in the new `collectImagesUnder` and `resolveSubfolderId` describes. Existing tests still pass (their imports continue to work).

- [ ] **Step 3: Add the new helpers to `sequencer.ts`**

In `lib/drive/sequencer.ts`, add these helpers alongside the existing exports (don't remove anything yet — `fetchPlayerImages` and `mergeInterspersed` get removed in Task 4):

```ts
type DriveListEntry = {
  id: string
  name: string
  mimeType: string
  thumbnailLink?: string
  imageMediaMetadata?: { time?: string }
  modifiedTime?: string
}

export async function collectImagesUnder(
  rootFolderId: string,
  accessToken: string,
): Promise<DriveImageFile[]> {
  const all: DriveImageFile[] = []
  const queue: string[] = [rootFolderId]
  const seenFolders = new Set<string>()

  while (queue.length > 0) {
    const folderId = queue.shift()!
    if (seenFolders.has(folderId)) continue
    seenFolders.add(folderId)

    const fields = 'files(id,name,mimeType,thumbnailLink,imageMediaMetadata(time),modifiedTime)'
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) throw new Error(`Drive list failed: ${await res.text()}`)
    const { files } = await res.json() as { files?: DriveListEntry[] }
    for (const f of files ?? []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        queue.push(f.id)
      } else if (f.mimeType.startsWith('image/')) {
        all.push({
          id: f.id,
          name: f.name,
          thumbnailLink: f.thumbnailLink,
          imageMediaMetadata: f.imageMediaMetadata,
          modifiedTime: f.modifiedTime ?? new Date(0).toISOString(),
        })
      }
    }
  }
  return all
}

export async function resolveSubfolderId(
  parentFolderId: string,
  folderName: string,
  accessToken: string,
): Promise<string | null> {
  const q = encodeURIComponent(
    `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`Drive folder lookup failed: ${await res.text()}`)
  const { files } = await res.json() as { files?: { id: string }[] }
  return files?.[0]?.id ?? null
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/drive/sequencer.ts lib/drive/sequencer.test.ts
git commit -m "feat(drive): add collectImagesUnder and resolveSubfolderId helpers"
```

---

### Task 3: Add `interleaveRandom` and `shuffle`

**Files:**
- Modify: `lib/drive/sequencer.ts`
- Modify: `lib/drive/sequencer.test.ts`

Random sequencer with the no-adjacent-same-regular-player rule. Property tests run 100 iterations using `Math.random`; one deterministic test injects a fixed RNG.

- [ ] **Step 1: Write the failing tests**

In `lib/drive/sequencer.test.ts`, add a new `describe` block at the bottom:

```ts
import { interleaveRandom } from './sequencer'

describe('interleaveRandom', () => {
  type Img = { playerId: string; idx: number }
  const img = (playerId: string, idx: number): Img => ({ playerId, idx })

  function buildScenario(perPlayer: number[], miscIndex: number | null = null) {
    const lists: Img[][] = []
    const players: { id: string; isMisc: boolean }[] = []
    for (let p = 0; p < perPlayer.length; p++) {
      const id = `p${p}`
      const isMisc = p === miscIndex
      lists.push(Array.from({ length: perPlayer[p] }, (_, i) => img(id, i)))
      players.push({ id, isMisc })
    }
    return { lists, players }
  }

  function totalCount(lists: unknown[][]) {
    return lists.reduce((n, l) => n + l.length, 0)
  }

  it('preserves length over 100 random runs', () => {
    const { lists, players } = buildScenario([3, 4, 5])
    const expected = totalCount(lists)
    for (let i = 0; i < 100; i++) {
      expect(interleaveRandom(lists.map((l) => [...l]), players)).toHaveLength(expected)
    }
  })

  it('preserves the multiset of items', () => {
    const { lists, players } = buildScenario([3, 4, 5])
    const flat = lists.flat()
    for (let i = 0; i < 100; i++) {
      const out = interleaveRandom(lists.map((l) => [...l]), players)
      expect(out).toHaveLength(flat.length)
      // Same set of items (compare by stringification of {playerId, idx} pair)
      const inKeys = flat.map((x) => `${x.playerId}:${x.idx}`).sort()
      const outKeys = out.map((x) => `${x.playerId}:${x.idx}`).sort()
      expect(outKeys).toEqual(inKeys)
    }
  })

  it('never places two regular players adjacent (when avoidable)', () => {
    const { lists, players } = buildScenario([4, 4, 4]) // 3 regular players, 4 each
    for (let trial = 0; trial < 100; trial++) {
      const out = interleaveRandom(lists.map((l) => [...l]), players)
      for (let i = 1; i < out.length; i++) {
        const prev = out[i - 1]
        const curr = out[i]
        const prevIsMisc = players.find((p) => p.id === prev.playerId)?.isMisc ?? false
        const currIsMisc = players.find((p) => p.id === curr.playerId)?.isMisc ?? false
        if (!prevIsMisc && !currIsMisc) {
          expect(prev.playerId).not.toBe(curr.playerId)
        }
      }
    }
  })

  it('allows misc-misc adjacency when misc dominates', () => {
    // 1 regular player × 4 + misc × 20 → misc-misc adjacency unavoidable
    const { lists, players } = buildScenario([4, 20], /* miscIndex */ 1)
    for (let trial = 0; trial < 50; trial++) {
      // Should complete without throwing
      const out = interleaveRandom(lists.map((l) => [...l]), players)
      expect(out).toHaveLength(24)
    }
  })

  it('accepts forced regular-player repeats when only one player has photos left', () => {
    // Scenarios where adjacency is unavoidable for regular players too
    const { lists, players } = buildScenario([1, 5]) // p1 has 5; p0 has 1; trailing four p1 are forced same-player
    for (let trial = 0; trial < 50; trial++) {
      const out = interleaveRandom(lists.map((l) => [...l]), players)
      expect(out).toHaveLength(6)
    }
  })

  it('is deterministic when a fixed RNG is injected', () => {
    const { lists, players } = buildScenario([2, 2])
    // Always pick the first eligible queue
    const fixed = () => 0
    const a = interleaveRandom(lists.map((l) => [...l]), players, fixed)
    const b = interleaveRandom(lists.map((l) => [...l]), players, fixed)
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test
```

Expected: 6 failing tests in `interleaveRandom`. Existing tests pass.

- [ ] **Step 3: Implement `interleaveRandom` and `shuffle`**

In `lib/drive/sequencer.ts`, add at the end of the file:

```ts
type SeqPlayer = { id: string; isMisc: boolean }

function shuffle<T>(arr: T[], random: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function interleaveRandom<T>(
  perPlayerLists: T[][],
  players: SeqPlayer[],
  random: () => number = Math.random,
): T[] {
  const queues = perPlayerLists.map((list) => shuffle([...list], random))
  const result: T[] = []
  let lastPlayerId: string | null = null
  let lastWasMisc = false

  while (queues.some((q) => q.length > 0)) {
    const eligible: number[] = []
    for (let i = 0; i < queues.length; i++) {
      if (queues[i].length === 0) continue
      // Same-regular-player adjacency conflict — skip unless it's misc OR the previous item was misc
      const conflict = !lastWasMisc && !players[i].isMisc && players[i].id === lastPlayerId
      if (!conflict) eligible.push(i)
    }
    const pool = eligible.length > 0
      ? eligible
      : queues.map((_, i) => i).filter((i) => queues[i].length > 0)

    const chosen = pool[Math.floor(random() * pool.length)]
    result.push(queues[chosen].shift()!)
    lastPlayerId = players[chosen].id
    lastWasMisc = players[chosen].isMisc
  }
  return result
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/drive/sequencer.ts lib/drive/sequencer.test.ts
git commit -m "feat(drive): add interleaveRandom sequencer with player adjacency rule"
```

---

### Task 4: Rewrite `buildPlaylist`, update routes, remove old helpers

**Files:**
- Modify: `lib/drive/sequencer.ts`
- Modify: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts`
- Modify: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts`

This is the integration commit. `buildPlaylist`'s signature changes (adds `name` to the player projection); both call sites must update simultaneously to keep the build green. `fetchPlayerImages` and `mergeInterspersed` are removed in the same commit.

- [ ] **Step 1: Rewrite `buildPlaylist` and remove old helpers in `sequencer.ts`**

In `lib/drive/sequencer.ts`:

1. **Remove** the existing `fetchPlayerImages` function entirely.
2. **Remove** the existing `mergeInterspersed` function entirely.
3. **Replace** the existing `buildPlaylist` function with the version below:

```ts
export async function buildPlaylist(
  players: { id: string; folderName: string; name: string }[],
  parentFolderId: string,
  accessToken: string,
  imagesPerPlayer: number,
): Promise<ImageCandidate[]> {
  const allImages = await Promise.all(
    players.map(async (p) => {
      const folder = await resolveSubfolderId(parentFolderId, p.folderName, accessToken)
      if (!folder) return []
      const isMisc = p.name === 'misc'
      const images = await collectImagesUnder(folder, accessToken)
      const deduped = Array.from(new Map(images.map((i) => [i.id, i])).values())
      const candidates: ImageCandidate[] = deduped.map((f) => ({
        driveFileId: f.id,
        playerId: p.id,
        thumbnailUrl: f.thumbnailLink ?? null,
        date: f.imageMediaMetadata?.time
          ? new Date(f.imageMediaMetadata.time).getTime()
          : new Date(f.modifiedTime).getTime(),
      }))
      return isMisc ? candidates : pickEvenly(candidates, imagesPerPlayer)
    })
  )
  const seqPlayers = players.map((p) => ({ id: p.id, isMisc: p.name === 'misc' }))
  return interleaveRandom(allImages, seqPlayers)
}
```

The `DriveImageFile` type referenced earlier should already exist (from Task 2 — `collectImagesUnder` returns these). If the existing code defined a slightly different `DriveImageFile`, keep your definition consistent across the file.

- [ ] **Step 2: Update POST `/projects` route**

In `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts`:

First, add `partitionTopLevel` to the import:

```ts
import { listFolderContents, parseDriveFiles, partitionTopLevel } from '@/lib/drive/scanner'
```

Then, locate the block where `folderItems` is computed (around line 60):

```ts
    const accessToken = await getFreshAccessToken(conn, db)
    const files = await listFolderContents(folderId.trim(), accessToken)
    const folderItems = parseDriveFiles(files)
```

Replace it with:

```ts
    const accessToken = await getFreshAccessToken(conn, db)
    const files = await listFolderContents(folderId.trim(), accessToken)
    const allFolders = parseDriveFiles(files)
    const { players: playerFolders, misc: miscFolder } = partitionTopLevel(allFolders)
    const folderItems = miscFolder ? [...playerFolders, miscFolder] : playerFolders
```

Then locate the `db.insert(players)` block (around lines 65–73):

```ts
      const newPlayers: { id: string; projectId: string; name: string; folderName: string }[] = []
      for (let i = 0; i < folderItems.length; i += 20) {
        const chunk = await db.insert(players).values(
          folderItems.slice(i, i + 20).map((f) => ({ projectId: project.id, name: f.name, folderName: f.name }))
        ).returning()
        newPlayers.push(...chunk)
      }
```

Replace with:

```ts
      const newPlayers: { id: string; projectId: string; name: string; folderName: string }[] = []
      for (let i = 0; i < folderItems.length; i += 20) {
        const chunk = await db.insert(players).values(
          folderItems.slice(i, i + 20).map((f) => ({
            projectId: project.id,
            name: f === miscFolder ? 'misc' : f.name,
            folderName: f.name,
          }))
        ).returning()
        newPlayers.push(...chunk)
      }
```

The `buildPlaylist(newPlayers, ...)` call below already gets `name` because `players.returning()` returns the full row. No further change needed there.

- [ ] **Step 3: Verify PATCH `/playlist` resequence route**

In `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts`, locate the resequence branch (around line 87 — the block starting with `if (body.type === 'resequence')`).

The existing query is:

```ts
    const projectPlayers = await db.query.players.findMany({ where: eq(players.projectId, projectId) })
```

`db.query.players.findMany` returns the full row by default — including `name` and `folderName`. Confirm this matches `buildPlaylist`'s new signature (`{ id; folderName; name }`). No code change should be needed; this step is a sanity check.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests still pass. The integration didn't change any test surface — `buildPlaylist` had no direct unit test before and still has none directly (it's covered by manual verification).

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 0 NEW errors. The two pre-existing errors in `components/editor/to-ffmpeg-json.test.ts` (`removable` field missing on Track fixtures) should still be present but unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/drive/sequencer.ts \
        app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/route.ts \
        app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/playlist/route.ts
git commit -m "feat(drive): rewrite buildPlaylist to recurse + randomize; integrate misc folder"
```

---

### Task 5: Manual verification on deploy

**Files:** none (deploy + browser test)

- [ ] **Step 1: Deploy**

```bash
npm run deploy
```

Note the `Current Version ID:` for traceability.

- [ ] **Step 2: Create a test project with mixed structure**

Pick a Drive folder (or create one for this test) with this layout:
- `team-folder/Lucas/*.jpg` (a few photos directly in the player folder)
- `team-folder/Lucas/spring/*.jpg` (a few photos nested one level deep)
- `team-folder/Mia/*.jpg`
- `team-folder/misc/*.jpg` (5 or more photos — to verify the no-cap behavior)
- `team-folder/song.mp3` (top-level audio, to verify audio still works)

Create a new project pointing at this folder.

- [ ] **Step 3: Verify the playlist**

Open the project in the editor. Confirm:
- Both `Lucas` photos at the top level AND nested `Lucas/spring/` photos appear under player Lucas in the timeline.
- A player named `misc` appears with all the misc photos (not capped to `imagesPerPlayer`).
- The timeline ordering is randomized (not strict A,B,C,A,B,C round-robin).
- No two adjacent items on V1 are from the same regular player (with one possible exception if a forced repeat was needed).
- Song.mp3 shows up in the audio picker.

- [ ] **Step 4: Verify resequence**

In the editor, trigger a resequence (whichever UI button calls the PATCH `/playlist` `type=resequence` action). Confirm:
- The playlist regenerates with a different random ordering.
- All structure properties from Step 3 still hold.

- [ ] **Step 5: Render the project**

Click Export. Wait for the GitHub Actions render to complete; download the resulting MP4 from Drive. Confirm:
- All photos appear in the rendered video.
- Audio plays correctly.
- No regression vs. previous renders.

- [ ] **Step 6: No commit** — this task is verification only.
