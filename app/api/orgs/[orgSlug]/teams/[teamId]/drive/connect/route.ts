import { NextResponse } from 'next/server'
import { requireSession, requireOrgMember } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ orgSlug: string; teamId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await requireSession()
  const { orgSlug, teamId } = await params
  const db = getDb()
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, orgSlug) })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await requireOrgMember(org.id, session.user.id, 'admin')
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = Buffer.from(JSON.stringify({ orgSlug, teamId })).toString('base64url')
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ].join(' ')

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.DRIVE_GOOGLE_CLIENT_ID!)
  url.searchParams.set('redirect_uri', `${process.env.NEXTAUTH_URL}/api/orgs/${orgSlug}/teams/${teamId}/drive/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
