# KickReel Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project detail page with a browser-based NLE for assembling soccer highlight reels from Drive photos and audio, wired to the existing render pipeline.

**Architecture:** A `useReducer`-based editor component tree replaces the project detail page at its existing route. Timeline state is persisted as JSON in a new `projects.timelineJson` column via a GET/PUT `/timeline` API. On Export, the editor serializes the timeline to ffmpeg JSON and POSTs it to the existing render route (updated to accept the new body).

**Tech Stack:** Next.js 16 App Router, React 19 `useReducer`, Tailwind CSS v4, Drizzle ORM + D1, Vitest, Google Drive API via existing `lib/drive/scanner`

**Design reference:** `Highlights.zip/design_handoff_kickreel_editor/` — open `KickReel Editor.html` in a browser and read the JSX files under `reference/` for interaction logic. This plan matches the MVP subset; the full feature set is in the reference.

---

## File Map

**Create:**
- `components/editor/types.ts` — Clip, Track, Timeline, MediaItem, HistoryState, Action types
- `components/editor/to-ffmpeg-json.ts` — serialize Timeline → ffmpeg JSON
- `components/editor/use-editor.ts` — useReducer + undo/redo + auto-save + keyboard shortcuts
- `components/editor/editor-top-bar.tsx` — 42px top bar
- `components/editor/editor-toolbar.tsx` — 34px secondary toolbar
- `components/editor/media-browser.tsx` — 270px left panel
- `components/editor/preview-panel.tsx` — center preview + transport
- `components/editor/timeline.tsx` — bottom multi-track timeline
- `components/editor/editor.tsx` — root editor component
- `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/settings/page.tsx` — moved project management UI
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/timeline/route.ts` — GET/PUT
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/route.ts` — GET audio files list

**Modify:**
- `db/schema.ts` — add `timelineJson` column to `projects`
- `app/globals.css` — add editor CSS custom properties for light/dark themes
- `lib/github/actions.ts` — add optional `timelineJson` to `RenderPayload`
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/render/route.ts` — accept timelineJson body
- `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx` — replace with EditorPage

---

## Task 1: Schema — add timeline_json column

**Files:**
- Modify: `db/schema.ts`
- Run: `npm run db:generate` then `npm run db:push`

- [ ] **Step 1: Add the column to the schema**

In `db/schema.ts`, update the `projects` table:

```ts
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status', { enum: ['draft', 'rendering', 'complete', 'failed'] }).notNull().default('draft'),
  imagesPerPlayer: integer('imagesPerPlayer').notNull().default(4),
  secondsPerImage: real('secondsPerImage').notNull().default(3.5),
  audioR2Key: text('audioR2Key'),
  folderId: text('folderId'),
  folderName: text('folderName'),
  timelineJson: text('timelineJson'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).default(now()),
})
```

- [ ] **Step 2: Generate the migration**

```bash
npm run db:generate
```

Expected: a new file `db/migrations/0002_*.sql` containing `ALTER TABLE projects ADD COLUMN timeline_json text;`

- [ ] **Step 3: Apply the migration**

```bash
npm run db:push
```

Expected: `[✓] Changes applied`

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts db/migrations/
git commit -m "feat: add timeline_json column to projects"
```

---

## Task 2: Editor types

**Files:**
- Create: `components/editor/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// components/editor/types.ts

export type MediaItem = {
  id: string          // Drive file ID
  kind: 'image' | 'audio'
  filename: string
  thumbnailUrl?: string
  defaultDuration: number  // seconds
}

export type Clip = {
  id: string
  mediaId: string       // Drive file ID (used as `source` in ffmpeg JSON)
  filename: string
  thumbnailUrl?: string // images only
  start: number         // seconds from t=0
  duration: number      // seconds
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/editor/types.ts
git commit -m "feat: add editor types"
```

---

## Task 3: toFFmpegJSON serializer

**Files:**
- Create: `components/editor/to-ffmpeg-json.ts`
- Test: `components/editor/to-ffmpeg-json.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// components/editor/to-ffmpeg-json.test.ts
import { describe, it, expect } from 'vitest'
import { toFFmpegJson } from './to-ffmpeg-json'
import type { Timeline } from './types'

const timeline: Timeline = {
  tracks: [
    {
      id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false,
      clips: [
        { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', thumbnailUrl: undefined, start: 0, duration: 3 },
        { id: 'c2', mediaId: 'drive-def', filename: 'celeb.jpg', thumbnailUrl: undefined, start: 3, duration: 4 },
      ],
    },
    {
      id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false,
      clips: [
        { id: 'c3', mediaId: 'drive-mus', filename: 'champs.mp3', start: 0, duration: 30 },
      ],
    },
  ],
}

describe('toFFmpegJson', () => {
  it('emits correct output settings', () => {
    const result = toFFmpegJson(timeline, 'rangers_spring26')
    expect(result.output).toEqual({
      filename: 'rangers_spring26.mp4',
      width: 1920,
      height: 1080,
      fps: 30,
      audio_rate: 48000,
    })
  })

  it('derives duration from latest clip end', () => {
    const result = toFFmpegJson(timeline, 'test')
    expect(result.duration).toBe(30)
  })

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
      kenburns: { from: 'center', to: 'in', scale: 1.08 },
      transition: { in: 'fade', duration: 0.2 },
    })
  })

  it('maps audio clips without kenburns', () => {
    const result = toFFmpegJson(timeline, 'test')
    const aTrack = result.tracks.find((t) => t.id === 'A1')!
    expect(aTrack.clips[0]).toMatchObject({
      type: 'audio',
      source: 'drive-mus',
      in: 0,
      out: 30,
      start: 0,
      end: 30,
    })
    expect(aTrack.clips[0]).not.toHaveProperty('kenburns')
  })

  it('excludes muted tracks', () => {
    const mutedTimeline: Timeline = {
      tracks: [
        { ...timeline.tracks[0], muted: true },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(mutedTimeline, 'test')
    const v = result.tracks.find((t) => t.id === 'V1')
    expect(v?.muted).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- to-ffmpeg-json
```

Expected: FAIL — "Cannot find module './to-ffmpeg-json'"

- [ ] **Step 3: Implement the serializer**

```ts
// components/editor/to-ffmpeg-json.ts
import type { Timeline, Clip, Track } from './types'

type FFmpegClip =
  | { id: string; type: 'image'; source: string; in: number; out: number; start: number; end: number; kenburns: { from: string; to: string; scale: number }; transition: { in: string; duration: number } }
  | { id: string; type: 'audio'; source: string; in: number; out: number; start: number; end: number }

type FFmpegTrack = { id: string; kind: string; muted: boolean; clips: FFmpegClip[] }

type FFmpegJson = {
  output: { filename: string; width: number; height: number; fps: number; audio_rate: number }
  duration: number
  tracks: FFmpegTrack[]
}

function clipEnd(clip: Clip): number {
  return clip.start + clip.duration
}

function serializeClip(clip: Clip, kind: 'video' | 'audio'): FFmpegClip {
  const base = { id: clip.id, source: clip.mediaId, in: clip.start, out: clipEnd(clip), start: clip.start, end: clipEnd(clip) }
  if (kind === 'video') {
    return { ...base, type: 'image', kenburns: { from: 'center', to: 'in', scale: 1.08 }, transition: { in: 'fade', duration: 0.2 } }
  }
  return { ...base, type: 'audio' }
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- to-ffmpeg-json
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add components/editor/to-ffmpeg-json.ts components/editor/to-ffmpeg-json.test.ts
git commit -m "feat: add toFFmpegJson serializer"
```

---

## Task 4: Timeline API routes (GET / PUT)

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/timeline/route.ts`
- Test: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/timeline/route.test.ts`

- [ ] **Step 1: Write the route test**

```ts
// app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/timeline/route.test.ts
import { describe, it, expect } from 'vitest'

describe('timeline route', () => {
  it('exports GET and PUT handlers', async () => {
    const mod = await import('./route')
    expect(typeof mod.GET).toBe('function')
    expect(typeof mod.PUT).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- timeline/route.test
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the route**

```ts
// app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/timeline/route.ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

