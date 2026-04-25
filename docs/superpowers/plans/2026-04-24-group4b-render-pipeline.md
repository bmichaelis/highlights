# Group 4B — Render Pipeline Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `render.mjs` to consume `timelineJson` for Ken Burns pan/zoom per clip, per-clip transition durations, N audio tracks with correct timing, and per-clip source trimming support.

**Architecture:** Add `sourceIn` to the `Clip` type and fix `to-ffmpeg-json.ts` to emit source-file offsets (not timeline positions) in `in`/`out`. Then add a `timelineJson` branch inside `render.mjs`'s try block while leaving the legacy `playlist`/`audioFileIds` path completely untouched.

**Tech Stack:** Vitest (unit tests via `npm test`), FFmpeg (video/audio processing), Node.js ESM script (`scripts/render.mjs`), TypeScript (`components/editor/`)

---

## File Map

| File | Change |
|------|--------|
| `components/editor/types.ts` | Add `sourceIn?: number` to `Clip` |
| `components/editor/to-ffmpeg-json.ts` | Use `sourceIn ?? 0` for `in`/`out` in `serializeClip` |
| `components/editor/to-ffmpeg-json.test.ts` | Add 2 tests for `sourceIn` behavior |
| `scripts/render.mjs` | Add `timelineJson` destructure; wrap legacy validation; add new path |

---

### Task 1: `sourceIn` type + serializer + tests

**Files:**
- Modify: `components/editor/types.ts`
- Modify: `components/editor/to-ffmpeg-json.ts`
- Modify: `components/editor/to-ffmpeg-json.test.ts`

- [ ] **Step 1: Write failing tests**

Add these two tests to the `describe('toFFmpegJson', ...)` block in `components/editor/to-ffmpeg-json.test.ts` after the existing tests:

```ts
  it('uses sourceIn for in/out when set', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        {
          ...timeline.tracks[0],
          clips: [{ ...timeline.tracks[0].clips[0], sourceIn: 1.5 }, timeline.tracks[0].clips[1]],
        },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    // in/out are source offsets (1.5 → 4.5); start/end remain timeline positions (0 → 3)
    expect(vTrack.clips[0]).toMatchObject({ in: 1.5, out: 4.5, start: 0, end: 3 })
  })

  it('defaults sourceIn to 0 for clips without it even when start != 0', () => {
    const result = toFFmpegJson(timeline, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    // c2: start=3, duration=4, no sourceIn → in=0 out=4 (NOT in=3 out=7)
    expect(vTrack.clips[1]).toMatchObject({ in: 0, out: 4, start: 3, end: 7 })
  })
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: both new tests fail. The first fails because `sourceIn` is not a field on `Clip`. The second fails because current code sets `in: clip.start` (3, not 0).

- [ ] **Step 3: Add `sourceIn` to `Clip` in `types.ts`**

In `components/editor/types.ts`, add `sourceIn?: number` to the `Clip` type after `duration`:

```ts
export type Clip = {
  id: string
  mediaId: string
  filename: string
  thumbnailUrl?: string
  start: number
  duration: number
  sourceIn?: number       // seconds into source file where playback begins; undefined = 0
  fadeIn?: number
  fadeOut?: number
  kenBurns?: { from: KBPosition; to: KBPosition; scale: number } | null
}
```

- [ ] **Step 4: Update `serializeClip` in `to-ffmpeg-json.ts`**

Replace the `base` definition inside `serializeClip` (currently line 32):

Old:
```ts
  const base = { id: clip.id, source: clip.mediaId, in: clip.start, out: clipEnd(clip), start: clip.start, end: clipEnd(clip) }
```

New:
```ts
  const sourceIn = clip.sourceIn ?? 0
  const base = { id: clip.id, source: clip.mediaId, in: sourceIn, out: sourceIn + clip.duration, start: clip.start, end: clip.start + clip.duration }
