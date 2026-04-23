# Group 2 — Per-Clip Ken Burns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users customize the Ken Burns effect per video clip — or disable it entirely — via the InspectorPanel.

**Architecture:** Add `KBPosition` string union and optional `kenBurns` field to `Clip`. Widen the `UPDATE_CLIP` action patch to include `kenBurns`. Update `toFFmpegJson` to serialize per-clip values. Add a Ken Burns section to `InspectorPanel` (V1 clips only) with an on/off toggle, two 3×3 position pickers (start and end), and a scale slider. The reducer needs no code change — `UPDATE_CLIP` already spreads any patch onto the clip.

**Tech Stack:** React 19 (functional components, hooks), TypeScript, Vitest, CSS custom properties.

---

## File Map

| File | Change |
|------|--------|
| `components/editor/types.ts` | Add `KBPosition` union; add `kenBurns?` to `Clip`; widen `UPDATE_CLIP` patch |
| `components/editor/to-ffmpeg-json.ts` | Update `FFmpegVideoClip.kenburns` type; use per-clip value in `serializeClip` |
| `components/editor/inspector-panel.tsx` | Add `KBGrid` sub-component; add Ken Burns section for V1 clips; widen `onUpdateClip` prop type |
| `components/editor/editor.tsx` | Widen `handleUpdateClip` callback signature |
| `components/editor/use-editor.test.ts` | Add 2 tests for `UPDATE_CLIP` with `kenBurns` patch |
| `components/editor/to-ffmpeg-json.test.ts` | Update existing default test; add 2 new per-clip kenBurns tests |

---

### Task 1: Extend Clip type and UPDATE_CLIP action

**Files:**
- Modify: `components/editor/types.ts`
- Test: `components/editor/use-editor.test.ts`

- [ ] **Step 1: Write two failing tests for UPDATE_CLIP with kenBurns**

Open `components/editor/use-editor.test.ts`. Inside the existing `describe('UPDATE_CLIP', ...)` block (after the last `it(...)` at the bottom of that block, before the closing `})`), add:

```ts
    it('patches kenBurns on a clip', () => {
      const next = editorReducer(makeHistory(withClip), {
        type: 'UPDATE_CLIP',
        trackId: 'V1',
        clipId: 'c1',
        patch: { kenBurns: { from: 'top-left', to: 'bottom-right', scale: 1.1 } },
      })
      expect(next.present.tracks[0].clips[0].kenBurns).toEqual({
        from: 'top-left',
        to: 'bottom-right',
        scale: 1.1,
      })
    })

    it('patches kenBurns to null (disables Ken Burns)', () => {
      const clipWithKB: Clip = { ...clipToUpdate, kenBurns: { from: 'center', to: 'bottom-right', scale: 1.08 } }
      const tl: Timeline = {
        ...emptyTimeline,
        tracks: [{ ...emptyTimeline.tracks[0], clips: [clipWithKB] }, emptyTimeline.tracks[1]],
      }
      const next = editorReducer(makeHistory(tl), {
        type: 'UPDATE_CLIP',
        trackId: 'V1',
        clipId: 'c1',
        patch: { kenBurns: null },
      })
      expect(next.present.tracks[0].clips[0].kenBurns).toBeNull()
    })
```

- [ ] **Step 2: Run tests to confirm TypeScript compilation fails**

```bash
npm test 2>&1 | head -30
```

Expected: TypeScript error like `Object literal may only specify known properties` or `'kenBurns' does not exist in type 'Partial<Pick<Clip, "fadeIn" | "fadeOut">>'`.

- [ ] **Step 3: Add KBPosition type and kenBurns field to Clip**

Replace the `Clip` type block and the `UPDATE_CLIP` action line in `components/editor/types.ts`:

The complete updated file:

```ts
export type MediaItem = {
  id: string          // Drive file ID
  kind: 'image' | 'audio'
  filename: string
  thumbnailUrl?: string
  defaultDuration: number  // seconds
}

export type KBPosition =
  'top-left' | 'top' | 'top-right' |
  'left'     | 'center' | 'right'  |
  'bottom-left' | 'bottom' | 'bottom-right'

export type Clip = {
  id: string
  mediaId: string       // Drive file ID (used as `source` in ffmpeg JSON)
  filename: string
  thumbnailUrl?: string // images only
  start: number         // seconds from t=0
  duration: number      // seconds
  fadeIn?: number       // seconds; undefined treated as 0.2
  fadeOut?: number      // seconds; undefined treated as 0.2
  kenBurns?: { from: KBPosition; to: KBPosition; scale: number } | null
  // undefined = use default (center→bottom-right, 1.08×); null = disabled (static)
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
  | { type: 'UPDATE_CLIP'; trackId: 'V1' | 'A1'; clipId: string; patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>> }
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass (the reducer already handles any patch via `{ ...c, ...action.patch }`).

- [ ] **Step 5: Commit**

```bash
git add components/editor/types.ts components/editor/use-editor.test.ts
git commit -m "feat: add KBPosition type and kenBurns field to Clip"
```

---

### Task 2: Update toFFmpegJson for per-clip kenBurns (TDD)

**Files:**
- Modify: `components/editor/to-ffmpeg-json.ts`
- Test: `components/editor/to-ffmpeg-json.test.ts`

- [ ] **Step 1: Update existing kenburns test and add two new tests**

In `components/editor/to-ffmpeg-json.test.ts`:

**Update** the existing `'maps video clips with kenburns and fade transition'` test — change `to: 'in'` to `to: 'bottom-right'`:

```ts
  it('maps video clips with kenburns and fade transition', () => {
    const result = toFFmpegJson(timeline, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    expect(vTrack.clips[0]).toMatchObject({
      type: 'image',
      source: 'drive-abc',
      in: 0,
      out: 3,
      start: 0,
      end: 3,
      kenburns: { from: 'center', to: 'bottom-right', scale: 1.08 },
      transition: { in: 'fade', duration: 0.2 },
    })
  })
```

**Add** these two new tests after the existing ones:

```ts
  it('uses per-clip kenBurns values when set', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        {
          ...timeline.tracks[0],
          clips: [{ ...timeline.tracks[0].clips[0], kenBurns: { from: 'top-left', to: 'bottom-right', scale: 1.15 } }, timeline.tracks[0].clips[1]],
        },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    expect(vTrack.clips[0]).toMatchObject({
      kenburns: { from: 'top-left', to: 'bottom-right', scale: 1.15 },
    })
    // second clip has no kenBurns, should use default
    expect(vTrack.clips[1]).toMatchObject({
      kenburns: { from: 'center', to: 'bottom-right', scale: 1.08 },
    })
  })

  it('emits kenburns: null when kenBurns is null (static clip)', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        {
          ...timeline.tracks[0],
          clips: [{ ...timeline.tracks[0].clips[0], kenBurns: null }, timeline.tracks[0].clips[1]],
        },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    expect((vTrack.clips[0] as { kenburns: unknown }).kenburns).toBeNull()
  })
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
npm test 2>&1 | grep -A 3 "FAIL\|Expected\|kenburns"
```

Expected: the updated `'maps video clips with kenburns'` test fails (got `to: 'in'`, expected `to: 'bottom-right'`). The two new tests also fail.

- [ ] **Step 3: Update to-ffmpeg-json.ts**

Replace the full file:

```ts
import type { Timeline, Clip, Track, KBPosition } from '@/components/editor/types'

