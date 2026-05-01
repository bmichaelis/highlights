# Recursive Drive Load Design Spec

**Date:** 2026-05-01
**Status:** Approved

## Overview

Today's Drive loader expects exactly one folder structure: top-level subfolders are players; images directly inside each player folder are the player's photos. Anything else — nested subfolders under a player, loose images at the team-folder root, photos organized by date or game — is invisible. Photographers have to organize photos into per-player folders manually before importing.

This spec lets the photographer organize loosely. The loader walks one level deep for player names, then recurses inside each player's subfolder to gather images at any depth. A subfolder named `misc` (case-insensitive) at the top level becomes a special player — same data model as a regular player, but with no per-image cap. Final ordering randomizes the pool with a constraint that no two adjacent items come from the same regular player; misc items can appear adjacent to themselves.

What changes from today:
- `fetchPlayerImages` is replaced by `collectImagesUnder`, which recurses inside a player's folder.
- The project-create flow recognizes a top-level `misc` folder and creates a special player for it.
- `mergeInterspersed` (deterministic round-robin) is replaced with a random-with-no-adjacent-same-regular-player sequencer.
- Audio scanning is unchanged — top-level only.

Backward compatibility: a team folder with only one level of player subfolders and no `misc` folder produces the same player set as today. Only the ordering changes (round-robin → random). No schema changes; no database migration.

---

## Section 1: Drive Walk Algorithm

### Recursive image collector

New helper in `lib/drive/sequencer.ts` (replacing `fetchPlayerImages`):

```ts
async function collectImagesUnder(
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
    const { files } = await res.json() as { files?: (DriveImageFile & { mimeType: string })[] }
    for (const f of files ?? []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') queue.push(f.id)
      else if (f.mimeType.startsWith('image/')) all.push(f)
    }
  }
  return all
}
```

BFS with a `seenFolders` set to defend against Drive shortcut loops. Returns a flat list of every image under the root. Deduplication by `driveFileId` is applied post-collection.

### Misc detection

New helper in `lib/drive/scanner.ts`:

```ts
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

Case-insensitive match on `misc`. If multiple folders match (`misc/`, `Misc/`), the last-encountered wins; document with a comment.

### Updated `buildPlaylist`

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
      const candidates = dedupeById(images).map(toImageCandidate(p.id))
      return isMisc ? candidates : pickEvenly(candidates, imagesPerPlayer)
    })
  )
  const seqPlayers = players.map((p) => ({ id: p.id, isMisc: p.name === 'misc' }))
  return interleaveRandom(allImages, seqPlayers)
}
```

Misc images skip `pickEvenly` (no cap). Regular players get `pickEvenly` exactly as today. The misc player is detected by `name === 'misc'` (canonical lowercase set when the player row was inserted).

### Edge cases handled

- Empty player folder → empty image array → skipped naturally.
- Drive shortcut loop → `seenFolders` set prevents infinite traversal.
- `misc` folder doesn't exist → no misc player created; behavior reduces to "recursive within player folders."
- Player folder has nested subfolders (e.g., `Lucas/2024/`) → all reachable images collected.
- Same image somehow reachable via multiple paths within one player → deduped by `driveFileId` post-collection.
- Same image reachable across multiple players → deduplication is per-player only; both players "own" their copy. Practically rare; out of scope to dedupe globally.

---

## Section 2: Random Sequencer

Replaces `mergeInterspersed` in `lib/drive/sequencer.ts`:

```ts
type SeqPlayer = { id: string; isMisc: boolean }

export function interleaveRandom<T>(
  perPlayerLists: T[][],
  players: SeqPlayer[],
  random: () => number = Math.random,
): T[] {
  // Shuffle within each player's list so the within-player order is also random.
  const queues = perPlayerLists.map((list) => shuffle([...list], random))
  const result: T[] = []
  let lastPlayerId: string | null = null
  let lastWasMisc = false

  while (queues.some((q) => q.length > 0)) {
    // Eligible queues = non-empty AND not creating a regular-player adjacency conflict.
    const eligible: number[] = []
    for (let i = 0; i < queues.length; i++) {
      if (queues[i].length === 0) continue
      const conflict = !lastWasMisc && !players[i].isMisc && players[i].id === lastPlayerId
      if (!conflict) eligible.push(i)
    }
    // If forced into a conflict (only one regular player has photos left), accept it.
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

function shuffle<T>(arr: T[], random: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
```

### Adjacency rule

The check is against the **immediately preceding item**, not "the last regular player" or any longer history.

