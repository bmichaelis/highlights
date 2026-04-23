# Group 1 — Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyboard shortcuts (S/N), per-clip fade transitions with an Inspector panel, and a live ffmpeg JSON viewer modal to the KickReel editor.

**Architecture:** All changes are confined to `components/editor/`. Types are extended first, then reducer logic (TDD), then serializer (TDD), then new UI components are created, and finally `editor.tsx` wires everything together. No API or database changes.

**Tech Stack:** React 19 `useReducer`, TypeScript, Vitest (run with `npm test`), CSS custom properties for theming.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `components/editor/types.ts` | Modify | Add `fadeIn?`/`fadeOut?` to `Clip`; add `SPLIT_CLIP`/`UPDATE_CLIP` to `EditorAction` |
| `components/editor/use-editor.ts` | Modify | Implement `SPLIT_CLIP` and `UPDATE_CLIP` reducer cases |
| `components/editor/use-editor.test.ts` | Modify | Tests for `SPLIT_CLIP` and `UPDATE_CLIP` |
| `components/editor/to-ffmpeg-json.ts` | Modify | Use per-clip `fadeIn`/`fadeOut`; add `fade` to audio clips |
| `components/editor/to-ffmpeg-json.test.ts` | Modify | Tests for per-clip fade values |
| `components/editor/inspector-panel.tsx` | Create | Right-side panel showing fade controls for selected clip |
| `components/editor/json-panel.tsx` | Create | Modal showing live ffmpeg JSON |
| `components/editor/editor-toolbar.tsx` | Modify | Enable Split button; add JSON toggle `{ }` button |
| `components/editor/editor.tsx` | Modify | Wire inspector, JSON panel, S/N shortcuts, canSplit, UPDATE_CLIP |

---

## Task 1: Extend types

**Files:**
- Modify: `components/editor/types.ts`

- [ ] **Step 1: Update `Clip` and `EditorAction` in `types.ts`**

Replace the entire file with:

```ts
export type MediaItem = {
  id: string          // Drive file ID
  kind: 'image' | 'audio'
  filename: string
  thumbnailUrl?: string
  defaultDuration: number  // seconds
}

export type Clip = {
  id: string
  mediaId: string       // Drive file ID (used as `source` in ffmpeg JSON)
  filename: string
  thumbnailUrl?: string // images only
  start: number         // seconds from t=0
  duration: number      // seconds
  fadeIn?: number       // seconds; undefined treated as 0.2
  fadeOut?: number      // seconds; undefined treated as 0.2
}

export type Track = {
  id: 'V1' | 'A1'
  kind: 'video' | 'audio'
  name: string
  muted: boolean
  locked: boolean
  clips: Clip[]
}

export type Timeline = {
  tracks: Track[]
}

export type HistoryState = {
  past: Timeline[]    // max 40
  present: Timeline
  future: Timeline[]
}

export type EditorState = {
  history: HistoryState
  playhead: number      // seconds
  playing: boolean
  zoom: number          // 30–200; pixels-per-second = zoom * 0.8
  selectedClipId: string | null
  snapOn: boolean
  drag: DragState | null
  saveStatus: 'idle' | 'saving' | 'saved'
}

export type DragState = {
  media: MediaItem
  curX: number
  curY: number
  overTrackId: 'V1' | 'A1' | null
  overTime: number      // seconds, snap-adjusted
}

export type EditorAction =
  | { type: 'ADD_CLIP'; trackId: 'V1' | 'A1'; clip: Clip }
  | { type: 'REMOVE_CLIP'; trackId: 'V1' | 'A1'; clipId: string }
  | { type: 'MOVE_CLIP'; trackId: 'V1' | 'A1'; clipId: string; newStart: number }
  | { type: 'RESIZE_CLIP'; trackId: 'V1' | 'A1'; clipId: string; newDuration: number }
  | { type: 'SPLIT_CLIP'; trackId: 'V1' | 'A1'; clipId: string; at: number }
  | { type: 'UPDATE_CLIP'; trackId: 'V1' | 'A1'; clipId: string; patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut'>> }
  | { type: 'TOGGLE_MUTE'; trackId: 'V1' | 'A1' }
  | { type: 'TOGGLE_LOCK'; trackId: 'V1' | 'A1' }
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add components/editor/types.ts
git commit -m "feat: add fadeIn/fadeOut to Clip and SPLIT_CLIP/UPDATE_CLIP actions"
```

