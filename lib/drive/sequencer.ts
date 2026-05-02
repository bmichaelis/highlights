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
  return playerImages.flat().sort((a, b) => a.date - b.date)
}


type DriveListEntry = {
  id: string
  name: string
  mimeType: string
  thumbnailLink?: string
  imageMediaMetadata?: { time?: string }
  modifiedTime?: string
}

export async function collectImagesUnder(
  rootFolderId: string,
  accessToken: string,
): Promise<DriveImageFile[]> {
  const all: DriveImageFile[] = []
  const queue: string[] = [rootFolderId]
  const seenFolders = new Set<string>()

  while (queue.length > 0) {
    const folderId = queue.shift()!
    if (seenFolders.has(folderId)) continue
    seenFolders.add(folderId)

    const fields = 'files(id,name,mimeType,thumbnailLink,imageMediaMetadata(time),modifiedTime)'
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) throw new Error(`Drive list failed: ${await res.text()}`)
    const { files } = await res.json() as { files?: DriveListEntry[] }
    for (const f of files ?? []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        queue.push(f.id)
      } else if (f.mimeType.startsWith('image/')) {
        all.push({
          id: f.id,
          name: f.name,
          thumbnailLink: f.thumbnailLink,
          imageMediaMetadata: f.imageMediaMetadata,
          modifiedTime: f.modifiedTime ?? new Date(0).toISOString(),
        })
      }
    }
  }
  return all
}

export async function resolveSubfolderId(
  parentFolderId: string,
  folderName: string,
  accessToken: string,
): Promise<string | null> {
  const q = encodeURIComponent(
    `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`Drive folder lookup failed: ${await res.text()}`)
  const { files } = await res.json() as { files?: { id: string }[] }
  return files?.[0]?.id ?? null
}

export async function buildPlaylist(
  players: { id: string; folderName: string; name: string }[],
  parentFolderId: string,
  accessToken: string,
  imagesPerPlayer: number,
): Promise<ImageCandidate[]> {
  const allImages = await Promise.all(
    players.map(async (p) => {
      const folder = await resolveSubfolderId(parentFolderId, p.folderName, accessToken)
      if (!folder) return []
      const isMisc = p.name === 'misc'
      const images = await collectImagesUnder(folder, accessToken)
      const deduped = Array.from(new Map(images.map((i) => [i.id, i])).values())
      const candidates: ImageCandidate[] = deduped.map((f) => ({
        driveFileId: f.id,
        playerId: p.id,
        thumbnailUrl: f.thumbnailLink ?? null,
        date: f.imageMediaMetadata?.time
          ? new Date(f.imageMediaMetadata.time).getTime()
          : new Date(f.modifiedTime).getTime(),
      }))
      return isMisc ? candidates : pickEvenly(candidates, imagesPerPlayer)
    })
  )
  const seqPlayers = players.map((p) => ({ id: p.id, isMisc: p.name === 'misc' }))
  return interleaveRandom(allImages, seqPlayers)
}

type SeqPlayer = { id: string; isMisc: boolean }

function shuffle<T>(arr: T[], random: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function interleaveRandom<T>(
  perPlayerLists: T[][],
  players: SeqPlayer[],
  random: () => number = Math.random,
): T[] {
  const queues = perPlayerLists.map((list) => shuffle([...list], random))
  const result: T[] = []
  let lastPlayerId: string | null = null
  let lastWasMisc = false

  while (queues.some((q) => q.length > 0)) {
    const eligible: number[] = []
    for (let i = 0; i < queues.length; i++) {
      if (queues[i].length === 0) continue
      // Same-regular-player adjacency conflict — skip unless either side is misc.
      const conflict = !lastWasMisc && !players[i].isMisc && players[i].id === lastPlayerId
      if (!conflict) eligible.push(i)
    }
    const pool = eligible.length > 0
      ? eligible
      : queues.map((_, i) => i).filter((i) => queues[i].length > 0)

    // Pick from queues tied for largest remaining size, breaking ties at
    // random. Largest-first prevents skewed depletion (a smaller queue
    // emptying first while a larger one still has many items, forcing
    // adjacent same-player items at the tail). Random tiebreak keeps the
    // ordering varied between runs.
    let maxSize = 0
    for (const i of pool) {
      if (queues[i].length > maxSize) maxSize = queues[i].length
    }
    const largest = pool.filter((i) => queues[i].length === maxSize)
    const chosen = largest[Math.floor(random() * largest.length)]
    result.push(queues[chosen].shift()!)
    lastPlayerId = players[chosen].id
    lastWasMisc = players[chosen].isMisc
  }
  return result
}