```

- [ ] **Step 5: Run tests to confirm all pass**

```bash
npm test
```

Expected: all 54 + 2 = 56 tests pass. Existing tests still pass because all existing test clips have `start: 0`, so their `in`/`out` values compute identically (`0` and `duration`).

- [ ] **Step 6: Commit**

```bash
git add components/editor/types.ts components/editor/to-ffmpeg-json.ts components/editor/to-ffmpeg-json.test.ts
git commit -m "feat: add sourceIn to Clip type, use source-file offsets in to-ffmpeg-json"
```

---

### Task 2: `render.mjs` — restructure + parse/collect/download

**Files:**
- Modify: `scripts/render.mjs`

- [ ] **Step 1: Add `timelineJson` to the payload destructure**

Replace line 6 in `scripts/render.mjs`:

Old:
```js
const { playlist, audioFileIds, accessToken, folderId, jobId, callbackUrl, callbackSecret } = payload
```

New:
```js
const { playlist, audioFileIds, accessToken, folderId, jobId,
        callbackUrl, callbackSecret, timelineJson } = payload
```

- [ ] **Step 2: Wrap legacy validation in `if (!timelineJson)`**

Replace the two top-level validation blocks (currently lines 22–31):

Old:
```js
// validate all duration fields immediately after parsing
if (!playlist || playlist.length === 0) {
  await postCallback('failed', { errorMsg: 'Empty playlist' })
  process.exit(1)
}

