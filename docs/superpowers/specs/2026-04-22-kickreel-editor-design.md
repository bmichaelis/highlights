# KickReel Editor — Design Spec

**Date:** 2026-04-22
**Status:** Approved

## Overview

Replace the existing project detail page with a browser-based NLE (non-linear editor) for assembling soccer highlight reels from Drive photos and audio. The editor lives at the existing project route and is informed by the KickReel design handoff package (`Highlights.zip`).

The design reference is an interactive HTML prototype at `Highlights.zip/design_handoff_kickreel_editor/KickReel Editor.html`. The prototype demonstrates the full intended interaction model. This spec covers the MVP subset to build first.

---

## Route & Layout

**Route:** `/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]`
The existing project detail page is replaced by the editor.

**Settings migration:** The current project detail page content (folder picker, team management, seconds-per-image, render status history) moves to a new sub-route: `/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/settings`. The EditorTopBar includes a gear icon (⚙) that navigates there. This keeps project management accessible without cluttering the editor.

**Shell:** The existing app header (dark gray-900 bar with org/team breadcrumb) stays fixed at top. The editor fills the remaining viewport height below it using `calc(100dvh - var(--header-height))` where `--header-height` is set as a CSS variable on the root layout. No page scroll; the editor never overflows the viewport.

---

## Visual Theme

Two themes implemented as CSS custom properties, toggling on `prefers-color-scheme` (and a future manual toggle):

**Light mode — warm paper:**
```css
--paper:       #efe9dc;
--paper-2:     #e7dfce;
--paper-3:     #ddd3bd;
--ink:         #2b2622;
--ink-2:       #4a423a;
--ink-3:       #6b6258;
--line:        #3a332d;
--line-soft:   #8a8175;
--accent:      #b98a4e;
--accent-2:    #d4a56a;
--accent-soft: rgba(185,138,78,.15);
--track-v:     #d9cfb8;
--track-v2:    #cdc2a8;
--track-a:     #a89a7c;
--danger:      #a8564a;
```

**Dark mode — Highlights dark theme:**
```css
--paper:       #111827;   /* gray-900 */
--paper-2:     #1f2937;   /* gray-800 */
--paper-3:     #374151;   /* gray-700 */
--ink:         #f9fafb;   /* gray-50 */
--ink-2:       #d1d5db;   /* gray-300 */
--ink-3:       #9ca3af;   /* gray-400 */
--line:        #374151;   /* gray-700 */
--line-soft:   #4b5563;   /* gray-600 */
--accent:      #2563eb;   /* blue-600 */
--accent-2:    #3b82f6;   /* blue-500 */
--accent-soft: rgba(37,99,235,.15);
--track-v:     #374151;
--track-v2:    #4b5563;
--track-a:     #4b5563;
--danger:      #dc2626;
```

Typography follows the design package for light mode (Kalam body, Caveat display, JetBrains Mono for metadata). In dark mode, fall back to the existing Tailwind system font stack to stay consistent with the rest of the app.

---

## Component Tree

```
EditorPage                        route component; loads project + timeline
  EditorTopBar          (42px)    project name · Undo · Redo · Save · Export
  EditorToolbar         (34px)    Import · Snap toggle · format info
  EditorBody            (flex row, fills remaining height above timeline)
    MediaBrowser        (270px)   Photos/Audio tabs · thumbnail grid · Refresh
    PreviewPanel        (flex 1)  16:9 video frame · transport bar
  Timeline              (280px, fixed at bottom of editor)
    TimelineHeader      (36px)    label · clip count · zoom slider
    TrackRow × 2                  V1 (photos) + A1 (audio)
      TrackHeader       (140px)   track name · mute · lock icons
      TrackBody                   ruler (sticky) · clips · playhead
```

### EditorTopBar
- Left: logo/brand mark + project filename (monospace, truncated)
- Right: Undo, Redo, Save (manual), Export (primary accent)
- Save shows a "Saving…" / "Saved" indicator during the debounced auto-save
- Export button: disabled while a render job is pending/running; shows job status inline

### EditorToolbar
- Import button (opens file picker for local upload — future; no-op in MVP with tooltip)
- Split button (no-op in MVP with tooltip)
- Divider
- Snap checkbox — persisted to `localStorage` key `kr-snap`
- Right: `16:9 · 1920×1080 · 30fps` in monospace

