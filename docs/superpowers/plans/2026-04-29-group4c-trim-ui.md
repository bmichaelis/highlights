# Group 4C — Trim UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-editor UI for trimming audio clips — left-edge drag handles on the timeline plus mm:ss.s numeric inputs in the inspector. Probes the source file's true duration on drop to bound the trim.

**Architecture:** Add `sourceDuration` to the `Clip` type (probed client-side via HTML5 audio metadata at drop time). Add a `TRIM_LEFT` reducer action that adjusts `sourceIn`, `start`, and `duration` together so the clip's right edge on the timeline stays put. Clamp `RESIZE_CLIP` to the source bound. Render a left-edge drag handle (audio clips only) plus a "Trim source" inspector section above the existing Fades.

**Tech Stack:** React 19 + Next.js 16 (`components/editor/`), Vitest (`npm test`), TypeScript, HTML5 Audio API.

---

## File Map

| File | Change |
|------|--------|
| `components/editor/types.ts` | Add `sourceDuration?: number` to `Clip`; add `TRIM_LEFT` action |
| `components/editor/use-editor.ts` | Handle `TRIM_LEFT`; clamp `RESIZE_CLIP` to source bound; fix `SPLIT_CLIP` `sourceIn` math |
| `components/editor/use-editor.test.ts` | Tests for `TRIM_LEFT`, `RESIZE_CLIP` clamp, `SPLIT_CLIP` `sourceIn` |
| `components/editor/inspector-panel.tsx` | Export `formatMMSS`/`parseMMSS`; add Trim source section (audio only); accept `onTrimLeft`/`onResizeClip` props |
| `components/editor/inspector-panel.test.ts` | New file — `formatMMSS`/`parseMMSS` tests |
| `components/editor/timeline.tsx` | Add left-edge handle on audio clips; `onTrimLeftClip` prop |
| `components/editor/editor.tsx` | `probeAudioDuration` + cache; await on audio drop; pass new callbacks to Inspector and Timeline |
| `components/editor/to-ffmpeg-json.test.ts` | Test trimmed audio serialization |

---

### Task 1: Add `sourceDuration` field and `TRIM_LEFT` action type

**Files:**
- Modify: `components/editor/types.ts`

- [ ] **Step 1: Add `sourceDuration` to `Clip`**

In `components/editor/types.ts`, find the `Clip` type and add `sourceDuration` after `sourceIn`:

```ts
export type Clip = {
  id: string
  mediaId: string
  filename: string
  thumbnailUrl?: string
  start: number
  duration: number
  sourceIn?: number     // seconds into source file where playback begins; undefined = 0
  sourceDuration?: number  // seconds; full length of source audio file. undefined = unknown (no clamp)
  fadeIn?: number
  fadeOut?: number
  kenBurns?: { from: KBPosition; to: KBPosition; scale: number } | null
}
```

- [ ] **Step 2: Add `TRIM_LEFT` to `EditorAction`**

In the same file, add a new variant to the `EditorAction` union after `RESIZE_CLIP`:

```ts
| { type: 'RESIZE_CLIP'; trackId: string; clipId: string; newDuration: number }
| { type: 'TRIM_LEFT'; trackId: string; clipId: string; newSourceIn: number }
| { type: 'SPLIT_CLIP'; trackId: string; clipId: string; at: number }
```

- [ ] **Step 3: Run tests to confirm existing suite still passes**

```bash
npm test
```

Expected: all 56 tests still pass. (Adding optional fields and a new action variant is backwards-compatible.)

- [ ] **Step 4: Commit**

```bash
git add components/editor/types.ts
git commit -m "feat: add sourceDuration field and TRIM_LEFT action type"
```

---

### Task 2: Implement `TRIM_LEFT` reducer with clamps

**Files:**
- Modify: `components/editor/use-editor.test.ts`
- Modify: `components/editor/use-editor.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe('TRIM_LEFT', ...)` block inside the existing `describe('editorReducer', ...)` in `components/editor/use-editor.test.ts`. Place it right after the `describe('SPLIT_CLIP', ...)` block:

```ts
  describe('TRIM_LEFT', () => {
    const audioClip: Clip = {
      id: 'a1', mediaId: 'song-id', filename: 'song.mp3',
      start: 5, duration: 10, sourceIn: 0, sourceDuration: 60,
    }
    const withClip: Timeline = {
      ...emptyTimeline,
      tracks: [emptyTimeline.tracks[0], { ...emptyTimeline.tracks[1], clips: [audioClip] }],
    }

    it('shifts start and shrinks duration by the same delta as sourceIn', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 3 })
      const c = next.present.tracks[1].clips[0]
      expect(c.sourceIn).toBe(3)
      expect(c.start).toBe(8)
      expect(c.duration).toBe(7)
      // right edge on timeline (start + duration) stays at 15
      expect(c.start + c.duration).toBe(15)
    })

    it('clamps newSourceIn to [0, sourceDuration - 0.3] when sourceDuration is known', () => {
      const high = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 999 })
      expect(high.present.tracks[1].clips[0].sourceIn).toBe(59.7)

      const low = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: -5 })
      expect(low.present.tracks[1].clips[0].sourceIn).toBe(0)
    })

    it('clamps newSourceIn to >= 0 only when sourceDuration is undefined', () => {
      const noDur: Clip = { ...audioClip, sourceDuration: undefined }
      const tl: Timeline = { ...emptyTimeline, tracks: [emptyTimeline.tracks[0], { ...emptyTimeline.tracks[1], clips: [noDur] }] }
      const next = editorReducer(makeHistory(tl), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 999 })
      expect(next.present.tracks[1].clips[0].sourceIn).toBe(999)
    })

    it('treats undefined sourceIn as 0 when computing delta', () => {
      const noIn: Clip = { ...audioClip, sourceIn: undefined }
      const tl: Timeline = { ...emptyTimeline, tracks: [emptyTimeline.tracks[0], { ...emptyTimeline.tracks[1], clips: [noIn] }] }
      const next = editorReducer(makeHistory(tl), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 2 })
      const c = next.present.tracks[1].clips[0]
      expect(c.sourceIn).toBe(2)
      expect(c.start).toBe(7)
      expect(c.duration).toBe(8)
    })

    it('pushes to undo history', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 3 })
      expect(next.past).toHaveLength(1)
    })

    it('UNDO restores original sourceIn/start/duration', () => {
      const after = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 3 })
      const undone = editorReducer(after, { type: 'UNDO' })
      const c = undone.present.tracks[1].clips[0]
      expect(c.sourceIn).toBe(0)
      expect(c.start).toBe(5)
      expect(c.duration).toBe(10)
    })
  })
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "TRIM_LEFT|FAIL"
```

Expected: 6 failing tests (no `TRIM_LEFT` handler yet; reducer falls through to `default` and returns state unchanged).

- [ ] **Step 3: Implement `TRIM_LEFT` in `use-editor.ts`**

In `components/editor/use-editor.ts`, add a new `case` in `editorReducer` after the `RESIZE_CLIP` case (around line 62):

```ts
    case 'TRIM_LEFT': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          clips.map((c) => {
            if (c.id !== action.clipId) return c
            const origIn = c.sourceIn ?? 0
            const maxIn = c.sourceDuration !== undefined
              ? Math.max(0, c.sourceDuration - 0.3)
              : Infinity
            const newIn = Math.max(0, Math.min(maxIn, action.newSourceIn))
            const delta = newIn - origIn
            return { ...c, sourceIn: newIn, start: c.start + delta, duration: c.duration - delta }
          })
        ),
      }
      return pushHistory(state, next)
    }
```

Notes:
- `updateTrack` is the existing helper at the top of the file.
- We do NOT call `normalizeTrack` here because the right edge on the timeline is invariant — moving the left edge inward never causes overlap with neighbors.
- `Math.max(0, ...)` on `sourceDuration - 0.3` guards against tiny source files.

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