---

## Task 2: Reducer — `SPLIT_CLIP` and `UPDATE_CLIP` (TDD)

**Files:**
- Modify: `components/editor/use-editor.test.ts`
- Modify: `components/editor/use-editor.ts`

- [ ] **Step 1: Write failing tests**

Add these two `describe` blocks at the bottom of `components/editor/use-editor.test.ts` (before the final closing `}`):

```ts
describe('SPLIT_CLIP', () => {
  const clipToSplit: Clip = { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', start: 0, duration: 6 }
  const withClip: Timeline = {
    ...emptyTimeline,
    tracks: [{ ...emptyTimeline.tracks[0], clips: [clipToSplit] }, emptyTimeline.tracks[1]],
  }

  it('splits clip into two clips at the given time', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
    const clips = next.present.tracks[0].clips
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ start: 0, duration: 2, fadeOut: 0 })
    expect(clips[1]).toMatchObject({ start: 2, duration: 4, fadeIn: 0 })
  })

  it('left clip keeps original id', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
    expect(next.present.tracks[0].clips[0].id).toBe('c1')
  })

  it('right clip gets a new id', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
    expect(next.present.tracks[0].clips[1].id).not.toBe('c1')
  })

  it('right clip shares mediaId and filename with original', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
    expect(next.present.tracks[0].clips[1]).toMatchObject({ mediaId: 'drive-abc', filename: 'goal.jpg' })
  })

  it('is a no-op when at is outside the clip', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 10 })
    expect(next.present.tracks[0].clips).toHaveLength(1)
    expect(next.past).toHaveLength(0)
  })

  it('pushes to undo history', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
    expect(next.past).toHaveLength(1)
  })
})

describe('UPDATE_CLIP', () => {
  const clipToUpdate: Clip = { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', start: 0, duration: 3 }
  const withClip: Timeline = {
    ...emptyTimeline,
    tracks: [{ ...emptyTimeline.tracks[0], clips: [clipToUpdate] }, emptyTimeline.tracks[1]],
  }

  it('patches fadeIn on a clip', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'UPDATE_CLIP', trackId: 'V1', clipId: 'c1', patch: { fadeIn: 0.5 } })
    expect(next.present.tracks[0].clips[0].fadeIn).toBe(0.5)
  })

  it('patches fadeOut on a clip', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'UPDATE_CLIP', trackId: 'V1', clipId: 'c1', patch: { fadeOut: 1.0 } })
    expect(next.present.tracks[0].clips[0].fadeOut).toBe(1.0)
  })

  it('does not modify other clips', () => {
    const clip2: Clip = { id: 'c2', mediaId: 'drive-xyz', filename: 'pass.jpg', start: 3, duration: 3 }
    const twoClips: Timeline = {
      ...emptyTimeline,
      tracks: [{ ...emptyTimeline.tracks[0], clips: [clipToUpdate, clip2] }, emptyTimeline.tracks[1]],
    }
    const next = editorReducer(makeHistory(twoClips), { type: 'UPDATE_CLIP', trackId: 'V1', clipId: 'c1', patch: { fadeIn: 0.8 } })
    expect(next.present.tracks[0].clips[1].fadeIn).toBeUndefined()
  })

  it('pushes to undo history', () => {
    const next = editorReducer(makeHistory(withClip), { type: 'UPDATE_CLIP', trackId: 'V1', clipId: 'c1', patch: { fadeIn: 0.3 } })
    expect(next.past).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: 10 new failures (`SPLIT_CLIP` and `UPDATE_CLIP` cases). Existing tests still pass.

- [ ] **Step 3: Implement `SPLIT_CLIP` and `UPDATE_CLIP` in `use-editor.ts`**

Add these two cases inside the `switch` in `editorReducer`, after the `RESIZE_CLIP` case:

```ts
case 'SPLIT_CLIP': {
  const next: Timeline = {
    ...state.present,
    tracks: updateTrack(state.present.tracks, action.trackId, (clips) => {
      const clip = clips.find((c) => c.id === action.clipId)
      if (!clip || action.at <= clip.start || action.at >= clip.start + clip.duration) return clips
      const left: Clip = { ...clip, duration: action.at - clip.start, fadeOut: 0 }
      const right: Clip = {
        ...clip,
        id: crypto.randomUUID(),
        start: action.at,
        duration: (clip.start + clip.duration) - action.at,
        fadeIn: 0,
      }
      return normalizeTrack([...clips.filter((c) => c.id !== action.clipId), left, right])
    }),
  }
  // no-op: if updateTrack returned identical clips, don't push history
  const trackBefore = state.present.tracks.find((t) => t.id === action.trackId)
  const trackAfter = next.tracks.find((t) => t.id === action.trackId)
  if (trackBefore?.clips === trackAfter?.clips) return state
  return pushHistory(state, next)
}
case 'UPDATE_CLIP': {
  const next: Timeline = {
    ...state.present,
    tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
      clips.map((c) => c.id === action.clipId ? { ...c, ...action.patch } : c)
    ),
  }
  return pushHistory(state, next)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass (previously failing `SPLIT_CLIP` and `UPDATE_CLIP` tests now green).

