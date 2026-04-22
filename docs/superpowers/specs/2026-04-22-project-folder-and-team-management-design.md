# Project Folder & Team Management Design

## Goal

Move Drive folder selection from the team level to the project level (each project has its own folder and its own player list), and add team rename/delete functionality.

## Context

Currently:
- `driveConnections` stores both OAuth tokens AND a folder selection per team
- `players` are scoped to a team and shared across all projects
- A team must select a Drive folder before any project can be created
- There is no way to rename or delete a team

After this change:
- `driveConnections` stores only OAuth tokens (pure access layer)
- Each project selects its own Drive folder during creation
- `players` are scoped to a project (one player list per project)
- Teams can be renamed or deleted

## Schema Changes

### `projects` table
Add two nullable columns:
- `folderId text` — Google Drive folder ID for this project
- `folderName text` — Display name of the folder

### `players` table
Replace `teamId` (FK to teams) with `projectId` (FK to projects). Existing player data is dropped in the migration (safe at this stage — no production data).

### `driveConnections` table
Remove `folderId` and `folderName` columns. The table becomes pure OAuth token storage: `accessToken`, `refreshToken`, `expiresAt` only.

A new Drizzle migration file handles all three changes.

## Team Management

### API

New route file: `app/api/orgs/[orgSlug]/teams/[teamId]/route.ts`

**PATCH** — rename team
- Body: `{ name: string }`
- Requires: authenticated session + admin role
- Updates `teams.name` for the given teamId
- Returns updated team as JSON

**DELETE** — delete team
- Requires: authenticated session + admin role
- Cascades: deletes driveConnections, projects, players, playlistItems, renderJobs for this team
- Returns 204 No Content

Cascade order matters (FK constraints): playlistItems → players, renderJobs → projects → driveConnections → team.

### UI (team page)

- Team name displayed as heading with a small "Edit" button beside it
- Clicking "Edit" swaps the heading for an inline text input + Save/Cancel buttons; on Save calls PATCH
- A "Delete team" button at the bottom of the page, styled destructively (red outline)
- Clicking "Delete team" shows a confirmation: "This will permanently delete [team name] and all its projects. This cannot be undone." with Cancel and Delete buttons; on confirm calls DELETE then redirects to `/orgs/[orgSlug]`

## Project Folder Integration

### Project Creation

The project creation form at `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/new/page.tsx` gains a folder selection section below the existing name/settings fields. It reuses the `DriveFolderBrowser` component and URL paste input (same pattern as the old team-level folder form). Folder selection is required before submitting.

**`POST /api/orgs/[orgSlug]/teams/[teamId]/projects`** updated:
- Accepts `folderId: string` and `folderName: string` in the request body (both required)
- Stores `folderId`/`folderName` on the new project record
- Passes the project's `folderId` (not the team's drive connection folder) to `buildPlaylist()`
- Creates `players` records with `projectId` (not `teamId`)
- Team-level drive connection must still exist (OAuth required to call Drive API)
- The `folderId === 'PENDING'` state is removed — drive connections no longer have a pending state

### Drive Connection UI (team page simplification)

- Remove `SelectFolderForm` from the team page
- The Drive section shows only: "Connected: [account info or checkmark]" when a drive connection exists, or the "Connect Google Drive" button when it doesn't
- The `PENDING` folder state is eliminated

### Auto-Sequencer

`buildPlaylist()` (in `lib/drive/sequencer.ts` or equivalent) receives `folderId` from the project record, not from `driveConnections`. The function signature change: accept `folderId` explicitly rather than looking it up from the team's connection.

## Change Folder After Creation

### API

New route: `PATCH /api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/folder`

- Body: `{ folderId: string, folderName: string }`
- Requires: authenticated session + org membership
- Steps (in a single operation):
  1. Update `projects.folderId` and `projects.folderName`
  2. Delete all `playlistItems` for this project
  3. Delete all `players` for this project
  4. Re-run `buildPlaylist()` with the new folder
- Returns updated project as JSON

### UI (project detail page)

- "Change folder" button on the project detail page
- Clicking opens the `DriveFolderBrowser` / URL input (same component as creation)
- After the user selects a folder, a confirmation modal appears: "This will delete your current playlist and re-scan the new folder. This cannot be undone. Continue?"
- On confirm: calls `PATCH .../folder`, page refreshes showing updated playlist
- On cancel: modal closes, nothing changes

## Files

**New:**
- `app/api/orgs/[orgSlug]/teams/[teamId]/route.ts` — PATCH (rename) + DELETE (delete team)
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/folder/route.ts` — PATCH (change folder + re-sequence)
- `db/migrations/0001_project_folder_player_project.sql` — schema migration

**Modified:**
- `db/schema.ts` — schema changes to projects, players, driveConnections
- `app/api/orgs/[orgSlug]/teams/[teamId]/projects/route.ts` — accept folderId/folderName, update buildPlaylist call
- `app/(app)/orgs/[orgSlug]/teams/[teamId]/page.tsx` — simplify drive section, add rename/delete UI
- `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/new/page.tsx` — add folder selection to creation form
- `app/(app)/orgs/[orgSlug]/teams/[teamId]/projects/[projectId]/page.tsx` — add "Change folder" button + confirmation
- `lib/drive/sequencer.ts` — accept folderId from project instead of reading from driveConnections