for (let i = 0; i < playlist.length; i++) {
  const d = playlist[i].duration
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0)
    throw new Error(`Invalid duration at playlist[${i}]: ${d}`)
}
```

New:
```js
if (!timelineJson) {
  if (!playlist || playlist.length === 0) {
    await postCallback('failed', { errorMsg: 'Empty playlist' })
    process.exit(1)
  }
  for (let i = 0; i < playlist.length; i++) {
    const d = playlist[i].duration
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0)
      throw new Error(`Invalid duration at playlist[${i}]: ${d}`)
  }
}
```

- [ ] **Step 3: Replace the entire try block body with the if/else structure**

The try block currently starts at line 47. Replace everything from `try {` through the closing `}` of the catch block with the following. The legacy path is the existing code, moved unchanged into the `else` branch. The new path starts with parse + collect + download (Tasks 3–5 will fill in the placeholder comments):

```js
try {
  await postCallback('running')

  if (timelineJson) {
    // ── NEW PATH ─────────────────────────────────────────────────────────────
    const tfj = JSON.parse(timelineJson)  // { output, duration, tracks }
    const v1Track = tfj.tracks.find((t) => t.id === 'V1')
    const audioTracks = tfj.tracks.filter((t) => t.kind === 'audio' && !t.muted)
    const videoClips = v1Track?.clips ?? []

    // Collect unique source Drive file IDs
    const imageSources = new Map()  // Drive file ID → local path
    for (const clip of videoClips) {
      if (!imageSources.has(clip.source)) {
        imageSources.set(clip.source, `${TMP}/images/${imageSources.size}.jpg`)
      }
    }
    const audioSources = new Map()  // Drive file ID → local path
    for (const track of audioTracks) {
      for (const clip of track.clips) {
        if (!audioSources.has(clip.source)) {
          audioSources.set(clip.source, `${TMP}/audio/src_${audioSources.size}.raw`)
        }
      }
    }

    // Download each unique source once
    for (const [sourceId, localPath] of imageSources) {
      await driveDownload(sourceId, localPath)
      console.log(`Downloaded image source: ${sourceId}`)
    }
    for (const [sourceId, localPath] of audioSources) {
      await driveDownload(sourceId, localPath)
      console.log(`Downloaded audio source: ${sourceId}`)
    }

    // VIDEO SEGMENTS — Task 3
    // AUDIO PROCESSING — Task 4
    // CONCAT + MUX + UPLOAD — Task 5

  } else {
    // ── LEGACY PATH (unchanged) ───────────────────────────────────────────────
    for (let i = 0; i < playlist.length; i++) {
      const dest = `${TMP}/images/${String(i).padStart(4, '0')}.jpg`
      await driveDownload(playlist[i].driveFileId, dest)
      console.log(`Downloaded image ${i + 1}/${playlist.length}`)
    }

    const audioPaths = []
    for (let i = 0; i < audioFileIds.length; i++) {
      const raw = `${TMP}/audio/${String(i).padStart(4, '0')}.raw`
      await driveDownload(audioFileIds[i], raw)
      const aac = `${TMP}/audio/${String(i).padStart(4, '0')}.aac`
      execSync(`ffmpeg -y -i "${raw}" -c:a aac -q:a 2 "${aac}"`, { stdio: 'inherit' })
      audioPaths.push(aac)
      console.log(`Downloaded audio ${i + 1}/${audioFileIds.length}`)
    }

    const totalDuration = playlist.reduce((sum, item) => sum + item.duration, 0)

    const segPaths = []
    for (let i = 0; i < playlist.length; i++) {
      const img = `${TMP}/images/${String(i).padStart(4, '0')}.jpg`
      const seg = `${TMP}/seg_${i}.mp4`
      const dur = playlist[i].duration
      execSync(
        `ffmpeg -y -loop 1 -t ${dur} -i "${img}" ` +
        `-vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p" ` +
        `-c:v libx264 -preset fast -crf 22 "${seg}"`,
        { stdio: 'inherit' }
      )
      segPaths.push(seg)
    }

    let videoPath
    if (segPaths.length === 1) {
      videoPath = segPaths[0]
    } else {
      const FADE = 0.5
      const inputs = segPaths.map((p) => `-i "${p}"`).join(' ')
      let prevLabel = '[0:v]'
      const filterParts = []
      let accumulatedOffset = 0
      for (let i = 1; i < segPaths.length; i++) {
        accumulatedOffset += playlist[i - 1].duration - FADE
        const outLabel = i < segPaths.length - 1 ? `[v${i}]` : '[vout]'
        filterParts.push(
          `${prevLabel}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${accumulatedOffset.toFixed(3)}${outLabel}`
        )
        prevLabel = outLabel
      }
      videoPath = `${TMP}/video_only.mp4`
      execSync(
        `ffmpeg -y ${inputs} -filter_complex "${filterParts.join(';')}" -map "[vout]" -c:v libx264 -preset fast -crf 22 "${videoPath}"`,
        { stdio: 'inherit' }
      )
    }

    let audioPath
    if (audioPaths.length === 0) {
      audioPath = `${TMP}/audio_silent.aac`
      execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${totalDuration} -c:a aac "${audioPath}"`)
    } else {
      const concatPath = `${TMP}/audio_concat.aac`
      if (audioPaths.length === 1) {
        fs.copyFileSync(audioPaths[0], concatPath)
      } else {
        const listFile = `${TMP}/audio_list.txt`
        fs.writeFileSync(listFile, audioPaths.map((p) => `file '${p}'`).join('\n'))
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:a aac "${concatPath}"`, { stdio: 'inherit' })
      }
      audioPath = `${TMP}/audio_final.aac`
      execSync(`ffmpeg -y -stream_loop -1 -i "${concatPath}" -t ${totalDuration} -c:a aac "${audioPath}"`, { stdio: 'inherit' })
    }

    const outputPath = `${TMP}/output.mp4`
    execSync(`ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outputPath}"`, { stdio: 'inherit' })

    const fileSize = fs.statSync(outputPath).size
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({
          name: `highlights_${new Date().toISOString().slice(0, 10)}.mp4`,
          parents: [folderId],
          mimeType: 'video/mp4',
        }),
      }
    )
    if (!initRes.ok) throw new Error(`Upload init failed: ${await initRes.text()}`)
    const uploadUrl = initRes.headers.get('location')

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(fileSize) },
      body: Readable.toWeb(fs.createReadStream(outputPath)),
      duplex: 'half',
    })
    if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`)
    const { id: driveFileId } = await uploadRes.json()

    await postCallback('complete', { driveFileId })
    console.log('Render complete, Drive file ID:', driveFileId)
  }
} catch (err) {
  console.error('Render error:', err)
  await postCallback('failed', { errorMsg: err.message })
  process.exit(1)
}
```