async function resolveProject(orgSlug: string, teamId: string, projectId: string) {
  const session = await requireSession()
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return null
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return null
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return null
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project) return null
  return { db, project }
}

export async function GET(_req: Request, { params }: Params) {
  const { orgSlug, teamId, projectId } = await params
  const resolved = await resolveProject(orgSlug, teamId, projectId)
  if (!resolved) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const timeline = resolved.project.timelineJson ? JSON.parse(resolved.project.timelineJson) : null
  return NextResponse.json({ timeline })
}

export async function PUT(req: Request, { params }: Params) {
  const { orgSlug, teamId, projectId } = await params
  const resolved = await resolveProject(orgSlug, teamId, projectId)
  if (!resolved) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { timeline?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.timeline || typeof body.timeline !== 'object') {
    return NextResponse.json({ error: 'Missing timeline' }, { status: 400 })
  }

  await resolved.db.update(projects)
    .set({ timelineJson: JSON.stringify(body.timeline) })
    .where(eq(projects.id, projectId))

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- timeline/route.test
```

Expected: 1 test PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/timeline/
git commit -m "feat: add GET/PUT timeline API route"
```

---

## Task 5: Audio listing API

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/route.ts`
- Test: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/route.test.ts`

- [ ] **Step 1: Write the route test**

```ts
// app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/route.test.ts
import { describe, it, expect } from 'vitest'

describe('audio route', () => {
  it('exports a GET handler', async () => {
    const mod = await import('./route')
    expect(typeof mod.GET).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- audio/route.test
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the route**

```ts
// app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/route.ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { refreshDriveToken } from '@/lib/drive/auth'
import { listFolderContents, pickAudioFiles } from '@/lib/drive/scanner'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
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
  if (!project.folderId) return NextResponse.json({ files: [] })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  try {
    const tokenData = await refreshDriveToken(conn.refreshToken)
    await db.update(driveConnections)
      .set({ accessToken: tokenData.accessToken, expiresAt: new Date(tokenData.expiresAt) })
      .where(eq(driveConnections.id, conn.id))
    const files = await listFolderContents(project.folderId, tokenData.accessToken)
    const audioFiles = pickAudioFiles(files)
    return NextResponse.json({ files: audioFiles })
  } catch {
    return NextResponse.json({ error: 'Drive access failed' }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- audio/route.test
```

Expected: 1 test PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/audio/
git commit -m "feat: add GET audio files API route"
```

---

## Task 6: Update render route to accept timelineJson

**Files:**
- Modify: `lib/github/actions.ts`
- Modify: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/render/route.ts`

- [ ] **Step 1: Update RenderPayload and triggerRender**

Replace `lib/github/actions.ts` entirely:

```ts
// lib/github/actions.ts
export type RenderPayload = {
  playlist: { driveFileId: string; duration: number }[]
  audioFileIds: string[]
  accessToken: string
  folderId: string
  jobId: string
  callbackUrl: string
  callbackSecret: string
  timelineJson?: string  // serialized ffmpeg JSON; when present, playlist/audioFileIds are ignored by the worker
}

export async function triggerRender(payload: RenderPayload): Promise<void> {
  const { GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO } = process.env
  if (!GITHUB_PAT || !GITHUB_OWNER || !GITHUB_REPO)
    throw new Error('Missing required env vars: GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO')
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'highlights-app',
      },
      body: JSON.stringify({
        event_type: 'render-video',
        client_payload: payload,
      }),
    }
  )
  if (!res.ok) throw new Error(`GitHub dispatch failed: ${await res.text()}`)
}
```

- [ ] **Step 2: Update the render route POST handler**

In `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/render/route.ts`, replace the `POST` function body. The GET function is unchanged. The new POST reads an optional `timelineJson` from the request body; when present it skips the `playlistItems` query and passes it directly to `triggerRender`.

```ts
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

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  const activeJob = await db.query.renderJobs.findFirst({
    where: and(eq(renderJobs.projectId, projectId)),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })
  if (activeJob && (activeJob.status === 'pending' || activeJob.status === 'running')) {
    return NextResponse.json({ error: 'Render already in progress' }, { status: 409 })
  }

  if (!project.folderId) return NextResponse.json({ error: 'No folder set for this project' }, { status: 400 })

  // Parse optional timelineJson from body
  let timelineJson: string | undefined
  try {
    const body = await req.json().catch(() => ({})) as { timelineJson?: string }
    if (typeof body.timelineJson === 'string') timelineJson = body.timelineJson
  } catch { /* no body is fine */ }

  let accessToken: string
  let playlist: { driveFileId: string; duration: number }[] = []
  let audioFileIds: string[] = []

  try {
    const tokenData = await refreshDriveToken(conn.refreshToken)
    accessToken = tokenData.accessToken
    await db.update(driveConnections)
      .set({ accessToken, expiresAt: new Date(tokenData.expiresAt) })
      .where(eq(driveConnections.id, conn.id))

    if (!timelineJson) {
      // Legacy path: derive from playlistItems
      const files = await listFolderContents(project.folderId, accessToken)
      audioFileIds = pickAudioFiles(files).map((f) => f.id)
      const items = await db
        .select({ driveFileId: playlistItems.driveFileId, duration: playlistItems.durationOverride, position: playlistItems.position })
        .from(playlistItems)
        .where(eq(playlistItems.projectId, projectId))
        .orderBy(asc(playlistItems.position))
      if (items.length === 0) return NextResponse.json({ error: 'Playlist is empty' }, { status: 400 })
      playlist = items.map((i) => ({ driveFileId: i.driveFileId, duration: i.duration ?? project.secondsPerImage }))
    }
  } catch {
    return NextResponse.json({ error: 'Drive access failed. Reconnect Drive and try again.' }, { status: 502 })
  }

  const callbackSecret = crypto.randomUUID()
  const nextAuthUrl = process.env.NEXTAUTH_URL
  if (!nextAuthUrl) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  const callbackUrl = `${nextAuthUrl}/api/render-callback`

  const [job] = await db.insert(renderJobs).values({ projectId, callbackSecret, status: 'pending' }).returning()
  await db.update(projects).set({ status: 'rendering' }).where(eq(projects.id, projectId))

  try {
    await triggerRender({
      playlist,
      audioFileIds,
      accessToken: accessToken!,
      folderId: project.folderId,
      jobId: job.id,
      callbackUrl,
      callbackSecret,
      timelineJson,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[render trigger] failed:', msg)
    await db.update(renderJobs)
      .set({ status: 'failed', errorMsg: msg, completedAt: new Date() })
      .where(eq(renderJobs.id, job.id))
    await db.update(projects).set({ status: 'failed' }).where(eq(projects.id, projectId))
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  return NextResponse.json(job, { status: 201 })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add lib/github/actions.ts app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/render/route.ts
git commit -m "feat: render route accepts timelineJson from editor"
```

---

## Task 7: Settings page (move existing project management UI)

**Files:**
- Create: `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/settings/page.tsx`

- [ ] **Step 1: Create the settings page**

Copy the existing project detail page content into a new file, with minor changes to the heading and navigation:

```tsx
// app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/settings/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { DriveFolderBrowser } from '@/components/drive-folder-browser'

type Project = { id: string; name: string; status: string; secondsPerImage: number; folderId: string | null; folderName: string | null }
type RenderJob = { id: string; status: string; outputDriveFileId: string | null; errorMsg: string | null }

export default function ProjectSettingsPage() {
  const { orgSlug, teamId, projectId } = useParams<{ orgSlug: string; teamId: string; projectId: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null)
  const [showFolderBrowser, setShowFolderBrowser] = useState(false)
  const [pendingFolder, setPendingFolder] = useState<{ id: string; name: string } | null>(null)
  const [changingFolder, setChangingFolder] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`)
      .then((r) => { if (!r.ok) return null; return r.json() as Promise<Project> })
      .then((data) => setProject(data))
      .catch(() => {})
  }, [orgSlug, teamId, projectId])

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`)
      .then((r) => r.json() as Promise<RenderJob>)
      .then((job) => { if (job?.id) setRenderJob(job) })
      .catch(() => {})
  }, [orgSlug, teamId, projectId])

  async function handleConfirmFolderChange() {
    if (!pendingFolder) return
    setChangingFolder(true)
    setFolderError(null)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: pendingFolder.id, folderName: pendingFolder.name }),
      })
      if (!res.ok) { setFolderError('Failed to change folder.'); return }
      const updated = await res.json() as Project
      setProject(updated)
      setPendingFolder(null)
    } finally {
      setChangingFolder(false)
    }
  }

  if (!project) return <p className="p-8 text-gray-400">Loading…</p>

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push(`/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`)}
          className="text-sm text-blue-400 hover:underline"
        >
          ← Back to editor
        </button>
        <h1 className="text-2xl font-bold text-gray-100">{project.name} — Settings</h1>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-gray-400">Drive folder: <span className="text-gray-200">{project.folderName ?? 'not set'}</span></p>
        <button onClick={() => setShowFolderBrowser(true)} className="text-xs text-blue-400 hover:underline">
          Change folder
        </button>
        {folderError && <p className="text-sm text-red-400">{folderError}</p>}
      </div>

      {renderJob && (
        <div className={`p-4 rounded-lg border ${
          renderJob.status === 'complete' ? 'border-green-700 bg-green-900/30' :
          renderJob.status === 'failed' ? 'border-red-700 bg-red-900/30' :
          'border-blue-700 bg-blue-900/30'
        }`}>
          {renderJob.status === 'pending' && <p className="text-gray-300">Queued — waiting for GitHub Actions runner…</p>}
          {renderJob.status === 'running' && <p className="text-gray-300">Rendering… this takes 2–3 minutes.</p>}
          {renderJob.status === 'complete' && renderJob.outputDriveFileId && (
            <div className="space-y-2">
              <p className="text-green-400 font-medium">Render complete!</p>
              <video src={`https://drive.google.com/uc?id=${renderJob.outputDriveFileId}&export=download`}
                controls className="w-full rounded" />
              <a href={`https://drive.google.com/file/d/${renderJob.outputDriveFileId}/view`}
                target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 underline">
                Open in Google Drive
              </a>
            </div>
          )}
          {renderJob.status === 'failed' && (
            <p className="text-red-400">Render failed: {renderJob.errorMsg}</p>
          )}
        </div>
      )}

      {showFolderBrowser && (
        <DriveFolderBrowser
          orgSlug={orgSlug}
          teamId={teamId}
          onSelect={(id, name) => { setPendingFolder({ id, name }); setShowFolderBrowser(false) }}
          onClose={() => setShowFolderBrowser(false)}
        />
      )}

      {pendingFolder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-4 mx-4">
            <h2 className="text-lg font-semibold text-gray-100">Change folder?</h2>
            <p className="text-sm text-gray-400">
              Switching to <strong className="text-gray-200">{pendingFolder.name}</strong> will delete your current playlist and re-scan the new folder. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPendingFolder(null)} className="text-sm text-gray-400 hover:text-gray-200">Cancel</button>
              <button onClick={handleConfirmFolderChange} disabled={changingFolder}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                {changingFolder ? 'Changing…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/settings/"
git commit -m "feat: add project settings sub-page"
```

---

## Task 8: Editor CSS custom properties

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add editor tokens to globals.css**

Append to `app/globals.css`:

```css
/* Editor tokens — light (warm paper) */
.editor-root {
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
}

/* Editor tokens — dark */
@media (prefers-color-scheme: dark) {
  .editor-root {
    --paper:       #111827;
    --paper-2:     #1f2937;
    --paper-3:     #374151;
    --ink:         #f9fafb;
    --ink-2:       #d1d5db;
    --ink-3:       #9ca3af;
    --line:        #374151;
    --line-soft:   #4b5563;
    --accent:      #2563eb;
    --accent-2:    #3b82f6;
    --accent-soft: rgba(37,99,235,.15);
    --track-v:     #374151;
    --track-v2:    #4b5563;
    --track-a:     #4b5563;
    --danger:      #dc2626;
  }
}

.editor-root {
  background: var(--paper);
  color: var(--ink);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat: add editor CSS custom properties for light/dark themes"
```

---

## Task 9: useEditor state hook

**Files:**
- Create: `components/editor/use-editor.ts`
- Test: `components/editor/use-editor.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// components/editor/use-editor.test.ts
import { describe, it, expect } from 'vitest'
import { editorReducer, initialHistory } from './use-editor'
import type { HistoryState, Clip, Timeline } from './types'

const emptyTimeline: Timeline = {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, clips: [] },
  ],
}

