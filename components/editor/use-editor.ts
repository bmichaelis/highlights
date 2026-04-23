'use client'
import { useReducer, useEffect, useCallback, useState } from 'react'
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
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, clips: [] },
  ],
}

export function initialHistory(timeline: Timeline = emptyTimeline): HistoryState {
  return { past: [], present: timeline, future: [] }
}

type UseEditorOptions = {
  projectSlug: string
  orgSlug: string
  teamId: string
  projectId: string
}

export function useEditor({ projectSlug, orgSlug, teamId, projectId }: UseEditorOptions) {
  const [history, dispatch] = useReducer(editorReducer, initialHistory())
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const apiBase = `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`

  const save = useCallback(async (timeline: Timeline) => {
    setSaveStatus('saving')
    try {
      await fetch(`${apiBase}/timeline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeline }),
      })
      setSaveStatus('saved')
    } catch {
      setSaveStatus('idle')
    }
  }, [apiBase, setSaveStatus])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault()
        dispatch({ type: 'SET_PLAYING', playing: true })
      }
      if (meta && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      if (meta && e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); dispatch({ type: 'REDO' }) }
      if (meta && e.code === 'KeyY') { e.preventDefault(); dispatch({ type: 'REDO' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  return { history, dispatch, save, saveStatus, apiBase, projectSlug }
}
