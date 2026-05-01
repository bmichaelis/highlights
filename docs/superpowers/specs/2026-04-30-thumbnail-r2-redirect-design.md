# Thumbnail R2 Redirect Design Spec

**Date:** 2026-04-30
**Status:** Approved

## Overview

Image thumbnails currently load directly from Drive's CDN at `lh3.googleusercontent.com/drive-storage/...`. Those URLs are signed with a short-lived signature; once they expire (~1 hour), Drive returns an HTML error page instead of an image, and Chrome's Opaque Response Blocking rejects the response with `ERR_BLOCKED_BY_ORB`. Thumbnails silently break after a project sits idle.

This spec applies the same R2 redirect pattern just shipped for audio: a new thumbnail route returns a 302 to a public R2 URL; R2 holds a copy of each Drive thumbnail, populated lazily on first request. Server-side endpoints substitute the new route URL into `thumbnailUrl` fields they return; the legacy DB column stays as-is and is functionally ignored.

Two key differences from the audio architecture:
1. **Cold-fill needs two Drive calls.** Drive's thumbnail bytes live behind signed URLs, not the `alt=media` endpoint. The route does `files.get?fields=thumbnailLink` to obtain a fresh signed URL, then fetches that URL.
2. **No DB migration.** `playlistItems.thumbnailUrl` keeps its existing values; reads override them at the API layer.

The existing audio R2 architecture is unchanged.

---

## Section 1: R2 Setup

### Bucket

A new R2 bucket: `highlights-thumbnails`. Audio stays in `highlights-audio` to keep buckets honestly named.

In `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "THUMBNAIL_BUCKET"
bucket_name = "highlights-thumbnails"
```

### Public access

Enable public access on the bucket (one-time, manual: Cloudflare dashboard → R2 → highlights-thumbnails → Settings → Public access → enable). Cloudflare exposes the bucket at `https://pub-<hash>.r2.dev`.

### Key naming

The Drive file ID, used directly as the R2 object key. Same pattern as audio:
- Drive file IDs are globally unique, so there's no collision with the audio bucket (and audio is in a separate bucket anyway).
- A new upload of the same image produces a new Drive file ID, so cache staleness is impossible.

### New env var

```toml
THUMBNAIL_PUBLIC_BASE_URL = "https://pub-<bucket-hash>.r2.dev"
```

Set after the bucket is made public. Add matching fields to `types/cloudflare-env.d.ts`:

```ts
THUMBNAIL_BUCKET: R2Bucket
THUMBNAIL_PUBLIC_BASE_URL: string
```

### Lifecycle

None. R2 storage is ~$0.015/GB/month; thumbnails are ~30KB each; orphans accumulate but cost is negligible.

---

## Section 2: Thumbnail Route

New route at `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.ts`:

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

  // Cold path — fetch a fresh thumbnailLink, fetch the bytes, write to R2.
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

### Per-request cost

**Steady state (R2 hit):** auth queries + `R2Bucket.head()` + 302. Microseconds.

**Cold-fill (once per thumbnail ever):** auth + Drive metadata call + Drive thumbnail fetch + R2 put + 302. ~200–500ms total.

### Browser side

`<img src="/api/.../thumbnail/<id>">` triggers a request to the route, gets 302, browser follows to R2's edge. R2 returns the bytes with `Cache-Control: public, max-age=31536000, immutable`, so the browser caches aggressively. Subsequent renders of the same thumbnail = browser cache hit; R2 isn't even contacted.

### Race conditions

Two simultaneous requests for a cold-cache thumbnail: both fetch + PUT to R2. Last write wins, content is byte-equivalent (same Drive file ID, same thumbnail), no correctness issue.

### Drive-failure handling

The cold-fill `catch` logs via `console.error` so production triage doesn't have to guess between auth, metadata, fetch, and R2 failures. Same convention as the audio route's recent follow-up.

---

## Section 3: URL Substitution at Read Endpoints

A small helper, applied at the two read points that surface `thumbnailUrl` to clients. Writes (project create, playlist create, folder change) are unchanged — the legacy `thumbnailUrl` column keeps storing whatever Drive returns. Reads override.

