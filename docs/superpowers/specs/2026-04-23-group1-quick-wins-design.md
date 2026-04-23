# Group 1 — Quick Wins Design Spec

**Date:** 2026-04-23
**Status:** Approved

## Overview

Three incremental improvements to the KickReel editor:

1. **Keyboard shortcuts** — Split clip at playhead (`S`) and snap toggle (`N`); enable the Split toolbar button
2. **Fade transitions per clip** — store per-clip fade-in/fade-out durations; expose them in a new Inspector panel
3. **JSON panel** — modal showing the live ffmpeg JSON for the current timeline

---

## Layout Change: Inspector Panel

The editor body gains a third column on the right:

```
MediaBrowser (270px) | PreviewPanel (flex 1) | InspectorPanel (180px)
```

`InspectorPanel` is always visible. Empty state: muted "Select a clip" placeholder. When a clip is selected: clip properties (fade controls). The `PreviewPanel` continues to maintain a 16:9 frame inside its flex container — the shrinkage is absorbed by the flex layout.

**File:** `components/editor/inspector-panel.tsx` (new)

---

## Keyboard Shortcuts

New handlers added to the existing `onKey` listener in `components/editor/editor.tsx`.

| Key | Action | Condition |
|-----|--------|-----------|
| `S` | Split clip at playhead | Playhead is inside a clip on an unlocked track |
| `N` | Toggle snap on/off | Always |

### Split logic

Find every clip across all unlocked tracks where `clip.start < playhead < clip.start + clip.duration`. For each match, dispatch `SPLIT_CLIP`.

`SPLIT_CLIP` splits the clip at `at` (seconds):
- **Left clip:** keeps original `id`, `start`, `mediaId`, `filename`, `thumbnailUrl`; `duration = at - clip.start`; `fadeIn` preserved, `fadeOut = 0` (no fade at cut point)
- **Right clip:** new `id` (`crypto.randomUUID()`), `start = at`, `duration = (clip.start + clip.duration) - at`, same `mediaId`/`filename`/`thumbnailUrl`; `fadeIn = 0`, `fadeOut` preserved

If no eligible clip contains the playhead, `S` is a no-op.

### Snap toggle

`N` key calls `setSnapOn(s => !s)` — same effect as clicking the Snap checkbox.

### EditorToolbar Split button

Currently disabled with "coming soon" tooltip. Becomes enabled (and shows normal cursor) when the playhead is inside at least one clip on an unlocked track. Clicking it fires the same split logic as `S`.

The `EditorToolbar` receives two new props:
- `canSplit: boolean` — computed in `editor.tsx`
- `onSplit: () => void` — handler defined in `editor.tsx`

### New reducer action

```ts
{ type: 'SPLIT_CLIP'; trackId: 'V1' | 'A1'; clipId: string; at: number }
```

Added to `EditorAction` union in `types.ts` and handled in `use-editor.ts`. Goes into undo history as a single step.

---

## Fade Transitions Per Clip

### Data model

`Clip` in `types.ts` gains two optional fields:

```ts
fadeIn?: number    // seconds; undefined treated as 0.2
fadeOut?: number   // seconds; undefined treated as 0.2
```

Existing serialized timelines without these fields continue to work — the serializer falls back to 0.2.

### Reducer action

```ts
{ type: 'UPDATE_CLIP'; trackId: 'V1' | 'A1'; clipId: string; patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut'>> }
```

Goes into undo history.

### InspectorPanel

**File:** `components/editor/inspector-panel.tsx`

Props:
```ts
type Props = {
  timeline: Timeline
  selectedClipId: string | null
  onUpdateClip: (trackId: 'V1' | 'A1', clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut'>>) => void
}
```

**Empty state** (no clip selected):
```
[muted text] Select a clip to edit its properties
```

**Clip selected:**
- Filename: truncated monospace, 11px
- Duration: `3.5s` monospace
- Divider
- **Fade In:** label + number input (step 0.1, min 0, max 2) + range slider, same value
- **Fade Out:** label + number input (step 0.1, min 0, max 2) + range slider, same value

Both inputs dispatch `UPDATE_CLIP` on change. Display values show `clip.fadeIn ?? 0.2` and `clip.fadeOut ?? 0.2`.

Styling uses CSS custom properties (`--paper-2` background, `--ink`/`--ink-2` text, `--line` border, `--accent` for slider `accentColor`).

### toFFmpegJson update

**File:** `components/editor/to-ffmpeg-json.ts`

- **Video clips:** `transition.duration` changes from hardcoded `0.2` to `clip.fadeIn ?? 0.2`
- **Audio clips:** add `fade: { in: clip.fadeIn ?? 0.2, out: clip.fadeOut ?? 0.2 }` to the ffmpeg audio clip shape

Updated `FFmpegAudioClip` type:
```ts
type FFmpegAudioClip = {
  id: string; type: 'audio'; source: string
  in: number; out: number; start: number; end: number
  fade: { in: number; out: number }
}
```

---

## JSON Panel

### Trigger

A `{ }` button added to the right end of `EditorToolbar`, left of the format badge. Clicking it sets `showJson: boolean` state in `editor.tsx` to `true`.

`EditorToolbar` receives two new props:
- `showJson: boolean`
- `onToggleJson: () => void`

### Modal

**File:** `components/editor/json-panel.tsx` (new)

Props:
```ts
type Props = {
  timeline: Timeline
  projectSlug: string
  onClose: () => void
}
```

- Centered modal overlay (`position: fixed`, full viewport, semi-transparent backdrop)
- Inner panel: `600px` wide, `70vh` tall, `--paper-2` background, rounded, drop shadow
- Header: "ffmpeg JSON" title (monospace) + Copy button + Close (`×`) button
- Body: `<pre>` block with `overflow: auto`, `font-size: 11px`, monospace, `--ink` color
- Content: `JSON.stringify(toFFmpegJson(timeline, projectSlug), null, 2)` — recomputes on every render, so always reflects the current timeline while the modal is open
- Closes on Escape key (via `useEffect` keydown listener) or clicking the backdrop

---

## Files

**New:**
- `components/editor/inspector-panel.tsx`
- `components/editor/json-panel.tsx`

**Modified:**
- `components/editor/types.ts` — add `fadeIn?`/`fadeOut?` to `Clip`; add `SPLIT_CLIP` and `UPDATE_CLIP` to `EditorAction`
- `components/editor/use-editor.ts` — handle `SPLIT_CLIP` and `UPDATE_CLIP` in reducer
- `components/editor/to-ffmpeg-json.ts` — use per-clip fade values; add `fade` to audio clips
- `components/editor/editor.tsx` — wire inspector panel, JSON panel, split logic, `N` shortcut
- `components/editor/editor-toolbar.tsx` — enable Split button, add `{ }` JSON toggle button

**Tests:**
- `components/editor/use-editor.test.ts` — add `SPLIT_CLIP` and `UPDATE_CLIP` cases
- `components/editor/to-ffmpeg-json.test.ts` — add per-clip fade and audio fade cases

---

## Out of scope

- Fade curve types (linear only for now)
- Per-clip volume control (audio inspector)
- Multiple clip selection