type FFmpegVideoClip = {
  id: string; type: 'image'; source: string
  in: number; out: number; start: number; end: number
  kenburns: { from: KBPosition; to: KBPosition; scale: number } | null
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

const DEFAULT_KB = { from: 'center' as KBPosition, to: 'bottom-right' as KBPosition, scale: 1.08 }

function clipEnd(clip: Clip): number {
  return clip.start + clip.duration
}

function serializeClip(clip: Clip, kind: 'video' | 'audio'): FFmpegClip {
  const base = { id: clip.id, source: clip.mediaId, in: clip.start, out: clipEnd(clip), start: clip.start, end: clipEnd(clip) }
  if (kind === 'video') {
    return {
      ...base,
      type: 'image',
      kenburns: clip.kenBurns === null ? null : (clip.kenBurns ?? DEFAULT_KB),
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

- [ ] **Step 4: Run tests to confirm all pass**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/editor/to-ffmpeg-json.ts components/editor/to-ffmpeg-json.test.ts
git commit -m "feat: per-clip kenBurns in toFFmpegJson"
```

---

### Task 3: Add Ken Burns controls to InspectorPanel and widen editor.tsx

**Files:**
- Modify: `components/editor/inspector-panel.tsx`
- Modify: `components/editor/editor.tsx`

- [ ] **Step 1: Replace inspector-panel.tsx**

```tsx
'use client'
import type { CSSProperties } from 'react'
import type { Timeline, Clip, KBPosition } from './types'

type Props = {
  timeline: Timeline
  selectedClipId: string | null
  onUpdateClip: (trackId: 'V1' | 'A1', clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>>) => void
}

const panelStyle: CSSProperties = {
  width: 180,
  flexShrink: 0,
  background: 'var(--paper-2)',
  borderLeft: '1.5px solid var(--line)',
  padding: '10px',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
}

const DEFAULT_KB = { from: 'center' as KBPosition, to: 'bottom-right' as KBPosition, scale: 1.08 }

const KB_POSITIONS: KBPosition[][] = [
  ['top-left', 'top', 'top-right'],
  ['left', 'center', 'right'],
  ['bottom-left', 'bottom', 'bottom-right'],
]

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

function KBGrid({
  label,
  value,
  onChange,
}: {
  label: string
  value: KBPosition
  onChange: (v: KBPosition) => void
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 20px)', gap: 2 }}>
        {KB_POSITIONS.flat().map((pos) => (
          <button
            key={pos}
            title={pos}
            onClick={() => onChange(pos)}
            style={{
              width: 20,
              height: 20,
              border: `1px solid ${pos === value ? 'var(--accent)' : 'var(--line-soft)'}`,
              borderRadius: 2,
              background: pos === value ? 'var(--accent)' : 'var(--paper)',
              opacity: pos === value ? 0.8 : 1,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function InspectorPanel({ timeline, selectedClipId, onUpdateClip }: Props) {
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
  const isVideo = trackId === 'V1'
  const isOn = clip.kenBurns !== null
  const effectiveKB = clip.kenBurns ?? DEFAULT_KB

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
      {isVideo && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '0 0 10px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>Ken Burns</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isOn}
                onChange={(e) => onUpdateClip(trackId, clip.id, { kenBurns: e.target.checked ? DEFAULT_KB : null })}
                style={{ accentColor: 'var(--accent)', width: 11, height: 11 }}
              />
              <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{isOn ? 'on' : 'off'}</span>
            </label>
          </div>
          {isOn && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <KBGrid
                  label="Start"
                  value={effectiveKB.from}
                  onChange={(v) => onUpdateClip(trackId, clip.id, { kenBurns: { ...effectiveKB, from: v } })}
                />
                <KBGrid
                  label="End"
                  value={effectiveKB.to}
                  onChange={(v) => onUpdateClip(trackId, clip.id, { kenBurns: { ...effectiveKB, to: v } })}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>Scale</span>
                <input
                  type="range"
                  min={1}
                  max={1.3}
                  step={0.01}
                  value={effectiveKB.scale}
                  onChange={(e) => onUpdateClip(trackId, clip.id, { kenBurns: { ...effectiveKB, scale: parseFloat(e.target.value) } })}
                  style={{ width: 60, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 10, color: 'var(--ink)', minWidth: 30, textAlign: 'right', fontFamily: 'monospace' }}>
                  {effectiveKB.scale.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Widen handleUpdateClip in editor.tsx**

In `components/editor/editor.tsx`, find line 199 (the `handleUpdateClip` useCallback). Change only the patch type:

```ts
  const handleUpdateClip = useCallback((trackId: 'V1' | 'A1', clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>>) => {
    dispatch({ type: 'UPDATE_CLIP', trackId, clipId, patch })
  }, [])
```

- [ ] **Step 3: Run all tests**

```bash
npm test 2>&1 | tail -10
```

Expected: all 44 tests pass (no new tests for the UI component — the type widening is validated by TypeScript).

- [ ] **Step 4: Commit**

```bash
git add components/editor/inspector-panel.tsx components/editor/editor.tsx
git commit -m "feat: Ken Burns controls in InspectorPanel"
```

---

## Verification

After all tasks, the full test suite runs clean:

```bash
npm test
```

Expected:
```
Test Files  10 passed (10)
     Tests  46 passed (46)
```

(44 existing + 2 new kenBurns reducer tests)
