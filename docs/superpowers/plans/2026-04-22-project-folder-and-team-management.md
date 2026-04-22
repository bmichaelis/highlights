# Project Folder & Team Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Drive folder selection from team level to project level, make players per-project, and add team rename/delete.

**Architecture:** Schema migration moves `folderId`/`folderName` from `driveConnections` to `projects`, and changes `players.teamId` to `players.projectId`. Project creation accepts a folder, scans it for player subfolders, and auto-sequences. A new PATCH endpoint handles folder changes post-creation by clearing and re-sequencing. Team rename/delete are new API endpoints with inline UI on the team page.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM, D1 (SQLite), Google Drive API v3, Tailwind CSS

---

## File Map

- **Modify:** `db/schema.ts` — remove folderId/folderName from driveConnections, add to projects, change players.teamId → projectId
- **Create:** `db/migrations/0001_project_folder_player_project.sql` — SQL migration
- **Modify:** `app/api/drive/callback/route.ts` — remove folderId/folderName from insert
- **Modify:** `app/api/orgs/[orgSlug]/teams/[teamId]/drive/route.ts` — remove folderId/folderName from GET/PATCH
- **Modify:** `app/api/orgs/[orgSlug]/teams/[teamId]/players/route.ts` — remove players.teamId reference
- **Create:** `app/api/orgs/[orgSlug]/teams/[teamId]/route.ts` — PATCH (rename) + DELETE (delete team)
- **Modify:** `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts` — accept folderId/folderName, scan folder, create players with projectId
- **Modify:** `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts` — resequence uses players.projectId and project.folderId
- **Create:** `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/folder/route.ts` — PATCH: update folder + re-sequence
- **Modify:** `app/(app)/orgs/[orgSlug]/teams/[teamId]/page.tsx` — simplify drive section, add rename/delete
- **Create:** `components/team-management.tsx` — client component for inline rename + delete confirmation
- **Modify:** `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/new/page.tsx` — add folder browser to form
- **Modify:** `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx` — add change folder button + confirmation

---

### Task 1: Schema Update and Migration

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/0001_project_folder_player_project.sql`

- [ ] **Step 1: Update `db/schema.ts`**

Replace the `driveConnections`, `players`, and `projects` table definitions with:

```ts
export const driveConnections = sqliteTable('drive_connections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId').notNull().unique().references(() => teams.id, { onDelete: 'cascade' }),
  userId: text('userId').notNull().references(() => users.id),
  accessToken: text('accessToken').notNull(),
  refreshToken: text('refreshToken').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }),
})

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
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).default(now()),
})

export const players = sqliteTable('players', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  folderName: text('folderName').notNull(),
})
```

Note: `projects` must be defined before `players` in the file since `players` now references `projects`. Move `projects` above `players` in the file.

- [ ] **Step 2: Create migration file**

Create `db/migrations/0001_project_folder_player_project.sql`:

```sql
-- Clear data tied to old schema (players and playlist_items reference the old teamId FK)
DELETE FROM `playlist_items`;
--> statement-breakpoint
DELETE FROM `players`;
--> statement-breakpoint
-- Recreate players table with projectId instead of teamId
CREATE TABLE `players_new` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`folderName` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `players`;
--> statement-breakpoint
ALTER TABLE `players_new` RENAME TO `players`;
--> statement-breakpoint
-- Add folder columns to projects (nullable — existing projects have no folder yet)
ALTER TABLE `projects` ADD COLUMN `folderId` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `folderName` text;
--> statement-breakpoint
-- Remove folder columns from drive_connections
ALTER TABLE `drive_connections` DROP COLUMN `folderId`;
--> statement-breakpoint
ALTER TABLE `drive_connections` DROP COLUMN `folderName`;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only from files that still reference the old fields (`players.teamId`, `driveConnections.folderId`) — those are fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts db/migrations/0001_project_folder_player_project.sql
git commit -m "feat: migrate folder to project level and players to per-project"
```

---

### Task 2: Fix Drive Routes and Players Route

**Files:**
- Modify: `app/api/drive/callback/route.ts`
- Modify: `app/api/orgs/[orgSlug]/teams/[teamId]/drive/route.ts`
- Modify: `app/api/orgs/[orgSlug]/teams/[teamId]/players/route.ts`

- [ ] **Step 1: Update drive callback — remove PENDING folder insert**

In `app/api/drive/callback/route.ts`, replace the `db.insert(driveConnections).values(...)` block (lines 51–66) with:

```ts
  await db.insert(driveConnections).values({
    teamId,
    userId: session.user.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  }).onConflictDoUpdate({
    target: driveConnections.teamId,
    set: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  })