### Helper

`lib/thumbnail-url.ts`:

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

Single source of truth for the URL pattern. Trivially unit-testable.

### Read point 1 — `/playlist` GET

In `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts`, substitute `thumbnailUrl` on each row before returning:

```ts
return NextResponse.json(rows.map(r => ({
  ...r,
  thumbnailUrl: thumbnailRouteUrl(orgSlug, teamId, projectId, r.driveFileId),
})))
```

### Read point 2 — project page server query

In `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx`, do the same substitution before passing `playlistItems` into the `Editor` component:

```ts
const items = (await db.select(...).from(playlistItems)...).map(r => ({
  ...r,
  thumbnailUrl: thumbnailRouteUrl(orgSlug, teamId, projectId, r.driveFileId),
}))
```

### Components are untouched

`MediaBrowser`, `PreviewPanel`, `Editor`, `image-card`, drag-ghost in `Editor` — all just consume the `thumbnailUrl` they receive. Whether it points at Drive or our route is opaque to them.

---

## Section 4: Manual One-Time Setup

1. Cloudflare dashboard → R2 → **Create bucket** named `highlights-thumbnails`.
2. Same bucket → Settings → enable public access.
3. Copy the `https://pub-<hash>.r2.dev` URL.
4. Set `THUMBNAIL_PUBLIC_BASE_URL` in `wrangler.toml` to that URL.
5. Deploy.

---

## Section 5: Testing

### `lib/thumbnail-url.test.ts` (new)

Pure-function unit test:
- `thumbnailRouteUrl('org', 'team', 'proj', 'fid')` returns `'/api/orgs/org/teams/team/projects/proj/thumbnail/fid'`.

### `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.test.ts` (new)

Smoke test only, matching the project's existing API-route convention:
- `expect(typeof mod.GET).toBe('function')`.

### Manual verification on deploy

1. Hard-refresh the editor for a project with photos.
2. **Network tab:** thumbnail requests show `/api/orgs/.../thumbnail/<id>` URLs — not the legacy `lh3.googleusercontent.com` URLs.
3. First visit per thumbnail: route returns 302; followed request to R2 returns 200 with image bytes (cold-fill).
4. Second visit (refresh): browser cache hit; minimal network activity.
5. **No `ERR_BLOCKED_BY_ORB` errors** in the console.
6. **wrangler tail:** route fires once per thumbnail on cold-fill, silent thereafter. No CPU errors.

---

## Files

**Modified:**
- `wrangler.toml` — add `[[r2_buckets]] THUMBNAIL_BUCKET` block; add `THUMBNAIL_PUBLIC_BASE_URL` under `[vars]`.
- `types/cloudflare-env.d.ts` — add `THUMBNAIL_BUCKET: R2Bucket` and `THUMBNAIL_PUBLIC_BASE_URL: string`.
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/playlist/route.ts` — substitute `thumbnailUrl` in GET response.
- `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx` — substitute `thumbnailUrl` in server query before passing to Editor.

**New:**
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.ts` — R2 lookup + Drive cold-fill + 302.
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/thumbnail/[fileId]/route.test.ts` — smoke test.
- `lib/thumbnail-url.ts` — URL builder helper.
- `lib/thumbnail-url.test.ts` — unit test.

---

## Out of Scope

- **Migration of existing `playlistItems.thumbnailUrl` values.** Stays as-is in D1; reads ignore. Column can be dropped later as cleanup.
- **Eager pre-population at project creation.** Lazy-fill only.
- **Multiple thumbnail sizes.** One size only (Drive's default `thumbnailLink` ~220px). The renderer pulls full-res from Drive directly and doesn't touch R2.
- **Renderer migration to R2 for thumbnails.** Renderer doesn't use thumbnails; no change.
- **Custom domain for `THUMBNAIL_PUBLIC_BASE_URL`.** Default `pub-*.r2.dev` only.
- **Lifecycle / eviction.** Orphans accumulate; storage cost is negligible.
- **Concurrent cold-fill locking.** Race accepted.
- **`<img onerror>` fallback in components.** Not needed; R2 URLs don't expire.
