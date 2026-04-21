# Drive Folder Browser Design

## Goal

Allow users to browse and select a Google Drive folder from within the app using a modal folder browser, instead of (or in addition to) pasting a folder URL.

## Context

When a team connects Google Drive, they land in a "Pending folder selection" state. Currently, `SelectFolderForm` shows a URL/ID input field. We're adding a "Browse Drive" button that opens an in-app modal so users can navigate their Drive folder hierarchy and select the right folder.

Both the browser and the URL input remain available.

## Architecture

### New API endpoint

`GET /api/orgs/[orgSlug]/teams/[teamId]/drive/folders?parentId=root`

- Authenticated via session + org membership check (same pattern as `folder-info` route)
- Reads the stored Drive connection for the team, refreshes the access token if needed
- Calls Google Drive API: `files.list` with query `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
- Returns `{ folders: [{ id: string, name: string }] }`
- `parentId` defaults to `"root"` if not provided

### New component: `DriveFolderBrowser`

Client component. Props: `orgSlug: string`, `teamId: string`, `onSelect: (id: string, name: string) => void`, `onClose: () => void`.

State:
- `stack: { id: string; name: string }[]` — navigation breadcrumb (starts with `[{ id: 'root', name: 'My Drive' }]`)
- `folders: { id: string; name: string }[]` — current folder's children
- `loading: boolean`
- `error: string | null`

Behavior:
- On mount: fetches folders for `parentId=root`
- Click a folder: pushes to stack, fetches its children
- Click a breadcrumb: slices stack back to that level, fetches
- "Select this folder" button: calls `onSelect(currentFolder.id, currentFolder.name)` with the current top of stack
- Shows spinner while loading, error message on failure

UI layout:
- Full-screen modal overlay (`fixed inset-0 bg-black/40 flex items-center justify-center z-50`)
- White panel `max-w-lg w-full rounded-xl shadow-xl p-6`
- Breadcrumb row at top (clickable items separated by `/`)
- Scrollable list of folders below (each with a folder icon and arrow)
- Footer row: "Cancel" (calls `onClose`) and "Select this folder" (always enabled — user can select any level including My Drive root)

### Updated `SelectFolderForm`

Adds a "Browse Drive" button above the existing URL input that opens `DriveFolderBrowser` in a modal. When `onSelect` fires, it calls the existing PATCH `/api/orgs/[orgSlug]/teams/[teamId]/drive` endpoint and then calls `router.refresh()`. On success, both the modal and the form are no longer needed (the team page re-renders showing the selected folder name).

## Data Flow

```
User clicks "Browse Drive"
  → DriveFolderBrowser mounts, fetches /drive/folders?parentId=root
  → Renders folder list
User clicks a folder
  → Pushes to breadcrumb stack, fetches /drive/folders?parentId=<id>
  → Renders subfolder list
User clicks "Select this folder"
  → SelectFolderForm calls PATCH /drive { folderId, folderName }
  → router.refresh()
  → Team page re-renders: "Connected: <folder name>"
```

## Error Handling

- API returns 400 if `parentId` is missing (though client always sends it)
- API returns 403 if user is not an org member
- API returns 400 if Drive is not connected for this team
- Client shows inline error message; user can retry or dismiss

## Files

- **Create:** `app/api/orgs/[orgSlug]/teams/[teamId]/drive/folders/route.ts`
- **Create:** `components/drive-folder-browser.tsx`
- **Modify:** `components/select-folder-form.tsx`
