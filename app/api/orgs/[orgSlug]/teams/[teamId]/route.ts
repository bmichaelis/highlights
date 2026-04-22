import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { organizations, teams, projects, players, playlistItems, renderJobs, driveConnections } from '@/db/schema'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { and, eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!team || team.orgId !== org.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(team)
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  let body: { name?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [updated] = await db.update(teams).set({ name: body.name.trim() }).where(eq(teams.id, teamId)).returning()
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    // Manual cascade: playlistItems.playerId has no onDelete clause
    const teamProjects = await db.query.projects.findMany({ where: eq(projects.teamId, teamId) })
    for (const project of teamProjects) {
      await db.delete(playlistItems).where(eq(playlistItems.projectId, project.id))
      await db.delete(players).where(eq(players.projectId, project.id))
      await db.delete(renderJobs).where(eq(renderJobs.projectId, project.id))
    }
    await db.delete(projects).where(eq(projects.teamId, teamId))
    await db.delete(driveConnections).where(eq(driveConnections.teamId, teamId))
    await db.delete(teams).where(eq(teams.id, teamId))
  } catch (e) {
    console.error('[team delete] cascade failed:', e)
    return NextResponse.json({ error: 'Failed to delete team.' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
