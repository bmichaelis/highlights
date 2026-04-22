import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-helpers'
import { getDb } from '@/db'
import { driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'

const REDIRECT_URI = `${process.env.NEXTAUTH_URL}/api/drive/callback`

export async function GET(req: Request) {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const returnedState = searchParams.get('state')
  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })

  const cookieStore = await cookies()
  const expectedState = cookieStore.get('drive_oauth_state')?.value
  if (!expectedState || expectedState !== returnedState) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  let orgSlug: string, teamId: string
  try {
    const decoded = JSON.parse(Buffer.from(returnedState, 'base64url').toString())
    orgSlug = decoded.orgSlug
    teamId = decoded.teamId
  } catch {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.DRIVE_GOOGLE_CLIENT_ID!,
      client_secret: process.env.DRIVE_GOOGLE_CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  const tokens = await tokenRes.json() as { refresh_token?: string; access_token: string; expires_in: number }

  if (!tokens.refresh_token) {
    return NextResponse.json({ error: 'No refresh token returned. Try disconnecting and reconnecting.' }, { status: 502 })
  }

  const db = getDb()
  await db.insert(driveConnections).values({
    teamId,
    userId: session.user.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  }).onConflictDoUpdate({
    target: driveConnections.teamId,
    set: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  })

  const response = NextResponse.redirect(new URL(`/orgs/${orgSlug}/teams/${teamId}`, req.url))
  response.cookies.delete('drive_oauth_state')
  return response
}
