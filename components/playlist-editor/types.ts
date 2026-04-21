export type PlaylistItem = {
  id: string
  position: number
  driveFileId: string
  thumbnailUrl: string | null
  exifDate: number | null
  durationOverride: number | null
  playerId: string
  playerName: string
}
