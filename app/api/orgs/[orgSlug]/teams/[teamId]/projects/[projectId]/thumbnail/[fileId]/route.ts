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
  const publicUrl = `${env.THUMBNAIL_PUBLIC_BASE_URL}/${fileId}`

  // Fast path — thumbnail already in R2.
  const existing = await env.THUMBNAIL_BUCKET.head(fileId)
  if (existing) {
    return Response.redirect(publicUrl, 302)
  }

  // Cold path — get a fresh thumbnailLink from Drive, fetch the bytes, write to R2.
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  try {
    const accessToken = await getFreshAccessToken(conn, db)

    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!metaRes.ok) return NextResponse.json({ error: 'Drive metadata fetch failed' }, { status: 502 })
    const { thumbnailLink } = await metaRes.json() as { thumbnailLink?: string }
    if (!thumbnailLink) return NextResponse.json({ error: 'No thumbnail available' }, { status: 404 })

    const imgRes = await fetch(thumbnailLink)
    if (!imgRes.ok || !imgRes.body) {
      return NextResponse.json({ error: 'Thumbnail fetch failed' }, { status: 502 })
    }

    await env.THUMBNAIL_BUCKET.put(fileId, imgRes.body, {
      httpMetadata: {
        contentType: imgRes.headers.get('content-type') ?? 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })

    return Response.redirect(publicUrl, 302)
  } catch (err) {
    console.error('[thumbnail] cold-fill failed for', fileId, err)
    return NextResponse.json({ error: 'Drive access failed' }, { status: 502 })
  }
}
