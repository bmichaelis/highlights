import { describe, it, expect } from 'vitest'
import { editorReducer, initialHistory } from './use-editor'
import type { HistoryState, Clip, Timeline } from './types'

const emptyTimeline: Timeline = {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, clips: [] },
  ],
}

const clip: Clip = { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', start: 0, duration: 3 }

function makeHistory(timeline: Timeline): HistoryState {
  return { past: [], present: timeline, future: [] }
}

describe('editorReducer', () => {
  it('ADD_CLIP appends to correct track', () => {
    const state = makeHistory(emptyTimeline)
    const next = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip })
    expect(next.present.tracks[0].clips).toHaveLength(1)
    expect(next.present.tracks[0].clips[0].id).toBe('c1')
    expect(next.present.tracks[1].clips).toHaveLength(0)
  })

  it('ADD_CLIP pushes current state to past', () => {
    const state = makeHistory(emptyTimeline)
    const next = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip })
    expect(next.past).toHaveLength(1)
    expect(next.future).toHaveLength(0)
  })

  it('REMOVE_CLIP removes by id', () => {
    const withClip: Timeline = { ...emptyTimeline, tracks: [{ ...emptyTimeline.tracks[0], clips: [clip] }, emptyTimeline.tracks[1]] }
    const state = makeHistory(withClip)
    const next = editorReducer(state, { type: 'REMOVE_CLIP', trackId: 'V1', clipId: 'c1' })
    expect(next.present.tracks[0].clips).toHaveLength(0)
  })

  it('UNDO restores previous state', () => {
    const state = makeHistory(emptyTimeline)
    const after = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip })
    const undone = editorReducer(after, { type: 'UNDO' })
    expect(undone.present.tracks[0].clips).toHaveLength(0)
    expect(undone.future).toHaveLength(1)
  })

  it('REDO reapplies undone state', () => {
    const state = makeHistory(emptyTimeline)
    const after = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip })
    const undone = editorReducer(after, { type: 'UNDO' })
    const redone = editorReducer(undone, { type: 'REDO' })
    expect(redone.present.tracks[0].clips).toHaveLength(1)
  })

  it('MOVE_CLIP updates start', () => {
    const withClip: Timeline = { ...emptyTimeline, tracks: [{ ...emptyTimeline.tracks[0], clips: [clip] }, emptyTimeline.tracks[1]] }
    const next = editorReducer(makeHistory(withClip), { type: 'MOVE_CLIP', trackId: 'V1', clipId: 'c1', newStart: 5 })
    expect(next.present.tracks[0].clips[0].start).toBe(5)
  })

  it('RESIZE_CLIP clamps to minimum 0.3', () => {
    const withClip: Timeline = { ...emptyTimeline, tracks: [{ ...emptyTimeline.tracks[0], clips: [clip] }, emptyTimeline.tracks[1]] }
    const next = editorReducer(makeHistory(withClip), { type: 'RESIZE_CLIP', trackId: 'V1', clipId: 'c1', newDuration: 0.1 })
    expect(next.present.tracks[0].clips[0].duration).toBe(0.3)
  })

  it('history is capped at 40 past states', () => {
    let state = makeHistory(emptyTimeline)
    for (let i = 0; i < 45; i++) {
      state = editorReducer(state, { type: 'ADD_CLIP', trackId: 'V1', clip: { ...clip, id: `c${i}`, start: i * 3 } })
    }
    expect(state.past.length).toBeLessThanOrEqual(40)
  })
})