Expected: all tests pass, including the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add components/editor/use-editor.ts components/editor/use-editor.test.ts
git commit -m "feat: add TRIM_LEFT reducer with sourceDuration clamp"
```

---

### Task 3: Clamp `RESIZE_CLIP` to source bound

**Files:**
- Modify: `components/editor/use-editor.test.ts`
- Modify: `components/editor/use-editor.ts`

- [ ] **Step 1: Write failing tests**

In `components/editor/use-editor.test.ts`, add these tests after the existing `'RESIZE_CLIP clamps to minimum 0.3'` test (around line 67):

```ts
  it('RESIZE_CLIP clamps to sourceDuration - sourceIn when sourceDuration is set', () => {
    const audioClip: Clip = {
      id: 'a1', mediaId: 'song-id', filename: 'song.mp3',
      start: 0, duration: 10, sourceIn: 5, sourceDuration: 60,
    }
    const tl: Timeline = { ...emptyTimeline, tracks: [emptyTimeline.tracks[0], { ...emptyTimeline.tracks[1], clips: [audioClip] }] }
    const next = editorReducer(makeHistory(tl), { type: 'RESIZE_CLIP', trackId: 'A1', clipId: 'a1', newDuration: 999 })
    // sourceIn=5, sourceDuration=60 → max duration = 55
    expect(next.present.tracks[1].clips[0].duration).toBe(55)
  })

  it('RESIZE_CLIP without sourceDuration only enforces 0.3 minimum', () => {
    const tl: Timeline = {
      ...emptyTimeline,
      tracks: [{ ...emptyTimeline.tracks[0], clips: [clip] }, emptyTimeline.tracks[1]],
    }
    const next = editorReducer(makeHistory(tl), { type: 'RESIZE_CLIP', trackId: 'V1', clipId: 'c1', newDuration: 99 })
    expect(next.present.tracks[0].clips[0].duration).toBe(99)
  })
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test
```

Expected: the first new test fails (no source-bound clamp); the second passes (existing behavior already permits any `newDuration ≥ 0.3`).

- [ ] **Step 3: Update `RESIZE_CLIP` handler**

In `components/editor/use-editor.ts`, replace the existing `RESIZE_CLIP` case (around lines 54-62) with:

```ts
    case 'RESIZE_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          normalizeTrack(clips.map((c) => {
            if (c.id !== action.clipId) return c
            const maxDur = c.sourceDuration !== undefined
              ? c.sourceDuration - (c.sourceIn ?? 0)
              : Infinity
            const newDuration = Math.max(0.3, Math.min(maxDur, action.newDuration))
            return { ...c, duration: newDuration }
          }))
        ),
      }
      return pushHistory(state, next)
    }
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/editor/use-editor.ts components/editor/use-editor.test.ts
git commit -m "feat: clamp RESIZE_CLIP to sourceDuration - sourceIn"
```

---

### Task 4: Fix `SPLIT_CLIP` to recompute `sourceIn` on right half

**Files:**
- Modify: `components/editor/use-editor.test.ts`
- Modify: `components/editor/use-editor.ts`

- [ ] **Step 1: Write failing test**

In `components/editor/use-editor.test.ts`, inside the existing `describe('SPLIT_CLIP', ...)` block, add a new test after `'right clip inherits thumbnailUrl from original'`:

```ts
    it('right clip recomputes sourceIn for trimmed audio', () => {
      const trimmed: Clip = {
        id: 'a1', mediaId: 'song-id', filename: 'song.mp3',
        start: 5, duration: 20, sourceIn: 10, sourceDuration: 60,
      }
      const tl: Timeline = {
        ...emptyTimeline,
        tracks: [emptyTimeline.tracks[0], { ...emptyTimeline.tracks[1], clips: [trimmed] }],
      }
      // Split at timeline t=12 — that's 7s into the clip → source position 17
      const next = editorReducer(makeHistory(tl), { type: 'SPLIT_CLIP', trackId: 'A1', clipId: 'a1', at: 12 })
      const clips = next.present.tracks[1].clips
      expect(clips).toHaveLength(2)
      expect(clips[0]).toMatchObject({ start: 5, duration: 7, sourceIn: 10 })
      expect(clips[1]).toMatchObject({ start: 12, duration: 13, sourceIn: 17 })
    })
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test
```

Expected: new test fails — current code spreads `clip` into the right half so `sourceIn` is `10`, not `17`.

- [ ] **Step 3: Fix `SPLIT_CLIP` handler**

In `components/editor/use-editor.ts`, find the `SPLIT_CLIP` case (around lines 63-82). Update the `right` clip definition:

```ts
      const right: Clip = {
        ...clip,
        id: crypto.randomUUID(),
        start: action.at,
        duration: (clip.start + clip.duration) - action.at,
        sourceIn: (clip.sourceIn ?? 0) + (action.at - clip.start),
        fadeIn: 0,
      }
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

