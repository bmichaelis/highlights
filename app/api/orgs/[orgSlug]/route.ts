import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { organizations, organizationMembers } from '@/db/schema'
import { requireSession } from '@/lib/auth-helpers'
import { eq, and } from 'drizzle-orm'

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const session = await requireSession()
  const { orgSlug } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const member = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, session.user.id)),
  })
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ ...org, role: member.role })
}
