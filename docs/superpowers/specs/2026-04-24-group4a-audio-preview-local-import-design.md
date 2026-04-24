# Group 4A — Audio Preview + Local File Import Design Spec

**Date:** 2026-04-24
**Status:** Approved

## Overview

Two features folded into one group:

1. **Audio playback in preview** — the preview panel plays audio tracks in sync with the playhead. Supports N audio tracks, muting, and scrubbing.
2. **Local file import** — users can upload photos and audio files from their local machine directly into the project's Google Drive folder via a button in the media browser.

The render pipeline upgrade (Ken Burns + N-audio in `render.mjs`) is a separate spec (Group 4B).

---

## Feature 1: Audio Proxy Route

**New file:** `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/[fileId]/route.ts`

`GET` handler. Uses the same Drive auth pattern as existing routes (look up project credentials, get access token). Fetches:

```
https://www.googleapis.com/drive/v3/files/${fileId}?alt=media
```

Forwards the `Range` request header if present (browser audio seeking). Streams the Drive response back with the original `Content-Type` header. No caching, no body transformation.

This URL is used as `<audio src>` in the preview panel:
```
/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/audio/${clip.mediaId}
```

---

## Feature 2: Preview Panel Audio Playback

**Modified file:** `components/editor/preview-panel.tsx`

### New prop

```ts
audioBaseUrl: string
// e.g. `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/audio`
```

Passed from `editor.tsx` where `orgSlug`, `teamId`, `projectId` are already available.

### Audio element management

One hidden `<audio>` element rendered per audio track:

```tsx
{timeline.tracks.filter((t) => t.kind === 'audio').map((track) => (
  <audio
    key={track.id}
    style={{ display: 'none' }}
    ref={(el) => {
      if (el) audioRefs.current.set(track.id, el)
      else audioRefs.current.delete(track.id)
    }}
  />
))}
```

Refs stored in `useRef<Map<string, HTMLAudioElement>>(new Map())`.

### Sync logic

`useEffect` on `[playhead, playing, timeline, audioBaseUrl]`:

For each audio track:
1. Find the active clip: `track.clips.find(c => c.start <= playhead && playhead < c.start + c.duration)`
2. If **no active clip** or **track is muted**: `audio.pause()`
3. If **active clip found**:
   - If clip changed from previously loaded (`loadedClipRef` keyed by track ID): set `audio.src`, seek to `playhead - clip.start`, update loaded clip ref
   - If **paused** (user scrubbing): `audio.currentTime = playhead - clip.start`
   - If **playing and same clip**: don't seek — let audio run naturally to avoid choppy playback
   - Call `audio.play().catch(() => {})` if `playing`, else `audio.pause()`

Track the loaded clip per audio element using `loadedClipIdRef = useRef<Map<string, string>>(new Map())` (track ID → clip ID currently loaded in that audio element).

### `editor.tsx` change

Pass the new prop to `<PreviewPanel>`:

```tsx
audioBaseUrl={`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/audio`}
```

---

## Feature 3: Local File Import

### Upload API route

**New file:** `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/upload/route.ts`

`POST` handler. Accepts `multipart/form-data` with a single `file` field. Flow:

1. Auth: same Drive credential lookup as existing routes
2. Look up project's `folderId` from D1
3. Read the file from the request body (`request.formData()`)
4. Upload to Drive using multipart upload:
   ```
   POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
   ```
   Metadata part: `{ name: file.name, parents: [folderId] }`  
   Media part: file bytes with original MIME type
5. Return `{ driveFileId, filename, mimeType }`

Individual files are well under Cloudflare's 100 MB request limit.

### Media browser UI

**Modified file:** `components/editor/media-browser.tsx`

A small `Upload` button added to the header area of each tab (Photos / Audio). Clicking the button triggers a hidden `<input type="file" multiple>` (Photos: `accept="image/*"`, Audio: `accept="audio/*"`).

On file selection:
- Upload files sequentially to `/api/.../upload`
- Show "Uploading 1/3…" counter in the tab header while in progress
- On completion, increment an internal `uploadGeneration` state counter; the media fetch `useEffect` includes `uploadGeneration` in its dependency array so it re-runs automatically

No changes to drag-to-timeline behavior.

---

## Files

**New:**
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/[fileId]/route.ts`
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/upload/route.ts`

**Modified:**
- `components/editor/preview-panel.tsx` — hidden audio elements, sync useEffect, new prop
- `components/editor/media-browser.tsx` — Upload button, file input, upload flow
- `components/editor/editor.tsx` — pass `audioBaseUrl` to PreviewPanel

---

## Out of Scope

- Render pipeline upgrade (Ken Burns + N-audio in `render.mjs`) — covered in Group 4B
- Thumbnail generation for uploaded photos (Drive generates thumbnails asynchronously; existing `null` thumbnail handling is already in place)
- Bulk upload progress bar (sequential upload with counter is sufficient)
- Upload size validation beyond Cloudflare's built-in 100 MB limit
