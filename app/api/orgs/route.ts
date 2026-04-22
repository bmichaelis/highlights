import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { organizations, organizationMembers } from '@/db/schema'
import { requireSession, slugify } from '@/lib/auth-helpers'
import { eq } from 'drizzle-orm'

export async function POST(req: Request) {
  const session = await requireSession()
  const { name } = await req.json() as { name?: string }
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const db = getDb()
  const baseSlug = slugify(name)
  let slug = baseSlug
  let suffix = 1
  while (true) {
    const existing = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })
    if (!existing) break
    slug = `${baseSlug}-${suffix++}`
  }

  const [org] = await db.insert(organizations).values({ name: name.trim(), slug }).returning()
  await db.insert(organizationMembers).values({ orgId: org.id, userId: session.user.id, role: 'owner' })
  return NextResponse.json(org, { status: 201 })
}
