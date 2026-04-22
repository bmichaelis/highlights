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
  const [folderUrl, setFolderUrl] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function parseFolderId(input: string): string | null {
    const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    if (urlMatch) return urlMatch[1]
    if (/^[a-zA-Z0-9_-]{10,}$/.test(input.trim())) return input.trim()
    return null
  }

  async function handleUrlInput(value: string) {
    const parsed = parseFolderId(value)
    if (!parsed) { setError('Paste a valid Google Drive folder URL or ID.'); return }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/drive/folder-info?id=${parsed}`)
      if (!res.ok) { setError('Could not access that folder.'); return }
      const data = await res.json() as { id: string; name: string }
      setFolderId(data.id)
      setFolderName(data.name)
      setFolderUrl('')
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
              <div className="flex gap-2">
                <input
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="flex-1 border rounded-lg px-3 py-2 text-sm"
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    await handleUrlInput(folderUrl)
                  }}
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleUrlInput(folderUrl)}
                  className="bg-gray-100 border px-3 py-2 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50"
                >
                  {loading ? '…' : 'Set'}
                </button>
              </div>
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
