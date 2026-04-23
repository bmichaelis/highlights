import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations, teams, projects, playlistItems, driveConnections, renderJobs } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { triggerRender } from '@/lib/github/actions'
import { refreshDriveToken } from '@/lib/drive/auth'
import { listFolderContents, pickAudioFiles } from '@/lib/drive/scanner'

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

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.teamId, teamId)),
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const job = await db.query.renderJobs.findFirst({
    where: eq(renderJobs.projectId, projectId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })
  return NextResponse.json(job ?? null)
}

export async function POST(req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId, projectId } = await params
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

  const activeJob = await db.query.renderJobs.findFirst({
    where: and(eq(renderJobs.projectId, projectId)),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })
  if (activeJob && (activeJob.status === 'pending' || activeJob.status === 'running')) {
    return NextResponse.json({ error: 'Render already in progress' }, { status: 409 })
  }

  if (!project.folderId) return NextResponse.json({ error: 'No folder set for this project' }, { status: 400 })

  // Parse optional timelineJson from body
  let timelineJson: string | undefined
  try {
    const body = await req.json().catch(() => ({})) as { timelineJson?: string }
    if (typeof body.timelineJson === 'string') timelineJson = body.timelineJson
  } catch { /* no body is fine */ }

  let accessToken: string
  let playlist: { driveFileId: string; duration: number }[] = []
  let audioFileIds: string[] = []

  try {
    const tokenData = await refreshDriveToken(conn.refreshToken)
    accessToken = tokenData.accessToken
    await db.update(driveConnections)
      .set({ accessToken, expiresAt: new Date(tokenData.expiresAt) })
      .where(eq(driveConnections.id, conn.id))

    if (!timelineJson) {
      // Legacy path: derive from playlistItems
      const files = await listFolderContents(project.folderId, accessToken)
      audioFileIds = pickAudioFiles(files).map((f) => f.id)
      const items = await db
        .select({ driveFileId: playlistItems.driveFileId, duration: playlistItems.durationOverride, position: playlistItems.position })
        .from(playlistItems)
        .where(eq(playlistItems.projectId, projectId))
        .orderBy(asc(playlistItems.position))
      if (items.length === 0) return NextResponse.json({ error: 'Playlist is empty' }, { status: 400 })
      playlist = items.map((i) => ({ driveFileId: i.driveFileId, duration: i.duration ?? project.secondsPerImage }))
    }
  } catch {
    return NextResponse.json({ error: 'Drive access failed. Reconnect Drive and try again.' }, { status: 502 })
  }

  const callbackSecret = crypto.randomUUID()
  const nextAuthUrl = process.env.NEXTAUTH_URL
  if (!nextAuthUrl) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  const callbackUrl = `${nextAuthUrl}/api/render-callback`

  const [job] = await db.insert(renderJobs).values({ projectId, callbackSecret, status: 'pending' }).returning()
  await db.update(projects).set({ status: 'rendering' }).where(eq(projects.id, projectId))

  try {
    await triggerRender({
      playlist,
      audioFileIds,
      accessToken: accessToken!,
      folderId: project.folderId,
      jobId: job.id,
      callbackUrl,
      callbackSecret,
      timelineJson,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[render trigger] failed:', msg)
    await db.update(renderJobs)
      .set({ status: 'failed', errorMsg: msg, completedAt: new Date() })
      .where(eq(renderJobs.id, job.id))
    await db.update(projects).set({ status: 'failed' }).where(eq(projects.id, projectId))
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  return NextResponse.json(job, { status: 201 })
}