- [ ] **Step 5: Commit**

```bash
git add components/editor/use-editor.ts components/editor/use-editor.test.ts
git commit -m "feat: implement SPLIT_CLIP and UPDATE_CLIP reducer actions"
```

---

## Task 3: Per-clip fades in `toFFmpegJson` (TDD)

**Files:**
- Modify: `components/editor/to-ffmpeg-json.test.ts`
- Modify: `components/editor/to-ffmpeg-json.ts`

- [ ] **Step 1: Add failing tests**

Add these tests at the bottom of the `describe('toFFmpegJson', ...)` block in `components/editor/to-ffmpeg-json.test.ts`:

```ts
  it('uses per-clip fadeIn for video transition duration', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        { ...timeline.tracks[0], clips: [{ ...timeline.tracks[0].clips[0], fadeIn: 0.8 }, timeline.tracks[0].clips[1]] },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    expect(vTrack.clips[0]).toMatchObject({ transition: { in: 'fade', duration: 0.8 } })
    // second clip has no fadeIn, should default to 0.2
    expect(vTrack.clips[1]).toMatchObject({ transition: { in: 'fade', duration: 0.2 } })
  })

  it('adds fade field to audio clips with default 0.2', () => {
    const result = toFFmpegJson(timeline, 'test')
    const aTrack = result.tracks.find((t) => t.id === 'A1')!
    expect(aTrack.clips[0]).toMatchObject({ fade: { in: 0.2, out: 0.2 } })
  })

  it('uses per-clip fadeIn/fadeOut for audio fade', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        timeline.tracks[0],
        { ...timeline.tracks[1], clips: [{ ...timeline.tracks[1].clips[0], fadeIn: 1.0, fadeOut: 0.5 }] },
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const aTrack = result.tracks.find((t) => t.id === 'A1')!
    expect(aTrack.clips[0]).toMatchObject({ fade: { in: 1.0, out: 0.5 } })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: 3 new failures. Existing tests still pass.

- [ ] **Step 3: Update `to-ffmpeg-json.ts`**

Replace the entire file with:

```ts
import type { Timeline, Clip, Track } from '@/components/editor/types'

type FFmpegVideoClip = {
  id: string; type: 'image'; source: string
  in: number; out: number; start: number; end: number
  kenburns: { from: string; to: string; scale: number }
  transition: { in: string; duration: number }
}

type FFmpegAudioClip = {
  id: string; type: 'audio'; source: string
  in: number; out: number; start: number; end: number
  fade: { in: number; out: number }
}

type FFmpegClip = FFmpegVideoClip | FFmpegAudioClip

