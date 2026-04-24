import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { refreshDriveToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function POST(req: Request, { params }: Params) {
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
  if (!project.folderId) return NextResponse.json({ error: 'Project has no Drive folder' }, { status: 400 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  try {
    const tokenData = await refreshDriveToken(conn.refreshToken)
    await db.update(driveConnections)
      .set({ accessToken: tokenData.accessToken, expiresAt: new Date(tokenData.expiresAt) })
      .where(eq(driveConnections.id, conn.id))

    const safeName = file.name.replace(/[/\\]/g, '_').slice(0, 255) || 'upload'
    const metadata = JSON.stringify({ name: safeName, parents: [project.folderId] })
    const fileBytes = await file.arrayBuffer()
    const boundary = 'boundary' + Date.now()
    const encoder = new TextEncoder()

    const metaPart = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
    )
    const mediaHeader = encoder.encode(
      `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
    )
    const closing = encoder.encode(`\r\n--${boundary}--`)

    const body = new Uint8Array(
      metaPart.byteLength + mediaHeader.byteLength + fileBytes.byteLength + closing.byteLength
    )
    body.set(metaPart, 0)
    body.set(mediaHeader, metaPart.byteLength)
    body.set(new Uint8Array(fileBytes), metaPart.byteLength + mediaHeader.byteLength)
    body.set(closing, metaPart.byteLength + mediaHeader.byteLength + fileBytes.byteLength)

    const driveRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    )
    if (!driveRes.ok) return NextResponse.json({ error: 'Drive upload failed' }, { status: 502 })
    const driveFile = await driveRes.json() as { id: string; name: string; mimeType: string }
    return NextResponse.json({ driveFileId: driveFile.id, filename: driveFile.name, mimeType: driveFile.mimeType })
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 502 })
  }
}