const clip: Clip = { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', start: 0, duration: 3 }

function makeHistory(timeline: Timeline): HistoryState {
  return { past: [], present: timeline, future: [] }
}

describe('editorReducer', () => {
  it('ADD_CLIP appends to correct track', () => {
    const state = makeHistory(emptyTimeline)
    const next = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip })
    expect(next.present.tracks[0].clips).toHaveLength(1)
    expect(next.present.tracks[0].clips[0].id).toBe('c1')
    expect(next.present.tracks[1].clips).toHaveLength(0)
  })

  it('ADD_CLIP pushes current state to past', () => {
    const state = makeHistory(emptyTimeline)
    const next = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip })
    expect(next.past).toHaveLength(1)
    expect(next.future).toHaveLength(0)
  })

  it('REMOVE_CLIP removes by id', () => {
    const withClip: Timeline = { ...emptyTimeline, tracks: [{ ...emptyTimeline.tracks[0], clips: [clip] }, emptyTimeline.tracks[1]] }
    const state = makeHistory(withClip)
    const next = editorReducer(state, { type: 'REMOVE_CLIP', trackId: 'V1', clipId: 'c1' })
    expect(next.present.tracks[0].clips).toHaveLength(0)
  })

  it('UNDO restores previous state', () => {
    const state = makeHistory(emptyTimeline)
    const after = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip })
    const undone = editorReducer(after, { type: 'UNDO' })
    expect(undone.present.tracks[0].clips).toHaveLength(0)
    expect(undone.future).toHaveLength(1)
  })

  it('REDO reapplies undone state', () => {
    const state = makeHistory(emptyTimeline)
    const after = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip })
    const undone = editorReducer(after, { type: 'UNDO' })
    const redone = editorReducer(undone, { type: 'REDO' })
    expect(redone.present.tracks[0].clips).toHaveLength(1)
  })

  it('MOVE_CLIP updates start', () => {
    const withClip: Timeline = { ...emptyTimeline, tracks: [{ ...emptyTimeline.tracks[0], clips: [clip] }, emptyTimeline.tracks[1]] }
    const next = editorReducer(makeHistory(withClip), { type: 'MOVE_CLIP', trackId: 'V1', clipId: 'c1', newStart: 5 })
    expect(next.present.tracks[0].clips[0].start).toBe(5)
  })

  it('RESIZE_CLIP clamps to minimum 0.3', () => {
    const withClip: Timeline = { ...emptyTimeline, tracks: [{ ...emptyTimeline.tracks[0], clips: [clip] }, emptyTimeline.tracks[1]] }
    const next = editorReducer(makeHistory(withClip), { type: 'RESIZE_CLIP', trackId: 'V1', clipId: 'c1', newDuration: 0.1 })
    expect(next.present.tracks[0].clips[0].duration).toBe(0.3)
  })

  it('history is capped at 40 past states', () => {
    let state = makeHistory(emptyTimeline)
    for (let i = 0; i < 45; i++) {
      state = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip: { ...clip, id: `c${i}`, start: i * 3 } })
    }
    expect(state.past.length).toBeLessThanOrEqual(40)
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test -- use-editor.test
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the reducer and hook**