- [ ] **Step 4: Verify syntax**

```bash
node --check scripts/render.mjs
```

Expected: no output (clean parse).

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: 56 tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/render.mjs
git commit -m "feat: scaffold timelineJson path in render.mjs with source download"
```

---

### Task 3: `render.mjs` — per-clip video segments (Ken Burns + static)

**Files:**
- Modify: `scripts/render.mjs`

- [ ] **Step 1: Add `KB_COORDS` constant after the imports**

Add after the three `import` lines at the top of `scripts/render.mjs` (after line 3):

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

- [ ] **Step 2: Replace the `// VIDEO SEGMENTS — Task 3` comment**

Find `// VIDEO SEGMENTS — Task 3` inside the `if (timelineJson)` block and replace it with:

```js
    // Build per-clip video segments
    const segPaths = []
    for (let i = 0; i < videoClips.length; i++) {
      const clip = videoClips[i]
      const src = imageSources.get(clip.source)
      const seg = `${TMP}/seg_${i}.mp4`
      const duration = clip.end - clip.start

      let vf
      if (clip.kenburns !== null) {
        const kb = clip.kenburns
        const D = Math.round(duration * 30)
        const from = KB_COORDS[kb.from]
        const to = KB_COORDS[kb.to]
        vf = [
          `zoompan=z='1+(${kb.scale}-1)*on/${D}':` +
          `x='max(0,min(iw*(zoom-1),iw*((${from.x}+(${to.x}-${from.x})*on/${D})*zoom-0.5)))':` +
          `y='max(0,min(ih*(zoom-1),ih*((${from.y}+(${to.y}-${from.y})*on/${D})*zoom-0.5)))':` +
          `d=${D}:s=1920x1080:fps=30`,
          'scale=1920:1080',
          'format=yuv420p',
        ].join(',')
      } else {
        vf = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p'
      }

      execSync(
        `ffmpeg -y -loop 1 -t ${duration} -i "${src}" ` +
        `-vf "${vf}" ` +
        `-c:v libx264 -preset fast -crf 22 "${seg}"`,
        { stdio: 'inherit' }
      )
      segPaths.push(seg)
      console.log(`Rendered video segment ${i + 1}/${videoClips.length}`)
    }
```

- [ ] **Step 3: Verify syntax**

```bash
node --check scripts/render.mjs
```

Expected: no output.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: 56 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/render.mjs
git commit -m "feat: add Ken Burns zoompan and static per-clip video segments in render.mjs"
```

---

### Task 4: `render.mjs` — audio per-clip processing + amix

**Files:**
- Modify: `scripts/render.mjs`

- [ ] **Step 1: Replace the `// AUDIO PROCESSING — Task 4` comment**

Find `// AUDIO PROCESSING — Task 4` inside the `if (timelineJson)` block and replace it with:

```js
    // Per-clip audio: trim source → apply fades → delay to timeline position
    const delayedAudioPaths = []
    let audioClipIdx = 0
    for (const track of audioTracks) {
      for (const clip of track.clips) {
        const src = audioSources.get(clip.source)
        const clipDur = clip.out - clip.in
        const trimmed = `${TMP}/audio/trimmed_${audioClipIdx}.aac`
        const faded   = `${TMP}/audio/faded_${audioClipIdx}.aac`
        const delayed = `${TMP}/audio/delayed_${audioClipIdx}.aac`

        execSync(
          `ffmpeg -y -ss ${clip.in} -t ${clipDur} -i "${src}" -c:a aac "${trimmed}"`,
          { stdio: 'inherit' }
        )

        const fadeOutSt = clipDur - clip.fade.out
        execSync(
          `ffmpeg -y -i "${trimmed}" ` +
          `-af "afade=t=in:st=0:d=${clip.fade.in},afade=t=out:st=${fadeOutSt.toFixed(3)}:d=${clip.fade.out}" ` +
          `"${faded}"`,
          { stdio: 'inherit' }
        )

        const delayMs = Math.round(clip.start * 1000)
        execSync(
          `ffmpeg -y -i "${faded}" -af "adelay=${delayMs}|${delayMs}" "${delayed}"`,
          { stdio: 'inherit' }
        )

        delayedAudioPaths.push(delayed)
        audioClipIdx++
        console.log(`Processed audio clip ${audioClipIdx}`)
      }
    }

    let audioPath
    if (delayedAudioPaths.length === 0) {
      audioPath = `${TMP}/audio_silent.aac`
      execSync(
        `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${tfj.duration} -c:a aac "${audioPath}"`,
        { stdio: 'inherit' }
      )
    } else {
      const inputs = delayedAudioPaths.map((p) => `-i "${p}"`).join(' ')
      audioPath = `${TMP}/audio_mixed.aac`
      execSync(
        `ffmpeg -y ${inputs} ` +
        `-filter_complex "amix=inputs=${delayedAudioPaths.length}:normalize=0:duration=longest" ` +
        `"${audioPath}"`,
        { stdio: 'inherit' }
      )
    }
```

