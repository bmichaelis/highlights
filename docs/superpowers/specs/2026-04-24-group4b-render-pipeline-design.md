# Group 4B — Render Pipeline Upgrade Design Spec

**Date:** 2026-04-24
**Status:** Approved

## Overview

Upgrade `scripts/render.mjs` to consume `timelineJson` (the serialized FFmpeg JSON produced by `to-ffmpeg-json.ts`) instead of the legacy `playlist`/`audioFileIds` arrays. This enables Ken Burns pan/zoom per clip, per-clip transition durations, N audio tracks with correct timing, per-clip source trimming (in/out points), and audio fade in/out.

Group 4C (trim UI — drag handles in the editor to set `sourceIn`) is a separate group. Group 4B only adds the data field and render support; the field defaults to 0 for all existing clips.

---

## Section 1: Data Model + Serializer

### `components/editor/types.ts`

Add one optional field to `Clip`:

```ts
sourceIn?: number  // seconds into source file where playback begins; undefined = 0
```

### `components/editor/to-ffmpeg-json.ts`

Update `serializeClip` to use `sourceIn` for `in`/`out` (source file offsets), keeping `start`/`end` as timeline positions:

```ts
const sourceIn = clip.sourceIn ?? 0
const base = {
  id: clip.id,
  source: clip.mediaId,
  in: sourceIn,
  out: sourceIn + clip.duration,
  start: clip.start,
  end: clip.start + clip.duration,
}
```

Previously `in`/`out` were set to `clip.start`/`clip.start + clip.duration` (timeline positions). They now carry source file offsets.

---

## Section 2: `render.mjs` Structure

At the top of the try block, check for `timelineJson`:

```js
const { playlist, audioFileIds, accessToken, folderId, jobId,
        callbackUrl, callbackSecret, timelineJson } = payload
```

**When `timelineJson` is present** — new path (described below). The legacy `playlist`/`audioFileIds` validation is skipped.

**When absent** — existing legacy path unchanged.

### New path steps

1. **Parse** — `const tfj = JSON.parse(timelineJson)` → `{ output, duration, tracks }`

2. **Collect unique sources** — collect unique `clip.source` IDs from V1 (always) and from any audio track where `track.muted === false`. Images go to `TMP/images/`, audio to `TMP/audio/`.

3. **Download** — reuse `driveDownload()`. Each source file downloaded once keyed by Drive file ID.

4. **Video segments** — for each clip on the V1 track, one FFmpeg call producing `seg_N.mp4`. Uses zoompan (Ken Burns) or static scale/pad depending on `clip.kenburns`.

5. **Concat video** — same xfade chain as today. Fade duration comes from `clip.transition.duration` instead of hardcoded 0.5.

6. **Audio clips** — for each clip on each unmuted audio track, three sequential FFmpeg calls: trim source → apply fades → delay to timeline position.

7. **Mix audio** — `amix` across all delayed clips. If no audio clips exist, generate silence as today.

8. **Mux + upload** — unchanged from current.

---

## Section 3: Ken Burns

### KBPosition coordinate map

```js
const KB_COORDS = {
  'top-left':     { x: 0,   y: 0   },
  'top':          { x: 0.5, y: 0   },
  'top-right':    { x: 1,   y: 0   },
  'left':         { x: 0,   y: 0.5 },
  'center':       { x: 0.5, y: 0.5 },
  'right':        { x: 1,   y: 0.5 },
  'bottom-left':  { x: 0,   y: 1   },
  'bottom':       { x: 0.5, y: 1   },
  'bottom-right': { x: 1,   y: 1   },
}
```

### `zoompan` expression

For a clip with `kenburns: { from, to, scale }` and `d = Math.round(duration * 30)` frames:

```
zoompan=
  z='1+(SCALE-1)*on/d':
  x='max(0,min(iw*(zoom-1),iw*((FX+(TX-FX)*on/d)*zoom-0.5)))':
  y='max(0,min(ih*(zoom-1),ih*((FY+(TY-FY)*on/d)*zoom-0.5)))':
  d=FRAMES:s=1920x1080:fps=30,
scale=1920:1080,format=yuv420p
```

`SCALE`, `FX`, `FY`, `TX`, `TY`, `FRAMES` are substituted as literals when building the command.

- Zoom animates linearly from 1× to `scale`× over the clip duration.
- `x`/`y` linearly interpolate the viewport focus from `from` to `to` coordinates, clamped to valid pan range.

### Static clip (kenburns: null)

```
scale=1920:1080:force_original_aspect_ratio=decrease,
pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,
fps=30,format=yuv420p
```

---

## Section 4: Audio Per-Clip Processing

For each audio clip (`clip.in`, `clip.out`, `clip.start`, `clip.fade.in`, `clip.fade.out`):

**Step 1 — Trim source** (using source in/out offsets):
```
ffmpeg -y -ss {clip.in} -t {clip.out - clip.in} -i source.raw -c:a aac trimmed_N.aac
```

**Step 2 — Apply fades**:
```
ffmpeg -y -i trimmed_N.aac
  -af "afade=t=in:st=0:d={fade.in},afade=t=out:st={duration - fade.out}:d={fade.out}"
  faded_N.aac
```

**Step 3 — Delay to timeline position**:
```
ffmpeg -y -i faded_N.aac
  -af "adelay={clip.start * 1000}|{clip.start * 1000}"
  delayed_N.aac
```

**Mix all clips**:
```
ffmpeg -y -i delayed_0.aac -i delayed_1.aac ...
  -filter_complex "amix=inputs=N:normalize=0:duration=longest"
  audio_mixed.aac
```

`normalize=0` means full-volume sum (no automatic attenuation). If no audio clips exist, generate silence as the legacy path does today.

---

## Section 5: Video Transition

Per-clip transition duration replaces the hardcoded 0.5s:

```js
const fadeDur = videoClips[i].transition.duration  // from clip.transition.duration
accumulatedOffset += videoClips[i - 1].end - videoClips[i - 1].start - fadeDur
// xfade=transition=fade:duration={fadeDur}:offset={accumulatedOffset}
```

---

## Files

**Modified:**
- `components/editor/types.ts` — add `sourceIn?: number` to `Clip`
- `components/editor/to-ffmpeg-json.ts` — update `in`/`out` to use `sourceIn`
- `scripts/render.mjs` — add `timelineJson` branch with zoompan, N-audio, source trim

**New:**
- `components/editor/to-ffmpeg-json.test.ts` — unit tests for serializer

---

## Out of Scope

- Trim UI (drag handles for `sourceIn`) — deferred to Group 4C
- Per-track volume controls — deferred
- Audio crossfade between overlapping clips — no overlapping audio clips in current editor UX
- Non-fade video transitions — only `fade` (xfade) supported; `clip.transition.in` is always `'fade'`
