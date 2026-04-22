const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg'])
const FOLDER_TYPE = 'application/vnd.google-apps.folder'
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg)$/i

type DriveFile = { id: string; name: string; mimeType: string }

export function parseDriveFiles(files: DriveFile[]): { id: string; name: string }[] {
  return files.filter((f) => f.mimeType === FOLDER_TYPE).map(({ id, name }) => ({ id, name }))
}

export function pickAudioFiles(files: DriveFile[]): { id: string; name: string }[] {
  return files
    .filter((f) => AUDIO_TYPES.has(f.mimeType) || AUDIO_EXTENSIONS.test(f.name))
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export async function listFolderContents(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const fields = 'files(id,name,mimeType)'
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`Drive API error: ${await res.text()}`)
  const data = await res.json() as { files?: DriveFile[] }
  return data.files ?? []
}

export async function scanTeamFolder(folderId: string, accessToken: string) {
  const files = await listFolderContents(folderId, accessToken)
  return {
    players: parseDriveFiles(files),
    audioFiles: pickAudioFiles(files),
  }
}