### MediaBrowser
- **Photos tab:** album tree from `playlistItems` grouped by player name as album label. 3-column thumbnail grid (72×54, `object-fit: cover`). Thumbnails sourced from `playlistItems.thumbnailUrl`.
- **Audio tab:** flat list of audio files from Drive folder (fetched via the existing Drive scanner). Each row: music icon, filename, duration.
- **Footer:** "Refresh from Drive" button — calls `PATCH /playlist { type: 'resequence' }` to rescan Drive and rebuild `playlistItems`, then re-fetches the media browser's photo and audio lists. Does **not** modify `timeline_json` or reset the editor state.
- Draggable items: `onPointerDown` starts drag; ghost follows cursor. Photos only drop on V1; audio only drops on A1.

### PreviewPanel
- 16:9 frame (82% panel width, black background, rounded-md, drop shadow)
- Shows the photo clip active at the current playhead on V1 as `<img>` with Ken Burns CSS animation (scale 1→1.08 over clip duration, `transform-origin: center`)
- Empty state: "no clip at playhead — drag a photo to V1 to begin"
- Transport bar (58px):
  - `0:00 / 0:30` time display (monospace)
  - Prev / Play-Pause / Next buttons; Play is 40px accent-colored circle. Prev/Next seek to the start of the previous/next clip on V1.
  - Scrubber: click/drag to seek; accent-filled progress bar
  - Volume icon + mini slider (decorative in MVP — no actual audio playback)

### Timeline

**Header (36px):** "Timeline" label · "+ Video track" and "+ Audio track" buttons (no-op in MVP, disabled) · clip count · duration · Zoom slider (30–200, default 80, persisted to `localStorage` key `kr-zoom`)

**Tracks (MVP: V1 + A1 only, fixed):**

| Track | Height | Clip bg (light) | Accepts |
|-------|--------|-----------------|---------|
| V1 Photos | 52px | `--track-v` | image media |
| A1 Music  | 36px | `--track-a` | audio media |

**TrackHeader (140px wide):** kind icon · track ID badge · track name · eye toggle · Mute "M" · Lock icon. Muted tracks render clips at 0.5 opacity.

**Ruler (24px, sticky top):** tick marks at 1s intervals; major ticks every 5s with `m:ss` label in monospace 9px. Color `--line-soft`.

**Playhead:** vertical accent line with downward triangle at top; draggable.

**Clips:**
- Image clips: `--track-v` background, filmstrip perforation pattern (CSS repeating-linear-gradient), filename + duration badge in monospace 9px
- Audio clips: `--track-a` background, SVG waveform pattern, filename badge
- Right-edge resize handle: 6px wide, `ew-resize` cursor
- Selected clip: accent border + `box-shadow: 0 0 0 2px var(--accent-2)`
- Drop target highlight: `background: var(--accent-soft)`; 3px accent insert line at snap position

---

## State Model

```ts
type Clip = {
  id: string;
  mediaId: string;       // Drive file ID for both photos and audio (used as `source` in ffmpeg JSON)
  filename: string;      // display label
  thumbnailUrl?: string; // photos only, sourced from playlistItems.thumbnailUrl
  start: number;         // seconds from timeline 0
  duration: number;      // seconds
};

type Track = {
  id: 'V1' | 'A1';
  kind: 'video' | 'audio';
  name: string;
  muted: boolean;
  locked: boolean;
  clips: Clip[];
};

type Timeline = {
  tracks: Track[];
};
```

All state lives in a React `useReducer`. Every mutation is wrapped in the undo history:

```ts
type HistoryState = {
  past: Timeline[];      // max 40
  present: Timeline;
  future: Timeline[];
};
```

**Bootstrap:** On first load when `project.timelineJson` is null, derive initial `Timeline` from `playlistItems` (each item becomes a clip on V1 placed sequentially using `durationOverride ?? project.secondsPerImage`). A1 starts empty.

**Auto-save:** Debounced 1s after any dispatch. PUT to `/api/.../timeline` with `{ timeline }`. Save indicator in top bar reflects in-flight state.

**localStorage:** `kr-zoom` (number), `kr-snap` (boolean). Not part of undo history.

---

## Data Model Changes

### Schema

```sql
ALTER TABLE projects ADD COLUMN timeline_json TEXT;
```