Expected: all tests pass, including all of the existing `SPLIT_CLIP` tests (the fix only adds a new field; existing tests don't check `sourceIn`).

- [ ] **Step 5: Commit**

```bash
git add components/editor/use-editor.ts components/editor/use-editor.test.ts
git commit -m "fix: recompute sourceIn on right half of SPLIT_CLIP"
```

---

### Task 5: `formatMMSS` and `parseMMSS` helpers + tests

**Files:**
- Create: `components/editor/inspector-panel.test.ts`
- Modify: `components/editor/inspector-panel.tsx`

- [ ] **Step 1: Write failing tests**

Create `components/editor/inspector-panel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatMMSS, parseMMSS } from './inspector-panel'

describe('formatMMSS', () => {
  it('formats 0 as "0:00.0"', () => {
    expect(formatMMSS(0)).toBe('0:00.0')
  })

  it('formats sub-minute values with leading zero in seconds', () => {
    expect(formatMMSS(12)).toBe('0:12.0')
    expect(formatMMSS(5.5)).toBe('0:05.5')
  })

  it('formats values over a minute', () => {
    expect(formatMMSS(65.5)).toBe('1:05.5')
  })

  it('formats values over an hour without rolling over to hours', () => {
    expect(formatMMSS(3661)).toBe('61:01.0')
  })
})

describe('parseMMSS', () => {
  it('parses plain seconds with decimals', () => {
    expect(parseMMSS('12.0')).toBe(12)
    expect(parseMMSS('5.5')).toBe(5.5)
  })

  it('parses M:SS.S format', () => {
    expect(parseMMSS('0:12.0')).toBe(12)
    expect(parseMMSS('1:05.5')).toBe(65.5)
  })

  it('returns null on garbage input', () => {
    expect(parseMMSS('garbage')).toBeNull()
    expect(parseMMSS('')).toBeNull()
    expect(parseMMSS(':12')).toBeNull()
    expect(parseMMSS('1:')).toBeNull()
  })

  it('returns null when seconds component is >= 60', () => {
    expect(parseMMSS('1:60')).toBeNull()
    expect(parseMMSS('0:99.9')).toBeNull()
  })

  it('returns null on negative values', () => {
    expect(parseMMSS('-5')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test
```

Expected: all 9 tests in the new file fail with "formatMMSS is not a function" (or the named-export equivalent).

- [ ] **Step 3: Add helpers to `inspector-panel.tsx`**

In `components/editor/inspector-panel.tsx`, add the helpers near the top of the file, just after the imports and before the `panelStyle` definition:

```ts
export function formatMMSS(s: number): string {
  const safe = Math.max(0, s)
  const m = Math.floor(safe / 60)
  const sec = (safe - m * 60).toFixed(1)
  return `${m}:${sec.padStart(4, '0')}`
}

export function parseMMSS(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (trimmed.startsWith('-')) return null
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx === -1) {
    const n = Number(trimmed)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const mStr = trimmed.slice(0, colonIdx)
  const sStr = trimmed.slice(colonIdx + 1)
  if (mStr === '' || sStr === '') return null
  const m = Number(mStr)
  const s = Number(sStr)
  if (!Number.isFinite(m) || !Number.isFinite(s)) return null
  if (m < 0 || s < 0 || s >= 60) return null
  return m * 60 + s
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

Expected: all 9 new tests pass; existing 56 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add components/editor/inspector-panel.tsx components/editor/inspector-panel.test.ts
git commit -m "feat: add formatMMSS / parseMMSS helpers"
```

---

### Task 6: Inspector panel — Trim source section

**Files:**
- Modify: `components/editor/inspector-panel.tsx`
- Modify: `components/editor/editor.tsx`

- [ ] **Step 1: Widen `Props` `trackId` types and add new callbacks**

The existing inspector narrows `trackId` to `'V1' | 'A1'`, but `ADD_AUDIO_TRACK` can create `A2`/`A3`/etc. — without widening, trim dispatches from A2 would silently misroute to A1. Widen all three callbacks to `string`.

In `components/editor/inspector-panel.tsx`, replace the `Props` type (around lines 6-10):

```ts
type Props = {
  timeline: Timeline
  selectedClipId: string | null
  onUpdateClip: (trackId: string, clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>>) => void
  onTrimLeft: (trackId: string, clipId: string, newSourceIn: number) => void
  onResizeClip: (trackId: string, clipId: string, newDuration: number) => void
}
```

Update the function signature destructure on the `InspectorPanel` line (around line 111):

```ts
export function InspectorPanel({ timeline, selectedClipId, onUpdateClip, onTrimLeft, onResizeClip }: Props) {
```

Inside the function body, find the lookup loop (around lines 112-117). Widen `selectedTrackId` and remove the cast:

```ts
  let selectedClip: Clip | null = null
  let selectedTrackId: string | null = null
  for (const track of timeline.tracks) {
    const c = track.clips.find((c) => c.id === selectedClipId)
    if (c) { selectedClip = c; selectedTrackId = track.id; break }
  }
```

Then find the variable assignment after the early return (around line 130) — leave `const trackId = selectedTrackId` as-is (it now has type `string`). Update the `isVideo` line below it:

```ts
  const isVideo = trackId === 'V1'
```

(No code change — it works the same with `trackId: string`.)

- [ ] **Step 2: Add `MMSSInput` and `TrimSection` sub-components above `InspectorPanel`**

In `components/editor/inspector-panel.tsx`, add these components above the `InspectorPanel` function (right after the existing `KBGrid` component):

```tsx
function MMSSInput({
  value,
  min,
  max,
  onCommit,
}: {
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(formatMMSS(value))
  // Re-sync draft when external value changes
  const lastValueRef = useRef(value)
  if (lastValueRef.current !== value) {
    lastValueRef.current = value
    if (parseMMSS(draft) !== value) setDraft(formatMMSS(value))
  }

  function commit() {
    const parsed = parseMMSS(draft)
    if (parsed === null) { setDraft(formatMMSS(value)); return }
    const clamped = Math.max(min, Math.min(max, parsed))
    if (clamped !== value) onCommit(clamped)
    setDraft(formatMMSS(clamped))
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{
        width: 60, fontSize: 10, fontFamily: 'monospace',
        background: 'var(--paper-3)', color: 'var(--ink)',
        border: '1px solid var(--line-soft)', borderRadius: 2,
        padding: '1px 4px', textAlign: 'right',
      }}
    />
  )
}

function TrimSection({
  clip,
  trackId,
  onTrimLeft,
  onResizeClip,
}: {
  clip: Clip
  trackId: string
  onTrimLeft: (trackId: string, clipId: string, newSourceIn: number) => void
  onResizeClip: (trackId: string, clipId: string, newDuration: number) => void
}) {
  const sourceIn = clip.sourceIn ?? 0
  const sourceOut = sourceIn + clip.duration
  const sourceDuration = clip.sourceDuration
  const minDuration = 0.3
  const maxSourceIn = sourceDuration !== undefined ? Math.max(0, sourceDuration - minDuration) : Infinity
  const maxSourceOut = sourceDuration !== undefined ? sourceDuration : Infinity
  const canReset = sourceIn > 0
  const fillStart = sourceDuration ? (sourceIn / sourceDuration) * 100 : 0
  const fillWidth = sourceDuration ? (clip.duration / sourceDuration) * 100 : 0

  return (
    <>
      <div style={{ fontSize: 10, color: 'var(--ink-2)', marginBottom: 4 }}>Trim source</div>
      {sourceDuration !== undefined && (
        <div
          style={{
            height: 4, background: 'var(--paper-3)', borderRadius: 2,
            position: 'relative', marginBottom: 8,
          }}
          title={`Source duration ${formatMMSS(sourceDuration)}`}
        >
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${fillStart}%`, width: `${fillWidth}%`,
            background: 'var(--accent)', borderRadius: 2,
          }} />
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Source in</span>
        <MMSSInput
          value={sourceIn}
          min={0}
          max={maxSourceIn}
          onCommit={(v) => onTrimLeft(trackId, clip.id, v)}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Source out</span>
        <MMSSInput
          value={sourceOut}
          min={sourceIn + minDuration}
          max={maxSourceOut}
          onCommit={(v) => onResizeClip(trackId, clip.id, v - sourceIn)}
        />
      </div>
      <div style={{ textAlign: 'right', marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => onTrimLeft(trackId, clip.id, 0)}
          disabled={!canReset}
          style={{
            fontSize: 9, color: canReset ? 'var(--ink-2)' : 'var(--ink-3)',
            background: 'none', border: 'none',
            textDecoration: canReset ? 'underline' : 'none',
            cursor: canReset ? 'pointer' : 'not-allowed', padding: 0,
          }}
        >Reset trim</button>
      </div>
    </>
  )
}
```

Also add the missing imports at the top of the file. Replace the existing first import line:

```ts
import type { CSSProperties } from 'react'
```

with:

```ts
import { useRef, useState, type CSSProperties } from 'react'
```

- [ ] **Step 3: Render the trim section in `InspectorPanel`**

In `components/editor/inspector-panel.tsx`, find the `InspectorPanel` return JSX. Insert the trim section above the existing FadeControl pair, **only for audio clips**. Replace this block:

```tsx
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '0 0 10px' }} />
      <FadeControl
        label="Fade In"
        value={fadeIn}
        onChange={(v) => onUpdateClip(trackId, clip.id, { fadeIn: v })}
      />
