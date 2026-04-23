import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

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
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let timeline: unknown = null
  if (project.timelineJson) {
    try {
      timeline = JSON.parse(project.timelineJson)
    } catch {
      timeline = null
    }
  }
  return NextResponse.json({ timeline })
}

export async function PUT(req: Request, { params }: Params) {
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
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { timeline?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.timeline || typeof body.timeline !== 'object') {
    return NextResponse.json({ error: 'Missing timeline' }, { status: 400 })
  }

  await db.update(projects)
    .set({ timelineJson: JSON.stringify(body.timeline) })
    .where(eq(projects.id, projectId))

  return NextResponse.json({ ok: true })
}
