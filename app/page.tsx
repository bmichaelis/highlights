import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizationMembers, organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  const session = await requireSession()
  const db = getDb()
  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, session.user.id),
  })
  if (!membership) redirect('/onboarding')
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, membership.orgId),
  })
  if (!org) redirect('/onboarding')
  redirect(`/orgs/${org.slug}`)
}
