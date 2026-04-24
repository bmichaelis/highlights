# Group 4A — Audio Preview + Local File Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audio playback to the preview panel and let users upload local photo/audio files into the project's Drive folder from the media browser.

**Architecture:** A new `audio/[fileId]` proxy route streams Drive audio to the browser with Range header forwarding. `PreviewPanel` gains one hidden `<audio>` element per audio track, synchronized to the playhead via a `useEffect`. A new `upload` route accepts multipart form data and pushes files to Drive via the multipart upload API; `MediaBrowser` gains per-tab Upload buttons that trigger re-fetches via an `uploadGeneration` counter.

**Tech Stack:** Next.js 16 App Router (Cloudflare Workers via @opennextjs/cloudflare), React 19, Drizzle ORM, Google Drive API v3, Vitest.

---

### Task 1: Audio proxy route

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/[fileId]/route.ts`

Note: the folder `audio/` already exists (it is the audio file listing route). This new file lives one level deeper at `audio/[fileId]/route.ts`.

- [ ] **Step 1: Create the route file**

```ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { refreshDriveToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string; fileId: string }> }

export async function GET(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId, fileId } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  try {
    const tokenData = await refreshDriveToken(conn.refreshToken)
    await db.update(driveConnections)
      .set({ accessToken: tokenData.accessToken, expiresAt: new Date(tokenData.expiresAt) })
      .where(eq(driveConnections.id, conn.id))

    const range = req.headers.get('range')
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.accessToken}`,
          ...(range ? { Range: range } : {}),
        },
      }
    )
    if (!driveRes.ok && driveRes.status !== 206) {
      return NextResponse.json({ error: 'Drive fetch failed' }, { status: 502 })
    }

    const headers: Record<string, string> = {
      'Content-Type': driveRes.headers.get('content-type') ?? 'audio/mpeg',
    }
    const contentRange = driveRes.headers.get('content-range')
    if (contentRange) headers['Content-Range'] = contentRange
    const contentLength = driveRes.headers.get('content-length')
    if (contentLength) headers['Content-Length'] = contentLength
    const acceptRanges = driveRes.headers.get('accept-ranges')
    if (acceptRanges) headers['Accept-Ranges'] = acceptRanges

    return new Response(driveRes.body, { status: driveRes.status, headers })
  } catch {
    return NextResponse.json({ error: 'Drive access failed' }, { status: 502 })
  }
}
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `npm test`
Expected: all 54 tests pass

- [ ] **Step 3: Commit**

```bash
git add "app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/[fileId]/route.ts"
git commit -m "feat: add audio proxy route with Range header forwarding"
```

---

### Task 2: Preview panel audio playback

**Files:**
- Modify: `components/editor/preview-panel.tsx`
- Modify: `components/editor/editor.tsx`

- [ ] **Step 1: Add `useEffect` to imports in `preview-panel.tsx`**

The file currently imports `useRef, useCallback` from React. Add `useEffect`:

```ts
import { useRef, useCallback, useEffect } from 'react'
```

- [ ] **Step 2: Add `audioBaseUrl` to the Props type**

Replace the Props type:

```ts
type Props = {
  timeline: Timeline
  playhead: number
  playing: boolean
  totalDuration: number
  audioBaseUrl: string
  onSeek: (time: number) => void
  onPlayPause: () => void
  onPrev: () => void
  onNext: () => void
}
```

- [ ] **Step 3: Destructure `audioBaseUrl` in the function signature**

Change:
```tsx
export function PreviewPanel({ timeline, playhead, playing, totalDuration, onSeek, onPlayPause, onPrev, onNext }: Props) {
```
To:
```tsx
export function PreviewPanel({ timeline, playhead, playing, totalDuration, audioBaseUrl, onSeek, onPlayPause, onPrev, onNext }: Props) {
```

- [ ] **Step 4: Add audio refs and sync effect**

Directly after `const scrubRef = useRef<HTMLDivElement>(null)`, add:

```ts
const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())
const loadedClipIdRef = useRef<Map<string, string>>(new Map())

useEffect(() => {
  const audioTracks = timeline.tracks.filter((t) => t.kind === 'audio')
  for (const track of audioTracks) {
    const audio = audioRefs.current.get(track.id)
    if (!audio) continue
    const activeClip = track.clips.find(
      (c) => c.start <= playhead && playhead < c.start + c.duration
    ) ?? null
    if (!activeClip || track.muted) {
      audio.pause()
      continue
    }
    const prevClipId = loadedClipIdRef.current.get(track.id)
    if (prevClipId !== activeClip.id) {
      audio.src = `${audioBaseUrl}/${activeClip.mediaId}`
      audio.currentTime = playhead - activeClip.start
      loadedClipIdRef.current.set(track.id, activeClip.id)
    } else if (!playing) {
      audio.currentTime = playhead - activeClip.start
    }
    if (playing) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }
}, [playhead, playing, timeline, audioBaseUrl])
```

- [ ] **Step 5: Add hidden `<audio>` elements to JSX**

In the return statement, add the audio elements just before the final closing `</div>` (the one that closes the outermost flex column):

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
    </div>
  )
}
```

- [ ] **Step 6: Pass `audioBaseUrl` from `editor.tsx`**

In `components/editor/editor.tsx`, find the `<PreviewPanel` usage (around line 273) and add the `audioBaseUrl` prop:

```tsx
<PreviewPanel
  timeline={timeline}
  playhead={playhead}
  playing={playing}
  totalDuration={totalDuration}
  audioBaseUrl={`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/audio`}
  onSeek={setPlayhead}
  onPlayPause={() => setPlaying((p) => !p)}
  onPrev={() => setPlayhead(prevTime)}
  onNext={() => setPlayhead(nextTime)}
/>
```

- [ ] **Step 7: Run existing tests to verify no regressions**

Run: `npm test`
Expected: all 54 tests pass

- [ ] **Step 8: Commit**

```bash
git add components/editor/preview-panel.tsx components/editor/editor.tsx
git commit -m "feat: add audio playback to preview panel"
```

---

### Task 3: Upload API route

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/upload/route.ts`

- [ ] **Step 1: Create the route file**

```ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { refreshDriveToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function POST(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!project.folderId) return NextResponse.json({ error: 'Project has no Drive folder' }, { status: 400 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  try {
    const tokenData = await refreshDriveToken(conn.refreshToken)
    await db.update(driveConnections)
      .set({ accessToken: tokenData.accessToken, expiresAt: new Date(tokenData.expiresAt) })
      .where(eq(driveConnections.id, conn.id))

    const metadata = JSON.stringify({ name: file.name, parents: [project.folderId] })
    const fileBytes = await file.arrayBuffer()
    const boundary = 'boundary' + Date.now()
    const encoder = new TextEncoder()

    const metaPart = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
    )
    const mediaHeader = encoder.encode(
      `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
    )
    const closing = encoder.encode(`\r\n--${boundary}--`)

    const body = new Uint8Array(
      metaPart.byteLength + mediaHeader.byteLength + fileBytes.byteLength + closing.byteLength
    )
    body.set(metaPart, 0)
    body.set(mediaHeader, metaPart.byteLength)
    body.set(new Uint8Array(fileBytes), metaPart.byteLength + mediaHeader.byteLength)
    body.set(closing, metaPart.byteLength + mediaHeader.byteLength + fileBytes.byteLength)

    const driveRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    )
    if (!driveRes.ok) return NextResponse.json({ error: 'Drive upload failed' }, { status: 502 })
    const driveFile = await driveRes.json() as { id: string; name: string; mimeType: string }
    return NextResponse.json({ driveFileId: driveFile.id, filename: driveFile.name, mimeType: driveFile.mimeType })
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 502 })
  }
}
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `npm test`
Expected: all 54 tests pass

- [ ] **Step 3: Commit**

```bash
git add "app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/upload/route.ts"
git commit -m "feat: add local file upload route to Drive"
```

---

### Task 4: Media browser upload UI

**Files:**
- Modify: `components/editor/media-browser.tsx`

- [ ] **Step 1: Add upload state and refs**

In `MediaBrowser`, after the existing state declarations (`const [refreshing, setRefreshing] = useState(false)`), add:

```ts
const [uploadGeneration, setUploadGeneration] = useState(0)
const [uploadStatus, setUploadStatus] = useState<string | null>(null)
const photoInputRef = useRef<HTMLInputElement>(null)
const audioInputRef = useRef<HTMLInputElement>(null)
```

- [ ] **Step 2: Add `uploadGeneration` to the photos useEffect dependency array**

Change:
```ts
useEffect(() => { loadPhotos() }, [projectId])
```
To:
```ts
useEffect(() => { loadPhotos() }, [projectId, uploadGeneration])
```

- [ ] **Step 3: Add `uploadGeneration` to the audio reset effect**

Change:
```ts
useEffect(() => {
  audioLoadedRef.current = false
  setAudioFiles([])
}, [projectId])
```
To:
```ts
useEffect(() => {
  audioLoadedRef.current = false
  setAudioFiles([])
}, [projectId, uploadGeneration])
```

- [ ] **Step 4: Add `uploadGeneration` to the audio load effect**

Change:
```ts
useEffect(() => {
  if (tab === 'audio' && !audioLoadedRef.current) {
    audioLoadedRef.current = true
    loadAudio()
  }
}, [tab, projectId])
```
To:
```ts
useEffect(() => {
  if (tab === 'audio' && !audioLoadedRef.current) {
    audioLoadedRef.current = true
    loadAudio()
  }
}, [tab, projectId, uploadGeneration])
```

- [ ] **Step 5: Add the upload handler**

After `handleRefresh`, add:

```ts
async function handleUpload(files: FileList | null) {
  if (!files || files.length === 0) return
  const total = files.length
  for (let i = 0; i < total; i++) {
    setUploadStatus(`Uploading ${i + 1}/${total}…`)
    const fd = new FormData()
    fd.append('file', files[i])
    await fetch(`${apiBase}/upload`, { method: 'POST', body: fd })
  }
  setUploadStatus(null)
  setUploadGeneration((g) => g + 1)
}
```

- [ ] **Step 6: Replace the tabs section in JSX to add the Upload button and hidden inputs**

Replace:
```tsx
{/* Tabs */}
<div className="flex gap-2 px-3 py-2">
  <button style={tabStyle(tab === 'photos')} onClick={() => setTab('photos')}>Photos</button>
  <button style={tabStyle(tab === 'audio')} onClick={() => setTab('audio')}>Audio</button>
</div>
```

With:
```tsx
{/* Tabs */}
<div className="flex items-center gap-2 px-3 py-2">
  <button style={tabStyle(tab === 'photos')} onClick={() => setTab('photos')}>Photos</button>
  <button style={tabStyle(tab === 'audio')} onClick={() => setTab('audio')}>Audio</button>
  <div style={{ flex: 1 }} />
  {uploadStatus ? (
    <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{uploadStatus}</span>
  ) : (
    <button
      onClick={() => (tab === 'photos' ? photoInputRef : audioInputRef).current?.click()}
      style={{ fontSize: 10, color: 'var(--ink-3)', background: 'none', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer' }}
    >
      Upload
    </button>
  )}
  <input
    ref={photoInputRef}
    type="file"
    multiple
    accept="image/*"
    style={{ display: 'none' }}
    onChange={(e) => { handleUpload(e.target.files); e.target.value = '' }}
  />
  <input
    ref={audioInputRef}
    type="file"
    multiple
    accept="audio/*"
    style={{ display: 'none' }}
    onChange={(e) => { handleUpload(e.target.files); e.target.value = '' }}
  />
</div>
```

- [ ] **Step 7: Run existing tests to verify no regressions**

Run: `npm test`
Expected: all 54 tests pass

- [ ] **Step 8: Commit**

```bash
git add components/editor/media-browser.tsx
git commit -m "feat: add upload button to media browser"
```
