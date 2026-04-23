# Group 2 — Per-Clip Ken Burns Design Spec

**Date:** 2026-04-23
**Status:** Approved

## Overview

Add per-clip Ken Burns customization to the KickReel editor. Each video clip can have its own start position, end position, and zoom scale — or Ken Burns can be disabled for a static shot. Controls live in the existing InspectorPanel.

Rendering Ken Burns in the final MP4 (updating `render.mjs` to consume `timelineJson` and apply ffmpeg `zoompan`) is **deferred** — that requires a separate render pipeline upgrade.

---

## Data Model

### `types.ts`

New position union:

```ts
export type KBPosition =
  'top-left' | 'top' | 'top-right' |
  'left'     | 'center' | 'right'  |
  'bottom-left' | 'bottom' | 'bottom-right'
```

New optional field on `Clip`:

```ts
kenBurns?: { from: KBPosition; to: KBPosition; scale: number } | null
```

Semantics:
- `undefined` — use default `{ from: 'center', to: 'bottom-right', scale: 1.08 }`. Backwards-compatible with existing saved timelines.
- `null` — Ken Burns disabled; clip renders as a static image.
- explicit object — use those `from`/`to`/`scale` values.

### `UPDATE_CLIP` patch type

The existing `UPDATE_CLIP` action's patch expands to include `kenBurns`:

```ts
patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>>
```

No new reducer action is needed.

---

## `toFFmpegJson` Changes

**File:** `components/editor/to-ffmpeg-json.ts`

`FFmpegVideoClip.kenburns` type changes from `{ from: string; to: string; scale: number }` to:

```ts
kenburns: { from: KBPosition; to: KBPosition; scale: number } | null
```

Serialization logic:

```ts
kenburns: clip.kenBurns === null
  ? null
  : (clip.kenBurns ?? { from: 'center', to: 'bottom-right', scale: 1.08 })
```

- `null` → `kenburns: null` in JSON output (signals "static" to future render implementation)
- `undefined` → default `center → bottom-right, 1.08×`
- explicit value → used as-is

---

## InspectorPanel — Ken Burns Controls

**File:** `components/editor/inspector-panel.tsx`

Ken Burns section appears below the fade controls **only for clips on the V1 track** (video). Audio clips (A1) do not show it. The panel determines track membership by searching `timeline.tracks`.

### When Ken Burns is on (`kenBurns !== null`)

```
Ken Burns  [✓ checkbox]
─────────────────────
Start          End
[■][ ][ ]    [ ][ ][ ]
[ ][■][ ]    [ ][ ][ ]
[ ][ ][ ]    [ ][ ][■]

Scale  ──────●──  1.08
```

- "Ken Burns" label + checkbox (checked) on the same row
- Two 3×3 grids side by side, labeled "Start" and "End"
- Each cell is a `<button>` representing one `KBPosition` value
- Selected cell highlighted with `--accent` border + background (opacity 0.8)
- Grid cell positions map row/col to position name:
  - Row 0: `top-left`, `top`, `top-right`
  - Row 1: `left`, `center`, `right`
  - Row 2: `bottom-left`, `bottom`, `bottom-right`
- Clicking a Start cell dispatches `UPDATE_CLIP` with `{ kenBurns: { ...current, from: clicked } }`
- Clicking an End cell dispatches `UPDATE_CLIP` with `{ kenBurns: { ...current, to: clicked } }`
- Scale row: label + `<input type="range">` (min 1.0, max 1.3, step 0.01) + numeric display
- Adjusting scale dispatches `UPDATE_CLIP` with `{ kenBurns: { ...current, scale: value } }`
- Display values use `effectiveKB` = `clip.kenBurns ?? { from: 'center', to: 'bottom-right', scale: 1.08 }`

### When Ken Burns is off (checkbox unchecked)

- Grids and scale slider are hidden
- Dispatches `UPDATE_CLIP` with `{ kenBurns: null }`
- Re-checking dispatches `UPDATE_CLIP` with `{ kenBurns: { from: 'center', to: 'bottom-right', scale: 1.08 } }`

### Styling

Consistent with existing fade controls: CSS custom properties throughout (`--paper-2`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-soft`, `--accent`). Grid cells use `border: 1px solid var(--line-soft)` unselected, `border: 1px solid var(--accent); background: var(--accent); opacity: 0.8` selected.

---

## `editor.tsx` Change

`handleUpdateClip` patch type widens from `Partial<Pick<Clip, 'fadeIn' | 'fadeOut'>>` to `Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>>`. No other changes needed.

---

## Files

**Modified:**
- `components/editor/types.ts` — add `KBPosition`; extend `Clip`; update `FFmpegVideoClip`
- `components/editor/to-ffmpeg-json.ts` — per-clip `kenBurns` serialization
- `components/editor/inspector-panel.tsx` — Ken Burns section
- `components/editor/editor.tsx` — widen `handleUpdateClip` type

**Tests:**
- `components/editor/to-ffmpeg-json.test.ts` — explicit value, `null`, and `undefined` default
- `components/editor/use-editor.test.ts` — `UPDATE_CLIP` with `kenBurns` patch

---

## Out of Scope

- Applying Ken Burns in `render.mjs` (deferred — requires render pipeline upgrade)
- Animated preview of the Ken Burns motion in the editor
- Ken Burns on audio clips
