# Group 3 — N Audio Tracks Design Spec

**Date:** 2026-04-24
**Status:** Approved

## Overview

Allow users to add any number of audio tracks (A2, A3, A4…) to the timeline. V1 and A1 are permanent and cannot be removed. User-added tracks (A2+) have a ✕ button in the track header that removes the track and all its clips. The `+ Audio track` button in the timeline header is always active.

V2 title-card clips are deferred to a later group.

---

## Data Model

### `types.ts`

`Track.id` widens from the literal union `'V1' | 'A1'` to `string`.

New `removable` field on `Track`:

```ts
export type Track = {
  id: string
  kind: 'video' | 'audio'
  name: string
  muted: boolean
  locked: boolean
  removable: boolean   // false for V1 and A1; true for A2, A3, …
  clips: Clip[]
}
```

`DragState.overTrackId` widens from `'V1' | 'A1' | null` to `string | null`.

All `trackId` fields in `EditorAction` widen from `'V1' | 'A1'` to `string`.

Two new reducer actions:

```ts
| { type: 'ADD_AUDIO_TRACK' }
| { type: 'REMOVE_AUDIO_TRACK'; trackId: string }
```

---

## Reducer Logic

### `use-editor.ts`

`emptyTimeline` adds `removable: false` to both initial tracks:

```ts
export const emptyTimeline: Timeline = {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
  ],
}
```

**`ADD_AUDIO_TRACK`** — computes the next sequential ID by scanning existing track IDs for the pattern `A{n}` (where n is an integer), taking the max n, and incrementing. New track appended to end of `tracks`:

```ts
{ id: `A${nextN}`, kind: 'audio', name: 'Audio', muted: false, locked: false, removable: true, clips: [] }
```

Pushes to undo history via `pushHistory`.

**`REMOVE_AUDIO_TRACK`** — no-op if the target track has `removable: false` (guards against removing V1 or A1). Otherwise, filters the track out of `tracks.` All clips on that track are removed with it. Pushes to undo history.

---

## Timeline Component

**File:** `components/editor/timeline.tsx`

### New props

```ts
onAddAudioTrack: () => void
onRemoveAudioTrack: (trackId: string) => void
```

All existing `trackId: 'V1' | 'A1'` props widen to `trackId: string`.

### Changes

1. **`+ Audio track` button** — remove `disabled`, wire to `onAddAudioTrack`.

2. **✕ button in track header** — rendered only when `track.removable`. Placed after the 🔒 button. Calls `onRemoveAudioTrack(track.id)`.

3. **Remove `as 'V1' | 'A1'` casts** — six cast sites in `startClipMove`, `startClipResize`, `handleKeyDown`, `handleTrackPointerMove`, `handleTrackPointerUp`, and the mute/lock button handlers all drop the cast now that `trackId` is `string`.

---

## `editor.tsx` Changes

- `handleAddAudioTrack`: dispatches `{ type: 'ADD_AUDIO_TRACK' }`
- `handleRemoveAudioTrack`: dispatches `{ type: 'REMOVE_AUDIO_TRACK', trackId }`
- Both passed to `<Timeline>` as `onAddAudioTrack` and `onRemoveAudioTrack`
- All existing `trackId: 'V1' | 'A1'` handler signatures widen to `string`

---

## `to-ffmpeg-json.ts`

No changes required. Already iterates all tracks generically.

---

## Files

**Modified:**
- `components/editor/types.ts` — widen `Track.id`; add `removable`; widen `DragState.overTrackId`; widen `EditorAction` trackId fields; add `ADD_AUDIO_TRACK` and `REMOVE_AUDIO_TRACK`
- `components/editor/use-editor.ts` — add `removable: false` to `emptyTimeline`; implement `ADD_AUDIO_TRACK` and `REMOVE_AUDIO_TRACK` reducer cases
- `components/editor/timeline.tsx` — enable `+ Audio track` button; ✕ button for removable tracks; remove `as 'V1' | 'A1'` casts; widen props
- `components/editor/editor.tsx` — wire `onAddAudioTrack` and `onRemoveAudioTrack`; widen handler signatures

**Tests:**
- `components/editor/use-editor.test.ts` — `ADD_AUDIO_TRACK` sequential IDs, double-add → A2/A3, `REMOVE_AUDIO_TRACK` removes track and clips, `REMOVE_AUDIO_TRACK` on non-removable track is a no-op

---

## Out of Scope

- Renaming audio tracks
- V2 title-card clips (deferred to a later group)
- Per-track volume controls
- Applying N-track audio in `render.mjs` (render pipeline upgrade deferred)
