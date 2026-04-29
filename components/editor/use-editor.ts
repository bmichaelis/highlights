import type { Timeline, HistoryState, EditorAction, Clip, Track } from './types'

const MAX_HISTORY = 40

function normalizeTrack(clips: Clip[]): Clip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  const result: Clip[] = []
  for (const clip of sorted) {
    const prev = result[result.length - 1]
    const start = prev ? Math.max(clip.start, prev.start + prev.duration) : clip.start
    result.push({ ...clip, start })
  }
  return result
}

function updateTrack(tracks: Track[], trackId: string, fn: (clips: Clip[]) => Clip[]): Track[] {
  return tracks.map((t) => t.id === trackId ? { ...t, clips: fn(t.clips) } : t)
}

function pushHistory(state: HistoryState, next: Timeline): HistoryState {
  const past = [...state.past, state.present].slice(-MAX_HISTORY)
  return { past, present: next, future: [] }
}

export function editorReducer(state: HistoryState, action: EditorAction): HistoryState {
  switch (action.type) {
    case 'ADD_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          normalizeTrack([...clips, action.clip])
        ),
      }
      return pushHistory(state, next)
    }
    case 'REMOVE_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          clips.filter((c) => c.id !== action.clipId)
        ),
      }
      return pushHistory(state, next)
    }
    case 'MOVE_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          normalizeTrack(clips.map((c) => c.id === action.clipId ? { ...c, start: Math.max(0, action.newStart) } : c))
        ),
      }
      return pushHistory(state, next)
    }
    case 'RESIZE_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          normalizeTrack(clips.map((c) => c.id === action.clipId ? { ...c, duration: Math.max(0.3, action.newDuration) } : c))
        ),
      }
      return pushHistory(state, next)
    }
    case 'TRIM_LEFT': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          clips.map((c) => {
            if (c.id !== action.clipId) return c
            const origIn = c.sourceIn ?? 0
            const maxIn = c.sourceDuration !== undefined
              ? Math.max(0, c.sourceDuration - 0.3)
              : Infinity
            const newIn = Math.max(0, Math.min(maxIn, action.newSourceIn))
            const delta = newIn - origIn
            return { ...c, sourceIn: newIn, start: c.start + delta, duration: c.duration - delta }
          })
        ),
      }
      return pushHistory(state, next)
    }
    case 'SPLIT_CLIP': {
      const track = state.present.tracks.find((t) => t.id === action.trackId)
      const clip = track?.clips.find((c) => c.id === action.clipId)
      if (!clip || action.at <= clip.start || action.at >= clip.start + clip.duration) return state
      const left: Clip = { ...clip, duration: action.at - clip.start, fadeOut: 0 }
      const right: Clip = {
        ...clip,
        id: crypto.randomUUID(),
        start: action.at,
        duration: (clip.start + clip.duration) - action.at,
        fadeIn: 0,
      }
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          normalizeTrack([...clips.filter((c) => c.id !== action.clipId), left, right])
        ),
      }
      return pushHistory(state, next)
    }
    case 'UPDATE_CLIP': {
      const next: Timeline = {
        ...state.present,
        tracks: updateTrack(state.present.tracks, action.trackId, (clips) =>
          clips.map((c) => c.id === action.clipId ? { ...c, ...action.patch } : c)
        ),
      }
      return pushHistory(state, next)
    }
    case 'TOGGLE_MUTE': {
      const next: Timeline = {
        ...state.present,
        tracks: state.present.tracks.map((t) => t.id === action.trackId ? { ...t, muted: !t.muted } : t),
      }
      return pushHistory(state, next)
    }
    case 'TOGGLE_LOCK': {
      const next: Timeline = {
        ...state.present,
        tracks: state.present.tracks.map((t) => t.id === action.trackId ? { ...t, locked: !t.locked } : t),
      }
      return pushHistory(state, next)
    }
    case 'ADD_AUDIO_TRACK': {
      const audioNums = state.present.tracks.map((t) => {
        const m = t.id.match(/^A(\d+)$/)
        return m ? parseInt(m[1], 10) : 0
      })
      const nextN = Math.max(0, ...audioNums) + 1
      const newTrack: Track = {
        id: `A${nextN}`,
        kind: 'audio',
        name: 'Audio',
        muted: false,
        locked: false,
        removable: true,
        clips: [],
      }
      return pushHistory(state, { ...state.present, tracks: [...state.present.tracks, newTrack] })
    }
    case 'REMOVE_AUDIO_TRACK': {
      const track = state.present.tracks.find((t) => t.id === action.trackId)
      if (!track?.removable) return state
      return pushHistory(state, {
        ...state.present,
        tracks: state.present.tracks.filter((t) => t.id !== action.trackId),
      })
    }
    case 'UNDO': {
      if (state.past.length === 0) return state
      const [past, present] = [state.past.slice(0, -1), state.past[state.past.length - 1]]
      return { past, present, future: [state.present, ...state.future] }
    }
    case 'REDO': {
      if (state.future.length === 0) return state
      const [present, ...future] = state.future
      return { past: [...state.past, state.present], present, future }
    }
    case 'LOAD_TIMELINE':
      return { past: [], present: action.timeline, future: [] }
    default:
      return state
  }
}

export const emptyTimeline: Timeline = {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
  ],
}

export function initialHistory(timeline: Timeline = emptyTimeline): HistoryState {
  return { past: [], present: timeline, future: [] }
}
