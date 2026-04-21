import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, players, playlistItems, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { buildPlaylist } from '@/lib/drive/sequencer'
import { getFreshAccessToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const teamProjects = await db.query.projects.findMany({ where: eq(projects.teamId, teamId) })
  return NextResponse.json(teamProjects)
}

export async function POST(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  let body: { name?: unknown; imagesPerPlayer?: unknown; secondsPerImage?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { name, imagesPerPlayer = 4, secondsPerImage = 3.5 } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const n = Number(imagesPerPlayer)
  const s = Number(secondsPerImage)
  if (!Number.isInteger(n) || n < 1 || n > 20) return NextResponse.json({ error: 'imagesPerPlayer must be an integer 1–20' }, { status: 400 })
  if (Number.isNaN(s) || s < 0.5 || s > 30) return NextResponse.json({ error: 'secondsPerImage must be a number 0.5–30' }, { status: 400 })

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  const [project] = await db.insert(projects).values({
    teamId, name: name.trim(), imagesPerPlayer: n, secondsPerImage: s,
  }).returning()

  const teamPlayers = await db.query.players.findMany({ where: eq(players.teamId, teamId) })
  if (teamPlayers.length > 0) {
    try {
      const accessToken = await getFreshAccessToken(conn, db)
      const playlist = await buildPlaylist(teamPlayers, conn.folderId, accessToken, n)
      if (playlist.length > 0) {
        await db.insert(playlistItems).values(
          playlist.map((item, i) => ({
            projectId: project.id,
            playerId: item.playerId,
            driveFileId: item.driveFileId,
            thumbnailUrl: item.thumbnailUrl,
            exifDate: new Date(item.date),
            position: i,
          }))
        )
      }
    } catch {
      await db.delete(projects).where(eq(projects.id, project.id))
      return NextResponse.json({ error: 'Failed to auto-sequence playlist from Drive. Check Drive connection and try again.' }, { status: 502 })
    }
  }

  return NextResponse.json(project, { status: 201 })
}
