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

  try {
    const accessToken = await getFreshAccessToken(conn, db)
    const files = await listFolderContents(folderId, accessToken)
    const folderItems = parseDriveFiles(files)

    // Drive is confirmed accessible — now mutate the database
    await db.update(projects).set({ folderId, folderName }).where(eq(projects.id, projectId))
    await db.delete(playlistItems).where(eq(playlistItems.projectId, projectId))
    await db.delete(players).where(eq(players.projectId, projectId))

    if (folderItems.length > 0) {
      // D1 limit: 100 bound params per statement. players=4/row → chunk 20; playlistItems=7/row → chunk 10
      const newPlayers: { id: string; projectId: string; name: string; folderName: string }[] = []
      for (let i = 0; i < folderItems.length; i += 20) {
        const chunk = await db.insert(players).values(
          folderItems.slice(i, i + 20).map((f) => ({ projectId, name: f.name, folderName: f.name }))
        ).returning()
        newPlayers.push(...chunk)
      }
      const playlist = await buildPlaylist(newPlayers, folderId, accessToken, project.imagesPerPlayer)
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
    }
  } catch (e) {
    console.error('[folder change] re-sequence failed:', e)
    return NextResponse.json({ error: 'Failed to re-sequence playlist from Drive.' }, { status: 502 })
  }

  const updated = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
  return NextResponse.json(updated)
}
