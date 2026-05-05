import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, players, playlistItems, driveConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { buildPlaylist } from '@/lib/drive/sequencer'
import { getFreshAccessToken } from '@/lib/drive/auth'
import { listFolderContents, parseDriveFiles, partitionTopLevel } from '@/lib/drive/scanner'

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
  let body: { name?: unknown; imagesPerPlayer?: unknown; secondsPerImage?: unknown; folderId?: unknown; folderName?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const { name, imagesPerPlayer = 4, secondsPerImage = 3.5, folderId, folderName } = body
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (typeof folderId !== 'string' || !folderId.trim()) return NextResponse.json({ error: 'folderId required' }, { status: 400 })
  if (typeof folderName !== 'string' || !folderName.trim()) return NextResponse.json({ error: 'folderName required' }, { status: 400 })
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
    teamId,
    name: name.trim(),
    imagesPerPlayer: n,
    secondsPerImage: s,
    folderId: folderId.trim(),
    folderName: folderName.trim(),
  }).returning()

  try {
    const accessToken = await getFreshAccessToken(conn, db)
    const files = await listFolderContents(folderId.trim(), accessToken)
    const allFolders = parseDriveFiles(files)
    const { players: playerFolders, misc: miscFolder } = partitionTopLevel(allFolders)
    const folderItems = miscFolder ? [...playerFolders, miscFolder] : playerFolders
    if (folderItems.length > 0) {
      // D1 limit: 100 bound params per statement. players=4/row → chunk 20; playlistItems=7/row → chunk 10
      const newPlayers: { id: string; projectId: string; name: string; folderName: string }[] = []
      for (let i = 0; i < folderItems.length; i += 20) {
        const chunk = await db.insert(players).values(
          folderItems.slice(i, i + 20).map((f) => ({
            projectId: project.id,
            name: f === miscFolder ? 'misc' : f.name,
            folderName: f.name,
          }))
        ).returning()
        newPlayers.push(...chunk)
      }
      const playlist = await buildPlaylist(newPlayers, folderId.trim(), accessToken, n)
      for (let i = 0; i < playlist.length; i += 10) {
        await db.insert(playlistItems).values(
          playlist.slice(i, i + 10).map((item, idx) => ({
            projectId: project.id,
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
    console.error('[project create] auto-sequence failed:', e)
    await db.delete(projects).where(eq(projects.id, project.id))
    return NextResponse.json({ error: 'Failed to auto-sequence playlist from Drive. Check Drive connection and try again.' }, { status: 502 })
  }

  return NextResponse.json(project, { status: 201 })
}
