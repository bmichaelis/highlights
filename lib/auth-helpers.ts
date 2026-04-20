import { auth } from '@/lib/auth.config'
import { getDb } from '@/db'
import { organizationMembers } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  return session
}

export async function requireOrgMember(orgId: string, userId: string, minRole?: 'admin' | 'owner') {
  const db = getDb()
  const member = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)),
  })
  if (!member) return null
  if (minRole === 'owner' && member.role !== 'owner') return null
  if (minRole === 'admin' && member.role === 'member') return null
  return member
}
