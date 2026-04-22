import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { listFolderContents, pickAudioFiles } from '@/lib/drive/scanner'
import { getFreshAccessToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project || !project.folderId) return NextResponse.json([])
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json([])
  const accessToken = await getFreshAccessToken(conn, db)
  const files = await listFolderContents(project.folderId, accessToken)
  return NextResponse.json(pickAudioFiles(files))
}