```

- [ ] **Step 2: Update drive route — remove folderId/folderName from GET and PATCH**

Replace the entire contents of `app/api/orgs/[orgSlug]/teams/[teamId]/drive/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  return NextResponse.json(conn ? { connected: true } : { connected: false })
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await db.delete(driveConnections).where(eq(driveConnections.teamId, teamId))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Update players route — remove players.teamId reference**

Replace the entire contents of `app/api/orgs/[orgSlug]/teams/[teamId]/players/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json([])
}
```

- [ ] **Step 4: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors in the three files changed above.

- [ ] **Step 5: Commit**

```bash
git add app/api/drive/callback/route.ts \
  "app/api/orgs/[orgSlug]/teams/[teamId]/drive/route.ts" \
  "app/api/orgs/[orgSlug]/teams/[teamId]/players/route.ts"
git commit -m "fix: remove folderId/folderName from drive connection routes"
```

---

### Task 3: Team PATCH and DELETE API

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/route.ts`

- [ ] **Step 1: Write failing test**

Create `app/api/orgs/[orgSlug]/teams/[teamId]/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('team route', () => {
  it('exports PATCH and DELETE handlers', async () => {
    const mod = await import('./route')
    expect(typeof mod.PATCH).toBe('function')
    expect(typeof mod.DELETE).toBe('function')
  })
})
```

- [ ] **Step 2: Run test — confirm fail**

```bash
npx vitest run "app/api/orgs/\[orgSlug\]/teams/\[teamId\]/route.test.ts"
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the route**

Create `app/api/orgs/[orgSlug]/teams/[teamId]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, players, playlistItems, renderJobs, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  let body: { name?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [updated] = await db.update(teams).set({ name: body.name.trim() }).where(eq(teams.id, teamId)).returning()
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const teamProjects = await db.query.projects.findMany({ where: eq(projects.teamId, teamId) })
  for (const project of teamProjects) {
    await db.delete(playlistItems).where(eq(playlistItems.projectId, project.id))
    await db.delete(players).where(eq(players.projectId, project.id))
    await db.delete(renderJobs).where(eq(renderJobs.projectId, project.id))
  }
  await db.delete(projects).where(eq(projects.teamId, teamId))
  await db.delete(driveConnections).where(eq(driveConnections.teamId, teamId))
  await db.delete(teams).where(eq(teams.id, teamId))

  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 4: Run test — confirm pass**

```bash
npx vitest run "app/api/orgs/\[orgSlug\]/teams/\[teamId\]/route.test.ts"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/orgs/[orgSlug]/teams/[teamId]/route.ts" \
  "app/api/orgs/[orgSlug]/teams/[teamId]/route.test.ts"
git commit -m "feat: add team rename and delete API endpoints"
```

---

### Task 4: Update Project Creation API

**Files:**
- Modify: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts`

- [ ] **Step 1: Replace the POST handler**

In `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts`, add `listFolderContents` and `parseDriveFiles` to the imports:

```ts
import { listFolderContents, parseDriveFiles, buildPlaylist } from '@/lib/drive/scanner'
```

Wait — `buildPlaylist` is in `lib/drive/sequencer`, not `scanner`. Keep imports as:

```ts
import { buildPlaylist } from '@/lib/drive/sequencer'
import { listFolderContents, parseDriveFiles } from '@/lib/drive/scanner'
```

Replace the entire `POST` function with:

