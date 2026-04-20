# Highlights — Design Spec
**Date:** 2026-04-20
**Status:** Approved

## Overview

A multi-tenant SaaS for creating end-of-year highlight videos for sports teams (initially soccer). Organizers connect a Google Drive folder per team, the system auto-sequences player photos chronologically, and users polish the playlist before triggering a render via GitHub Actions + FFmpeg. Output is written back to Google Drive.

---

## Architecture

```
Browser (Next.js 15)
    │
    ├─ Auth: NextAuth v5 + Google OAuth
    │
    ├─ Cloudflare Worker (API routes)
    │       ├─ D1 (SQLite) — all app state
    │       └─ R2 — audio upload fallback only
    │
    ├─ Google Drive API — images, audio, rendered MP4
    │
    └─ GitHub API (repository_dispatch)
            └─ GitHub Actions Runner
                    ├─ Downloads images from Drive
                    ├─ Downloads audio from Drive (or R2 fallback)
                    ├─ Runs FFmpeg → MP4
                    └─ Writes MP4 back to Drive, POSTs callback to Worker
```

**Render request flow:**
1. User finalizes playlist → clicks "Render"
2. Worker writes `render_jobs` row (pending), calls GitHub `repository_dispatch` with playlist, Drive token, callback URL
3. Actions downloads assets, runs FFmpeg, uploads MP4 to Drive, POSTs callback
4. Worker marks job complete in D1; browser polls every 5 seconds and shows playback link

---

## Data Model (D1)

| Table | Key Fields |
|-------|-----------|
| `users` | id, email, name, image |
| `accounts` | NextAuth OAuth accounts (Google) |
| `organizations` | id, name, slug, created_at |
| `organization_members` | org_id, user_id, role (owner/admin/member) |
| `teams` | id, org_id, name, created_at |
| `drive_connections` | id, team_id, user_id, folder_id, folder_name, access_token, refresh_token |
| `players` | id, team_id, name, folder_name |
| `projects` | id, team_id, name, status, images_per_player (default 4), seconds_per_image (default 3.5), audio_r2_key (nullable fallback) |
| `playlist_items` | id, project_id, player_id, drive_file_id, position, duration_override (nullable) |
| `render_jobs` | id, project_id, status (pending/running/complete/failed), github_run_id, output_drive_file_id, error_msg, created_at, completed_at |

**Multi-tenancy:** All resources are scoped through `org_id`. Every API route validates org membership before returning data.

---

## Google Drive Integration

### Connection
- Drive is connected **per team** (not per org) — each team has its own root Drive folder
- Connection requires two OAuth scopes: `drive.readonly` (read images/audio) + `drive.file` (write rendered MP4)
- Tokens stored in `drive_connections`; refresh token used to renew access automatically
- Any org admin can connect or reconnect a team's Drive

### Expected Drive folder structure
```
TeamRootFolder/
  PlayerName1/       ← subfolder name must match players.folder_name
    photo001.jpg
    photo002.jpg
  PlayerName2/
    ...
  01_opener.mp3      ← audio files at root level, played alphanumerically
  02_main.mp3
```

### Player discovery
- On Drive connect, system scans root folder subfolders and creates `players` records from subfolder names
- `players.folder_name` is the canonical link between app and Drive

### Auto-sequencing (at project creation)
1. For each player, list all image files in their subfolder
2. Fetch `imageMediaMetadata.time` (EXIF date) from Drive API — no download needed
3. Select N images per player (default 4), distributed evenly across the player's date range; if a player has fewer than N images, use all available
4. Merge all selected images across all players, sort chronologically by EXIF date
5. Write sorted list as `playlist_items` with sequential positions

### Audio discovery
- System scans the team root folder for `.mp3`, `.wav`, `.m4a` files
- Lists them alphanumerically — this is the audio playlist order
- If none found, user is prompted to upload an audio file via the app (stored in R2 as fallback)

---

## Playlist Editor

A drag-and-drop list of image cards in the current sequence. Each card shows:
- Thumbnail (from Drive `thumbnailLink` — no download needed)
- Player name + EXIF date
- Duration (project default, overridable per-image)
- Drag handle + remove button

**User actions:**
- Drag to reorder
- Remove an image
- Override duration on any image
- "Add images" — browse remaining Drive images not yet in the playlist
- "Re-sequence" — discard manual edits, re-run auto-sequencing
- "Render" — locks playlist, triggers GitHub Actions

**Auto-saves:** Every change immediately updates `playlist_items` positions in D1. No explicit save step.

**Music panel:** Shows audio files found in Drive (alphanumeric order) or upload prompt if none found.

---

## Render Pipeline (GitHub Actions)

**Triggered via:** `repository_dispatch` event with `client_payload` containing:
- Ordered list of `{ driveFileId, duration }` for each playlist item
- Ordered list of audio Drive file IDs
- Drive OAuth access token (both `drive.readonly` + `drive.file` scopes — needed for image/audio reads and MP4 write-back)
- Drive folder ID for output
- Render job ID + Worker callback URL

**Steps:**
1. Download images from Drive in playlist order
2. Download audio files from Drive in order (or R2 fallback URL)
3. FFmpeg: build slideshow with per-image durations and crossfade transitions
4. FFmpeg: concatenate audio, loop/trim to match total video duration, mix at comfortable level
5. Upload rendered MP4 to Drive team root folder
6. POST `{ jobId, driveFileId, status }` to Worker callback URL

**Expected render time:** 2–3 minutes for a 4–5 minute video on a standard GitHub Actions runner.

**On failure:** Actions POSTs `{ jobId, status: "failed", errorMsg }` to callback; user sees error and can re-trigger.

---

## Auth & Multi-tenancy

- **Sign-in:** Google OAuth via NextAuth v5
- **First sign-in:** User is prompted to create or join an org
- **Roles:** owner, admin, member — admins can manage teams/players/projects; members can view and trigger renders
- **Org invites:** Owner/admin invites by email; invitee signs in with Google to join
- **Data isolation:** Every Worker API route validates org membership before operating on any resource

---

## Storage Summary

| Asset | Storage |
|-------|---------|
| Source images | Google Drive (read) |
| Audio files | Google Drive (read, alphanumeric) |
| Audio fallback | R2 (user upload via app) |
| Rendered MP4 | Google Drive (app writes back) |
| Live playback | Stream from Drive URL |

---

## Output

- **Exported video:** MP4 written to team's Drive root folder, shareable directly from Drive
- **Live playback:** Streamed from Drive URL in the browser — suitable for banquet display
- **Typical duration:** 4–5 minutes for an 18–22 player team at 4 images/player × 3.5 sec/image

---

## Out of Scope for POC

- AI-assisted image selection or face recognition
- Spotify / Soundcloud / YouTube audio integration
- Local machine render script
- Dropbox, OneDrive, S3 storage sources
- In-app video clip trimming
- Soccer Clipper integration
