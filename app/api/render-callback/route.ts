import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { renderJobs, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'

const VALID_STATUSES = ['running', 'complete', 'failed'] as const
type CallbackStatus = typeof VALID_STATUSES[number]

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export async function POST(req: Request) {
  let body: { jobId?: unknown; status?: unknown; secret?: unknown; driveFileId?: unknown; errorMsg?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { jobId, status, secret, driveFileId, errorMsg } = body

  if (typeof jobId !== 'string' || !jobId)
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
  if (typeof secret !== 'string' || !secret)
    return NextResponse.json({ error: 'Invalid secret' }, { status: 400 })
  if (!VALID_STATUSES.includes(status as CallbackStatus))
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const db = getDb()
  const job = await db.query.renderJobs.findFirst({ where: eq(renderJobs.id, jobId) })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!timingSafeStringEqual(job.callbackSecret, secret as string))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isTerminal = status === 'complete' || status === 'failed'
  await db.update(renderJobs).set({
    status: status as CallbackStatus,
    outputDriveFileId: typeof driveFileId === 'string' ? driveFileId : null,
    errorMsg: typeof errorMsg === 'string' ? errorMsg : null,
    completedAt: isTerminal ? new Date() : null,
  }).where(eq(renderJobs.id, jobId))

  const projectStatus = status === 'complete' ? 'complete' : status === 'failed' ? 'failed' : 'rendering'
  await db.update(projects).set({ status: projectStatus }).where(eq(projects.id, job.projectId))

  return NextResponse.json({ ok: true })
}
