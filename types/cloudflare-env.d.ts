interface CloudflareEnv {
  DB: D1Database
  AUDIO_BUCKET: R2Bucket
  AUDIO_PUBLIC_BASE_URL: string
  AUTH_SECRET: string
  AUTH_GOOGLE_ID: string
  AUTH_GOOGLE_SECRET: string
  NEXTAUTH_URL: string
  DRIVE_GOOGLE_CLIENT_ID: string
  DRIVE_GOOGLE_CLIENT_SECRET: string
  GITHUB_PAT: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
}