- `Lucas, Lucas` — forbidden.
- `Lucas, misc, Lucas` — allowed (Lucas isn't "in a row").
- `misc, misc` — allowed (lax for misc).
- `Lucas, misc, misc, Lucas` — allowed.

### Forced repeats

When only one regular player has photos remaining and the rule would otherwise block them, the algorithm accepts the repeat rather than dropping the item or stalling. Edge case in practice (would require `imagesPerPlayer` very high relative to player count) but the algorithm handles it gracefully.

### Determinism for tests

The `random` parameter defaults to `Math.random` in production. Tests can inject a seedable function for deterministic behavior, or run property-based tests against `Math.random` over many iterations.

---

## Section 3: Integration

### `lib/drive/scanner.ts`

Add `partitionTopLevel` (Section 1). No other changes; `pickAudioFiles` and `listFolderContents` unchanged.

### `lib/drive/sequencer.ts`

- Add `collectImagesUnder` and `resolveSubfolderId`.
- Replace the body of `buildPlaylist` (signature gains `name` field).
- Add `interleaveRandom` and a small `shuffle` helper.
- Remove `fetchPlayerImages` and `mergeInterspersed` (no other consumers).

### `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts` (POST)

After listing top-level folder contents:

```ts
const allFolders = parseDriveFiles(files)
const { players: playerFolders, misc: miscFolder } = partitionTopLevel(allFolders)
const folderItems = miscFolder ? [...playerFolders, miscFolder] : playerFolders
```

When inserting `players` rows, the misc folder's row gets `name: 'misc'` (canonical lowercase). `folderName` stays as the actual Drive folder name (preserves casing for the folder-id lookup).

```ts
folderItems.slice(i, i + 20).map((f) => ({
  projectId: project.id,
  name: f === miscFolder ? 'misc' : f.name,
  folderName: f.name,
}))
```

The bulk insert chunking (`+= 20`) and D1 param-limit math are unchanged.

When passing `players` into `buildPlaylist`, include `name` in the projection — `buildPlaylist` uses `name` to detect misc.

### `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts` (PATCH, `type === 'resequence'`)

`db.query.players.findMany(...)` already returns `{ id, projectId, name, folderName }`. Confirm `name` is included when the array is passed to `buildPlaylist`. No structural change; behavior automatically picks up the new logic.

### Backward compatibility

A team folder structured as today's flat per-player layout produces identical players in D1. Only differences:
- Images previously visible (top-level of player folder) still visible; nested images now also surfaced. If a photographer never nested, no behavior change in image set.
- Ordering changes from round-robin to random.

Existing projects don't need migration. Their next `resequence` action picks up the new behavior.

---

## Section 4: Testing

### `lib/drive/scanner.test.ts` — extend

- No `misc` folder anywhere → all entries flow through as players; `misc: null`.
- One folder named `misc` (lowercase) → moved to `misc`, others as players.
- One folder named `MISC` / `Misc` / `mISC` → matched case-insensitively.
- Multiple folders matching `misc` (case variants) → last-encountered wins.
- Empty folder list → empty players, `misc: null`.

### `lib/drive/sequencer.test.ts` — restructure

- **Keep:** `pickEvenly` tests (algorithm unchanged).
- **Remove:** `mergeInterspersed` tests (function deleted).
- **Remove:** old `fetchPlayerImages` tests (function deleted).
- **Add property tests for `interleaveRandom`**, each run 100 iterations:
  - Length preserved.
  - Multiset preserved (same `driveFileId`s in output as input; no drops, no duplicates).
  - Player-adjacency invariant: for every pair `(out[i], out[i+1])` where neither is misc, `out[i].playerId !== out[i+1].playerId`.
  - Misc-laxity: input with misc dominating (1 regular player × 4 + misc × 20). Algorithm completes; misc-misc adjacency is allowed.
  - Forced-repeat acceptance: input with one player × 10. Algorithm completes without throwing or losing items.
- **Add deterministic `interleaveRandom` test** with an injected `random` function returning known values; lock specific output on a known input.
- **Add `collectImagesUnder` tests**, mocking `global.fetch`:
  - Single folder, images only → returns flat list.
  - Folder with subfolder containing images → recurses, returns all.
  - Folder with mixed (subfolders + images at root) → both surfaced.
  - Folder with cycle (folder references itself via shortcut) → terminates via `seenFolders`.
  - Empty folder → empty array.
- **Replace** removed `fetchPlayerImages` tests with `buildPlaylist` integration tests, mocking `fetch` to return canned Drive listings:
  - Regular players' images run through `pickEvenly` (count capped).
  - Misc player's images flow through (no cap).
  - Final ordering passes the adjacency invariant.

Tests live in the project's `lib/` test pattern (`vitest.config.ts` includes `lib/**/*.test.ts` in the `unit` project). Run with `npm test`.

### Manual verification

After deploy:
1. Create a project pointed at a team folder with a mix of structures: per-player subfolders, a `misc` folder, and a player with nested subfolders inside (e.g. `Lucas/spring/`, `Lucas/summer/`).
2. Confirm playlist includes images from all three sources.
3. Confirm `misc` images aren't capped.
4. Click "Resequence" in the editor; confirm a different ordering each time, none with two adjacent regular-player photos from the same player.
5. Render the project; confirm the resulting MP4 plays the new ordering.

---

## Files

**Modified:**
- `lib/drive/scanner.ts` — add `partitionTopLevel`.
- `lib/drive/sequencer.ts` — add `collectImagesUnder`, `resolveSubfolderId`, `interleaveRandom`, `shuffle`; rewrite `buildPlaylist`; remove `fetchPlayerImages` and `mergeInterspersed`.
- `lib/drive/scanner.test.ts` — add `partitionTopLevel` tests.
- `lib/drive/sequencer.test.ts` — drop removed-function tests; add new tests.
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts` — partition top-level folders, set misc player's `name='misc'`, include `name` in projection passed to `buildPlaylist`.
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts` — verify `name` is in the projection passed to `buildPlaylist` in the resequence path.

**No new files. No new env vars. No schema changes.**

---

## Out of Scope

- **Recursive audio scanning.** Audio stays top-level only. Dedicated `team/audio/` subfolder support is a candidate follow-up.
- **Schema migration / `playerId` nullability.** Misc images get a real `players` row; no schema change. A fully flat (no players) model remains a separate future redesign.
- **Configurable misc folder name.** Hardcoded to `misc` (case-insensitive).
- **Drive pagination beyond 1000 files per folder.** `pageSize=1000` is the API max; any single folder exceeding this would lose extra files. Realistic photographer folders never approach this.
- **Image deduplication across players.** Within-player dedup only; an image reachable through two different players' subtrees appears under both.
- **Pre-validation of folder structure at project creation.** No "you don't have any subfolders, are you sure?" UI.
- **Editor UX changes.** None needed.
- **Render path changes.** Unchanged.
