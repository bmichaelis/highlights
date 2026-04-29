# Group 4C — Trim UI Design Spec

**Date:** 2026-04-29
**Status:** Approved

## Overview

Group 4B added the `sourceIn` data field and render-side support for trimming audio clips, but no UI sets it — every clip ships with `sourceIn = 0`. Group 4C adds the editor UI to trim audio clips: left-edge drag handles on the timeline plus matching numeric inputs in the inspector panel.

Scope is deliberately narrow. Video clips on V1 (currently image-only) and playback-rate stretch are deferred to separate groups (4D and 4E respectively). 4C touches only audio clips.

---

## Section 1: Data Model

### `components/editor/types.ts`

Add one optional field to `Clip`:

```ts
sourceDuration?: number   // seconds; full length of source audio file. undefined = unknown (no clamp)
```

Stored on the Clip (not on `MediaItem`) so it travels with the clip through undo/redo and persisted timeline JSON. Probed at drop time and not refreshed afterwards.

Add one new action to `EditorAction`:

```ts
| { type: 'TRIM_LEFT'; trackId: string; clipId: string; newSourceIn: number }
```

---

## Section 2: Reducer + Actions

### `TRIM_LEFT` semantics

The right edge of the clip on the timeline stays put. Drag the left handle inward → `sourceIn` increases, `start` increases by the same amount, `duration` decreases:

```ts
const delta = newSourceIn - (clip.sourceIn ?? 0)
clip.sourceIn = newSourceIn
clip.start    = clip.start + delta
clip.duration = clip.duration - delta
```

Clamp at the reducer:
- `newSourceIn ≥ 0`
- `newSourceIn ≤ sourceDuration - 0.3` if `sourceDuration` is known (matches existing 0.3s minimum duration in `RESIZE_CLIP`)

### `RESIZE_CLIP` clamp

Existing signature unchanged. Add a clamp inside the reducer when `sourceDuration` is known:

```ts
const maxDur = clip.sourceDuration !== undefined
  ? clip.sourceDuration - (clip.sourceIn ?? 0)
  : Infinity
const newDuration = Math.max(0.3, Math.min(maxDur, action.newDuration))
```

This prevents the right-edge handle and the inspector's "Source out" input from extending past the source file's end.

### `SPLIT_CLIP` fix

Current code spreads the original clip into both halves, so the right half's `sourceIn` is wrong. Fix:

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

Without this, splitting a trimmed audio clip plays the wrong source content after the cut.

### Inspector input wiring

- "Source in" → `TRIM_LEFT { newSourceIn }`
- "Source out" → existing `RESIZE_CLIP { newDuration: sourceOut - sourceIn }`
- "Reset trim" → `TRIM_LEFT { newSourceIn: 0 }`

---

## Section 3: Timeline Drag Handle

Add a left-edge handle in `ClipView`, only rendered when `track.kind === 'audio'`. Visual treatment mirrors the existing right-edge handle: `width: 6, cursor: 'ew-resize', background: 'rgba(0,0,0,.15)'`.

New prop on `Timeline`:

```ts
onTrimLeftClip: (trackId: string, clipId: string, newSourceIn: number) => void
```

Drag handler, parallel to the existing `startClipResize`:

```ts
function startClipTrimLeft(e: React.MouseEvent, clip: Clip, track: Track) {
  if (track.locked) return
  e.preventDefault()
  e.stopPropagation()
  const origSourceIn = clip.sourceIn ?? 0
  const origStart    = clip.start
  const origX        = e.clientX
  const otherClips   = track.clips.filter((c) => c.id !== clip.id)
  const maxSourceIn  = clip.sourceDuration !== undefined
    ? Math.max(0, clip.sourceDuration - 0.3)
    : Infinity

  function onMove(ev: MouseEvent) {
    const dx       = ev.clientX - origX
    const dt       = dx / pixelsPerSecond
    const rawStart = Math.max(0, origStart + dt)
    const snapped  = snapTime(rawStart, otherClips, snapOn, pixelsPerSecond)
    const delta    = snapped - origStart
    const newIn    = Math.max(0, Math.min(maxSourceIn, origSourceIn + delta))
    onTrimLeftClip(track.id, clip.id, newIn)
  }
  // standard mousemove/mouseup teardown
}
```

