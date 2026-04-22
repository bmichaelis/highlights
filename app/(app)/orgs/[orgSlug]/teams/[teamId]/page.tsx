import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, driveConnections, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { TeamManagement } from '@/components/team-management'

type Props = { params: Promise<{ orgSlug: string; teamId: string }> }

export default async function TeamPage({ params }: Props) {
  await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) notFound()
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!team || team.orgId !== org.id) notFound()

  const drive = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  const teamProjects = await db.query.projects.findMany({ where: eq(projects.teamId, teamId) })

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <TeamManagement orgSlug={orgSlug} teamId={teamId} teamName={team.name} />

      <section className="border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Google Drive</h2>
        {drive ? (
          <p className="text-green-700 text-sm">Connected</p>
        ) : (
          <a href={`/api/orgs/${orgSlug}/teams/${teamId}/drive/connect`}
            className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
            Connect Google Drive
          </a>
        )}
      </section>

      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">Projects</h2>
          {drive && (
            <Link href={`/orgs/${orgSlug}/teams/${teamId}/projects/new`}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm">
              New Project
            </Link>
          )}
        </div>
        <ul className="space-y-2">
          {teamProjects.map((p) => (
            <li key={p.id}>
              <Link href={`/orgs/${orgSlug}/teams/${teamId}/projects/${p.id}`}
                className="block p-4 border rounded-lg hover:bg-gray-50">
                <span>{p.name}</span>
                <span className="ml-2 text-sm text-gray-500">{p.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