```ts
export async function POST(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  let body: { name?: unknown; imagesPerPlayer?: unknown; secondsPerImage?: unknown; folderId?: unknown; folderName?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const { name, imagesPerPlayer = 4, secondsPerImage = 3.5, folderId, folderName } = body
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (typeof folderId !== 'string' || !folderId.trim()) return NextResponse.json({ error: 'folderId required' }, { status: 400 })
  if (typeof folderName !== 'string' || !folderName.trim()) return NextResponse.json({ error: 'folderName required' }, { status: 400 })
  const n = Number(imagesPerPlayer)
  const s = Number(secondsPerImage)
  if (!Number.isInteger(n) || n < 1 || n > 20) return NextResponse.json({ error: 'imagesPerPlayer must be an integer 1–20' }, { status: 400 })
  if (Number.isNaN(s) || s < 0.5 || s > 30) return NextResponse.json({ error: 'secondsPerImage must be a number 0.5–30' }, { status: 400 })

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  const [project] = await db.insert(projects).values({
    teamId,
    name: name.trim(),
    imagesPerPlayer: n,
    secondsPerImage: s,
    folderId: folderId.trim(),
    folderName: folderName.trim(),
  }).returning()

  try {
    const accessToken = await getFreshAccessToken(conn, db)
    const files = await listFolderContents(folderId.trim(), accessToken)
    const folderItems = parseDriveFiles(files)
    if (folderItems.length > 0) {
      const newPlayers = await db.insert(players).values(
        folderItems.map((f) => ({ projectId: project.id, name: f.name, folderName: f.name }))
      ).returning()
      const playlist = await buildPlaylist(newPlayers, folderId.trim(), accessToken, n)
      if (playlist.length > 0) {
        await db.insert(playlistItems).values(
          playlist.map((item, i) => ({
            projectId: project.id,
            playerId: item.playerId,
            driveFileId: item.driveFileId,
            thumbnailUrl: item.thumbnailUrl,
            exifDate: item.date ? new Date(item.date) : null,
            position: i,
          }))
        )
      }
    }
  } catch {
    await db.delete(projects).where(eq(projects.id, project.id))
    return NextResponse.json({ error: 'Failed to auto-sequence playlist from Drive. Check Drive connection and try again.' }, { status: 502 })
  }

  return NextResponse.json(project, { status: 201 })
}
```

Also remove the now-unused import `{ players }` from the top of the original file — it's still needed but now for `insert`, not `findMany`. Make sure the imports include `listFolderContents, parseDriveFiles`:

```ts
import { organizations, teams, projects, players, playlistItems, driveConnections } from '@/db/schema'
import { buildPlaylist } from '@/lib/drive/sequencer'
import { listFolderContents, parseDriveFiles } from '@/lib/drive/scanner'
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors in this file.

- [ ] **Step 3: Commit**

```bash
git add "app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts"
git commit -m "feat: project creation accepts folder and scans for players"
```

---

### Task 5: Update Playlist Resequence

**Files:**
- Modify: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts`

- [ ] **Step 1: Update resequence handler**

In `playlist/route.ts`, the `resequence` block currently reads `players.teamId` and `conn.folderId`. Replace that block (lines 87–112) with:

```ts
  if (body.type === 'resequence') {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!project.folderId) return NextResponse.json({ error: 'No folder set for this project' }, { status: 400 })
    const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
    if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })
    const projectPlayers = await db.query.players.findMany({ where: eq(players.projectId, projectId) })
    const accessToken = await getFreshAccessToken(conn, db)
    const playlist = await buildPlaylist(projectPlayers, project.folderId, accessToken, project.imagesPerPlayer)

    await db.transaction(async (tx) => {
      await tx.delete(playlistItems).where(eq(playlistItems.projectId, projectId))
      if (playlist.length > 0) {
        await tx.insert(playlistItems).values(
          playlist.map((item, i) => ({
            projectId,
            playerId: item.playerId,
            driveFileId: item.driveFileId,
            thumbnailUrl: item.thumbnailUrl,
            exifDate: new Date(item.date),
            position: i,
          }))
        )
      }
    })
    return NextResponse.json({ ok: true })
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts"
git commit -m "fix: resequence uses project folder and per-project players"
```

---

### Task 6: Change Folder API

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/folder/route.ts`

- [ ] **Step 1: Write failing test**

Create `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/folder/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('project folder route', () => {
  it('exports a PATCH handler', async () => {
    const mod = await import('./route')
    expect(typeof mod.PATCH).toBe('function')
  })
})
```

- [ ] **Step 2: Run test — confirm fail**

```bash
npx vitest run "app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/folder/route.test.ts"
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the route**

