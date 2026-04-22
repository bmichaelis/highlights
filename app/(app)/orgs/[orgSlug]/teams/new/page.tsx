'use client'
import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function NewTeamPage() {
  const router = useRouter()
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const [name, setName] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/orgs/${orgSlug}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return
    const team = await res.json() as { id: string }
    router.push(`/orgs/${orgSlug}/teams/${team.id}`)
  }

  return (
    <main className="max-w-md mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-bold">New Team</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="U16 Girls" className="w-full border rounded-lg px-4 py-2" required />
        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg">
          Create Team
        </button>
      </form>
    </main>
  )
}
