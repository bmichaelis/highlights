import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getFreshAccessToken } from '@/lib/drive/auth'
import { listFolderContents, parseDriveFiles } from '@/lib/drive/scanner'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const { searchParams } = new URL(req.url)
  const parentId = searchParams.get('parentId') ?? 'root'

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  const accessToken = await getFreshAccessToken(conn, db)
  const files = await listFolderContents(parentId, accessToken)
  const folders = parseDriveFiles(files)

  return NextResponse.json({ folders })
}