```

with:

```tsx
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '0 0 10px' }} />
      {!isVideo && (
        <>
          <TrimSection
            clip={clip}
            trackId={trackId}
            onTrimLeft={onTrimLeft}
            onResizeClip={onResizeClip}
          />
          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '0 0 10px' }} />
        </>
      )}
      <FadeControl
        label="Fade In"
        value={fadeIn}
        onChange={(v) => onUpdateClip(trackId, clip.id, { fadeIn: v })}
      />
```

- [ ] **Step 4: Wire new props from `editor.tsx`**

In `components/editor/editor.tsx`, find the `<InspectorPanel ... />` element (around lines 285-289). Update it:

```tsx
        <InspectorPanel
          timeline={timeline}
          selectedClipId={selectedClipId}
          onUpdateClip={handleUpdateClip}
          onTrimLeft={(tid, cid, newSourceIn) => dispatch({ type: 'TRIM_LEFT', trackId: tid, clipId: cid, newSourceIn })}
          onResizeClip={(tid, cid, dur) => dispatch({ type: 'RESIZE_CLIP', trackId: tid, clipId: cid, newDuration: dur })}
        />
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 6: Manual verification — Inspector renders for audio clips**

```bash
npm run dev
```

Open a project with at least one audio clip in the editor. Click an audio clip in the timeline. The inspector should show a "Trim source" section above Fades. The source bar will be hidden because no audio clip has `sourceDuration` set yet (that comes in Task 7). Inputs should accept values and the Reset trim button should be disabled while sourceIn = 0.

