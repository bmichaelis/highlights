import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { organizations, teams } from '@/db/schema'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgTeams = await db.query.teams.findMany({ where: eq(teams.orgId, org.id) })
  return NextResponse.json(orgTeams)
}

export async function POST(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug } = await params
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const [team] = await db.insert(teams).values({ orgId: org.id, name: name.trim() }).returning()
  return NextResponse.json(team, { status: 201 })
}
