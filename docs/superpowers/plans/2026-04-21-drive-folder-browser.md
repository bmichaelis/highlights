# Drive Folder Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app Google Drive folder browser modal so users can navigate and select a Drive folder without leaving the app.

**Architecture:** New API endpoint lists Drive subfolders server-side using the stored token. A new `DriveFolderBrowser` modal component handles navigation with breadcrumbs. `SelectFolderForm` gains a "Browse Drive" button that opens the modal; both the modal and the existing URL input converge on the same PATCH call to save the selection.

**Tech Stack:** Next.js 15 App Router, React (client components), Google Drive API v3, Drizzle ORM + D1, Tailwind CSS

---

## File Map

- **Create:** `app/api/orgs/[orgSlug]/teams/[teamId]/drive/folders/route.ts` — lists Drive folders for a given parentId
- **Create:** `components/drive-folder-browser.tsx` — modal folder browser component
- **Modify:** `components/select-folder-form.tsx` — add "Browse Drive" button + modal state

---

### Task 1: Drive Folders API Endpoint

**Files:**
- Create: `app/api/orgs/[orgSlug]/teams/[teamId]/drive/folders/route.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/orgs/[orgSlug]/teams/[teamId]/drive/folders/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('GET /drive/folders', () => {
  it('exports a GET handler', async () => {
    const mod = await import('./route')
    expect(typeof mod.GET).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run app/api/orgs/\\[orgSlug\\]/teams/\\[teamId\\]/drive/folders/route.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the route file**

Create `app/api/orgs/[orgSlug]/teams/[teamId]/drive/folders/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getFreshAccessToken } from '@/lib/drive/auth'
import { listFolderContents, parseDriveFiles } from '@/lib/drive/scanner'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const { searchParams } = new URL(req.url)
  const parentId = searchParams.get('parentId') ?? 'root'

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  const accessToken = await getFreshAccessToken(conn, db)
  const files = await listFolderContents(parentId, accessToken)
  const folders = parseDriveFiles(files)

  return NextResponse.json({ folders })
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run app/api/orgs/\\[orgSlug\\]/teams/\\[teamId\\]/drive/folders/route.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/orgs/\\[orgSlug\\]/teams/\\[teamId\\]/drive/folders/route.ts app/api/orgs/\\[orgSlug\\]/teams/\\[teamId\\]/drive/folders/route.test.ts
git commit -m "feat: add drive folders listing API endpoint"
```

---

### Task 2: DriveFolderBrowser Component

**Files:**
- Create: `components/drive-folder-browser.tsx`

- [ ] **Step 1: Create the component**

Create `components/drive-folder-browser.tsx`:

```tsx
'use client'
import { useState, useEffect, useCallback } from 'react'

type Folder = { id: string; name: string }
type BreadcrumbItem = { id: string; name: string }

type Props = {
  orgSlug: string
  teamId: string
  onSelect: (id: string, name: string) => void
  onClose: () => void
}

