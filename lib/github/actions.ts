export type RenderPayload = {
  playlist: { driveFileId: string; duration: number }[]
  audioFileIds: string[]
  accessToken: string
  folderId: string
  jobId: string
  callbackUrl: string
  callbackSecret: string
  timelineJson?: string  // serialized ffmpeg JSON; when present, playlist/audioFileIds are ignored by the worker
}

export async function triggerRender(payload: RenderPayload): Promise<void> {
  const { GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO } = process.env
  if (!GITHUB_PAT || !GITHUB_OWNER || !GITHUB_REPO)
    throw new Error('Missing required env vars: GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO')
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'highlights-app',
      },
      body: JSON.stringify({
        event_type: 'render-video',
        client_payload: payload,
      }),
    }
  )
  if (!res.ok) throw new Error(`GitHub dispatch failed: ${await res.text()}`)
}