type FFmpegTrack = { id: string; kind: string; muted: boolean; clips: FFmpegClip[] }

type FFmpegJson = {
  output: { filename: string; width: number; height: number; fps: number; audio_rate: number }
  duration: number
  tracks: FFmpegTrack[]
}

function clipEnd(clip: Clip): number {
  return clip.start + clip.duration
}

function serializeClip(clip: Clip, kind: 'video' | 'audio'): FFmpegClip {
  const base = { id: clip.id, source: clip.mediaId, in: clip.start, out: clipEnd(clip), start: clip.start, end: clipEnd(clip) }
  if (kind === 'video') {
    return {
      ...base,
      type: 'image',
      kenburns: { from: 'center', to: 'in', scale: 1.08 },
      transition: { in: 'fade', duration: clip.fadeIn ?? 0.2 },
    }
  }
  return {
    ...base,
    type: 'audio',
    fade: { in: clip.fadeIn ?? 0.2, out: clip.fadeOut ?? 0.2 },
  }
}

function serializeTrack(track: Track): FFmpegTrack {
  return {
    id: track.id,
    kind: track.kind,
    muted: track.muted,
    clips: track.clips.map((c) => serializeClip(c, track.kind)),
  }
}

export function toFFmpegJson(timeline: Timeline, projectSlug: string): FFmpegJson {
  const allEnds = timeline.tracks.flatMap((t) => t.clips.map(clipEnd))
  const duration = allEnds.length > 0 ? Math.max(...allEnds) : 0
  return {
    output: { filename: `${projectSlug}.mp4`, width: 1920, height: 1080, fps: 30, audio_rate: 48000 },
    duration,
    tracks: timeline.tracks.map(serializeTrack),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/editor/to-ffmpeg-json.ts components/editor/to-ffmpeg-json.test.ts
git commit -m "feat: per-clip fadeIn/fadeOut in toFFmpegJson"
```

---

## Task 4: `InspectorPanel` component

**Files:**
- Create: `components/editor/inspector-panel.tsx`

- [ ] **Step 1: Create `inspector-panel.tsx`**

```tsx
'use client'
import type { Timeline, Clip } from './types'

type Props = {
  timeline: Timeline
  selectedClipId: string | null
  onUpdateClip: (trackId: 'V1' | 'A1', clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut'>>) => void
}

function FadeControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{label}</span>
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={value}
          onChange={(e) => onChange(Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)))}
          style={{
            width: 40,
            fontSize: 10,
            fontFamily: 'monospace',
            background: 'var(--paper-3)',
            color: 'var(--ink)',
            border: '1px solid var(--line-soft)',
            borderRadius: 2,
            padding: '1px 3px',
            textAlign: 'right',
          }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={2}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
    </div>
  )
}

export function InspectorPanel({ timeline, selectedClipId, onUpdateClip }: Props) {
  const panelStyle: React.CSSProperties = {
    width: 180,
    flexShrink: 0,
    background: 'var(--paper-2)',
    borderLeft: '1.5px solid var(--line)',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  }

  let selectedClip: Clip | null = null
  let selectedTrackId: 'V1' | 'A1' | null = null
  for (const track of timeline.tracks) {
    const c = track.clips.find((c) => c.id === selectedClipId)
    if (c) { selectedClip = c; selectedTrackId = track.id as 'V1' | 'A1'; break }
  }

  if (!selectedClip || !selectedTrackId) {
    return (
      <div style={panelStyle}>
        <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace', textAlign: 'center', marginTop: 24 }}>
          Select a clip to edit its properties
        </span>
      </div>
    )
  }

  const clip = selectedClip
  const trackId = selectedTrackId
  const fadeIn = clip.fadeIn ?? 0.2
  const fadeOut = clip.fadeOut ?? 0.2
  const filename = clip.filename.length > 20 ? clip.filename.slice(0, 17) + '…' : clip.filename

  return (
    <div style={panelStyle}>
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ink)', marginBottom: 2, wordBreak: 'break-all' }}>
        {filename}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ink-3)', marginBottom: 10 }}>
        {clip.duration.toFixed(1)}s
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '0 0 10px' }} />
      <FadeControl
        label="Fade In"
        value={fadeIn}
        onChange={(v) => onUpdateClip(trackId, clip.id, { fadeIn: v })}
      />
      <FadeControl
        label="Fade Out"
        value={fadeOut}
        onChange={(v) => onUpdateClip(trackId, clip.id, { fadeOut: v })}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/editor/inspector-panel.tsx
