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
  fadeIn?: number       // seconds; undefined treated as 0.2
  fadeOut?: number      // seconds; undefined treated as 0.2
  kenBurns?: { from: KBPosition; to: KBPosition; scale: number } | null
  // undefined = use default (center→bottom-right, 1.08×); null = disabled (static)
}

export type Track = {
  id: 'V1' | 'A1'
  kind: 'video' | 'audio'
  name: string
  muted: boolean
  locked: boolean
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
  overTrackId: 'V1' | 'A1' | null
  overTime: number      // seconds, snap-adjusted
}

export type EditorAction =
  | { type: 'ADD_CLIP'; trackId: 'V1' | 'A1'; clip: Clip }
  | { type: 'REMOVE_CLIP'; trackId: 'V1' | 'A1'; clipId: string }
  | { type: 'MOVE_CLIP'; trackId: 'V1' | 'A1'; clipId: string; newStart: number }
  | { type: 'RESIZE_CLIP'; trackId: 'V1' | 'A1'; clipId: string; newDuration: number }
  | { type: 'SPLIT_CLIP'; trackId: 'V1' | 'A1'; clipId: string; at: number }
  | { type: 'UPDATE_CLIP'; trackId: 'V1' | 'A1'; clipId: string; patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>> }
  | { type: 'TOGGLE_MUTE'; trackId: 'V1' | 'A1' }
  | { type: 'TOGGLE_LOCK'; trackId: 'V1' | 'A1' }
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
