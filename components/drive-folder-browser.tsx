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
