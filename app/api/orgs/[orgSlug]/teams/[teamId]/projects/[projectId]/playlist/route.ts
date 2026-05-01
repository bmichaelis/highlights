import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, playlistItems, players, projects, driveConnections } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { buildPlaylist } from '@/lib/drive/sequencer'
import { getFreshAccessToken } from '@/lib/drive/auth'
import { thumbnailRouteUrl } from '@/lib/thumbnail-url'

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

  const items = await db
    .select({
      id: playlistItems.id,
      position: playlistItems.position,
      driveFileId: playlistItems.driveFileId,
      thumbnailUrl: playlistItems.thumbnailUrl,
      exifDate: playlistItems.exifDate,
      durationOverride: playlistItems.durationOverride,
      playerId: playlistItems.playerId,
      playerName: players.name,
    })
    .from(playlistItems)
    .innerJoin(players, eq(playlistItems.playerId, players.id))
    .where(eq(playlistItems.projectId, projectId))
    .orderBy(asc(playlistItems.position))

  return NextResponse.json(items.map(item => ({
    ...item,
    thumbnailUrl: thumbnailRouteUrl(orgSlug, teamId, projectId, item.driveFileId),
  })))
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { type?: unknown; items?: unknown; id?: unknown; duration?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (body.type === 'reorder') {
    if (!Array.isArray(body.items)) return NextResponse.json({ error: 'Invalid items' }, { status: 400 })
    const reorderItems = body.items as { id: string; position: number }[]
    for (const { id, position } of reorderItems) {
      await db.update(playlistItems)
        .set({ position })
        .where(and(eq(playlistItems.id, id), eq(playlistItems.projectId, projectId)))
    }
    return NextResponse.json({ ok: true })
  }

  if (body.type === 'remove') {
    if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    await db.delete(playlistItems)
      .where(and(eq(playlistItems.id, body.id as string), eq(playlistItems.projectId, projectId)))
    return NextResponse.json({ ok: true })
  }

  if (body.type === 'duration') {
    if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    if (typeof body.duration !== 'number' || !Number.isFinite(body.duration) || body.duration <= 0)
      return NextResponse.json({ error: 'Invalid duration' }, { status: 400 })
    await db.update(playlistItems)
      .set({ durationOverride: body.duration as number })
      .where(and(eq(playlistItems.id, body.id as string), eq(playlistItems.projectId, projectId)))
    return NextResponse.json({ ok: true })
  }

  if (body.type === 'resequence') {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!project.folderId) return NextResponse.json({ error: 'No folder set for this project' }, { status: 400 })
    const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
    if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })
    const projectPlayers = await db.query.players.findMany({ where: eq(players.projectId, projectId) })
    const accessToken = await getFreshAccessToken(conn, db)
    const playlist = await buildPlaylist(projectPlayers, project.folderId, accessToken, project.imagesPerPlayer)

    await db.delete(playlistItems).where(eq(playlistItems.projectId, projectId))
    // D1 limit: 100 bound params per statement; playlistItems=7/row → chunk 10
    for (let i = 0; i < playlist.length; i += 10) {
      await db.insert(playlistItems).values(
        playlist.slice(i, i + 10).map((item, idx) => ({
          projectId,
          playerId: item.playerId,
          driveFileId: item.driveFileId,
          thumbnailUrl: item.thumbnailUrl,
          exifDate: item.date ? new Date(item.date) : null,
          position: i + idx,
        }))
      )
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
