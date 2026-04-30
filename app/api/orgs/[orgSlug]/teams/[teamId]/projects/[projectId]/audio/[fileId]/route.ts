import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { refreshDriveToken } from '@/lib/drive/auth'

const TOKEN_REFRESH_BUFFER_MS = 60_000

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string; fileId: string }> }

export async function GET(_req: Request, { params }: Params) {
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
    let accessToken = conn.accessToken
    const expiresAtMs = conn.expiresAt ? conn.expiresAt.getTime() : 0
    if (!accessToken || expiresAtMs < Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      const tokenData = await refreshDriveToken(conn.refreshToken)
      accessToken = tokenData.accessToken
      await db.update(driveConnections)
        .set({ accessToken, expiresAt: new Date(tokenData.expiresAt) })
        .where(eq(driveConnections.id, conn.id))
    }

    // Always fetch the full file from Drive — do NOT forward Range. The
    // browser's <audio> element issues many tiny range requests during normal
    // playback (and many more on every seek), each of which lands on the
    // Worker and exhausts CPU. By serving the full file once with strong
    // cache headers and no Accept-Ranges, the browser fetches the file once
    // and serves all subsequent reads from its own cache.
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!driveRes.ok) {
      return NextResponse.json({ error: 'Drive fetch failed' }, { status: 502 })
    }

    const buffer = await driveRes.arrayBuffer()

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': driveRes.headers.get('content-type') ?? 'audio/mpeg',
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Drive access failed' }, { status: 502 })
  }
}
