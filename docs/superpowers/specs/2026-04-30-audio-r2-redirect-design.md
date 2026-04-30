# Audio R2 Redirect Design Spec

**Date:** 2026-04-30
**Status:** Approved

## Overview

Take the Cloudflare Worker out of the audio byte-serving path. The audio route becomes a **lookup-and-redirect** route that returns a 302 pointing the browser at a public R2 URL. R2 holds a copy of each audio file, populated lazily on first request. The browser fetches audio bytes directly from R2's edge — the Worker is never in the byte path after the first warming.

This replaces the current architecture where every audio request goes through `app/api/orgs/.../audio/[fileId]/route.ts` and does NextAuth session validation, four D1 lookups, an OAuth refresh check, a Drive `alt=media` fetch, and a buffer of the response into Worker memory. Under sustained load (the browser's `<audio>` element issues many requests during normal playback and seeks), this exhausts the Worker's CPU budget and triggers Error 1102, which then cascades to other routes on the same isolate.

Scope is editor preview only. The renderer (`scripts/render.mjs`) keeps its current Drive download path. Image thumbnails are a separate group.

---

## Section 1: R2 Setup

### Bucket

Use the existing `highlights-audio` R2 bucket, already bound as `env.AUDIO_BUCKET` in `wrangler.toml`.

### Public access

Enable public access on the bucket (one-time, manual in the Cloudflare dashboard: R2 → highlights-audio → Settings → Public access → enable). Cloudflare exposes the bucket at `https://pub-<hash>.r2.dev`.

We use the default `pub-*.r2.dev` hostname for now. A custom domain (`audio.kindacoach.com`) is a future swap with no code change beyond the env var.

### Key naming

The R2 object key is the Drive file ID, used directly. Example: `1aEnyA-az2URamqYHclGLaFzpitROOY9D`.

- Drive file IDs are globally unique and immutable, so two projects referencing the same Drive audio file naturally deduplicate to one R2 object.
- A new upload of the same song produces a new Drive file ID → new R2 key. There's no stale-cache problem because files are never overwritten in place.

### New env var

Add to `wrangler.toml` under `[vars]`:

```toml
AUDIO_PUBLIC_BASE_URL = "https://pub-<bucket-hash>.r2.dev"
```

The hash gets filled in after enabling public access in the dashboard. Add the matching field to `types/cloudflare-env.d.ts`:

```ts
AUDIO_PUBLIC_BASE_URL: string
```

### Lifecycle

No cleanup. Orphaned R2 objects (files no longer referenced by any project) accumulate. R2 storage is ~$0.015/GB/month; for a coaching tool with on the order of 100 audio files at ~5MB each, that's pennies per month. Not worth automating.

---

## Section 2: Audio Route

`app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/[fileId]/route.ts` becomes:

```ts
export async function GET(_req: Request, { params }: Params) {
  // 1. Auth checks (unchanged from current route)
  const session = await requireSession()
  const { orgSlug, teamId, projectId, fileId } = await params
  const db = getDb()
  // ... org / member / team / project lookups, return 404/403 on miss ...

  const env = getCloudflareContext().env

  // 2. Fast path — file already in R2
  const exists = await env.AUDIO_BUCKET.head(fileId)
  if (exists) {
    return Response.redirect(`${env.AUDIO_PUBLIC_BASE_URL}/${fileId}`, 302)
  }

  // 3. Cold path — warm R2 from Drive (once per file, ever)
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  let accessToken = conn.accessToken
  const expiresAtMs = conn.expiresAt ? conn.expiresAt.getTime() : 0
  if (!accessToken || expiresAtMs < Date.now() + 60_000) {
    const tokenData = await refreshDriveToken(conn.refreshToken)
    accessToken = tokenData.accessToken
    await db.update(driveConnections)
      .set({ accessToken, expiresAt: new Date(tokenData.expiresAt) })
      .where(eq(driveConnections.id, conn.id))
  }

  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!driveRes.ok) return NextResponse.json({ error: 'Drive fetch failed' }, { status: 502 })

  await env.AUDIO_BUCKET.put(fileId, driveRes.body, {
    httpMetadata: {
      contentType: driveRes.headers.get('content-type') ?? 'audio/mpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })

  // 4. Same redirect as the fast path
  return Response.redirect(`${env.AUDIO_PUBLIC_BASE_URL}/${fileId}`, 302)
}
```

### Per-request cost

**Steady state (R2 hit):** auth queries + one `R2Bucket.head()` call (Cloudflare-internal, microseconds) + return a 302. No Drive call, no buffer, no streaming. The Worker never touches the audio bytes after the first warming.

**Cold-fill (R2 miss, once per file ever):** auth + Drive fetch + R2 put + 302. Comparable cost to today's per-request cost, but happens at most once per Drive file ID across all sessions.

### Browser side

`<audio src="/api/.../audio/<id>">` triggers a request to the route, gets 302, browser follows to the R2 URL, R2 responds with the audio file. R2's response carries its own `Cache-Control: public, max-age=31536000, immutable` (set in the `put()` call), so the browser caches the bytes aggressively. Subsequent plays of the same file = browser cache hit; R2 isn't even contacted.

### Race conditions

Two simultaneous requests for a cold file: both fetch from Drive, both PUT to R2. Last write wins, bytes are identical (Drive file IDs are immutable), no correctness issue. Wasteful but not worth a lock at this scale.

### What the route loses

Compared to the current code, drop:
- `arrayBuffer()` buffering of the Drive response.
- The Range-stripping logic.
- Setting `Content-Type` / `Content-Length` / `Cache-Control` on a bytes response.

What stays:
- All four auth checks.
- The OAuth-skip-when-valid logic from `e54283d` (still needed for the cold-fill path).

---

## Section 3: Preview-Panel and Existing Workarounds

No changes required. The 302 redirect is transparent to the HTML5 `<audio>` element. All the work already on `main` (`sourceIn` handling, drift correction removal, throttled `play()` retries, probe `<audio>` release) stays as-is and benefits from R2.

The `probeAudioDuration` helper in `editor.tsx` continues to work. Its first probe of a given file will trigger the R2 cold-fill (since it sets `audio.src` and waits for `loadedmetadata`); subsequent probes hit the cached promise and don't re-fetch.

---

## Section 4: Manual One-Time Setup

1. Cloudflare dashboard → R2 → highlights-audio → Settings → enable public access.
2. Copy the resulting `https://pub-<hash>.r2.dev` URL.
3. Set `AUDIO_PUBLIC_BASE_URL` in `wrangler.toml` to that URL.
4. Deploy.

If the public URL ever needs to change (e.g., custom domain), it's a one-line change in `wrangler.toml` plus a redeploy.

---

## Section 5: Testing

### New unit tests

Create `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/[fileId]/route.test.ts`. Mirror the patterns in the existing `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/route.test.ts` for mocking DB and Drive; add a small mock for the R2 binding.

Cases:
- **R2 hit** — `AUDIO_BUCKET.head()` resolves to a non-null value. Route returns 302 to `${AUDIO_PUBLIC_BASE_URL}/${fileId}`. No Drive fetch, no `put()` call.
- **R2 miss → Drive fetch succeeds** — `head()` returns `null`. Route fetches from Drive, calls `AUDIO_BUCKET.put()` with the response body and `cacheControl: 'public, max-age=31536000, immutable'`, returns 302.
- **R2 miss → Drive fetch fails (non-ok response)** — route returns 502. No `put()` call.
- **No Drive connection on the team** — route returns 400 before any R2 or Drive activity.

The R2 binding mocks as a small object with `head()` and `put()` methods. We don't verify R2's actual storage behavior — only that we call the right methods with the right arguments.

### Existing tests

The parent `/audio/route.test.ts` (the listing route) is unaffected; should stay green.

### Manual verification on deploy

1. Deploy. Open the editor for a project that has audio.
2. Press play.
3. **Network tab:** the audio request shows status **302** with a `location:` header pointing at the R2 public URL. The followed request to R2 is a **200** with the audio bytes.
4. **wrangler tail:** the audio route fires once per audio file (R2 cold-fill on first ever play), then is silent on subsequent plays of the same file. **No CPU exceeded errors**, no streaming hangs.
5. **Audio plays through cleanly.** No stutter, no meltdown.
6. **Render verification:** trigger a render. `render.mjs` still pulls from Drive — confirm the resulting MP4 has audio.

No load test required; the architectural change makes the bug impossible by design (Worker isn't in the byte path), so a smoke test confirms.

---

## Files

**Modified:**
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/[fileId]/route.ts` — replace buffer-and-serve with R2 lookup + 302; keep auth checks + OAuth-skip logic; add cold-fill from Drive on miss.
- `wrangler.toml` — add `AUDIO_PUBLIC_BASE_URL` under `[vars]`.
- `types/cloudflare-env.d.ts` — add `AUDIO_PUBLIC_BASE_URL: string` to `CloudflareEnv`.

**New:**
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/audio/[fileId]/route.test.ts` — four happy/error path tests.

---

## Out of Scope

- **Image thumbnails on Drive** — separate group. Same architectural pattern can apply later.
- **Renderer migration to R2** — `scripts/render.mjs` keeps its current Drive download path.
- **Eager pre-population** — files are copied to R2 on first play, not on project creation or upload.
- **Signed R2 URLs** — public bucket only.
- **Custom domain for R2** — using Cloudflare's default `pub-*.r2.dev`.
- **Lifecycle / eviction** — orphaned R2 objects accumulate; storage cost is negligible at this scale.
- **Concurrent cold-fill locking** — accepted race; content is deterministic by file ID.
- **Cache invalidation on Drive file change** — Drive file IDs are immutable; new uploads produce new IDs.
- **Editor UX for "audio failed to load"** — falls back to existing error handling in preview-panel.
