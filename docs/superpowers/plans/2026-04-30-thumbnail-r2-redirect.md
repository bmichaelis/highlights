# Thumbnail R2 Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct Drive thumbnail URLs (which expire and trigger ERR_BLOCKED_BY_ORB) with stable URLs served via a Worker route that 302-redirects to a public R2 URL. R2 is populated lazily on first request from Drive's `thumbnailLink`.

**Architecture:** Mirrors the audio R2 redirect shipped earlier today, but for image thumbnails into a separate `THUMBNAIL_BUCKET`. Adds a thumbnail route, a URL helper, and server-side substitution at the two endpoints that surface `thumbnailUrl` to clients. No DB migration — the legacy `playlistItems.thumbnailUrl` column keeps its values; reads override at the API layer.

**Tech Stack:** Next.js 16 / OpenNext on Cloudflare Workers (`getCloudflareContext` for env bindings), R2 (`THUMBNAIL_BUCKET` binding), Drizzle / D1, Vitest (`npm test`), Drive `files.get?fields=thumbnailLink` API.

---

## Note on testing

Following the same convention used in the audio R2 plan: smoke test on the new route + manual verification covers the route's runtime behavior; the URL helper gets a real unit test because it's a pure function. No deeper mocking infrastructure introduced.

---

## File Map

| File | Change |
|------|--------|
| `types/cloudflare-env.d.ts` | Add `THUMBNAIL_BUCKET: R2Bucket` and `THUMBNAIL_PUBLIC_BASE_URL: string` |
| `wrangler.toml` | Add `[[r2_buckets]]` block for `THUMBNAIL_BUCKET`; add `THUMBNAIL_PUBLIC_BASE_URL` placeholder under `[vars]` |
| `lib/thumbnail-url.ts` | New: `thumbnailRouteUrl(orgSlug, teamId, projectId, driveFileId)` builder |
| `lib/thumbnail-url.test.ts` | New: pure-function unit test |
| `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.ts` | New: R2 lookup + Drive cold-fill + 302 |
| `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.test.ts` | New: smoke test |
| `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts` | Modify GET to substitute `thumbnailUrl` |
| `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx` | Modify server query to substitute `thumbnailUrl` |

---

### Task 1: Add `THUMBNAIL_BUCKET` and `THUMBNAIL_PUBLIC_BASE_URL` env bindings

**Files:**
- Modify: `types/cloudflare-env.d.ts`
- Modify: `wrangler.toml`

The R2 bucket binding and public URL need to be declared in code. The placeholder URL gets replaced in Task 5 once the bucket is made public.

- [ ] **Step 1: Add fields to `CloudflareEnv` interface**

In `types/cloudflare-env.d.ts`, add the two fields after `AUDIO_PUBLIC_BASE_URL`:

```ts
interface CloudflareEnv {
  DB: D1Database
  AUDIO_BUCKET: R2Bucket
  AUDIO_PUBLIC_BASE_URL: string
  THUMBNAIL_BUCKET: R2Bucket
  THUMBNAIL_PUBLIC_BASE_URL: string
  AUTH_SECRET: string
  AUTH_GOOGLE_ID: string
  AUTH_GOOGLE_SECRET: string
  NEXTAUTH_URL: string
  DRIVE_GOOGLE_CLIENT_ID: string
  DRIVE_GOOGLE_CLIENT_SECRET: string
  GITHUB_PAT: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
}
```

- [ ] **Step 2: Add R2 bucket binding to `wrangler.toml`**

In `wrangler.toml`, add a new `[[r2_buckets]]` block after the existing `AUDIO_BUCKET` block:

```toml
[[r2_buckets]]
binding = "AUDIO_BUCKET"
bucket_name = "highlights-audio"

[[r2_buckets]]
binding = "THUMBNAIL_BUCKET"
bucket_name = "highlights-thumbnails"
```

