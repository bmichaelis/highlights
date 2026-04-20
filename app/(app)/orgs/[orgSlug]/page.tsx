import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, organizationMembers, teams } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

export default async function OrgPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const session = await requireSession()
  const { orgSlug } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) notFound()

  const member = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, session.user.id)),
  })
  if (!member) redirect('/onboarding')

  const orgTeams = await db.query.teams.findMany({ where: eq(teams.orgId, org.id) })

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-bold">{org.name}</h1>
      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Teams</h2>
          <Link href={`/orgs/${orgSlug}/teams/new`} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm">
            New Team
          </Link>
        </div>
        {orgTeams.length === 0 ? (
          <p className="text-gray-500">No teams yet.</p>
        ) : (
          <ul className="space-y-2">
            {orgTeams.map((team) => (
              <li key={team.id}>
                <Link href={`/orgs/${orgSlug}/teams/${team.id}`} className="block p-4 border rounded-lg hover:bg-gray-50">
                  {team.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
