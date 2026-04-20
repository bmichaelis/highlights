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
  const data = await res.json()
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

export async function getFreshAccessToken(conn: {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
}): Promise<string> {
  if (!conn.expiresAt || conn.expiresAt - Date.now() > 60_000) return conn.accessToken
  const { accessToken } = await refreshDriveToken(conn.refreshToken)
  return accessToken
}
