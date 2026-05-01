import { notFound } from 'next/navigation'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, playlistItems } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { Editor } from '@/components/editor/editor'
import { thumbnailRouteUrl } from '@/lib/thumbnail-url'

type Props = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export default async function ProjectPage({ params }: Props) {
  const { orgSlug, teamId, projectId } = await params
  const session = await requireSession()
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) notFound()
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) notFound()
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) notFound()
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project) notFound()

  const rawItems = await db
    .select({
      driveFileId: playlistItems.driveFileId,
      duration: playlistItems.durationOverride,
      position: playlistItems.position,
    })
    .from(playlistItems)
    .where(eq(playlistItems.projectId, projectId))
    .orderBy(asc(playlistItems.position))

  const items = rawItems.map(r => ({
    ...r,
    thumbnailUrl: thumbnailRouteUrl(orgSlug, teamId, projectId, r.driveFileId),
  }))

  const initialTimeline = project.timelineJson ? JSON.parse(project.timelineJson) : null
  const projectSlug = project.name.toLowerCase().replace(/\s+/g, '_')

  return (
    <Editor
      orgSlug={orgSlug}
      teamId={teamId}
      projectId={projectId}
      projectName={project.name}
      projectSlug={projectSlug}
      initialTimeline={initialTimeline}
      playlistItems={items}
      secondsPerImage={project.secondsPerImage}
    />
  )
}