Click an image clip. The inspector should show only the Fades + Ken Burns sections (no Trim source).

- [ ] **Step 7: Commit**

```bash
git add components/editor/inspector-panel.tsx components/editor/editor.tsx
git commit -m "feat: add Trim source section to inspector for audio clips"
```

---

### Task 7: `probeAudioDuration` + await on audio drop

**Files:**
- Modify: `components/editor/editor.tsx`

- [ ] **Step 1: Add the probe helper and cache**

In `components/editor/editor.tsx`, find the existing `audioBase` constant (around line 72). Right after it, add:

```tsx
  const audioDurationCache = useRef<Map<string, Promise<number | null>>>(new Map())

  const probeAudioDuration = useCallback((mediaId: string): Promise<number | null> => {
    const cached = audioDurationCache.current.get(mediaId)
    if (cached) return cached
    const p = new Promise<number | null>((resolve) => {
      const a = new Audio()
      a.preload = 'metadata'
      a.onloadedmetadata = () => resolve(isFinite(a.duration) ? a.duration : null)
      a.onerror = () => resolve(null)
      a.src = `${audioBase}/${mediaId}`
    })
    audioDurationCache.current.set(mediaId, p)
    return p
  }, [audioBase])
```

- [ ] **Step 2: Update `handleDrop` to await for audio**

In the same file, find `handleDrop` (around lines 186-198). Replace it with:

```tsx
  const handleDrop = useCallback(async (trackId: string, time: number) => {
    if (!drag) return
    const media = drag.media
    setDrag(null)
    const newClip: Clip = {
      id: `c-${crypto.randomUUID()}`,
      mediaId: media.id,
      filename: media.filename,
      thumbnailUrl: media.thumbnailUrl,
      start: time,
      duration: media.defaultDuration,
    }
    if (media.kind === 'audio') {
      const dur = await probeAudioDuration(media.id)
      if (dur === null) {
        console.warn('Audio duration probe failed for', media.id)
      } else {
        newClip.sourceDuration = dur
      }
    }
    dispatch({ type: 'ADD_CLIP', trackId, clip: newClip })
  }, [drag, probeAudioDuration])
```

Notes on this change:
- `setDrag(null)` moves to the top of the function so the drag ghost disappears immediately on drop, before the await.
- The function becomes `async`. React's event handler typing accepts this.
- The `[drag]` dep array gains `probeAudioDuration` for correctness; `useCallback` keeps that stable.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 4: Manual verification — drop audio, see source bar**

```bash
npm run dev
```

