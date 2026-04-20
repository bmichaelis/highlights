import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, driveConnections, players } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { scanTeamFolder } from '@/lib/drive/scanner'
import { getFreshAccessToken } from '@/lib/drive/auth'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function POST(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const team = await db.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.orgId, org.id)) })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  const accessToken = await getFreshAccessToken({
    accessToken: conn.accessToken,
    refreshToken: conn.refreshToken,
    expiresAt: conn.expiresAt instanceof Date ? conn.expiresAt.getTime() : conn.expiresAt,
  })
  const { players: foundPlayers, audioFiles } = await scanTeamFolder(conn.folderId, accessToken)

  // Batch fetch existing players for this team to avoid N+1
  const existingPlayers = await db.query.players.findMany({ where: eq(players.teamId, teamId) })
  const existingFolderNames = new Set(existingPlayers.map((p) => p.folderName))
  for (const p of foundPlayers) {
    if (!existingFolderNames.has(p.name)) {
      await db.insert(players).values({ teamId, name: p.name, folderName: p.name })
    }
  }

  const allPlayers = await db.query.players.findMany({ where: eq(players.teamId, teamId) })
  return NextResponse.json({ players: allPlayers, audioFiles })
}