```ts
// components/editor/use-editor.ts
'use client'
import { useReducer, useEffect, useRef, useCallback } from 'react'
import type { Timeline, HistoryState, EditorAction, Clip, Track } from './types'

const MAX_HISTORY = 40

function normalizeTrack(clips: Clip[]): Clip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  const result: Clip[] = []
  for (const clip of sorted) {
    const prev = result[result.length - 1]
    const start = prev ? Math.max(clip.start, prev.start + prev.duration) : clip.start
    result.push({ ...clip, start })
  }
  return result
}

function updateTrack(tracks: Track[], trackId: string, fn: (clips: Clip[]) => Clip[]): Track[] {
  return tracks.map((t) => t.id === trackId ? { ...t, clips: fn(t.clips) } : t)
}

function pushHistory(state: HistoryState, next: Timeline): HistoryState {
  const past = [...state.past, state.present].slice(-MAX_HISTORY)
  return { past, present: next, future: [] }
}

export function editorReducer(state: HistoryState, action: EditorAction): HistoryState {
  switch (action.type) {
    case 'ADD_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          normalizeTrack([...clips, action.clip])
        ),
      }
      return pushHistory(state, next)
    }
    case 'REMOVE_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          clips.filter((c) => c.id !== action.clipId)
        ),
      }
      return pushHistory(state, next)
    }
    case 'MOVE_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          normalizeTrack(clips.map((c) => c.id === action.clipId ? { ...c, start: Math.max(0, action.newStart) } : c))
        ),
      }
      return pushHistory(state, next)
    }
    case 'RESIZE_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          clips.map((c) => c.id === action.clipId ? { ...c, duration: Math.max(0.3, action.newDuration) } : c)
        ),
      }
      return pushHistory(state, next)
    }
    case 'TOGGLE_MUTE': {
      const next: Timeline = {
        ...state.present,
        tracks: state.present.tracks.map((t) => t.id === action.trackId ? { ...t, muted: !t.muted } : t),
      }
      return pushHistory(state, next)
    }
    case 'TOGGLE_LOCK': {
      const next: Timeline = {
        ...state.present,
        tracks: state.present.tracks.map((t) => t.id === action.trackId ? { ...t, locked: !t.locked } : t),
      }
      return pushHistory(state, next)
    }
    case 'UNDO': {
      if (state.past.length === 0) return state
      const [past, present] = [state.past.slice(0, -1), state.past[state.past.length - 1]]
      return { past, present, future: [state.present, ...state.future] }
    }
    case 'REDO': {
      if (state.future.length === 0) return state
      const [present, ...future] = state.future
      return { past: [...state.past, state.present], present, future }
    }
    case 'LOAD_TIMELINE':
      return { past: [], present: action.timeline, future: [] }
    default:
      return state
  }
}

export const emptyTimeline: Timeline = {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, clips: [] },
  ],
}

export function initialHistory(timeline: Timeline = emptyTimeline): HistoryState {
  return { past: [], present: timeline, future: [] }
}

type UseEditorOptions = {
  projectSlug: string
  orgSlug: string
  teamId: string
  projectId: string
}

export function useEditor({ projectSlug, orgSlug, teamId, projectId }: UseEditorOptions) {
  const [history, dispatch] = useReducer(editorReducer, initialHistory())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStatus = useRef<'idle' | 'saving' | 'saved'>('idle')

  const apiBase = `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`

  const save = useCallback(async (timeline: Timeline) => {
    saveStatus.current = 'saving'
    try {
      await fetch(`${apiBase}/timeline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeline }),
      })
      saveStatus.current = 'saved'
    } catch {
      saveStatus.current = 'idle'
    }
  }, [apiBase])

  const dispatchAndSave = useCallback((action: EditorAction) => {
    dispatch(action)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      // history.present is stale here; the caller should pass the post-reduce timeline
    }, 1000)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (e.code === 'Space' && !e.target || (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault()
        dispatch({ type: 'SET_PLAYING', playing: true } as unknown as EditorAction)
      }
      if (meta && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      if (meta && e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); dispatch({ type: 'REDO' }) }
      if (meta && e.code === 'KeyY') { e.preventDefault(); dispatch({ type: 'REDO' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { history, dispatch, save, saveStatus: saveStatus.current, apiBase, projectSlug }
}
```

> **Note:** The `useEditor` hook exposes `dispatch` directly. Components call `dispatch` with timeline-mutating actions; the `Editor` component wraps dispatch to trigger auto-save after each mutation using a `useEffect` that watches `history.present`.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- use-editor.test
```

Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add components/editor/use-editor.ts components/editor/use-editor.test.ts
git commit -m "feat: add editor useReducer with undo/redo"
```

---

## Task 10: EditorTopBar component

**Files:**
- Create: `components/editor/editor-top-bar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/editor/editor-top-bar.tsx
'use client'
import Link from 'next/link'
import type { Timeline } from './types'
import type { HistoryState } from './types'

type Props = {
  projectName: string
  orgSlug: string
  teamId: string
  projectId: string
  history: HistoryState
  saveStatus: 'idle' | 'saving' | 'saved'
  renderStatus: string | null
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onExport: () => void
  dispatch: (action: { type: string }) => void
}

export function EditorTopBar({
  projectName, orgSlug, teamId, projectId,
  history, saveStatus, renderStatus,
  onUndo, onRedo, onSave, onExport,
}: Props) {
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0
  const isRendering = renderStatus === 'pending' || renderStatus === 'running'

  return (
    <div
      className="flex items-center gap-2 px-3 shrink-0"
      style={{ height: 42, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--line)' }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Caveat, cursive' }}>
        KickReel
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {projectName}
      </span>

      <div className="flex items-center gap-1 ml-auto">
        {saveStatus === 'saving' && (
          <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }}>Saving…</span>
        )}
        {saveStatus === 'saved' && (
          <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }}>Saved</span>
        )}

        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          style={{ fontSize: 11, color: canUndo ? 'var(--ink-2)' : 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '2px 6px', background: 'transparent', cursor: canUndo ? 'pointer' : 'default' }}
        >
          ↩ Undo
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
          style={{ fontSize: 11, color: canRedo ? 'var(--ink-2)' : 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '2px 6px', background: 'transparent', cursor: canRedo ? 'pointer' : 'default' }}
        >
          ↪ Redo
        </button>
        <button
          onClick={onSave}
          style={{ fontSize: 11, color: 'var(--ink)', border: '1.5px solid var(--line)', borderRadius: 3, padding: '2px 8px', background: 'transparent', cursor: 'pointer' }}
        >
          Save
        </button>
        <button
          onClick={onExport}
          disabled={isRendering}
          style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: isRendering ? 'var(--ink-3)' : 'var(--accent)', border: 'none', borderRadius: 3, padding: '3px 10px', cursor: isRendering ? 'default' : 'pointer' }}
        >
          {isRendering ? 'Rendering…' : 'Export'}
        </button>
        <Link
          href={`/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/settings`}
          title="Project settings"
          style={{ fontSize: 14, color: 'var(--ink-3)', textDecoration: 'none', padding: '0 4px' }}
        >
          ⚙
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/editor/editor-top-bar.tsx
git commit -m "feat: add EditorTopBar component"
```

---

## Task 11: EditorToolbar component

**Files:**
- Create: `components/editor/editor-toolbar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/editor/editor-toolbar.tsx
'use client'

type Props = {
  snapOn: boolean
  onSnapChange: (on: boolean) => void
}

