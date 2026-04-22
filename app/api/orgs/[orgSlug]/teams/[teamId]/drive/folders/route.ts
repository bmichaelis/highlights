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

  let accessToken: string
  try {
    accessToken = await getFreshAccessToken(conn, db)
  } catch {
    return NextResponse.json({ error: 'Failed to authenticate with Drive' }, { status: 502 })
  }

  let files: Awaited<ReturnType<typeof listFolderContents>>
  try {
    files = await listFolderContents(parentId, accessToken)
  } catch {
    return NextResponse.json({ error: 'Failed to list Drive folders' }, { status: 502 })
  }

  const folders = parseDriveFiles(files)
  return NextResponse.json({ folders })
}