The reducer derives the new `start` and `duration` from `newSourceIn`, so the timeline only ever sends `newSourceIn`. Snapping snaps the resulting timeline `start` to other clip edges on the same track, then back-computes `newSourceIn`.

The right-edge handle keeps its existing wiring; the reducer-side clamp from Section 2 prevents extending past source end on audio clips.

---

## Section 4: Inspector Panel

For audio clips only, add a "Trim source" section above the existing Fades section. Video clips (V1): unchanged.

### Layout

```
┌─────────────────────────┐
│ song.mp3                │
│ 12.0s on timeline       │
├─────────────────────────┤
│ Trim source             │
│ ▰▰▱▱▱▱▱▱▱▱  ← bar     │   (hidden if sourceDuration unknown)
│ Source in   [ 0:12.0 ]  │
│ Source out  [ 0:24.0 ]  │
│           [Reset trim]  │
├─────────────────────────┤
│ Fade in     [   0.2 ]   │
│ Fade out    [   0.2 ]   │
└─────────────────────────┘
```

### Source bar

A 4px-tall bar showing the full source duration with the selected portion highlighted. Background `var(--paper-3)`, fill `var(--accent)`, fill range from `(sourceIn / sourceDuration)` to `((sourceIn + duration) / sourceDuration)`. Hidden entirely when `sourceDuration` is undefined.

### Numeric inputs

`<input type="text">` (not `number`, to support colons). Display value via `formatMMSS(s)` → `"M:SS.S"`. On blur or Enter, parse via `parseMMSS(text)`. If parse fails or value is out of range, revert to last good value (silent reject — no error UI). Parse on blur/Enter rather than every keystroke because mm:ss.s parsing mid-input is jittery.

```ts
function formatMMSS(s: number): string {
  const m   = Math.floor(s / 60)
  const sec = (s - m * 60).toFixed(1)
  return `${m}:${sec.padStart(4, '0')}`   // "0:12.0", "1:05.5"
}

function parseMMSS(input: string): number | null {
  // accepts "12.0", "0:12.0", "1:05.5"
  // returns null on garbage, missing components, or seconds ≥ 60
}
```

Both helpers live alongside `inspector-panel.tsx` and get unit tests.

### Reset trim

Small text-style button bottom-right of the Trim section. Dispatches `TRIM_LEFT { newSourceIn: 0 }`. Disabled when `(clip.sourceIn ?? 0) === 0`.

### Wiring

- Source in change → `onTrimLeft(trackId, clipId, parsedValue)`; clamp `0 ≤ x ≤ sourceDuration - 0.3` in inspector before dispatching
- Source out change → `onResizeClip(trackId, clipId, parsedValue - sourceIn)`; clamp similarly
- Reset → `onTrimLeft(trackId, clipId, 0)`

The inspector's existing `Props.onUpdateClip` signature is unchanged; we add two new callbacks (`onTrimLeft`, `onResizeClip`) wired down from `editor.tsx`.

---

## Section 5: Drop-Time Source Duration Probe

Audio source duration is read on the client when an audio clip is dropped. Same URL pattern the preview panel already uses: `${audioBaseUrl}/${mediaId}`.

In `editor.tsx`:

```ts
const audioDurationCache = useRef<Map<string, Promise<number | null>>>(new Map())

function probeAudioDuration(mediaId: string): Promise<number | null> {
  const cached = audioDurationCache.current.get(mediaId)
  if (cached) return cached
  const p = new Promise<number | null>((resolve) => {
    const a = new Audio()
    a.preload = 'metadata'
    a.onloadedmetadata = () => resolve(isFinite(a.duration) ? a.duration : null)
    a.onerror          = () => resolve(null)
    a.src = `${audioBaseUrl}/${mediaId}`
  })
  audioDurationCache.current.set(mediaId, p)
  return p
}
```

### Drop flow

- **Image drop** — unchanged; dispatch `ADD_CLIP` synchronously.
- **Audio drop** — `await probeAudioDuration(mediaId)`, then dispatch `ADD_CLIP` with `sourceDuration` set on the clip. Probe is typically <200ms; the small delay between mouseup and clip appearance is acceptable. If the probe returns `null`, dispatch with `sourceDuration: undefined` and log a warning.