git commit -m "feat: add InspectorPanel with fade controls"
```

---

## Task 5: `JsonPanel` component

**Files:**
- Create: `components/editor/json-panel.tsx`

- [ ] **Step 1: Create `json-panel.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { toFFmpegJson } from './to-ffmpeg-json'
import type { Timeline } from './types'

type Props = {
  timeline: Timeline
  projectSlug: string
  onClose: () => void
}

export function JsonPanel({ timeline, projectSlug, onClose }: Props) {
  const json = JSON.stringify(toFFmpegJson(timeline, projectSlug), null, 2)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleCopy() {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const btnStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--ink-2)',
    background: 'transparent',
    border: '1px solid var(--line-soft)',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
  }

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000 }}
      />
      {/* panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 600,
          height: '70vh',
          background: 'var(--paper-2)',
          borderRadius: 8,
          boxShadow: '0 16px 48px rgba(0,0,0,.45)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1001,
          overflow: 'hidden',
        }}
      >
        {/* header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1.5px solid var(--line)',
            background: 'var(--paper-3)',
          }}
        >
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink)', flex: 1 }}>
            ffmpeg JSON
          </span>
          <button onClick={handleCopy} style={btnStyle}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={onClose} style={{ ...btnStyle, fontSize: 16, padding: '0 6px', lineHeight: '20px' }}>
            ×
          </button>
        </div>
        {/* body */}
        <pre
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 12,
            margin: 0,
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--ink)',
            lineHeight: 1.5,
          }}
        >
          {json}
        </pre>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/editor/json-panel.tsx
git commit -m "feat: add JsonPanel modal"
```

---

## Task 6: Update `EditorToolbar`

**Files:**
- Modify: `components/editor/editor-toolbar.tsx`

- [ ] **Step 1: Replace `editor-toolbar.tsx`**

```tsx
'use client'

type Props = {
  snapOn: boolean
  onSnapChange: (on: boolean) => void
  canSplit: boolean
  onSplit: () => void
  showJson: boolean
  onToggleJson: () => void
}