Create `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/folder/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, projects, players, playlistItems, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getFreshAccessToken } from '@/lib/drive/auth'
import { listFolderContents, parseDriveFiles } from '@/lib/drive/scanner'
import { buildPlaylist } from '@/lib/drive/sequencer'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId } = await params
  let body: { folderId?: unknown; folderName?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.folderId !== 'string' || !body.folderId.trim()) return NextResponse.json({ error: 'folderId required' }, { status: 400 })
  if (typeof body.folderName !== 'string' || !body.folderName.trim()) return NextResponse.json({ error: 'folderName required' }, { status: 400 })
  const folderId = body.folderId.trim()
  const folderName = body.folderName.trim()

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  await db.update(projects).set({ folderId, folderName }).where(eq(projects.id, projectId))
  await db.delete(playlistItems).where(eq(playlistItems.projectId, projectId))
  await db.delete(players).where(eq(players.projectId, projectId))

  try {
    const accessToken = await getFreshAccessToken(conn, db)
    const files = await listFolderContents(folderId, accessToken)
    const folderItems = parseDriveFiles(files)
    if (folderItems.length > 0) {
      const newPlayers = await db.insert(players).values(
        folderItems.map((f) => ({ projectId, name: f.name, folderName: f.name }))
      ).returning()
      const playlist = await buildPlaylist(newPlayers, folderId, accessToken, project.imagesPerPlayer)
      if (playlist.length > 0) {
        await db.insert(playlistItems).values(
          playlist.map((item, i) => ({
            projectId,
            playerId: item.playerId,
            driveFileId: item.driveFileId,
            thumbnailUrl: item.thumbnailUrl,
            exifDate: item.date ? new Date(item.date) : null,
            position: i,
          }))
        )
      }
    }
  } catch {
    return NextResponse.json({ error: 'Failed to re-sequence playlist from Drive.' }, { status: 502 })
  }

  const updated = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
  return NextResponse.json(updated)
}
```

- [ ] **Step 4: Run test — confirm pass**

```bash
npx vitest run "app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/folder/route.test.ts"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/folder/route.ts" \
  "app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/folder/route.test.ts"
git commit -m "feat: add change-folder API with re-sequence"
```

---

### Task 7: Team Page UI

**Files:**
- Create: `components/team-management.tsx`
- Modify: `app/(app)/orgs/[orgSlug]/teams/[teamId]/page.tsx`

- [ ] **Step 1: Create TeamManagement client component**