(Find the existing `AUDIO_BUCKET` block — the new one goes immediately after it. Don't duplicate the `AUDIO_BUCKET` block; only add the new one.)

- [ ] **Step 3: Add placeholder var to `[vars]` block**

In `wrangler.toml`, find the `[vars]` block and append the new key after `AUDIO_PUBLIC_BASE_URL`:

```toml
[vars]
AUTH_GOOGLE_ID = "540014896460-78no60qlh6c5f9uj5ukmhrh2erh3i5rr.apps.googleusercontent.com"
DRIVE_GOOGLE_CLIENT_ID = "540014896460-78no60qlh6c5f9uj5ukmhrh2erh3i5rr.apps.googleusercontent.com"
NEXTAUTH_URL = "https://highlights.kindacoach.com"
GITHUB_OWNER = "bmichaelis"
GITHUB_REPO = "highlights"
AUDIO_PUBLIC_BASE_URL = "https://pub-1035b3a927c644bc813be144ce9e3ec0.r2.dev"
THUMBNAIL_PUBLIC_BASE_URL = "https://placeholder.r2.dev"
```

The placeholder URL is intentional — Task 5 replaces it with the real `pub-<hash>.r2.dev` URL after enabling public access on the bucket.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all 77 tests still pass. (Adding fields to the env interface and a new bucket binding is backwards-compatible; nothing reads them yet.)

- [ ] **Step 5: Commit**

```bash
git add types/cloudflare-env.d.ts wrangler.toml
git commit -m "chore: add THUMBNAIL_BUCKET binding and PUBLIC_BASE_URL env var"
```

---

### Task 2: Create `thumbnailRouteUrl` helper + unit test

**Files:**
- Create: `lib/thumbnail-url.ts`
- Create: `lib/thumbnail-url.test.ts`

Pure function that builds the thumbnail route URL. Single source of truth for the URL pattern. TDD-style.

- [ ] **Step 1: Write the failing test**

Create `lib/thumbnail-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { thumbnailRouteUrl } from './thumbnail-url'

describe('thumbnailRouteUrl', () => {
  it('builds the route URL from the four ID parts', () => {
    expect(thumbnailRouteUrl('myorg', 'team-1', 'proj-2', 'drive-fid-3'))
      .toBe('/api/orgs/myorg/teams/team-1/projects/proj-2/thumbnail/drive-fid-3')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test
```

Expected: the new test fails because `lib/thumbnail-url.ts` doesn't exist yet.

- [ ] **Step 3: Implement the helper**

Create `lib/thumbnail-url.ts`:

```ts
export function thumbnailRouteUrl(
  orgSlug: string,
  teamId: string,
  projectId: string,
  driveFileId: string,
): string {
  return `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/thumbnail/${driveFileId}`
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

Expected: 78 tests pass (77 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add lib/thumbnail-url.ts lib/thumbnail-url.test.ts
git commit -m "feat: add thumbnailRouteUrl helper"
```

---

### Task 3: Create the thumbnail route + smoke test

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.ts`
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.test.ts`

The route mirrors the audio route's structure: auth → R2 fast path → Drive cold-fill on miss → 302.

- [ ] **Step 1: Create the route file**

Create `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getFreshAccessToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string; fileId: string }> }

export async function GET(_req: Request, { params }: Params) {
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

  const { env } = getCloudflareContext()
  const publicUrl = `${env.THUMBNAIL_PUBLIC_BASE_URL}/${fileId}`

  // Fast path — thumbnail already in R2.
  const existing = await env.THUMBNAIL_BUCKET.head(fileId)
  if (existing) {
    return Response.redirect(publicUrl, 302)
  }

  // Cold path — get a fresh thumbnailLink from Drive, fetch the bytes, write to R2.
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  try {
    const accessToken = await getFreshAccessToken(conn, db)

    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!metaRes.ok) return NextResponse.json({ error: 'Drive metadata fetch failed' }, { status: 502 })
    const { thumbnailLink } = await metaRes.json() as { thumbnailLink?: string }
    if (!thumbnailLink) return NextResponse.json({ error: 'No thumbnail available' }, { status: 404 })

    const imgRes = await fetch(thumbnailLink)
    if (!imgRes.ok || !imgRes.body) {
      return NextResponse.json({ error: 'Thumbnail fetch failed' }, { status: 502 })
    }

    await env.THUMBNAIL_BUCKET.put(fileId, imgRes.body, {
      httpMetadata: {
        contentType: imgRes.headers.get('content-type') ?? 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })

    return Response.redirect(publicUrl, 302)
  } catch (err) {
    console.error('[thumbnail] cold-fill failed for', fileId, err)
    return NextResponse.json({ error: 'Drive access failed' }, { status: 502 })
  }
}
```

- [ ] **Step 2: Create the smoke test**

Create `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('thumbnail file route', () => {
  it('exports a GET handler', async () => {
    const mod = await import('./route')
    expect(typeof mod.GET).toBe('function')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 79 tests pass (78 existing + 1 new smoke test).

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: 0 NEW errors. The pre-existing 2 errors in `to-ffmpeg-json.test.ts` (`removable` field missing) should still be there but unchanged.

- [ ] **Step 5: Commit**

```bash
git add app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/thumbnail/\[fileId\]/route.ts \
        app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/thumbnail/\[fileId\]/route.test.ts
git commit -m "feat: serve thumbnails via R2 lookup + 302 redirect"
```

---

### Task 4: Substitute `thumbnailUrl` at the two read points

**Files:**
- Modify: `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts`
- Modify: `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx`

The route exists; now point clients at it. Two read endpoints surface `thumbnailUrl` to the editor; both get a one-line substitution.

- [ ] **Step 1: Update `/playlist` GET**

In `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts`, modify the GET handler.

First, add the import at the top of the file (after the existing imports):

```ts
import { thumbnailRouteUrl } from '@/lib/thumbnail-url'
```

Then, find the existing `return NextResponse.json(items)` line at the end of the GET handler (around line 38). Replace it with:

```ts
  return NextResponse.json(items.map(item => ({
    ...item,
    thumbnailUrl: thumbnailRouteUrl(orgSlug, teamId, projectId, item.driveFileId),
  })))
}
```

Leave the rest of the file (PATCH handler etc.) unchanged.

- [ ] **Step 2: Update the project page server query**

In `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx`, modify the server query.

First, add the import after the existing imports:

```ts
import { thumbnailRouteUrl } from '@/lib/thumbnail-url'
```

Then, find the `const items = await db.select(...)` block (around lines 24-33) and wrap the result with `.map()` to substitute `thumbnailUrl`. Replace:

```ts
  const items = await db
    .select({
      driveFileId: playlistItems.driveFileId,
      duration: playlistItems.durationOverride,
      position: playlistItems.position,
      thumbnailUrl: playlistItems.thumbnailUrl,
    })
    .from(playlistItems)
    .where(eq(playlistItems.projectId, projectId))
    .orderBy(asc(playlistItems.position))