Nullable. Null = not yet edited (bootstrap from `playlistItems` on load).

### New API endpoints

**`GET /api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/timeline`**
Returns `{ timeline: Timeline | null }`. Requires org membership.

**`PUT /api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/timeline`**
Body: `{ timeline: Timeline }`. Saves to `projects.timelineJson`. Returns `{ ok: true }`.

### Updated render endpoint

**`POST /api/.../render`** accepts an optional body:

```ts
// New shape (editor path):
{ timelineJson: string }  // serialized ffmpeg JSON from toFFmpegJSON(timeline)

// Legacy shape (still supported for backward compat):
// no body — derives from playlistItems as before
```

When `timelineJson` is present, the route skips the `playlistItems` query and passes the provided JSON directly to `triggerRender()`. `triggerRender()` gains a new optional `timelineJson` parameter; the GitHub Actions workflow receives it as an input.

The `playlistItems` table and sequencer are kept — they continue to power the Refresh flow and the bootstrap derivation.

---

## Interactions (MVP)

### Drag from browser → timeline
1. `onPointerDown` on a media item starts drag; attach `pointermove`/`pointerup` to `window`
2. Floating ghost (rotated -2°, shadowed) follows cursor
3. Hit-test against `[data-track-row]` elements; highlight compatible track with `--accent-soft`
4. Snap (when enabled): nearest clip edge or `t=0` within `8 / pps` seconds
5. On `pointerup` over compatible track: insert clip; ripple any overlapping clips forward; normalize track
6. On `pointerup` elsewhere: discard

### Clip reorder (drag clip body)
`onMouseDown` → mousemove updates `clip.start = max(0, origStart + dx/pps)`, snapped against other clips. `normalizeTrack` on mouseup.

### Clip resize (right-edge handle)
`onMouseDown` on handle → mousemove updates `clip.duration = max(0.3, origDur + dx/pps)`. Normalize on mouseup.

### Playhead scrub
Click/drag on ruler → `playhead = (clientX - rulerLeft + scrollLeft) / pps`. Click/drag on transport scrubber → proportional seek.

### Play loop
`requestAnimationFrame` while `playing`. Advance `playhead += dt`. Stop at max clip end time. Spacebar toggles.

### Keyboard shortcuts
| Key | Action |
|-----|--------|
| Space | Play / pause |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z | Redo |
| Delete / Backspace | Remove selected clip |

### Export
1. Call `toFFmpegJSON(timeline)` (see design reference `ed-state.jsx`)
2. POST to `/render` with `{ timelineJson: JSON.stringify(ffmpegPayload) }`
3. On 201: show render-in-progress state in Export button (poll GET `/render` for status)
4. On error: toast with message

---

## ffmpeg JSON shape

Produced by `toFFmpegJSON(timeline)`, matches the design reference exactly:

```json
{
  "output": { "filename": "<project-slug>.mp4", "width": 1920, "height": 1080, "fps": 30, "audio_rate": 48000 },
  "duration": 30.0,
  "tracks": [
    {
      "id": "V1",
      "kind": "video",
      "muted": false,
      "clips": [
        {
          "id": "c-...",
          "type": "image",
          "source": "<driveFileId>",
          "in": 0, "out": 3.0, "start": 0, "end": 3.0,
          "kenburns": { "from": "center", "to": "in", "scale": 1.08 },
          "transition": { "in": "fade", "duration": 0.2 }
        }
      ]
    },
    {
      "id": "A1",
      "kind": "audio",
      "muted": false,
      "clips": [
        {
          "id": "c-...",
          "type": "audio",
          "source": "<driveFileId>",
          "in": 0, "out": 30.0, "start": 0, "end": 30.0
        }
      ]
    }
  ]
}
```

---

## Deferred (follow-on work)

- Title cards and lower thirds (V2 track)
- Voiceover track (A2)
- Add / remove tracks UI
- Per-clip Ken Burns customization
- Fade transitions per clip
- JSON panel (live ffmpeg JSON preview)
- File / Edit / Insert / Share / Help menus
- Project Settings modal (link to existing settings page for now)
- Keyboard shortcut for Split (S) and Snap toggle (N)
- Actual audio playback in preview
- Local file import (Import button)

---

## Out of scope

- Mobile / touch support
- Multi-user collaborative editing
- Render progress streaming (polling is sufficient for MVP)
