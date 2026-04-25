export type MediaItem = {
  id: string          // Drive file ID
  kind: 'image' | 'audio'
  filename: string
  thumbnailUrl?: string
  defaultDuration: number  // seconds
}

export type KBPosition =
  'top-left' | 'top' | 'top-right' |
  'left'     | 'center' | 'right'  |
  'bottom-left' | 'bottom' | 'bottom-right'

export type Clip = {
  id: string
  mediaId: string       // Drive file ID (used as `source` in ffmpeg JSON)
  filename: string
  thumbnailUrl?: string // images only
  start: number         // seconds from t=0
  duration: number      // seconds
  sourceIn?: number     // seconds into source file where playback begins; undefined = 0
  fadeIn?: number       // seconds; undefined treated as 0.2
  fadeOut?: number      // seconds; undefined treated as 0.2
  kenBurns?: { from: KBPosition; to: KBPosition; scale: number } | null
  // undefined = use default (center→bottom-right, 1.08×); null = disabled (static)
}

export type Track = {
  id: string
  kind: 'video' | 'audio'
  name: string
  muted: boolean
  locked: boolean
  removable: boolean
  clips: Clip[]
}

export type Timeline = {
  tracks: Track[]
}

export type HistoryState = {
  past: Timeline[]    // max 40
  present: Timeline
  future: Timeline[]
}

export type EditorState = {
  history: HistoryState
  playhead: number      // seconds
  playing: boolean
  zoom: number          // 30–200; pixels-per-second = zoom * 0.8
  selectedClipId: string | null
  snapOn: boolean
  drag: DragState | null
  saveStatus: 'idle' | 'saving' | 'saved'
}

export type DragState = {
  media: MediaItem
  curX: number
  curY: number
  overTrackId: string | null
  overTime: number      // seconds, snap-adjusted
}

export type EditorAction =
  | { type: 'ADD_CLIP'; trackId: string; clip: Clip }
  | { type: 'REMOVE_CLIP'; trackId: string; clipId: string }
  | { type: 'MOVE_CLIP'; trackId: string; clipId: string; newStart: number }
  | { type: 'RESIZE_CLIP'; trackId: string; clipId: string; newDuration: number }
  | { type: 'SPLIT_CLIP'; trackId: string; clipId: string; at: number }
  | { type: 'UPDATE_CLIP'; trackId: string; clipId: string; patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>> }
  | { type: 'TOGGLE_MUTE'; trackId: string }
  | { type: 'TOGGLE_LOCK'; trackId: string }
  | { type: 'ADD_AUDIO_TRACK' }
  | { type: 'REMOVE_AUDIO_TRACK'; trackId: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_PLAYHEAD'; time: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SELECT_CLIP'; clipId: string | null }
  | { type: 'SET_SNAP'; on: boolean }
  | { type: 'SET_DRAG'; drag: DragState | null }
  | { type: 'SET_SAVE_STATUS'; status: 'idle' | 'saving' | 'saved' }
  | { type: 'LOAD_TIMELINE'; timeline: Timeline }

export const DEFAULT_KB: { from: KBPosition; to: KBPosition; scale: number } = {
  from: 'center',
  to: 'bottom-right',
  scale: 1.08,
}
