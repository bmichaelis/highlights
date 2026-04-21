'use client'
import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function NewProjectPage() {
  const router = useRouter()
  const { orgSlug, teamId } = useParams<{ orgSlug: string; teamId: string }>()
  const [name, setName] = useState('')
  const [imagesPerPlayer, setImagesPerPlayer] = useState(4)
  const [secondsPerImage, setSecondsPerImage] = useState(3.5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, imagesPerPlayer, secondsPerImage }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? 'Failed to create project. Make sure Google Drive is connected.')
        return
      }
      const project = await res.json()
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
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded-lg disabled:opacity-50">
          {loading ? 'Creating & sequencing…' : 'Create Project'}
        </button>
      </form>
    </main>
  )
}
