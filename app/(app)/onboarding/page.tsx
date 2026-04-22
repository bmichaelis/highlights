'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function OnboardingPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { setError('Failed to create organization'); return }
    const org = await res.json() as { slug: string }
    router.push(`/orgs/${org.slug}`)
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="max-w-md w-full p-8 space-y-4">
        <h1 className="text-2xl font-bold">Create an organization</h1>
        <form onSubmit={handleCreate} className="space-y-4">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Springfield Soccer Club" className="w-full border rounded-lg px-4 py-2" required />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg">
            Create Organization
          </button>
        </form>
        <p className="text-center text-sm text-gray-500">
          <Link href="/" className="text-blue-600 hover:underline">Back to dashboard</Link>
        </p>
      </div>
    </main>
  )
}
