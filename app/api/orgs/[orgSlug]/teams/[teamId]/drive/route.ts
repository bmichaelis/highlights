import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  return NextResponse.json(conn ? { connected: true, folderName: conn.folderName, folderId: conn.folderId } : { connected: false })
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const { folderId, folderName } = await req.json()
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await db.update(driveConnections).set({ folderId, folderName }).where(eq(driveConnections.teamId, teamId))
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await db.delete(driveConnections).where(eq(driveConnections.teamId, teamId))
  return NextResponse.json({ ok: true })
}