In a project with audio in the Drive folder:
1. Drag an audio file from the media browser to A1.
2. After drop, click the new clip.
3. Inspector should show the "Trim source" section with the source bar visible (probed from the file's true duration). The bar should fill from the start to roughly `clip.duration / sourceDuration` of the way across.

If the bar is missing, check the browser console for "Audio duration probe failed" warnings — likely an audio URL or CORS issue.

- [ ] **Step 5: Commit**

```bash
git add components/editor/editor.tsx
git commit -m "feat: probe audio source duration on drop"
```

---

### Task 8: Timeline left-edge handle on audio clips

**Files:**
- Modify: `components/editor/timeline.tsx`
- Modify: `components/editor/editor.tsx`

- [ ] **Step 1: Add `onTrimLeftClip` prop to `Timeline`**

In `components/editor/timeline.tsx`, update the `Props` type (around lines 5-25). Add a new prop after `onResizeClip`:

```ts
  onResizeClip: (trackId: string, clipId: string, newDuration: number) => void
  onTrimLeftClip: (trackId: string, clipId: string, newSourceIn: number) => void
```

Update the function destructure on the `Timeline` line (around lines 98-103):

```ts
export function Timeline({
  timeline, playhead, zoom, selectedClipId, snapOn, drag, totalDuration,
  onSeekRuler, onZoomChange, onMoveClip, onResizeClip, onTrimLeftClip, onRemoveClip,
  onSelectClip, onToggleMute, onToggleLock, onDragOver, onDrop,
  onAddAudioTrack, onRemoveAudioTrack,
}: Props) {
```

- [ ] **Step 2: Add `onTrimLeftStart` to `ClipViewProps` and render the handle**

In the same file, update the `ClipViewProps` type (around lines 48-56) — add a new optional field:

```ts
type ClipViewProps = {
  clip: Clip
  track: Track
  selected: boolean
  pixelsPerSecond: number
  onSelect: () => void
  onMoveStart: (e: React.MouseEvent, clip: Clip) => void
  onResizeStart: (e: React.MouseEvent, clip: Clip) => void
  onTrimLeftStart?: (e: React.MouseEvent, clip: Clip) => void
}
```

Then update the `ClipView` function destructure and the JSX inside. Replace the entire `ClipView` body with:

```tsx
function ClipView({ clip, track, selected, pixelsPerSecond, onSelect, onMoveStart, onResizeStart, onTrimLeftStart }: ClipViewProps) {
  const bg = track.kind === 'audio' ? 'var(--track-a)' : 'var(--track-v)'
  const left = clip.start * pixelsPerSecond
  const width = Math.max(clip.duration * pixelsPerSecond, 24)

  return (
    <div
      onMouseDown={(e) => { onSelect(); onMoveStart(e, clip) }}
      style={{
        position: 'absolute', left, width,
        top: 4, bottom: 4,
        background: bg,
        border: selected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
        borderRadius: 3,
        boxShadow: selected ? '0 0 0 2px var(--accent-2)' : undefined,
        cursor: track.locked ? 'not-allowed' : 'grab',
        opacity: track.muted ? 0.5 : 1,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <span style={{
        position: 'absolute', bottom: 2, left: 4,
        fontSize: 9, fontFamily: 'monospace', color: 'var(--ink-2)',
        whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '90%',
      }}>
        {clip.filename} · {clip.duration.toFixed(1)}s
      </span>
      {/* Left-edge trim handle (audio only) */}
      {onTrimLeftStart && (
        <div
          onMouseDown={(e) => { e.stopPropagation(); onTrimLeftStart(e, clip) }}
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 6,
            cursor: 'ew-resize', background: 'rgba(0,0,0,.15)',
          }}
        />
      )}
      {/* Right-edge resize handle */}
      <div
        onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, clip) }}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
          cursor: 'ew-resize', background: 'rgba(0,0,0,.15)',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Add `startClipTrimLeft` handler to `Timeline`**

In `components/editor/timeline.tsx`, add a new `useCallback` right after `startClipResize` (around line 158):

```tsx
  const startClipTrimLeft = useCallback((e: React.MouseEvent, clip: Clip, track: Track) => {
    if (track.locked) return
    e.preventDefault()
    const origSourceIn = clip.sourceIn ?? 0
    const origStart = clip.start
    const origX = e.clientX
    const otherClips = track.clips.filter((c) => c.id !== clip.id)
    const maxSourceIn = clip.sourceDuration !== undefined
      ? Math.max(0, clip.sourceDuration - 0.3)
      : Infinity

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - origX
      const dt = dx / pixelsPerSecond
      const rawStart = Math.max(0, origStart + dt)
      const snapped = snapTime(rawStart, otherClips, snapOn, pixelsPerSecond)
      const delta = snapped - origStart
      const newIn = Math.max(0, Math.min(maxSourceIn, origSourceIn + delta))
      onTrimLeftClip(track.id, clip.id, newIn)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pixelsPerSecond, snapOn, onTrimLeftClip])
```

- [ ] **Step 4: Pass the trim-left starter to audio `ClipView`s**

In `components/editor/timeline.tsx`, find the existing `<ClipView ... />` rendering inside the tracks loop (around lines 315-325). Replace it with:

```tsx
                {track.clips.map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    track={track}
                    selected={clip.id === selectedClipId}
                    pixelsPerSecond={pixelsPerSecond}
                    onSelect={() => onSelectClip(clip.id)}
                    onMoveStart={(e) => startClipMove(e, clip, track)}
                    onResizeStart={(e) => startClipResize(e, clip, track)}
                    onTrimLeftStart={track.kind === 'audio' ? (e) => startClipTrimLeft(e, clip, track) : undefined}
                  />
                ))}
