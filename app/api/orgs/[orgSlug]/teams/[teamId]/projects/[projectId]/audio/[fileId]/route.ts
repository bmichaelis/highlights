import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { refreshDriveToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string; fileId: string }> }

export async function GET(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId, fileId } = await params
  const db = getDb()

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  try {
    const tokenData = await refreshDriveToken(conn.refreshToken)
    await db.update(driveConnections)
      .set({ accessToken: tokenData.accessToken, expiresAt: new Date(tokenData.expiresAt) })
      .where(eq(driveConnections.id, conn.id))

    const range = req.headers.get('range')
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.accessToken}`,
          ...(range ? { Range: range } : {}),
        },
      }
    )
    if (!driveRes.ok && driveRes.status !== 206) {
      return NextResponse.json({ error: 'Drive fetch failed' }, { status: 502 })
    }

    const headers: Record<string, string> = {
      'Content-Type': driveRes.headers.get('content-type') ?? 'audio/mpeg',
    }
    const contentRange = driveRes.headers.get('content-range')
    if (contentRange) headers['Content-Range'] = contentRange
    const contentLength = driveRes.headers.get('content-length')
    if (contentLength) headers['Content-Length'] = contentLength
    const acceptRanges = driveRes.headers.get('accept-ranges')
    if (acceptRanges) headers['Accept-Ranges'] = acceptRanges

    return new Response(driveRes.body, { status: driveRes.status, headers })
  } catch {
    return NextResponse.json({ error: 'Drive access failed' }, { status: 502 })
  }
}
