export type ImageCandidate = {
  driveFileId: string
  playerId: string
  thumbnailUrl: string | null
  date: number  // ms timestamp from EXIF or Drive modifiedTime
}

type DriveImageFile = {
  id: string
  name: string
  thumbnailLink?: string
  imageMediaMetadata?: { time?: string }
  modifiedTime: string
}

export function pickEvenly<T extends { date: number }>(items: T[], n: number): T[] {
  if (items.length === 0) return []
  if (n <= 0) return []
  if (items.length <= n) return [...items]

  const sorted = [...items].sort((a, b) => a.date - b.date)
  if (n === 1) return [sorted[0]]

  const result: T[] = [sorted[0]]
  const step = (sorted.length - 1) / (n - 1)
  for (let i = 1; i < n - 1; i++) {
    result.push(sorted[Math.round(i * step)])
  }
  result.push(sorted[sorted.length - 1])
  return result
}

export function mergeChronological<T extends { date: number }>(playerImages: T[][]): T[] {
  return playerImages
    .flat()
    .sort((a, b) => a.date - b.date)
}

export async function fetchPlayerImages(
  playerId: string,
  folderName: string,
  parentFolderId: string,
  accessToken: string
): Promise<ImageCandidate[]> {
  const q = encodeURIComponent(
    `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const folderRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!folderRes.ok) throw new Error(`Drive folder lookup failed: ${await folderRes.text()}`)
  const { files: folders } = await folderRes.json()
  if (!folders?.length) return []

  const subFolderId = folders[0].id
  const imageQ = encodeURIComponent(
    `'${subFolderId}' in parents and mimeType contains 'image/' and trashed=false`
  )
  const fields = 'files(id,name,thumbnailLink,imageMediaMetadata(time),modifiedTime)'
  const imgRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${imageQ}&fields=${fields}&pageSize=1000`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!imgRes.ok) throw new Error(`Drive image list failed: ${await imgRes.text()}`)
  const { files } = await imgRes.json()

  return (files ?? []).map((f: DriveImageFile) => ({
    driveFileId: f.id,
    playerId,
    thumbnailUrl: f.thumbnailLink ?? null,
    date: f.imageMediaMetadata?.time
      ? new Date(f.imageMediaMetadata.time).getTime()
      : new Date(f.modifiedTime).getTime(),
  }))
}

export async function buildPlaylist(
  players: { id: string; folderName: string }[],
  parentFolderId: string,
  accessToken: string,
  imagesPerPlayer: number
): Promise<ImageCandidate[]> {
  const allPlayerImages = await Promise.all(
    players.map((p) => fetchPlayerImages(p.id, p.folderName, parentFolderId, accessToken))
  )
  const selected = allPlayerImages.map((imgs) => pickEvenly(imgs, imagesPerPlayer))
  return mergeChronological(selected)
}
