import { describe, it, expect } from 'vitest'
import { editorReducer, initialHistory } from './use-editor'
import type { HistoryState, Clip, Timeline } from './types'

const emptyTimeline: Timeline = {
  tracks: [
    { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
    { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
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

  describe('SPLIT_CLIP', () => {
    const clipToSplit: Clip = { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', start: 0, duration: 6 }
    const withClip: Timeline = {
      ...emptyTimeline,
      tracks: [{ ...emptyTimeline.tracks[0], clips: [clipToSplit] }, emptyTimeline.tracks[1]],
    }

    it('splits clip into two clips at the given time', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
      const clips = next.present.tracks[0].clips
      expect(clips).toHaveLength(2)
      expect(clips[0]).toMatchObject({ start: 0, duration: 2, fadeOut: 0 })
      expect(clips[1]).toMatchObject({ start: 2, duration: 4, fadeIn: 0 })
    })

    it('left clip keeps original id', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
      expect(next.present.tracks[0].clips[0].id).toBe('c1')
    })

    it('right clip gets a new id', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
      expect(next.present.tracks[0].clips[1].id).not.toBe('c1')
    })

    it('right clip shares mediaId and filename with original', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
      expect(next.present.tracks[0].clips[1]).toMatchObject({ mediaId: 'drive-abc', filename: 'goal.jpg' })
    })

    it('is a no-op when at is outside the clip', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 10 })
      expect(next.present.tracks[0].clips).toHaveLength(1)
      expect(next.past).toHaveLength(0)
    })

    it('pushes to undo history', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
      expect(next.past).toHaveLength(1)
    })

    it('right clip inherits thumbnailUrl from original', () => {
      const clipWithThumb: Clip = { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', thumbnailUrl: 'https://thumb.url', start: 0, duration: 6 }
      const tl: Timeline = {
        ...emptyTimeline,
        tracks: [{ ...emptyTimeline.tracks[0], clips: [clipWithThumb] }, emptyTimeline.tracks[1]],
      }
      const next = editorReducer(makeHistory(tl), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 2 })
      expect(next.present.tracks[0].clips[1].thumbnailUrl).toBe('https://thumb.url')
    })

    it('is a no-op when at equals clip start', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'SPLIT_CLIP', trackId: 'V1', clipId: 'c1', at: 0 })
      expect(next.present.tracks[0].clips).toHaveLength(1)
      expect(next.past).toHaveLength(0)
    })
  })

  describe('TRIM_LEFT', () => {
    const audioClip: Clip = {
      id: 'a1', mediaId: 'song-id', filename: 'song.mp3',
      start: 5, duration: 10, sourceIn: 0, sourceDuration: 60,
    }
    const withClip: Timeline = {
      ...emptyTimeline,
      tracks: [emptyTimeline.tracks[0], { ...emptyTimeline.tracks[1], clips: [audioClip] }],
    }

    it('shifts start and shrinks duration by the same delta as sourceIn', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 3 })
      const c = next.present.tracks[1].clips[0]
      expect(c.sourceIn).toBe(3)
      expect(c.start).toBe(8)
      expect(c.duration).toBe(7)
      // right edge on timeline (start + duration) stays at 15
      expect(c.start + c.duration).toBe(15)
    })

    it('clamps newSourceIn to [0, sourceDuration - 0.3] when sourceDuration is known', () => {
      const high = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 999 })
      expect(high.present.tracks[1].clips[0].sourceIn).toBe(59.7)

      const low = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: -5 })
      expect(low.present.tracks[1].clips[0].sourceIn).toBe(0)
    })

    it('clamps newSourceIn to >= 0 only when sourceDuration is undefined', () => {
      const noDur: Clip = { ...audioClip, sourceDuration: undefined }
      const tl: Timeline = { ...emptyTimeline, tracks: [emptyTimeline.tracks[0], { ...emptyTimeline.tracks[1], clips: [noDur] }] }
      const next = editorReducer(makeHistory(tl), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 999 })
      expect(next.present.tracks[1].clips[0].sourceIn).toBe(999)
    })

    it('treats undefined sourceIn as 0 when computing delta', () => {
      const noIn: Clip = { ...audioClip, sourceIn: undefined }
      const tl: Timeline = { ...emptyTimeline, tracks: [emptyTimeline.tracks[0], { ...emptyTimeline.tracks[1], clips: [noIn] }] }
      const next = editorReducer(makeHistory(tl), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 2 })
      const c = next.present.tracks[1].clips[0]
      expect(c.sourceIn).toBe(2)
      expect(c.start).toBe(7)
      expect(c.duration).toBe(8)
    })

    it('pushes to undo history', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 3 })
      expect(next.past).toHaveLength(1)
    })

    it('UNDO restores original sourceIn/start/duration', () => {
      const after = editorReducer(makeHistory(withClip), { type: 'TRIM_LEFT', trackId: 'A1', clipId: 'a1', newSourceIn: 3 })
      const undone = editorReducer(after, { type: 'UNDO' })
      const c = undone.present.tracks[1].clips[0]
      expect(c.sourceIn).toBe(0)
      expect(c.start).toBe(5)
      expect(c.duration).toBe(10)
    })
  })

  describe('UPDATE_CLIP', () => {
    const clipToUpdate: Clip = { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', start: 0, duration: 3 }
    const withClip: Timeline = {
      ...emptyTimeline,
      tracks: [{ ...emptyTimeline.tracks[0], clips: [clipToUpdate] }, emptyTimeline.tracks[1]],
    }

    it('patches fadeIn on a clip', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'UPDATE_CLIP', trackId: 'V1', clipId: 'c1', patch: { fadeIn: 0.5 } })
      expect(next.present.tracks[0].clips[0].fadeIn).toBe(0.5)
    })

    it('patches fadeOut on a clip', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'UPDATE_CLIP', trackId: 'V1', clipId: 'c1', patch: { fadeOut: 1.0 } })
      expect(next.present.tracks[0].clips[0].fadeOut).toBe(1.0)
    })

    it('does not modify other clips', () => {
      const clip2: Clip = { id: 'c2', mediaId: 'drive-xyz', filename: 'pass.jpg', start: 3, duration: 3 }
      const twoClips: Timeline = {
        ...emptyTimeline,
        tracks: [{ ...emptyTimeline.tracks[0], clips: [clipToUpdate, clip2] }, emptyTimeline.tracks[1]],
      }
      const next = editorReducer(makeHistory(twoClips), { type: 'UPDATE_CLIP', trackId: 'V1', clipId: 'c1', patch: { fadeIn: 0.8 } })
      expect(next.present.tracks[0].clips[1].fadeIn).toBeUndefined()
    })

    it('pushes to undo history', () => {
      const next = editorReducer(makeHistory(withClip), { type: 'UPDATE_CLIP', trackId: 'V1', clipId: 'c1', patch: { fadeIn: 0.3 } })
      expect(next.past).toHaveLength(1)
    })

    it('patches kenBurns on a clip', () => {
      const next = editorReducer(makeHistory(withClip), {
        type: 'UPDATE_CLIP',
        trackId: 'V1',
        clipId: 'c1',
        patch: { kenBurns: { from: 'top-left', to: 'bottom-right', scale: 1.1 } },
      })
      expect(next.present.tracks[0].clips[0].kenBurns).toEqual({
        from: 'top-left',
        to: 'bottom-right',
        scale: 1.1,
      })
    })

    it('patches kenBurns to null (disables Ken Burns)', () => {
      const clipWithKB: Clip = { ...clipToUpdate, kenBurns: { from: 'center', to: 'bottom-right', scale: 1.08 } }
      const tl: Timeline = {
        ...emptyTimeline,
        tracks: [{ ...emptyTimeline.tracks[0], clips: [clipWithKB] }, emptyTimeline.tracks[1]],
      }
      const next = editorReducer(makeHistory(tl), {
        type: 'UPDATE_CLIP',
        trackId: 'V1',
        clipId: 'c1',
        patch: { kenBurns: null },
      })
      expect(next.present.tracks[0].clips[0].kenBurns).toBeNull()
    })
  })

  describe('ADD_AUDIO_TRACK', () => {
    it('adds A2 when only A1 exists', () => {
      const state = makeHistory(emptyTimeline)
      const next = editorReducer(state, { type: 'ADD_AUDIO_TRACK' })
      expect(next.present.tracks).toHaveLength(3)
      const a2 = next.present.tracks[2]
      expect(a2.id).toBe('A2')
      expect(a2.kind).toBe('audio')
      expect(a2.name).toBe('Audio')
      expect(a2.removable).toBe(true)
      expect(a2.clips).toEqual([])
    })

    it('adds A3 when A2 already exists', () => {
      const state = makeHistory({
        tracks: [
          { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
          { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
          { id: 'A2', kind: 'audio', name: 'Audio', muted: false, locked: false, removable: true, clips: [] },
        ],
      })
      const next = editorReducer(state, { type: 'ADD_AUDIO_TRACK' })
      expect(next.present.tracks).toHaveLength(4)
      expect(next.present.tracks[3].id).toBe('A3')
    })

    it('pushes to undo history', () => {
      const state = makeHistory(emptyTimeline)
      const next = editorReducer(state, { type: 'ADD_AUDIO_TRACK' })
      expect(next.past).toHaveLength(1)
    })
  })

  describe('REMOVE_AUDIO_TRACK', () => {
    const audioClip: Clip = { id: 'ac1', mediaId: 'm1', filename: 'song.mp3', start: 0, duration: 5 }

    it('removes the track and all its clips', () => {
      const state = makeHistory({
        tracks: [
          { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
          { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
          { id: 'A2', kind: 'audio', name: 'Audio', muted: false, locked: false, removable: true, clips: [audioClip] },
        ],
      })
      const next = editorReducer(state, { type: 'REMOVE_AUDIO_TRACK', trackId: 'A2' })
      expect(next.present.tracks).toHaveLength(2)
      expect(next.present.tracks.find((t) => t.id === 'A2')).toBeUndefined()
    })

    it('is a no-op for non-removable tracks', () => {
      const state = makeHistory(emptyTimeline)
      const next = editorReducer(state, { type: 'REMOVE_AUDIO_TRACK', trackId: 'A1' })
      expect(next).toBe(state)
    })

    it('pushes to undo history when track is removed', () => {
      const state = makeHistory({
        tracks: [
          { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips: [] },
          { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
          { id: 'A2', kind: 'audio', name: 'Audio', muted: false, locked: false, removable: true, clips: [] },
        ],
      })
      const next = editorReducer(state, { type: 'REMOVE_AUDIO_TRACK', trackId: 'A2' })
      expect(next.past).toHaveLength(1)
    })
  })
})