```

- [ ] **Step 5: Wire `onTrimLeftClip` from `editor.tsx`**

In `components/editor/editor.tsx`, find the `<Timeline ... />` element (around lines 292-312). Add the new prop after `onResizeClip`:

```tsx
        onResizeClip={(tid, cid, dur) => dispatch({ type: 'RESIZE_CLIP', trackId: tid, clipId: cid, newDuration: dur })}
        onTrimLeftClip={(tid, cid, newSourceIn) => dispatch({ type: 'TRIM_LEFT', trackId: tid, clipId: cid, newSourceIn })}
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 7: Manual verification — drag the new handle**

```bash
npm run dev
```

1. Open the editor with an audio clip on A1.
2. Hover the left edge of the audio clip — cursor should change to `ew-resize`.
3. Drag the left edge to the right. The clip's start position should advance, the right edge should stay fixed, and the duration shown in the clip label should decrease. Inspector "Source in" should update live.
4. Try to drag past the source's end — the handle should clamp.
5. Try to drag past 0 to the left — should clamp at 0.
6. Verify image clips (V1) do NOT have a left-edge handle.
7. Cmd-Z to undo — clip should restore.

- [ ] **Step 8: Commit**

```bash
git add components/editor/timeline.tsx components/editor/editor.tsx
git commit -m "feat: add left-edge trim handle to audio clips on timeline"
```

---

### Task 9: Serializer test for trimmed audio

**Files:**
- Modify: `components/editor/to-ffmpeg-json.test.ts`

- [ ] **Step 1: Add test**

In `components/editor/to-ffmpeg-json.test.ts`, add a new test inside the existing `describe('toFFmpegJson', ...)` block, after the existing `'defaults sourceIn to 0 ...'` test:

```ts
  it('serializes trimmed audio clip with sourceIn-based in/out', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        timeline.tracks[0],
        {
          ...timeline.tracks[1],
          clips: [{ ...timeline.tracks[1].clips[0], sourceIn: 8, duration: 12 }],
        },
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const aTrack = result.tracks.find((t) => t.id === 'A1')!
    // sourceIn=8, duration=12 → in=8, out=20; start/end are timeline positions
    expect(aTrack.clips[0]).toMatchObject({ type: 'audio', source: 'drive-mus', in: 8, out: 20, start: 0, end: 12 })
  })
```

- [ ] **Step 2: Run tests to confirm pass**

```bash
npm test
```

Expected: new test passes (the serializer was already correct as of Group 4B; this test just locks in the audio-trim contract). All other tests still pass.

- [ ] **Step 3: Commit**

```bash
git add components/editor/to-ffmpeg-json.test.ts
git commit -m "test: cover trimmed audio serialization"
```

---

### Task 10: End-to-end manual verification

**Files:** none

This task verifies the whole feature in a browser and via a real render.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test trim via timeline drag**

1. Drop an audio clip on A1.
2. Drag the left edge to about 1/4 of the way in.
3. Confirm the inspector "Source in" updates to a non-zero value as you drag.
4. Confirm the source bar in the inspector shifts right.

- [ ] **Step 3: Test trim via inspector input**

1. Click into the "Source in" input, type a different value (e.g. `0:30.0`), press Enter.
2. The clip's left edge should snap to that source position; the right edge on the timeline should stay put.
3. Click "Reset trim". Source in returns to `0:00.0`; clip extends back to the source start. Right edge still fixed.

- [ ] **Step 4: Test split + trim interaction**

1. Place playhead inside a trimmed audio clip.
2. Press `S` to split.
3. Confirm the right half's "Source in" reads the expected mid-source position (original sourceIn + offset to playhead).

- [ ] **Step 5: Test undo/redo across trims**

Cmd-Z several times after various trims. Each trim should fully undo (sourceIn, start, duration restored together).

- [ ] **Step 6: Render and verify trimmed audio in MP4**

1. Trim an audio clip so it starts noticeably late in the song (e.g. skip a 20-second intro).
2. Click Export.
3. Wait for the render workflow to complete; download the resulting MP4 from Drive.
4. Open it. The music should start at the trimmed point, not from the song's beginning.

- [ ] **Step 7: Final test pass**

```bash
npm test
```

Expected: all tests pass — should be the original 56 plus 6 (`TRIM_LEFT`) + 2 (`RESIZE_CLIP` clamp) + 1 (`SPLIT_CLIP` sourceIn) + 9 (`formatMMSS`/`parseMMSS`) + 1 (audio serialization) = **75 tests**.

- [ ] **Step 8: No commit** — this task is verification only.
