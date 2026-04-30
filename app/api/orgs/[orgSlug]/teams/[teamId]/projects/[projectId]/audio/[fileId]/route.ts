import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getFreshAccessToken } from '@/lib/drive/auth'

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

  const { env } = getCloudflareContext()
  const publicUrl = `${env.AUDIO_PUBLIC_BASE_URL}/${fileId}`

  // Fast path — file is already in R2.
  const existing = await env.AUDIO_BUCKET.head(fileId)
  if (existing) {
    return Response.redirect(publicUrl, 302)
  }

  // Cold path — fetch from Drive once, write to R2, then redirect.
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  try {
    const accessToken = await getFreshAccessToken(conn, db)
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!driveRes.ok) {
      return NextResponse.json({ error: 'Drive fetch failed' }, { status: 502 })
    }

    await env.AUDIO_BUCKET.put(fileId, driveRes.body, {
      httpMetadata: {
        contentType: driveRes.headers.get('content-type') ?? 'audio/mpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })

    return Response.redirect(publicUrl, 302)
  } catch {
    return NextResponse.json({ error: 'Drive access failed' }, { status: 502 })
  }
}