```

with:

```ts
  const rawItems = await db
    .select({
      driveFileId: playlistItems.driveFileId,
      duration: playlistItems.durationOverride,
      position: playlistItems.position,
    })
    .from(playlistItems)
    .where(eq(playlistItems.projectId, projectId))
    .orderBy(asc(playlistItems.position))

  const items = rawItems.map(r => ({
    ...r,
    thumbnailUrl: thumbnailRouteUrl(orgSlug, teamId, projectId, r.driveFileId),
  }))
```

(Note: we also drop `thumbnailUrl: playlistItems.thumbnailUrl` from the SQL select since we're constructing it instead. The Editor's expected shape — `{ driveFileId, duration, position, thumbnailUrl }` — is preserved.)

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 79 tests still pass. No new tests added (the substitution is too thin to warrant testing the route directly; it's covered by manual verification).

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: 0 NEW errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/playlist/route.ts \
        app/\(app\)/orgs/\[orgSlug\]/teams/\[teamId\]/projects/\[projectId\]/page.tsx
git commit -m "feat: route thumbnailUrl through R2 redirect at read endpoints"
```

---

### Task 5: Create R2 bucket and enable public access

**Files:** none (Cloudflare dashboard action)

One-time manual setup. The `THUMBNAIL_BUCKET` binding in `wrangler.toml` references a bucket named `highlights-thumbnails` that doesn't exist yet — this task creates it and makes it public.