- [ ] **Step 2: Verify syntax**

```bash
node --check scripts/render.mjs
```

Expected: no output.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 56 tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/render.mjs
git commit -m "feat: add per-clip audio trim/fade/delay and amix in render.mjs"
```

---

### Task 5: `render.mjs` — video xfade concat + mux + upload

**Files:**
- Modify: `scripts/render.mjs`

- [ ] **Step 1: Replace the `// CONCAT + MUX + UPLOAD — Task 5` comment**

Find `// CONCAT + MUX + UPLOAD — Task 5` inside the `if (timelineJson)` block and replace it with:

```js
    // Concat video segments with per-clip xfade transitions
    let videoPath
    if (segPaths.length === 1) {
      videoPath = segPaths[0]
    } else {
      const inputs = segPaths.map((p) => `-i "${p}"`).join(' ')
      let prevLabel = '[0:v]'
      const filterParts = []
      let accumulatedOffset = 0
      for (let i = 1; i < videoClips.length; i++) {
        const fadeDur = videoClips[i].transition.duration
        accumulatedOffset += (videoClips[i - 1].end - videoClips[i - 1].start) - fadeDur
        const outLabel = i < videoClips.length - 1 ? `[v${i}]` : '[vout]'
        filterParts.push(
          `${prevLabel}[${i}:v]xfade=transition=fade:duration=${fadeDur}:offset=${accumulatedOffset.toFixed(3)}${outLabel}`
        )
        prevLabel = outLabel
      }
      videoPath = `${TMP}/video_only.mp4`
      execSync(
        `ffmpeg -y ${inputs} -filter_complex "${filterParts.join(';')}" -map "[vout]" -c:v libx264 -preset fast -crf 22 "${videoPath}"`,
        { stdio: 'inherit' }
      )
    }

    // Mux video + audio
    const outputPath = `${TMP}/output.mp4`
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outputPath}"`,
      { stdio: 'inherit' }
    )

    // Upload to Drive via resumable upload
    const fileSize = fs.statSync(outputPath).size
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({
          name: `highlights_${new Date().toISOString().slice(0, 10)}.mp4`,
          parents: [folderId],
          mimeType: 'video/mp4',
        }),
      }
    )
    if (!initRes.ok) throw new Error(`Upload init failed: ${await initRes.text()}`)
    const uploadUrl = initRes.headers.get('location')

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(fileSize) },
      body: Readable.toWeb(fs.createReadStream(outputPath)),
      duplex: 'half',
    })
    if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`)
    const { id: driveFileId } = await uploadRes.json()

    await postCallback('complete', { driveFileId })
    console.log('Render complete, Drive file ID:', driveFileId)
```

- [ ] **Step 2: Verify syntax**

```bash
node --check scripts/render.mjs
```

Expected: no output.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: 56 tests pass. (render.mjs itself is not unit-tested, but the serializer tests cover the data model, and the syntax check verified the script parses correctly.)

- [ ] **Step 4: Commit**

```bash
git add scripts/render.mjs
git commit -m "feat: complete timelineJson render path — xfade concat, mux, Drive upload"
```