export function EditorToolbar({ snapOn, onSnapChange, canSplit, onSplit, showJson, onToggleJson }: Props) {
  const btnBase: React.CSSProperties = {
    fontSize: 11,
    border: '1px solid var(--line-soft)',
    borderRadius: 3,
    padding: '1px 8px',
    background: 'transparent',
  }

  return (
    <div
      className="flex items-center gap-2 px-3 shrink-0"
      style={{ height: 34, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--line)' }}
    >
      <button
        title="Import media (coming soon)"
        disabled
        style={{ ...btnBase, color: 'var(--ink-3)', cursor: 'not-allowed' }}
      >
        ⬆ Import
      </button>
      <button
        title={canSplit ? 'Split clip at playhead (S)' : 'Move playhead over a clip to split'}
        disabled={!canSplit}
        onClick={onSplit}
        style={{ ...btnBase, color: canSplit ? 'var(--ink)' : 'var(--ink-3)', cursor: canSplit ? 'pointer' : 'not-allowed' }}
      >
        ✂ Split
      </button>

      <div style={{ width: 1, height: 16, background: 'var(--line-soft)', margin: '0 4px' }} />

      <label className="flex items-center gap-1" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={snapOn}
          onChange={(e) => onSnapChange(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 12, height: 12 }}
        />
        <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>Snap</span>
      </label>

      <span style={{ fontSize: 9, color: 'var(--ink-3)', fontFamily: 'monospace', marginLeft: 'auto' }}>
        16:9 · 1920×1080 · 30fps
      </span>

      <button
        title="View ffmpeg JSON"
        onClick={onToggleJson}
        style={{
          ...btnBase,
          fontFamily: 'monospace',
          color: showJson ? 'var(--accent)' : 'var(--ink-2)',
          borderColor: showJson ? 'var(--accent)' : 'var(--line-soft)',
          cursor: 'pointer',
        }}
      >
        {'{ }'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: TypeScript errors in `editor.tsx` because it now passes stale props. These will be fixed in Task 7.

- [ ] **Step 3: Commit**

```bash
git add components/editor/editor-toolbar.tsx
git commit -m "feat: enable Split button and add JSON panel toggle in toolbar"
```

---

## Task 7: Wire `editor.tsx`

**Files:**
- Modify: `components/editor/editor.tsx`

- [ ] **Step 1: Replace `editor.tsx`**

```tsx
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { editorReducer, initialHistory, emptyTimeline } from './use-editor'
import { useReducer } from 'react'
import { toFFmpegJson } from './to-ffmpeg-json'
import { EditorTopBar } from './editor-top-bar'
import { EditorToolbar } from './editor-toolbar'
import { MediaBrowser } from './media-browser'
import { PreviewPanel } from './preview-panel'
import { Timeline } from './timeline'
import { InspectorPanel } from './inspector-panel'
import { JsonPanel } from './json-panel'
import type { Timeline as TimelineType, MediaItem, Clip, DragState, EditorAction } from './types'

type Props = {
  orgSlug: string
  teamId: string
  projectId: string
  projectName: string
  projectSlug: string
  initialTimeline: TimelineType | null
  playlistItems: { driveFileId: string; duration: number | null; position: number; thumbnailUrl: string | null }[]
  secondsPerImage: number
}

function bootstrap(
  playlistItems: { driveFileId: string; duration: number | null; position: number; thumbnailUrl: string | null }[],
  secondsPerImage: number,
): TimelineType {
  const clips: Clip[] = playlistItems
    .sort((a, b) => a.position - b.position)
    .reduce<{ clips: Clip[]; cursor: number }>((acc, item, i) => {
      const dur = item.duration ?? secondsPerImage
      acc.clips.push({
        id: `boot-${i}`,
        mediaId: item.driveFileId,
        filename: item.driveFileId.slice(-8),
        thumbnailUrl: item.thumbnailUrl ?? undefined,
        start: acc.cursor,
        duration: dur,
      })
      acc.cursor += dur
      return acc
    }, { clips: [], cursor: 0 }).clips
  return {
    tracks: [
      { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, clips },
      { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, clips: [] },
    ],
  }
}

export function Editor({ orgSlug, teamId, projectId, projectName, projectSlug, initialTimeline, playlistItems, secondsPerImage }: Props) {
  const startTimeline = initialTimeline ?? (playlistItems.length > 0 ? bootstrap(playlistItems, secondsPerImage) : emptyTimeline)
  const [history, dispatch] = useReducer(editorReducer, initialHistory(startTimeline))
  const timeline = history.present

  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(() => Number(typeof window !== 'undefined' ? localStorage.getItem('kr-zoom') ?? '80' : '80'))
  const [snapOn, setSnapOn] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('kr-snap') !== 'false' : true)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [renderStatus, setRenderStatus] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didMountRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const apiBase = `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`

  // Stable ref for values needed by keyboard handler (avoids stale closures in useEffect([]))
  const editorStateRef = useRef({ timeline, playhead, snapOn })
  useEffect(() => { editorStateRef.current = { timeline, playhead, snapOn } })

  const totalDuration = Math.max(
    ...timeline.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)),
    0
  )

  const canSplit = timeline.tracks.some((t) => {
    if (t.locked) return false
    return t.clips.some((c) => c.start < playhead && playhead < c.start + c.duration)
  })

  function handleSplit() {
    const { timeline: tl, playhead: ph } = editorStateRef.current
    for (const track of tl.tracks) {
      if (track.locked) continue
      const clip = track.clips.find((c) => c.start < ph && ph < c.start + c.duration)
      if (clip) dispatch({ type: 'SPLIT_CLIP', trackId: track.id as 'V1' | 'A1', clipId: clip.id, at: ph })
    }
  }

  // Play loop
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastTimeRef.current = null; return }
    function tick(now: number) {
      if (lastTimeRef.current === null) { lastTimeRef.current = now }
      const dt = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now
      setPlayhead((p) => {
        const next = p + dt
        if (next >= totalDuration) { setPlaying(false); return totalDuration }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playing, totalDuration])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const meta = e.metaKey || e.ctrlKey
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p) }
      if (meta && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      if (meta && e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); dispatch({ type: 'REDO' }) }
      if (meta && e.code === 'KeyY') { e.preventDefault(); dispatch({ type: 'REDO' }) }
      if (e.code === 'KeyS' && !meta) {
        e.preventDefault()
        const { timeline: tl, playhead: ph } = editorStateRef.current
        for (const track of tl.tracks) {
          if (track.locked) continue
          const clip = track.clips.find((c) => c.start < ph && ph < c.start + c.duration)
          if (clip) dispatch({ type: 'SPLIT_CLIP', trackId: track.id as 'V1' | 'A1', clipId: clip.id, at: ph })
        }
      }
      if (e.code === 'KeyN' && !meta) {
        e.preventDefault()
        setSnapOn((s) => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // localStorage persistence
  useEffect(() => { localStorage.setItem('kr-zoom', String(zoom)) }, [zoom])
  useEffect(() => { localStorage.setItem('kr-snap', String(snapOn)) }, [snapOn])

  // Auto-save on timeline change
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await fetch(`${apiBase}/timeline`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeline }),
        })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch { setSaveStatus('idle') }
    }, 1000)
  }, [timeline, apiBase])

  // Poll render status on mount
  useEffect(() => {
    fetch(`${apiBase}/render`).then((r) => r.json()).then((job: unknown) => { const j = job as { status?: string }; if (j?.status) setRenderStatus(j.status) }).catch(() => {})
  }, [apiBase])

  // Drag-from-browser global pointer handlers
  useEffect(() => {
    if (!drag) return
    function onPointerMove(e: PointerEvent) {
      setDrag((d) => d ? { ...d, curX: e.clientX, curY: e.clientY } : null)
    }
    function onPointerUp() { setDrag(null) }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp) }
  }, [!!drag])

  const handleDragStart = useCallback((media: MediaItem, e: React.PointerEvent) => {
    e.preventDefault()
    setDrag({ media, curX: e.clientX, curY: e.clientY, overTrackId: null, overTime: 0 })
  }, [])

  const handleDragOver = useCallback((trackId: 'V1' | 'A1' | null, time: number) => {
    setDrag((d) => d ? { ...d, overTrackId: trackId, overTime: time } : null)
  }, [])

  const handleDrop = useCallback((trackId: 'V1' | 'A1', time: number) => {
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

  const handleUpdateClip = useCallback((trackId: 'V1' | 'A1', clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut'>>) => {
    dispatch({ type: 'UPDATE_CLIP', trackId, clipId, patch })
  }, [])

  async function handleExport() {
    const ffmpegJson = toFFmpegJson(timeline, projectSlug)
    const res = await fetch(`${apiBase}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timelineJson: JSON.stringify(ffmpegJson) }),
    })
    if (res.ok) {
      const job = await res.json() as { status: string }
      setRenderStatus(job.status)
    }
  }

  function handleManualSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    fetch(`${apiBase}/timeline`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline }),
    }).then(() => { setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000) })
  }

  const v1 = timeline.tracks.find((t) => t.id === 'V1')!
  const prevTime = v1.clips.map((c) => c.start).filter((s) => s < playhead - 0.01).sort((a, b) => b - a)[0] ?? 0
  const nextTime = v1.clips.map((c) => c.start).filter((s) => s > playhead + 0.01).sort((a, b) => a - b)[0] ?? playhead

  return (
    <div
      className="editor-root flex flex-col"
      style={{ height: 'calc(100dvh - 3.5rem)', overflow: 'hidden' }}
    >
      <EditorTopBar
        projectName={projectName}
        orgSlug={orgSlug}
        teamId={teamId}
        projectId={projectId}
        history={history}
        saveStatus={saveStatus}
        renderStatus={renderStatus}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
        onSave={handleManualSave}
        onExport={handleExport}
        dispatch={dispatch as (a: { type: string }) => void}
      />
      <EditorToolbar
        snapOn={snapOn}
        onSnapChange={setSnapOn}
        canSplit={canSplit}
        onSplit={handleSplit}
        showJson={showJson}
        onToggleJson={() => setShowJson((v) => !v)}
      />

      <div className="flex flex-1 min-h-0">
        <MediaBrowser
          orgSlug={orgSlug}
          teamId={teamId}
          projectId={projectId}
          onDragStart={handleDragStart}
        />
        <PreviewPanel
          timeline={timeline}
          playhead={playhead}
          playing={playing}
          totalDuration={totalDuration}
          onSeek={setPlayhead}
          onPlayPause={() => setPlaying((p) => !p)}
          onPrev={() => setPlayhead(prevTime)}
          onNext={() => setPlayhead(nextTime)}
        />
        <InspectorPanel
          timeline={timeline}
          selectedClipId={selectedClipId}
          onUpdateClip={handleUpdateClip}
        />
      </div>

      <Timeline
        timeline={timeline}
        playhead={playhead}
        zoom={zoom}
        selectedClipId={selectedClipId}
        snapOn={snapOn}
        drag={drag}
        totalDuration={totalDuration}
        onSeekRuler={setPlayhead}
        onZoomChange={setZoom}
        onMoveClip={(tid, cid, start) => dispatch({ type: 'MOVE_CLIP', trackId: tid, clipId: cid, newStart: start })}
        onResizeClip={(tid, cid, dur) => dispatch({ type: 'RESIZE_CLIP', trackId: tid, clipId: cid, newDuration: dur })}
        onRemoveClip={(tid, cid) => dispatch({ type: 'REMOVE_CLIP', trackId: tid, clipId: cid })}
        onSelectClip={setSelectedClipId}
        onToggleMute={(tid) => dispatch({ type: 'TOGGLE_MUTE', trackId: tid })}
        onToggleLock={(tid) => dispatch({ type: 'TOGGLE_LOCK', trackId: tid })}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      />

      {/* Drag ghost */}
      {drag && (
        <div
          style={{
            position: 'fixed',
            left: drag.curX - 36,
            top: drag.curY - 27,
            width: 72, height: 54,
            background: 'var(--paper-3)',
            border: '1.5px solid var(--line)',
            borderRadius: 3,
            boxShadow: '0 10px 24px rgba(0,0,0,.28)',
            transform: 'rotate(-2deg)',
            pointerEvents: 'none',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {drag.media.thumbnailUrl && (
            <img src={drag.media.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>
      )}

      {showJson && (
        <JsonPanel
          timeline={timeline}
          projectSlug={projectSlug}
          onClose={() => setShowJson(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run all tests to confirm nothing regressed**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/editor/editor.tsx
git commit -m "feat: wire inspector panel, JSON panel, S/N shortcuts in editor"
```

---

## Verification Checklist

After all tasks are complete, manually verify in the browser:

- [ ] Inspector panel appears on the right; shows "Select a clip" when nothing is selected
- [ ] Clicking a clip shows its filename, duration, fade in/out sliders
- [ ] Adjusting fade sliders updates the clip (reflected in JSON panel)
- [ ] `S` key splits the clip at the playhead; both halves visible in timeline
- [ ] Split button in toolbar is disabled when playhead is not over a clip, enabled when it is
- [ ] `N` key toggles the Snap checkbox
- [ ] `{ }` button in toolbar opens JSON panel; panel shows current ffmpeg JSON
- [ ] JSON panel Copy button copies to clipboard
- [ ] JSON panel closes with Escape or `×` button
- [ ] Undo/redo works for split and fade changes
- [ ] Auto-save still fires after fade changes
