import { getDb } from '@/db'
import { driveConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function refreshDriveToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.DRIVE_GOOGLE_CLIENT_ID!,
      client_secret: process.env.DRIVE_GOOGLE_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

export async function getFreshAccessToken(
  conn: { id: string; accessToken: string; refreshToken: string; expiresAt: Date | number | null },
  db: ReturnType<typeof getDb>
): Promise<string> {
  const expiresAtMs = conn.expiresAt instanceof Date ? conn.expiresAt.getTime() : conn.expiresAt
  if (!expiresAtMs || expiresAtMs - Date.now() > 60_000) return conn.accessToken
  const { accessToken, expiresAt } = await refreshDriveToken(conn.refreshToken)
  await db.update(driveConnections).set({ accessToken, expiresAt: new Date(expiresAt) }).where(eq(driveConnections.id, conn.id))
  return accessToken
}