export function DriveFolderBrowser({ orgSlug, teamId, onSelect, onClose }: Props) {
  const [stack, setStack] = useState<BreadcrumbItem[]>([{ id: 'root', name: 'My Drive' }])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = stack[stack.length - 1]

  const fetchFolders = useCallback(async (parentId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/orgs/${orgSlug}/teams/${teamId}/drive/folders?parentId=${parentId}`
      )
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setError(body.error ?? 'Failed to load folders')
        return
      }
      const data = await res.json() as { folders: Folder[] }
      setFolders(data.folders)
    } catch {
      setError('Failed to load folders')
    } finally {
      setLoading(false)
    }
  }, [orgSlug, teamId])

  useEffect(() => {
    fetchFolders('root')
  }, [fetchFolders])

  function navigateTo(folder: Folder) {
    setStack((prev) => [...prev, { id: folder.id, name: folder.name }])
    fetchFolders(folder.id)
  }

  function navigateToBreadcrumb(index: number) {
    const item = stack[index]
    setStack((prev) => prev.slice(0, index + 1))
    fetchFolders(item.id)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white max-w-lg w-full rounded-xl shadow-xl flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b">
          <h2 className="text-lg font-semibold mb-3">Browse Google Drive</h2>
          {/* Breadcrumbs */}
          <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
            {stack.map((item, i) => (
              <span key={item.id} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={i === stack.length - 1
                    ? 'font-medium text-gray-900 cursor-default'
                    : 'hover:text-blue-600 hover:underline'}
                  disabled={i === stack.length - 1}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </nav>
        </div>

        {/* Folder list */}
        <div className="overflow-y-auto flex-1 px-6 py-3">
          {loading && (
            <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
          )}
          {!loading && error && (
            <p className="text-sm text-red-600 py-4">{error}</p>
          )}
          {!loading && !error && folders.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">No folders here.</p>
          )}
          {!loading && !error && folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => navigateTo(folder)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 text-left text-sm"
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                {folder.name}
              </span>
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-between items-center">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(current.id, current.name)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
          >
            Select "{current.name}"
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors in `drive-folder-browser.tsx`

- [ ] **Step 3: Commit**

```bash
git add components/drive-folder-browser.tsx
git commit -m "feat: add DriveFolderBrowser modal component"
```

---

### Task 3: Wire Browser into SelectFolderForm

**Files:**
- Modify: `components/select-folder-form.tsx`

- [ ] **Step 1: Update the component**

Replace the contents of `components/select-folder-form.tsx` with:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DriveFolderBrowser } from './drive-folder-browser'

type Props = { orgSlug: string; teamId: string }

function parseFolderId(input: string): string | null {
  const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (urlMatch) return urlMatch[1]
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input.trim())) return input.trim()
  return null
}

export function SelectFolderForm({ orgSlug, teamId }: Props) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBrowser, setShowBrowser] = useState(false)

  async function saveFolder(folderId: string, folderName: string) {
    setLoading(true)
    setError(null)
    try {
      const patchRes = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/drive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, folderName }),
      })
      if (!patchRes.ok) {
        setError('Failed to save folder.')
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const folderId = parseFolderId(url)
    if (!folderId) {
      setError('Paste a Google Drive folder URL or folder ID.')
      return
    }
    setLoading(true)
    try {
      const infoRes = await fetch(
        `/api/orgs/${orgSlug}/teams/${teamId}/drive/folder-info?id=${folderId}`
      )
      if (!infoRes.ok) {
        const body = await infoRes.json() as { error?: string }
        setError(body.error ?? 'Could not access that folder.')
        return
      }
      const { name } = await infoRes.json() as { id: string; name: string }
      await saveFolder(folderId, name)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {showBrowser && (
        <DriveFolderBrowser
          orgSlug={orgSlug}
          teamId={teamId}
          onSelect={async (id, name) => {
            setShowBrowser(false)
            await saveFolder(id, name)
          }}
          onClose={() => setShowBrowser(false)}
        />
      )}

      <div className="mt-3 space-y-3">
        <button
          type="button"
          onClick={() => setShowBrowser(true)}
          className="w-full border-2 border-dashed border-blue-300 text-blue-600 py-2 rounded-lg text-sm hover:border-blue-500 hover:bg-blue-50 transition-colors"
        >
          Browse Drive folders
        </button>

        <p className="text-xs text-gray-400 text-center">or paste a folder URL</p>

        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            className="w-full border rounded-lg px-3 py-2 text-sm"
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Set Folder'}
          </button>
        </form>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add components/select-folder-form.tsx
git commit -m "feat: add Browse Drive button to folder selection form"
```

---

### Task 4: Deploy and Verify

- [ ] **Step 1: Build**

```bash
npx @cloudflare/next-on-pages
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Deploy**

```bash
npx wrangler deploy
```

Expected: Deployment URL printed.

- [ ] **Step 3: Manual smoke test**

1. Navigate to a team that has Drive connected with `folderId = 'PENDING'`
2. Confirm "Browse Drive folders" button appears above the URL input
3. Click it — modal opens, shows folders from My Drive
4. Navigate into a subfolder — breadcrumb updates, subfolder contents load
5. Click a breadcrumb item — navigates back up
6. Click "Select …" — modal closes, team page refreshes, folder name shown as connected
7. Confirm the URL paste path still works end-to-end

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: <describe what was fixed>"
```
