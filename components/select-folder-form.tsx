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