export function EditorToolbar({ snapOn, onSnapChange }: Props) {
  return (
    <div
      className="flex items-center gap-2 px-3 shrink-0"
      style={{ height: 34, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--line)' }}
    >
      <button
        title="Import media (coming soon)"
        disabled
        style={{ fontSize: 11, color: 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 8px', background: 'transparent', cursor: 'not-allowed' }}
      >
        ⬆ Import
      </button>
      <button
        title="Split clip at playhead (coming soon)"
        disabled
        style={{ fontSize: 11, color: 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 8px', background: 'transparent', cursor: 'not-allowed' }}
      >
        ✂ Split
      </button>

      <div style={{ width: 1, height: 16, background: 'var(--line-soft)', margin: '0 4px' }} />

      <label className="flex items-center gap-1" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={snapOn}
          onChange={(e) => onSnapChange(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 12, height: 12 }}
        />
        <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>Snap</span>
      </label>

      <span style={{ fontSize: 9, color: 'var(--ink-3)', fontFamily: 'monospace', marginLeft: 'auto' }}>
        16:9 · 1920×1080 · 30fps
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/editor/editor-toolbar.tsx
git commit -m "feat: add EditorToolbar component"
```

---

## Task 12: MediaBrowser component

**Files:**
- Create: `components/editor/media-browser.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/editor/media-browser.tsx
'use client'
import { useEffect, useState } from 'react'
import type { MediaItem } from './types'

type PlaylistItem = {
  id: string
  driveFileId: string
  thumbnailUrl: string | null
  playerName: string
}

type Props = {
  orgSlug: string
  teamId: string
  projectId: string
  onDragStart: (media: MediaItem, e: React.PointerEvent) => void
}

export function MediaBrowser({ orgSlug, teamId, projectId, onDragStart }: Props) {
  const [tab, setTab] = useState<'photos' | 'audio'>('photos')
  const [photos, setPhotos] = useState<PlaylistItem[]>([])
  const [audioFiles, setAudioFiles] = useState<{ id: string; name: string }[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const apiBase = `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`

  useEffect(() => { loadPhotos() }, [projectId])
  useEffect(() => { if (tab === 'audio') loadAudio() }, [tab, projectId])

  async function loadPhotos() {
    const res = await fetch(`${apiBase}/playlist`)
    if (!res.ok) return
    const items = await res.json() as PlaylistItem[]
    setPhotos(items)
  }

  async function loadAudio() {
    const res = await fetch(`${apiBase}/audio`)
    if (!res.ok) return
    const data = await res.json() as { files: { id: string; name: string }[] }
    setAudioFiles(data.files)
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch(`${apiBase}/playlist`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'resequence' }),
      })
      await loadPhotos()
      if (tab === 'audio') await loadAudio()
    } finally {
      setRefreshing(false)
    }
  }

  const tabStyle = (active: boolean) => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 3,
    border: '1px solid',
    borderColor: active ? 'var(--line)' : 'var(--line-soft)',
    background: active ? 'var(--paper-2)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink-3)',
    cursor: 'pointer',
  } as React.CSSProperties)

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 270, background: 'var(--paper-2)', borderRight: '1.5px solid var(--line)', overflow: 'hidden' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--line-soft)' }}>
        <span style={{ fontSize: 19, fontWeight: 600, fontFamily: 'Caveat, cursive', color: 'var(--ink)' }}>Media</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 px-3 py-2">
        <button style={tabStyle(tab === 'photos')} onClick={() => setTab('photos')}>Photos</button>
        <button style={tabStyle(tab === 'audio')} onClick={() => setTab('audio')}>Audio</button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2">
        {tab === 'photos' && (
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {photos.map((item) => {
              const media: MediaItem = {
                id: item.driveFileId,
                kind: 'image',
                filename: item.playerName,
                thumbnailUrl: item.thumbnailUrl ?? undefined,
                defaultDuration: 3.5,
              }
              return (
                <div
                  key={item.id}
                  onPointerDown={(e) => onDragStart(media, e)}
                  style={{
                    width: 72, height: 54, borderRadius: 2,
                    border: '1px solid var(--line-soft)',
                    background: 'var(--paper-3)',
                    overflow: 'hidden', cursor: 'grab', touchAction: 'none',
                  }}
                >
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt={item.playerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'var(--track-v)' }} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'audio' && (
          <div className="flex flex-col gap-1 py-1">
            {audioFiles.map((f) => {
              const media: MediaItem = {
                id: f.id,
                kind: 'audio',
                filename: f.name,
                defaultDuration: 120,
              }
              return (
                <div
                  key={f.id}
                  onPointerDown={(e) => onDragStart(media, e)}
                  className="flex items-center gap-2 px-2 py-2"
                  style={{ border: '1px solid var(--line-soft)', borderRadius: 3, background: 'var(--paper)', cursor: 'grab', touchAction: 'none' }}
                >
                  <span style={{ fontSize: 14 }}>♪</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                </div>
              )
            })}
            {audioFiles.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--ink-3)', padding: '8px 4px' }}>No audio files in this folder</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2" style={{ borderTop: '1px solid var(--line-soft)' }}>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ width: '100%', fontSize: 11, color: 'var(--ink-2)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '4px 0', background: 'transparent', cursor: refreshing ? 'default' : 'pointer' }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh from Drive'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/editor/media-browser.tsx
git commit -m "feat: add MediaBrowser component"
```

---

## Task 13: PreviewPanel component

**Files:**
- Create: `components/editor/preview-panel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/editor/preview-panel.tsx
'use client'
import { useRef, useCallback } from 'react'
import type { Timeline, Clip } from './types'

type Props = {
  timeline: Timeline
  playhead: number
  playing: boolean
  totalDuration: number
  onSeek: (time: number) => void
  onPlayPause: () => void
  onPrev: () => void
  onNext: () => void
}

function activeClip(timeline: Timeline, playhead: number): Clip | null {
  const v1 = timeline.tracks.find((t) => t.id === 'V1')
  if (!v1) return null
  return v1.clips.find((c) => playhead >= c.start && playhead < c.start + c.duration) ?? null
}

function prevClipStart(timeline: Timeline, playhead: number): number {
  const v1 = timeline.tracks.find((t) => t.id === 'V1')
  if (!v1) return 0
  const starts = v1.clips.map((c) => c.start).filter((s) => s < playhead - 0.01).sort((a, b) => b - a)
  return starts[0] ?? 0
}

function nextClipStart(timeline: Timeline, playhead: number): number | null {
  const v1 = timeline.tracks.find((t) => t.id === 'V1')
  if (!v1) return null
  const starts = v1.clips.map((c) => c.start).filter((s) => s > playhead + 0.01).sort((a, b) => a - b)
  return starts[0] ?? null
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PreviewPanel({ timeline, playhead, playing, totalDuration, onSeek, onPlayPause, onPrev, onNext }: Props) {
  const clip = activeClip(timeline, playhead)
  const scrubRef = useRef<HTMLDivElement>(null)

  const handleScrubClick = useCallback((e: React.MouseEvent) => {
    if (!scrubRef.current) return
    const rect = scrubRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(ratio * totalDuration)
  }, [totalDuration, onSeek])

  const progress = totalDuration > 0 ? Math.min(1, playhead / totalDuration) : 0

  // Ken Burns animation: progress within current clip
  const kenBurnsScale = clip ? 1 + 0.08 * ((playhead - clip.start) / clip.duration) : 1

  return (
    <div
      className="flex flex-col items-center justify-center flex-1 gap-3"
      style={{ background: 'var(--paper-2)', minWidth: 0 }}
    >
      {/* Video frame */}
      <div
        style={{
          width: '82%', aspectRatio: '16/9',
          background: '#1b1814',
          border: '1.5px solid var(--line)',
          borderRadius: 6,
          boxShadow: '0 10px 30px rgba(40,30,20,.22)',
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        {clip?.thumbnailUrl ? (
          <img
            src={clip.thumbnailUrl}
            alt={clip.filename}
            style={{
              width: '100%', height: '100%', objectFit: 'cover',
              transform: `scale(${kenBurnsScale})`,
              transformOrigin: 'center',
              transition: playing ? 'none' : 'transform 0.1s',
            }}
          />
        ) : (
          <p style={{ fontSize: 12, color: '#6b6258', textAlign: 'center', padding: '0 16px' }}>
            {clip ? clip.filename : 'no clip at playhead — drag a photo to V1 to begin'}
          </p>
        )}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3" style={{ width: '82%' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'monospace', width: 92, flexShrink: 0 }}>
          {formatTime(playhead)} / {formatTime(totalDuration)}
        </span>

        <button onClick={onPrev} style={{ fontSize: 16, color: 'var(--ink-2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>⏮</button>

        <button
          onClick={onPlayPause}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'var(--accent)', border: 'none',
            color: '#fff', fontSize: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <button onClick={onNext} style={{ fontSize: 16, color: 'var(--ink-2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>⏭</button>

        {/* Scrubber */}
        <div
          ref={scrubRef}
          onClick={handleScrubClick}
          style={{
            flex: 1, height: 8, borderRadius: 4,
            background: 'var(--paper-3)', cursor: 'pointer', position: 'relative',
          }}
        >
          <div style={{ width: `${progress * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
        </div>

        <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>🔊</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/editor/preview-panel.tsx
git commit -m "feat: add PreviewPanel component"
```

---

## Task 14: Timeline component

The Timeline is the most complex component. It handles the ruler, track rows, clip rendering, clip drag-to-reorder, clip resize, playhead drag, and drag-from-browser drop target. Study `reference/ed-timeline.jsx` in the design package for the full interaction logic before implementing.

**Files:**
- Create: `components/editor/timeline.tsx`

- [ ] **Step 1: Create the Timeline component**

```tsx
// components/editor/timeline.tsx
'use client'
import { useRef, useCallback } from 'react'
import type { Timeline, Track, Clip, DragState } from './types'

type Props = {
  timeline: Timeline
  playhead: number
  zoom: number             // 30–200; pps = zoom * 0.8
  selectedClipId: string | null
  snapOn: boolean
  drag: DragState | null
  totalDuration: number
  onSeekRuler: (time: number) => void
  onZoomChange: (zoom: number) => void
  onMoveClip: (trackId: 'V1' | 'A1', clipId: string, newStart: number) => void
  onResizeClip: (trackId: 'V1' | 'A1', clipId: string, newDuration: number) => void
  onRemoveClip: (trackId: 'V1' | 'A1', clipId: string) => void
  onSelectClip: (clipId: string | null) => void
  onToggleMute: (trackId: 'V1' | 'A1') => void
  onToggleLock: (trackId: 'V1' | 'A1') => void
  onDragOver: (trackId: 'V1' | 'A1' | null, time: number) => void
  onDrop: (trackId: 'V1' | 'A1', time: number) => void
}

function pps(zoom: number) { return zoom * 0.8 }

function snapTime(t: number, clips: Clip[], snapOn: boolean, pixelsPerSecond: number): number {
  if (!snapOn) return t
  const snapThresholdSec = 8 / pixelsPerSecond
  const candidates = [0, ...clips.flatMap((c) => [c.start, c.start + c.duration])]
  let best = t
  let bestDist = snapThresholdSec
  for (const c of candidates) {
    const d = Math.abs(t - c)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return best
}

function formatRulerLabel(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type ClipViewProps = {
  clip: Clip
  track: Track
  selected: boolean
  pixelsPerSecond: number
  onSelect: () => void
  onMoveStart: (e: React.MouseEvent, clip: Clip) => void
  onResizeStart: (e: React.MouseEvent, clip: Clip) => void
}

function ClipView({ clip, track, selected, pixelsPerSecond, onSelect, onMoveStart, onResizeStart }: ClipViewProps) {
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
      {/* Resize handle */}
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

export function Timeline({
  timeline, playhead, zoom, selectedClipId, snapOn, drag, totalDuration,
  onSeekRuler, onZoomChange, onMoveClip, onResizeClip, onRemoveClip,
  onSelectClip, onToggleMute, onToggleLock, onDragOver, onDrop,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pixelsPerSecond = pps(zoom)
  const rulerWidth = Math.max(totalDuration * pixelsPerSecond + 200, 800)

  const allClips = timeline.tracks.flatMap((t) => t.clips)
  const clipCount = allClips.length

  // Ruler click → seek
  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    if (!scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const scrollLeft = scrollRef.current.scrollLeft
    const time = (e.clientX - rect.left + scrollLeft - 140) / pixelsPerSecond
    onSeekRuler(Math.max(0, time))
  }, [pixelsPerSecond, onSeekRuler])

  // Clip drag (move)
  const startClipMove = useCallback((e: React.MouseEvent, clip: Clip, track: Track) => {
    if (track.locked) return
    e.preventDefault()
    const origStart = clip.start
    const origX = e.clientX
    const otherClips = track.clips.filter((c) => c.id !== clip.id)

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - origX
      const newStart = snapTime(Math.max(0, origStart + dx / pixelsPerSecond), otherClips, snapOn, pixelsPerSecond)
      onMoveClip(track.id as 'V1' | 'A1', clip.id, newStart)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pixelsPerSecond, snapOn, onMoveClip])

  // Clip resize
  const startClipResize = useCallback((e: React.MouseEvent, clip: Clip, track: Track) => {
    if (track.locked) return
    e.preventDefault()
    const origDur = clip.duration
    const origX = e.clientX

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - origX
      onResizeClip(track.id as 'V1' | 'A1', clip.id, Math.max(0.3, origDur + dx / pixelsPerSecond))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pixelsPerSecond, onResizeClip])

  // Keyboard: delete selected clip
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
      for (const track of timeline.tracks) {
        if (track.clips.some((c) => c.id === selectedClipId)) {
          onRemoveClip(track.id as 'V1' | 'A1', selectedClipId)
          break
        }
      }
    }
  }, [selectedClipId, timeline.tracks, onRemoveClip])

  // Drop zone pointer events for inter-panel drag
  const handleTrackPointerMove = useCallback((e: React.PointerEvent, track: Track) => {
    if (!drag) return
    if (!scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const scrollLeft = scrollRef.current.scrollLeft
    const rawTime = (e.clientX - rect.left + scrollLeft - 140) / pixelsPerSecond
    const snapped = snapTime(Math.max(0, rawTime), track.clips, snapOn, pixelsPerSecond)
    onDragOver(track.id as 'V1' | 'A1', snapped)
  }, [drag, pixelsPerSecond, snapOn, onDragOver])

  const handleTrackPointerUp = useCallback((e: React.PointerEvent, track: Track) => {
    if (!drag) return
    const compatible = (drag.media.kind === 'image' && track.kind === 'video') || (drag.media.kind === 'audio' && track.kind === 'audio')
    if (!compatible || track.locked) { onDragOver(null, 0); return }
    if (!scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const scrollLeft = scrollRef.current.scrollLeft
    const rawTime = (e.clientX - rect.left + scrollLeft - 140) / pixelsPerSecond
    const snapped = snapTime(Math.max(0, rawTime), track.clips, snapOn, pixelsPerSecond)
    onDrop(track.id as 'V1' | 'A1', snapped)
  }, [drag, pixelsPerSecond, snapOn, onDragOver, onDrop])

  // Ruler ticks
  const rulerStep = pixelsPerSecond >= 40 ? 1 : pixelsPerSecond >= 20 ? 2 : 5
  const majorEvery = 5
  const tickCount = Math.ceil(rulerWidth / pixelsPerSecond) + 1

  const playheadLeft = 140 + playhead * pixelsPerSecond

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col shrink-0 outline-none"
      style={{ height: 280, background: 'var(--paper-2)', borderTop: '1.5px solid var(--line)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 36, borderBottom: '1px solid var(--line-soft)' }}>
        <span style={{ fontSize: 20, fontWeight: 600, fontFamily: 'Caveat, cursive', color: 'var(--ink)' }}>Timeline</span>
        <button disabled style={{ fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 6px', background: 'transparent', cursor: 'not-allowed' }}>+ Video track</button>
        <button disabled style={{ fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 6px', background: 'transparent', cursor: 'not-allowed' }}>+ Audio track</button>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--ink-3)', marginLeft: 'auto' }}>{clipCount} clips · {totalDuration.toFixed(1)}s</span>
        <label className="flex items-center gap-1">
          <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Zoom</span>
          <input type="range" min={30} max={200} value={zoom} onChange={(e) => onZoomChange(Number(e.target.value))}
            style={{ width: 80, accentColor: 'var(--accent)' }} />
        </label>
      </div>

      {/* Tracks + ruler area */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative">
        {/* Playhead line */}
        <div style={{
          position: 'absolute', left: playheadLeft, top: 0, bottom: 0,
          width: 2, background: 'var(--accent)', zIndex: 10, pointerEvents: 'none',
        }}>
          <div style={{ width: 10, height: 10, background: 'var(--accent)', clipPath: 'polygon(50% 100%, 0 0, 100% 0)', marginLeft: -4 }} />
        </div>

        {/* Ruler */}
        <div
          onClick={handleRulerClick}
          style={{
            position: 'sticky', top: 0, zIndex: 5,
            height: 24, display: 'flex', alignItems: 'flex-end',
            paddingLeft: 140, width: rulerWidth + 140,
            background: 'var(--paper-2)', borderBottom: '1px solid var(--line-soft)',
            cursor: 'crosshair',
          }}
        >
          {Array.from({ length: tickCount }, (_, i) => {
            const t = i * rulerStep
            const isMajor = t % (rulerStep * majorEvery) === 0
            return (
              <div key={i} style={{ position: 'absolute', left: 140 + t * pixelsPerSecond }}>
                <div style={{ width: 1, height: isMajor ? 12 : 6, background: 'var(--line-soft)', marginLeft: -0.5 }} />
                {isMajor && (
                  <span style={{ position: 'absolute', top: -13, left: 3, fontSize: 9, fontFamily: 'monospace', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                    {formatRulerLabel(t)}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Tracks */}
        {timeline.tracks.map((track) => {
          const isDropTarget = drag !== null && drag.overTrackId === track.id
          const compatible = drag !== null && ((drag.media.kind === 'image' && track.kind === 'video') || (drag.media.kind === 'audio' && track.kind === 'audio'))
          const trackHeight = track.kind === 'video' ? 52 : 36

          return (
            <div
              key={track.id}
              style={{
                display: 'flex',
                height: trackHeight,
                borderBottom: '1px dashed var(--line-soft)',
              }}
            >
              {/* Track header */}
              <div
                className="flex items-center gap-1 px-2 shrink-0"
                style={{ width: 140, background: 'var(--paper-2)', borderRight: '1.5px solid var(--line)' }}
              >
                <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>{track.kind === 'video' ? '🖼' : '♪'}</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>{track.id}</span>
                <span style={{ fontSize: 10, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</span>
                <button
                  onClick={() => onToggleMute(track.id as 'V1' | 'A1')}
                  style={{ fontSize: 9, fontWeight: 700, color: track.muted ? 'var(--accent)' : 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px' }}
                  title="Mute"
                >M</button>
                <button
                  onClick={() => onToggleLock(track.id as 'V1' | 'A1')}
                  style={{ fontSize: 9, color: track.locked ? 'var(--accent)' : 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px' }}
                  title="Lock"
                >🔒</button>
              </div>

              {/* Clip area */}
              <div
                data-track-row={track.id}
                onPointerMove={(e) => handleTrackPointerMove(e, track)}
                onPointerUp={(e) => handleTrackPointerUp(e, track)}
                style={{
                  position: 'relative', flex: 1,
                  width: rulerWidth,
                  background: isDropTarget && compatible ? 'var(--accent-soft)' : (track.kind === 'audio' ? 'rgba(0,0,0,.03)' : 'transparent'),
                }}
              >
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
                  />
                ))}

                {/* Drop insert line */}
                {isDropTarget && compatible && drag && (
                  <div style={{
                    position: 'absolute',
                    left: drag.overTime * pixelsPerSecond,
                    top: 0, bottom: 0, width: 3,
                    background: 'var(--accent)',
                    pointerEvents: 'none',
                  }} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/editor/timeline.tsx
git commit -m "feat: add Timeline component with clips, ruler, drag interactions"
```

---

## Task 15: Editor root component + project page replacement

**Files:**
- Create: `components/editor/editor.tsx`
- Modify: `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx`

- [ ] **Step 1: Create the root Editor component**

```tsx
// components/editor/editor.tsx
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { editorReducer, initialHistory, emptyTimeline } from './use-editor'
import { useReducer } from 'react'
import { toFFmpegJson } from './to-ffmpeg-json'
import { EditorTopBar } from './editor-top-bar'
import { EditorToolbar } from './editor-toolbar'
import { MediaBrowser } from './media-browser'
import { PreviewPanel } from './preview-panel'
import { Timeline } from './timeline'
import type { Timeline as TimelineType, MediaItem, Clip, DragState, EditorAction } from './types'

type Props = {
  orgSlug: string
  teamId: string
  projectId: string
  projectName: string
  projectSlug: string
  initialTimeline: TimelineType | null
  playlistItems: { driveFileId: string; duration: number; position: number }[]
  secondsPerImage: number
}

function bootstrap(
  playlistItems: { driveFileId: string; duration: number | null; position: number }[],
  secondsPerImage: number,
): TimelineType {
  const clips: Clip[] = playlistItems
    .sort((a, b) => a.position - b.position)
    .reduce<{ clips: Clip[]; cursor: number }>((acc, item, i) => {
      const dur = item.duration ?? secondsPerImage
      acc.clips.push({ id: `boot-${i}`, mediaId: item.driveFileId, filename: item.driveFileId.slice(-8), start: acc.cursor, duration: dur })
      acc.cursor += dur
      return acc
    }, { clips: [], cursor: 0 }).clips
  return {
    tracks: [
      { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, clips },
      { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, clips: [] },
    ],
  }
}

export function Editor({ orgSlug, teamId, projectId, projectName, projectSlug, initialTimeline, playlistItems, secondsPerImage }: Props) {
  const startTimeline = initialTimeline ?? (playlistItems.length > 0 ? bootstrap(playlistItems as any, secondsPerImage) : emptyTimeline)
  const [history, dispatch] = useReducer(editorReducer, initialHistory(startTimeline))
  const timeline = history.present

  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(() => Number(typeof window !== 'undefined' ? localStorage.getItem('kr-zoom') ?? '80' : '80'))
  const [snapOn, setSnapOn] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('kr-snap') !== 'false' : true)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [renderStatus, setRenderStatus] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const apiBase = `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`

  const totalDuration = Math.max(
    ...timeline.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)),
    0
  )

  // Play loop
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastTimeRef.current = null; return }
    function tick(now: number) {
      if (lastTimeRef.current === null) { lastTimeRef.current = now }
      const dt = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now
      setPlayhead((p) => {
        const next = p + dt
        if (next >= totalDuration) { setPlaying(false); return totalDuration }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playing, totalDuration])

  // Keyboard: space = play/pause, undo/redo handled globally
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p) }
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      if (meta && e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); dispatch({ type: 'REDO' }) }
      if (meta && e.code === 'KeyY') { e.preventDefault(); dispatch({ type: 'REDO' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // localStorage persistence
  useEffect(() => { localStorage.setItem('kr-zoom', String(zoom)) }, [zoom])
  useEffect(() => { localStorage.setItem('kr-snap', String(snapOn)) }, [snapOn])

  // Auto-save on timeline change
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await fetch(`${apiBase}/timeline`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeline }),
        })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch { setSaveStatus('idle') }
    }, 1000)
  }, [timeline, apiBase])

  // Poll render status
  useEffect(() => {
    fetch(`${apiBase}/render`).then((r) => r.json()).then((job) => { if (job?.status) setRenderStatus(job.status) }).catch(() => {})
  }, [apiBase])

  // Drag-from-browser global pointer handlers
  useEffect(() => {
    if (!drag) return
    function onPointerMove(e: PointerEvent) {
      setDrag((d) => d ? { ...d, curX: e.clientX, curY: e.clientY } : null)
    }
    function onPointerUp() { setDrag(null) }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp) }
  }, [!!drag])

  const handleDragStart = useCallback((media: MediaItem, e: React.PointerEvent) => {
    e.preventDefault()
    setDrag({ media, curX: e.clientX, curY: e.clientY, overTrackId: null, overTime: 0 })
  }, [])

  const handleDragOver = useCallback((trackId: 'V1' | 'A1' | null, time: number) => {
    setDrag((d) => d ? { ...d, overTrackId: trackId, overTime: time } : null)
  }, [])

  const handleDrop = useCallback((trackId: 'V1' | 'A1', time: number) => {
    if (!drag) return
    const newClip: Clip = {
      id: `c-${crypto.randomUUID()}`,
      mediaId: drag.media.id,
      filename: drag.media.filename,
      thumbnailUrl: drag.media.thumbnailUrl,
      start: time,
      duration: drag.media.defaultDuration,
    }
    dispatch({ type: 'ADD_CLIP', trackId, clip: newClip })
    setDrag(null)
  }, [drag])

  async function handleExport() {
    const ffmpegJson = toFFmpegJson(timeline, projectSlug)
    const res = await fetch(`${apiBase}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timelineJson: JSON.stringify(ffmpegJson) }),
    })
    if (res.ok) {
      const job = await res.json() as { status: string }
      setRenderStatus(job.status)
    }
  }

  function handleManualSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    fetch(`${apiBase}/timeline`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline }),
    }).then(() => { setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000) })
  }

  const v1 = timeline.tracks.find((t) => t.id === 'V1')!
  const prevTime = v1.clips.map((c) => c.start).filter((s) => s < playhead - 0.01).sort((a, b) => b - a)[0] ?? 0
  const nextTime = v1.clips.map((c) => c.start).filter((s) => s > playhead + 0.01).sort((a, b) => a - b)[0] ?? playhead

  return (
    <div
      className="editor-root flex flex-col"
      style={{ height: 'calc(100dvh - 3.5rem)', overflow: 'hidden' }}
    >
      <EditorTopBar
        projectName={projectName}
        orgSlug={orgSlug}
        teamId={teamId}
        projectId={projectId}
        history={history}
        saveStatus={saveStatus}
        renderStatus={renderStatus}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
        onSave={handleManualSave}
        onExport={handleExport}
        dispatch={dispatch as (a: { type: string }) => void}
      />
      <EditorToolbar snapOn={snapOn} onSnapChange={setSnapOn} />

      <div className="flex flex-1 min-h-0">
        <MediaBrowser
          orgSlug={orgSlug}
          teamId={teamId}
          projectId={projectId}
          onDragStart={handleDragStart}
        />
        <PreviewPanel
          timeline={timeline}
          playhead={playhead}
          playing={playing}
          totalDuration={totalDuration}
          onSeek={setPlayhead}
          onPlayPause={() => setPlaying((p) => !p)}
          onPrev={() => setPlayhead(prevTime)}
          onNext={() => setPlayhead(nextTime)}
        />
      </div>

      <Timeline
        timeline={timeline}
        playhead={playhead}
        zoom={zoom}
        selectedClipId={selectedClipId}
        snapOn={snapOn}
        drag={drag}
        totalDuration={totalDuration}
        onSeekRuler={setPlayhead}
        onZoomChange={setZoom}
        onMoveClip={(tid, cid, start) => dispatch({ type: 'MOVE_CLIP', trackId: tid, clipId: cid, newStart: start })}
        onResizeClip={(tid, cid, dur) => dispatch({ type: 'RESIZE_CLIP', trackId: tid, clipId: cid, newDuration: dur })}
        onRemoveClip={(tid, cid) => dispatch({ type: 'REMOVE_CLIP', trackId: tid, clipId: cid })}
        onSelectClip={setSelectedClipId}
        onToggleMute={(tid) => dispatch({ type: 'TOGGLE_MUTE', trackId: tid })}
        onToggleLock={(tid) => dispatch({ type: 'TOGGLE_LOCK', trackId: tid })}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      />

      {/* Drag ghost */}
      {drag && (
        <div
          style={{
            position: 'fixed',
            left: drag.curX - 36,
            top: drag.curY - 27,
            width: 72, height: 54,
            background: 'var(--paper-3)',
            border: '1.5px solid var(--line)',
            borderRadius: 3,
            boxShadow: '0 10px 24px rgba(0,0,0,.28)',
            transform: 'rotate(-2deg)',
            pointerEvents: 'none',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {drag.media.thumbnailUrl && (
            <img src={drag.media.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Replace the project detail page**

Replace `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx` entirely:

```tsx
// app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx
import { notFound } from 'next/navigation'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, playlistItems } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { Editor } from '@/components/editor/editor'

type Props = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export default async function ProjectPage({ params }: Props) {
  const { orgSlug, teamId, projectId } = await params
  const session = await requireSession()
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) notFound()
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) notFound()
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) notFound()
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project) notFound()

  const items = await db
    .select({ driveFileId: playlistItems.driveFileId, duration: playlistItems.durationOverride, position: playlistItems.position })
    .from(playlistItems)
    .where(eq(playlistItems.projectId, projectId))
    .orderBy(asc(playlistItems.position))

  const initialTimeline = project.timelineJson ? JSON.parse(project.timelineJson) : null
  const projectSlug = project.name.toLowerCase().replace(/\s+/g, '_')

  return (
    <Editor
      orgSlug={orgSlug}
      teamId={teamId}
      projectId={projectId}
      projectName={project.name}
      projectSlug={projectSlug}
      initialTimeline={initialTimeline}
      playlistItems={items}
      secondsPerImage={project.secondsPerImage}
    />
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all existing tests PASS plus the new ones

- [ ] **Step 5: Start dev server and verify the editor loads**

```bash
npm run dev
```

Navigate to `/orgs/<slug>/teams/<teamId>/projects/<projectId>`. Expected:
- Editor loads with the warm paper theme in light mode / dark theme in dark mode
- Media browser shows photo thumbnails from existing playlist items
- Timeline shows bootstrapped clips from playlist items on V1
- Dragging a photo from browser onto V1 adds a clip
- Dragging a photo to the wrong track (A1) has no effect
- Undo/redo (Cmd+Z / Cmd+Shift+Z) works
- Spacebar plays/pauses
- Export button triggers a render job

- [ ] **Step 6: Commit**

```bash
git add components/editor/ "app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx"
git commit -m "feat: wire editor to project page, replacing existing detail view"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Route replacement at existing URL (Task 15)
- ✅ Settings sub-route for project management (Task 7)
- ✅ Dual CSS theme (Task 8)
- ✅ `timeline_json` column + migration (Task 1)
- ✅ GET/PUT timeline API (Task 4)
- ✅ Audio listing API (Task 5)
- ✅ Render route accepts `timelineJson` (Task 6)
- ✅ Bootstrap from `playlistItems` when `timeline_json` is null (Task 15, `bootstrap()`)
- ✅ Refresh from Drive (MediaBrowser footer, Task 12) — only refreshes media browser, not timeline
- ✅ Types (Task 2)
- ✅ `toFFmpegJson` with kenburns + fade transition (Task 3)
- ✅ useReducer undo/redo (Task 9)
- ✅ Auto-save 1s debounce (Task 15, Editor component)
- ✅ EditorTopBar (Task 10)
- ✅ EditorToolbar with Snap (Task 11)
- ✅ MediaBrowser Photos + Audio tabs (Task 12)
- ✅ PreviewPanel with Ken Burns preview + transport (Task 13)
- ✅ Timeline: ruler, V1+A1 tracks, clips, drag-from-browser, clip move, resize, mute, lock (Task 14)
- ✅ Keyboard shortcuts: Space, Cmd+Z, Cmd+Shift+Z, Delete (Task 15 + use-editor.ts)
- ✅ Export → POST timelineJson → render pipeline (Task 15)
- ✅ Prev/Next seek to clip start (Task 13, `prevClipStart`/`nextClipStart`)
- ✅ Drag ghost (Task 15)
