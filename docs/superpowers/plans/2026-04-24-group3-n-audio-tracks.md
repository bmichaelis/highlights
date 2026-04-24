# Group 3 — N Audio Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to add any number of audio tracks (A2, A3, A4…) to the timeline, with V1 and A1 permanent and A2+ removable via a ✕ button in the track header.

**Architecture:** Widen `Track.id` and all `trackId` references from the `'V1' | 'A1'` literal union to `string`, add a `removable: boolean` flag to `Track`, implement `ADD_AUDIO_TRACK` / `REMOVE_AUDIO_TRACK` reducer actions, then update the `Timeline` component to render the ✕ button and enable the `+ Audio track` button. The rendering loop already iterates `timeline.tracks` generically so no track-rendering logic needs restructuring.

**Tech Stack:** TypeScript, React 19, Vitest (`npm test` = `vitest run`)

---

### Task 1: Widen types.ts

**Files:**
- Modify: `components/editor/types.ts`

No tests needed — this is a pure type change. TypeScript errors in downstream files are expected and will be fixed in Tasks 2–4.

- [ ] **Step 1: Replace `Track` type**

In `components/editor/types.ts`, replace the `Track` type:

```ts
export type Track = {
  id: string
  kind: 'video' | 'audio'
  name: string
  muted: boolean
  locked: boolean
  removable: boolean
  clips: Clip[]
}
```

- [ ] **Step 2: Widen `DragState.overTrackId`**

Replace the `DragState` type:

```ts
export type DragState = {
  media: MediaItem
  curX: number
  curY: number
  overTrackId: string | null
  overTime: number
}
```

- [ ] **Step 3: Widen `EditorAction` and add new actions**

Replace the entire `EditorAction` type:

```ts
export type EditorAction =
  | { type: 'ADD_CLIP'; trackId: string; clip: Clip }
  | { type: 'REMOVE_CLIP'; trackId: string; clipId: string }
  | { type: 'MOVE_CLIP'; trackId: string; clipId: string; newStart: number }
  | { type: 'RESIZE_CLIP'; trackId: string; clipId: string; newDuration: number }
  | { type: 'SPLIT_CLIP'; trackId: string; clipId: string; at: number }
  | { type: 'UPDATE_CLIP'; trackId: string; clipId: string; patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>> }
  | { type: 'TOGGLE_MUTE'; trackId: string }
  | { type: 'TOGGLE_LOCK'; trackId: string }
  | { type: 'ADD_AUDIO_TRACK' }
  | { type: 'REMOVE_AUDIO_TRACK'; trackId: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_PLAYHEAD'; time: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SELECT_CLIP'; clipId: string | null }
  | { type: 'SET_SNAP'; on: boolean }
  | { type: 'SET_DRAG'; drag: DragState | null }
  | { type: 'SET_SAVE_STATUS'; status: 'idle' | 'saving' | 'saved' }
  | { type: 'LOAD_TIMELINE'; timeline: Timeline }
```

- [ ] **Step 4: Commit**

```bash
git add components/editor/types.ts
git commit -m "refactor: widen Track.id to string, add removable field and N-audio actions"
```

---

### Task 2: Update reducer — tests first

**Files:**
- Modify: `components/editor/use-editor.ts`
- Modify: `components/editor/use-editor.test.ts`
- Test: `components/editor/use-editor.test.ts`

- [ ] **Step 1: Update `emptyTimeline` in the test file**

In `components/editor/use-editor.test.ts`, add `removable: false` to the local `emptyTimeline` const at the top of the file:

```ts
const emptyTimeline: Timeline = {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
  ],
}
```

- [ ] **Step 2: Add failing tests for `ADD_AUDIO_TRACK`**

Append to the `describe('editorReducer', ...)` block in `components/editor/use-editor.test.ts`:

```ts
describe('ADD_AUDIO_TRACK', () => {
  it('adds A2 when only A1 exists', () => {
    const state = makeHistory(emptyTimeline)
    const next = editorReducer(state, { type: 'ADD_AUDIO_TRACK' })
    expect(next.present.tracks).toHaveLength(3)
    const a2 = next.present.tracks[2]
    expect(a2.id).toBe('A2')
    expect(a2.kind).toBe('audio')
    expect(a2.name).toBe('Audio')
    expect(a2.removable).toBe(true)
    expect(a2.clips).toEqual([])
  })

  it('adds A3 when A2 already exists', () => {
    const state = makeHistory({
      tracks: [
        { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
        { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
        { id: 'A2', kind: 'audio', name: 'Audio', muted: false, locked: false, removable: true, clips: [] },
      ],
    })
    const next = editorReducer(state, { type: 'ADD_AUDIO_TRACK' })
    expect(next.present.tracks).toHaveLength(4)
    expect(next.present.tracks[3].id).toBe('A3')
  })

  it('pushes to undo history', () => {
    const state = makeHistory(emptyTimeline)
    const next = editorReducer(state, { type: 'ADD_AUDIO_TRACK' })
    expect(next.past).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Add failing tests for `REMOVE_AUDIO_TRACK`**

Continue appending to `components/editor/use-editor.test.ts`:

```ts
describe('REMOVE_AUDIO_TRACK', () => {
  const audioClip: Clip = { id: 'ac1', mediaId: 'm1', filename: 'song.mp3', start: 0, duration: 5 }

  it('removes the track and all its clips', () => {
    const state = makeHistory({
      tracks: [
        { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
        { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
        { id: 'A2', kind: 'audio', name: 'Audio', muted: false, locked: false, removable: true, clips: [audioClip] },
      ],
    })
    const next = editorReducer(state, { type: 'REMOVE_AUDIO_TRACK', trackId: 'A2' })
    expect(next.present.tracks).toHaveLength(2)
    expect(next.present.tracks.find((t) => t.id === 'A2')).toBeUndefined()
  })

  it('is a no-op for non-removable tracks', () => {
    const state = makeHistory(emptyTimeline)
    const next = editorReducer(state, { type: 'REMOVE_AUDIO_TRACK', trackId: 'A1' })
    expect(next).toBe(state)
  })

  it('pushes to undo history when track is removed', () => {
    const state = makeHistory({
      tracks: [
        { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
        { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
        { id: 'A2', kind: 'audio', name: 'Audio', muted: false, locked: false, removable: true, clips: [] },
      ],
    })
    const next = editorReducer(state, { type: 'REMOVE_AUDIO_TRACK', trackId: 'A2' })
    expect(next.past).toHaveLength(1)
  })
})
```

- [ ] **Step 4: Run tests — verify new tests fail**

```bash
npm test -- use-editor
```

Expected: existing tests pass, the 6 new ADD/REMOVE tests fail with `Not implemented` or switch case fall-through.

- [ ] **Step 5: Update `emptyTimeline` in `use-editor.ts`**

In `components/editor/use-editor.ts`, update `emptyTimeline`:

```ts
export const emptyTimeline: Timeline = {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
  ],
}
```

- [ ] **Step 6: Implement `ADD_AUDIO_TRACK` reducer case**

In `components/editor/use-editor.ts`, add the case before `case 'UNDO':`:

```ts
case 'ADD_AUDIO_TRACK': {
  const audioNums = state.present.tracks.map((t) => {
    const m = t.id.match(/^A(\d+)$/)
    return m ? parseInt(m[1], 10) : 0
  })
  const nextN = Math.max(...audioNums) + 1
  const newTrack: Track = {
    id: `A${nextN}`,
    kind: 'audio',
    name: 'Audio',
    muted: false,
    locked: false,
    removable: true,
    clips: [],
  }
  return pushHistory(state, { ...state.present, tracks: [...state.present.tracks, newTrack] })
}
```

- [ ] **Step 7: Implement `REMOVE_AUDIO_TRACK` reducer case**

Add directly after the `ADD_AUDIO_TRACK` case:

```ts
case 'REMOVE_AUDIO_TRACK': {
  const track = state.present.tracks.find((t) => t.id === action.trackId)
  if (!track?.removable) return state
  return pushHistory(state, {
    ...state.present,
    tracks: state.present.tracks.filter((t) => t.id !== action.trackId),
  })
}
```

- [ ] **Step 8: Run tests — verify all pass**

```bash
npm test -- use-editor
```

Expected: all tests pass (existing + 6 new).

- [ ] **Step 9: Commit**

```bash
git add components/editor/use-editor.ts components/editor/use-editor.test.ts
git commit -m "feat: implement ADD_AUDIO_TRACK and REMOVE_AUDIO_TRACK reducer cases"
```

---

### Task 3: Update timeline.tsx

**Files:**
- Modify: `components/editor/timeline.tsx`

No unit tests — changes verified by `npm test` (type-check via build) and visual inspection.

- [ ] **Step 1: Widen Props type**

In `components/editor/timeline.tsx`, replace the `Props` type (lines 5–23):

```ts
type Props = {
  timeline: Timeline
  playhead: number
  zoom: number
  selectedClipId: string | null
  snapOn: boolean
  drag: DragState | null
  totalDuration: number
  onSeekRuler: (time: number) => void
  onZoomChange: (zoom: number) => void
  onMoveClip: (trackId: string, clipId: string, newStart: number) => void
  onResizeClip: (trackId: string, clipId: string, newDuration: number) => void
  onRemoveClip: (trackId: string, clipId: string) => void
  onSelectClip: (clipId: string | null) => void
  onToggleMute: (trackId: string) => void
  onToggleLock: (trackId: string) => void
  onDragOver: (trackId: string | null, time: number) => void
  onDrop: (trackId: string, time: number) => void
  onAddAudioTrack: () => void
  onRemoveAudioTrack: (trackId: string) => void
}
```

- [ ] **Step 2: Add new props to destructuring**

Update the `export function Timeline(...)` parameter destructuring to include the two new props:

```ts
export function Timeline({
  timeline, playhead, zoom, selectedClipId, snapOn, drag, totalDuration,
  onSeekRuler, onZoomChange, onMoveClip, onResizeClip, onRemoveClip,
  onSelectClip, onToggleMute, onToggleLock, onDragOver, onDrop,
  onAddAudioTrack, onRemoveAudioTrack,
}: Props) {
```

- [ ] **Step 3: Remove all `as 'V1' | 'A1'` casts**

There are 6 cast sites. Replace each occurrence of `track.id as 'V1' | 'A1'` with just `track.id`. Specifically:

In `startClipMove` callback:
```ts
onMoveClip(track.id, clip.id, newStart)
```

In `startClipResize` callback:
```ts
onResizeClip(track.id, clip.id, Math.max(0.3, origDur + dx / pixelsPerSecond))
```

In `handleKeyDown` callback:
```ts
onRemoveClip(track.id, selectedClipId)
```

In `handleTrackPointerMove` callback:
```ts
onDragOver(track.id, snapped)
```

In `handleTrackPointerUp` callback:
```ts
onDrop(track.id, snapped)
```

In the mute/lock buttons inside track header JSX:
```tsx
<button onClick={() => onToggleMute(track.id)} ...>M</button>
<button onClick={() => onToggleLock(track.id)} ...>🔒</button>
```

- [ ] **Step 4: Enable `+ Audio track` button**

In the Timeline header section, replace the disabled `+ Audio track` button:

```tsx
<button
  onClick={onAddAudioTrack}
  style={{ fontSize: 10, color: 'var(--ink-2)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 6px', background: 'transparent', cursor: 'pointer' }}
>+ Audio track</button>
```

(The `+ Video track` button stays `disabled`.)

- [ ] **Step 5: Add ✕ button to removable track headers**

In the track header `<div>`, after the 🔒 button, add:

```tsx
{track.removable && (
  <button
    onClick={() => onRemoveAudioTrack(track.id)}
    style={{ fontSize: 9, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px' }}
    title="Remove track"
  >✕</button>
)}
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all tests pass (no timeline unit tests; this verifies the type changes compile cleanly with the rest of the suite).

- [ ] **Step 7: Commit**

```bash
git add components/editor/timeline.tsx
git commit -m "feat: enable +Audio track button and add ✕ for removable tracks in timeline"
```

---

### Task 4: Update editor.tsx

**Files:**
- Modify: `components/editor/editor.tsx`

- [ ] **Step 1: Add `removable: false` to `bootstrap()`**

In `components/editor/editor.tsx`, update the `bootstrap` function's return value (the two track objects):

```ts
return {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
  ],
}
```

- [ ] **Step 2: Remove `as 'V1' | 'A1'` cast in `handleSplit`**

In the `handleSplit` function (around line 92), change:

```ts
dispatch({ type: 'SPLIT_CLIP', trackId: track.id, clipId: clip.id, at: ph })
```

(Remove the `as 'V1' | 'A1'` cast.)

- [ ] **Step 3: Widen `handleDragOver`**

```ts
const handleDragOver = useCallback((trackId: string | null, time: number) => {
  setDrag((d) => d ? { ...d, overTrackId: trackId, overTime: time } : null)
}, [])
```

- [ ] **Step 4: Widen `handleDrop`**

```ts
const handleDrop = useCallback((trackId: string, time: number) => {
  if (!drag) return
  const newClip: Clip = {
    id: `c-${crypto.randomUUID()}`,
    mediaId: drag.media.id,
    filename: drag.media.filename,
    thumbnailUrl: drag.media.thumbnailUrl,
    start: time,
    duration: drag.media.defaultDuration,
  }
  dispatch({ type: 'ADD_CLIP', trackId, clip: newClip })
  setDrag(null)
}, [drag])
```

- [ ] **Step 5: Widen `handleUpdateClip`**

```ts
const handleUpdateClip = useCallback((trackId: string, clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>>) => {
  dispatch({ type: 'UPDATE_CLIP', trackId, clipId, patch })
}, [])
```

- [ ] **Step 6: Add `handleAddAudioTrack` and `handleRemoveAudioTrack`**

Add these two new callbacks near the other `useCallback` handlers:

```ts
const handleAddAudioTrack = useCallback(() => {
  dispatch({ type: 'ADD_AUDIO_TRACK' })
}, [])

const handleRemoveAudioTrack = useCallback((trackId: string) => {
  dispatch({ type: 'REMOVE_AUDIO_TRACK', trackId })
}, [])
```

- [ ] **Step 7: Pass new props to `<Timeline>`**

In the `<Timeline ...>` JSX, add the two new props:

```tsx
onAddAudioTrack={handleAddAudioTrack}
onRemoveAudioTrack={handleRemoveAudioTrack}
```

- [ ] **Step 8: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add components/editor/editor.tsx
git commit -m "feat: wire ADD_AUDIO_TRACK and REMOVE_AUDIO_TRACK in editor"
```