Create `components/team-management.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = { orgSlug: string; teamId: string; teamName: string }

export function TeamManagement({ orgSlug, teamId, teamName }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(teamName)
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) { setError('Failed to rename team.'); return }
      setEditing(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}`, { method: 'DELETE' })
      if (!res.ok) { setError('Failed to delete team.'); return }
      router.push(`/orgs/${orgSlug}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-2">
      {editing ? (
        <form onSubmit={handleRename} className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded-lg px-3 py-1 text-xl font-bold flex-1"
            autoFocus
            required
          />
          <button type="submit" disabled={saving}
            className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setName(teamName) }}
            className="text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{teamName}</h1>
          <button onClick={() => setEditing(true)}
            className="text-sm text-blue-600 hover:underline">
            Edit
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-semibold">Delete team?</h2>
            <p className="text-sm text-gray-600">
              This will permanently delete <strong>{teamName}</strong> and all its projects. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDelete(false)}
                className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <button onClick={() => setShowDelete(true)}
          className="text-sm text-red-600 border border-red-200 px-3 py-1 rounded-lg hover:bg-red-50">
          Delete team
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update team page**

Replace the entire contents of `app/(app)/orgs/[orgSlug]/teams/[teamId]/page.tsx` with:

```tsx
import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, driveConnections, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { TeamManagement } from '@/components/team-management'

type Props = { params: Promise<{ orgSlug: string; teamId: string }> }

export default async function TeamPage({ params }: Props) {
  await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) notFound()
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!team || team.orgId !== org.id) notFound()

  const drive = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  const teamProjects = await db.query.projects.findMany({ where: eq(projects.teamId, teamId) })

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <TeamManagement orgSlug={orgSlug} teamId={teamId} teamName={team.name} />

      <section className="border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Google Drive</h2>
        {drive ? (
          <p className="text-green-700 text-sm">Connected</p>
        ) : (
          <a href={`/api/orgs/${orgSlug}/teams/${teamId}/drive/connect`}
            className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
            Connect Google Drive
          </a>
        )}
      </section>

      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">Projects</h2>
          {drive && (
            <Link href={`/orgs/${orgSlug}/teams/${teamId}/projects/new`}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm">
              New Project
            </Link>
          )}
        </div>
        <ul className="space-y-2">
          {teamProjects.map((p) => (
            <li key={p.id}>
              <Link href={`/orgs/${orgSlug}/teams/${teamId}/projects/${p.id}`}
                className="block p-4 border rounded-lg hover:bg-gray-50">
                <span>{p.name}</span>
                <span className="ml-2 text-sm text-gray-500">{p.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add components/team-management.tsx \
  "app/(app)/orgs/[orgSlug]/teams/[teamId]/page.tsx"
git commit -m "feat: add team rename/delete UI and simplify drive section"
```

---

### Task 8: Project Creation UI with Folder Browser

**Files:**
- Modify: `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/new/page.tsx`

- [ ] **Step 1: Replace the page**

Replace the entire contents of `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/new/page.tsx` with:

```tsx
'use client'
import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { DriveFolderBrowser } from '@/components/drive-folder-browser'

export default function NewProjectPage() {
  const router = useRouter()
  const { orgSlug, teamId } = useParams<{ orgSlug: string; teamId: string }>()
  const [name, setName] = useState('')
  const [imagesPerPlayer, setImagesPerPlayer] = useState(4)
  const [secondsPerImage, setSecondsPerImage] = useState(3.5)
  const [folderId, setFolderId] = useState('')
  const [folderName, setFolderName] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function parseFolderId(input: string): string | null {
    const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    if (urlMatch) return urlMatch[1]
    if (/^[a-zA-Z0-9_-]{10,}$/.test(input.trim())) return input.trim()
    return null
  }

  async function handleUrlPaste(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = (e.currentTarget.elements.namedItem('folderUrl') as HTMLInputElement).value
    const parsed = parseFolderId(input)
    if (!parsed) { setError('Paste a valid Google Drive folder URL or ID.'); return }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/drive/folder-info?id=${parsed}`)
      if (!res.ok) { setError('Could not access that folder.'); return }
      const data = await res.json() as { id: string; name: string }
      setFolderId(data.id)
      setFolderName(data.name)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!folderId) { setError('Please select a Drive folder.'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, imagesPerPlayer, secondsPerImage, folderId, folderName }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? 'Failed to create project.')
        return
      }
      const project = await res.json() as { id: string }
      router.push(`/orgs/${orgSlug}/teams/${teamId}/projects/${project.id}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="max-w-md mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-bold">New Project</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Project Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="2024 Season Highlights" className="w-full border rounded-lg px-4 py-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Images per Player</label>
          <input type="number" min={1} max={20} value={imagesPerPlayer}
            onChange={(e) => setImagesPerPlayer(Number(e.target.value))}
            className="w-full border rounded-lg px-4 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Seconds per Image</label>
          <input type="number" min={0.5} max={30} step={0.5} value={secondsPerImage}
            onChange={(e) => setSecondsPerImage(Number(e.target.value))}
            className="w-full border rounded-lg px-4 py-2" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Google Drive Folder</label>
          {folderId ? (
            <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-green-50">
              <span className="text-sm text-green-800 font-medium">{folderName}</span>
              <button type="button" onClick={() => { setFolderId(''); setFolderName('') }}
                className="text-xs text-gray-500 hover:text-gray-700 ml-2">Change</button>
            </div>
          ) : (
            <div className="space-y-3">
              <button type="button" onClick={() => setShowBrowser(true)}
                className="w-full border-2 border-dashed border-blue-300 text-blue-600 py-2 rounded-lg text-sm hover:border-blue-500 hover:bg-blue-50 transition-colors">
                Browse Drive folders
              </button>
              <p className="text-xs text-gray-400 text-center">or paste a folder URL</p>
              <form onSubmit={handleUrlPaste} className="flex gap-2">
                <input name="folderUrl" placeholder="https://drive.google.com/drive/folders/..."
                  className="flex-1 border rounded-lg px-3 py-2 text-sm" required />
                <button type="submit" disabled={loading}
                  className="bg-gray-100 border px-3 py-2 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50">
                  {loading ? '…' : 'Set'}
                </button>
              </form>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading || !folderId}
          className="w-full bg-blue-600 text-white py-2 rounded-lg disabled:opacity-50">
          {loading ? 'Creating & sequencing…' : 'Create Project'}
        </button>
      </form>

      {showBrowser && (
        <DriveFolderBrowser
          orgSlug={orgSlug}
          teamId={teamId}
          onSelect={(id, name) => { setFolderId(id); setFolderName(name); setShowBrowser(false) }}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </main>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/new/page.tsx"
git commit -m "feat: add folder browser to project creation form"
```

---

### Task 9: Project Detail UI — Change Folder

**Files:**
- Modify: `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx`

- [ ] **Step 1: Update the project detail page**

Replace the entire contents of `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx` with:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { PlaylistEditor } from '@/components/playlist-editor'
import { DriveFolderBrowser } from '@/components/drive-folder-browser'

type Project = { id: string; name: string; status: string; secondsPerImage: number; folderId: string | null; folderName: string | null }
type RenderJob = { id: string; status: string; outputDriveFileId: string | null; errorMsg: string | null }

export default function ProjectPage() {
  const { orgSlug, teamId, projectId } = useParams<{ orgSlug: string; teamId: string; projectId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null)
  const [renderLoading, setRenderLoading] = useState(false)
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

  useEffect(() => {
    if (!renderJob || renderJob.status === 'complete' || renderJob.status === 'failed') return
    const interval = setInterval(() => {
      fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`)
        .then((r) => r.json() as Promise<RenderJob>).then(setRenderJob)
    }, 5000)
    return () => clearInterval(interval)
  }, [renderJob, orgSlug, teamId, projectId])

  async function handleRender() {
    setRenderLoading(true)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`, { method: 'POST' })
      if (res.ok) {
        const job = await res.json() as RenderJob
        setRenderJob(job)
        setProject((p) => p ? { ...p, status: 'rendering' } : p)
      }
    } finally {
      setRenderLoading(false)
    }
  }

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

  if (!project) return <p className="p-8 text-gray-500">Loading…</p>

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <div className="text-right">
          {project.folderName && (
            <p className="text-xs text-gray-500 mb-1">Folder: {project.folderName}</p>
          )}
          <button onClick={() => setShowFolderBrowser(true)}
            className="text-xs text-blue-600 hover:underline">
            Change folder
          </button>
        </div>
      </div>

      {folderError && <p className="text-sm text-red-600">{folderError}</p>}

      {renderJob && (
        <div className={`p-4 rounded-lg border ${
          renderJob.status === 'complete' ? 'border-green-300 bg-green-50' :
          renderJob.status === 'failed' ? 'border-red-300 bg-red-50' :
          'border-blue-300 bg-blue-50'
        }`}>
          {renderJob.status === 'pending' && <p>Queued — waiting for GitHub Actions runner…</p>}
          {renderJob.status === 'running' && <p>Rendering… this takes 2–3 minutes.</p>}
          {renderJob.status === 'complete' && renderJob.outputDriveFileId && (
            <div className="space-y-2">
              <p className="text-green-800 font-medium">Render complete!</p>
              <video src={`https://drive.google.com/uc?id=${renderJob.outputDriveFileId}&export=download`}
                controls className="w-full rounded" />
              <a href={`https://drive.google.com/file/d/${renderJob.outputDriveFileId}/view`}
                target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">
                Open in Google Drive
              </a>
            </div>
          )}
          {renderJob.status === 'failed' && (
            <p className="text-red-800">Render failed: {renderJob.errorMsg}</p>
          )}
        </div>
      )}

      <PlaylistEditor
        orgSlug={orgSlug} teamId={teamId} projectId={projectId}
        defaultDuration={project.secondsPerImage}
        projectStatus={project.status}
        onRender={handleRender}
        renderLoading={renderLoading}
      />

      {showFolderBrowser && (
        <DriveFolderBrowser
          orgSlug={orgSlug}
          teamId={teamId}
          onSelect={(id, name) => { setPendingFolder({ id, name }); setShowFolderBrowser(false) }}
          onClose={() => setShowFolderBrowser(false)}
        />
      )}

      {pendingFolder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-semibold">Change folder?</h2>
            <p className="text-sm text-gray-600">
              Switching to <strong>{pendingFolder.name}</strong> will delete your current playlist and re-scan the new folder. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPendingFolder(null)}
                className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              <button onClick={handleConfirmFolderChange} disabled={changingFolder}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
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

- [ ] **Step 2: Verify TypeScript compiles clean across all files**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx"
git commit -m "feat: add change folder button to project detail page"
```

---

### Task 10: Run Migration and Deploy

- [ ] **Step 1: Apply migration to remote D1**

```bash
npx wrangler d1 migrations apply highlights-db --remote
```

Expected output includes: `Applying migration 0001_project_folder_player_project.sql` and `Done!`

- [ ] **Step 2: Build and deploy**

```bash
npm run deploy 2>&1 | tail -10
```

Expected: `Deployed highlights triggers` with a version ID.

- [ ] **Step 3: Smoke test**

1. Navigate to a team page — confirm "Edit" and "Delete team" buttons appear, drive section shows only "Connected" (no folder picker)
2. Click "Edit" — rename form appears inline, save updates the name
3. Click "New Project" — form now shows a folder browser section; select a folder and create
4. On the project detail page — confirm "Change folder" link appears, clicking opens browser, selecting + confirming re-sequences
5. Navigate to org page and confirm team is still listed correctly