- [ ] **Step 1: Create the R2 bucket**

In a browser:
1. Sign in to https://dash.cloudflare.com/.
2. Workers & Pages → R2 → **Create bucket**.
3. Bucket name: `highlights-thumbnails` (must match the binding in wrangler.toml).
4. Region/jurisdiction: leave as default.
5. Click Create.

- [ ] **Step 2: Enable public access**

1. Open the new `highlights-thumbnails` bucket.
2. Click **Settings**.
3. Find **Public access** (sometimes labeled "R2.dev subdomain") → click **Allow Access** / **Enable**.
4. Cloudflare displays a public URL of the form `https://pub-<hash>.r2.dev`. Copy it.

- [ ] **Step 3: Update `wrangler.toml` with the real URL**

Open `wrangler.toml`. In the `[vars]` block, replace the placeholder:

```toml
THUMBNAIL_PUBLIC_BASE_URL = "https://placeholder.r2.dev"
```

with the real URL Cloudflare gave you, e.g.:

```toml
THUMBNAIL_PUBLIC_BASE_URL = "https://pub-abc123def456.r2.dev"
```

(The exact hash will differ.)

- [ ] **Step 4: Commit**

```bash
git add wrangler.toml
git commit -m "chore: set THUMBNAIL_PUBLIC_BASE_URL to live R2 public URL"
```

---

### Task 6: Deploy and manually verify

**Files:** none (deploy + browser test)

- [ ] **Step 1: Deploy**

```bash
npm run deploy
```

Expected: clean deploy. Note the `Current Version ID:` in the output for traceability.

- [ ] **Step 2: Open the deployed editor**

In a browser:
1. Navigate to `https://highlights.kindacoach.com/`.
2. Sign in if needed.
3. Open a project that has photos in its playlist.

- [ ] **Step 3: Verify the thumbnail URL pattern in DevTools**

Open DevTools → Network → filter by "thumbnail" or "img".

1. Hard-refresh the editor.
2. Confirm the thumbnail requests are to URLs of the form `/api/orgs/.../thumbnail/<fileId>` — **not** the legacy `lh3.googleusercontent.com/drive-storage/...` URLs.
3. Click one of the thumbnail rows; confirm:
   - **First request:** Status `302`, with `location:` pointing at `https://pub-<hash>.r2.dev/<fileId>`.
   - **Second request** (auto-followed): Status `200`, content-type `image/jpeg` (or similar).

If the request returns 200 with image bytes (no 302), the deploy didn't pick up Task 3's changes — re-check version ID and redeploy.

- [ ] **Step 4: Verify R2 cold-fill**

In a separate terminal, run `npx wrangler tail highlights` while pressing refresh in the editor (a thumbnail not previously fetched will trigger cold-fill).

Expected log lines:
- `GET .../thumbnail/...` from the route.
- No "Worker exceeded CPU time limit" errors.
- No `[thumbnail] cold-fill failed` errors (those are from the `console.error` in the catch).

- [ ] **Step 5: Verify R2 hit (steady state)**

Refresh the editor again. In wrangler tail:
- Each `GET .../thumbnail/...` returns very quickly (microseconds inside the Worker — just R2 head + redirect).
- No CPU errors.

In Network tab, image requests may be served from disk cache entirely (browser cached the R2 response on first load).

- [ ] **Step 6: Verify thumbnails actually display**

Confirm that:
- The media browser on the left side of the editor shows photo thumbnails.
- Clicking a clip on the timeline shows that photo in the preview panel.
- No `ERR_BLOCKED_BY_ORB` errors in the console (the symptom we're fixing).
- No broken-image icons in the editor.

- [ ] **Step 7: Verify the renderer still works**

Click Export. Wait for the GitHub Actions render to finish; download the resulting MP4 from Drive. Confirm the photos display correctly in the rendered video. (The renderer pulls full-res images from Drive directly; this verifies we didn't accidentally break that path.)

- [ ] **Step 8: No commit** — this task is verification only.
