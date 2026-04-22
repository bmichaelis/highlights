import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, projects, players, playlistItems, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getFreshAccessToken } from '@/lib/drive/auth'
import { listFolderContents, parseDriveFiles } from '@/lib/drive/scanner'
import { buildPlaylist } from '@/lib/drive/sequencer'

type Params = { params: Promise<{ orgSlug: string; teamId: string; projectId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId } = await params
  let body: { folderId?: unknown; folderName?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.folderId !== 'string' || !body.folderId.trim()) return NextResponse.json({ error: 'folderId required' }, { status: 400 })
  if (typeof body.folderName !== 'string' || !body.folderName.trim()) return NextResponse.json({ error: 'folderName required' }, { status: 400 })
  const folderId = body.folderId.trim()
  const folderName = body.folderName.trim()

  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)) })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const conn = await db.query.driveConnections.findFirst({ where: eq(driveConnections.teamId, teamId) })
  if (!conn) return NextResponse.json({ error: 'Drive not connected' }, { status: 400 })

  // Clear existing playlist/players
  await db.delete(playlistItems).where(eq(playlistItems.projectId, projectId))
  await db.delete(players).where(eq(players.projectId, projectId))

  try {
    const accessToken = await getFreshAccessToken(conn, db)
    const files = await listFolderContents(folderId, accessToken)
    const folderItems = parseDriveFiles(files)

    // Only update folder metadata after confirming Drive is accessible
    await db.update(projects).set({ folderId, folderName }).where(eq(projects.id, projectId))

    if (folderItems.length > 0) {
      const newPlayers = await db.insert(players).values(
        folderItems.map((f) => ({ projectId, name: f.name, folderName: f.name }))
      ).returning()
      const playlist = await buildPlaylist(newPlayers, folderId, accessToken, project.imagesPerPlayer)
      if (playlist.length > 0) {
        await db.insert(playlistItems).values(
          playlist.map((item, i) => ({
            projectId,
            playerId: item.playerId,
            driveFileId: item.driveFileId,
            thumbnailUrl: item.thumbnailUrl,
            exifDate: item.date ? new Date(item.date) : null,
            position: i,
          }))
        )
      }
    }
  } catch {
    return NextResponse.json({ error: 'Failed to re-sequence playlist from Drive.' }, { status: 502 })
  }

  const updated = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
  return NextResponse.json(updated)
}
