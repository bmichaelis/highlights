'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = { orgSlug: string; teamId: string; teamName: string }

export function TeamManagement({ orgSlug, teamId, teamName }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(teamName)
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) { setError('Failed to rename team.'); return }
      setEditing(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}`, { method: 'DELETE' })
      if (!res.ok) { setError('Failed to delete team.'); return }
      router.push(`/orgs/${orgSlug}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-2">
      {editing ? (
        <form onSubmit={handleRename} className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded-lg px-3 py-1 text-xl font-bold flex-1"
            autoFocus
            required
          />
          <button type="submit" disabled={saving}
            className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setName(teamName) }}
            className="text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{teamName}</h1>
          <button onClick={() => setEditing(true)}
            className="text-sm text-blue-600 hover:underline">
            Edit
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-semibold">Delete team?</h2>
            <p className="text-sm text-gray-600">
              This will permanently delete <strong>{teamName}</strong> and all its projects. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDelete(false)}
                className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <button onClick={() => setShowDelete(true)}
          className="text-sm text-red-600 border border-red-200 px-3 py-1 rounded-lg hover:bg-red-50">
          Delete team
        </button>
      </div>
    </div>
  )
}