The cache is per-editor-mount, keyed by Drive file ID, so re-dropping the same audio is instant after the first probe.

### Pre-4C clips

Audio clips loaded from a saved timeline written before 4C will not have `sourceDuration`. They lack the clamp until re-dropped. No backfill — self-healing on next drop, and the trim UI degrades gracefully (no source bar, no clamp).

---

## Section 6: Testing

Match the existing pattern: unit tests on the reducer and pure helpers; no component tests (none exist today for inspector or timeline).

### `components/editor/use-editor.test.ts` — extend

- `TRIM_LEFT` with `sourceDuration` known: `start`, `sourceIn`, `duration` update consistently; right edge of clip on timeline is invariant.
- `TRIM_LEFT` clamps to `[0, sourceDuration - 0.3]`.
- `TRIM_LEFT` with `sourceDuration` undefined: clamps only to `≥ 0`.
- `TRIM_LEFT` participates in undo/redo.
- `RESIZE_CLIP` clamps `newDuration` to `≤ sourceDuration - sourceIn` when known.
- `SPLIT_CLIP` on a trimmed audio clip — right half has correct `sourceIn = orig.sourceIn + (at - orig.start)`.

### `components/editor/inspector-panel.test.ts` — new

- `formatMMSS(0)` → `"0:00.0"`
- `formatMMSS(12)` → `"0:12.0"`
- `formatMMSS(65.5)` → `"1:05.5"`
- `formatMMSS(3661)` → `"61:01.0"`
- `parseMMSS("12.0")` → `12`
- `parseMMSS("0:12.0")` → `12`
- `parseMMSS("1:05.5")` → `65.5`
- `parseMMSS("garbage")` → `null`
- `parseMMSS(":12")` → `null`
- `parseMMSS("1:60")` → `null` (seconds component must be `< 60`)

### `components/editor/to-ffmpeg-json.test.ts` — extend

- Trimmed audio clip serializes with `in = sourceIn`, `out = sourceIn + duration`.

### Manual verification

Per AGENTS.md "for UI changes, use the feature in a browser": start dev server, drop an audio clip, drag the left handle to trim, render, and confirm the rendered MP4 starts the song at the trimmed point. Then test: trim via inspector inputs, reset trim, undo/redo a trim, split a trimmed clip.

---

## Files

**Modified:**
- `components/editor/types.ts` — add `sourceDuration?: number` to `Clip`; add `TRIM_LEFT` action.
- `components/editor/use-editor.ts` — handle `TRIM_LEFT`; clamp `RESIZE_CLIP` to source bound; fix `SPLIT_CLIP` `sourceIn` math.
- `components/editor/timeline.tsx` — left-edge handle on audio clips; `onTrimLeftClip` prop.
- `components/editor/inspector-panel.tsx` — Trim source section (audio only); `formatMMSS`/`parseMMSS` helpers; source bar; Reset trim button; new `onTrimLeft` and `onResizeClip` props.
- `components/editor/editor.tsx` — `probeAudioDuration` + cache; await probe on audio drop; pass new callbacks to Timeline and Inspector.
- `components/editor/use-editor.test.ts` — reducer tests for `TRIM_LEFT`, clamp, `SPLIT_CLIP` fix.
- `components/editor/to-ffmpeg-json.test.ts` — trimmed-audio serialization test.

**New:**
- `components/editor/inspector-panel.test.ts` — `formatMMSS`/`parseMMSS` tests.

---

## Out of Scope

- **Video sources on V1** — deferred to Group 4D. When 4D lands, it extends the trim handle to V1 video clips and reuses the `TRIM_LEFT` reducer action.
- **Stretch / playback rate** — deferred to Group 4E.
- **Trim handles on image clips** — images have no meaningful `sourceIn`; V1 keeps current behavior.
- **Per-track volume controls** — still deferred from 4B; not bundled into 4C.
- **`sourceDuration` backfill for pre-4C clips** — self-healing on next drop.
- **Audio waveform visualization** — separate concern.
- **Touch-friendly handle sizing** — desktop-only assumption; matches existing 6px right-edge handle.
