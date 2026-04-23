import { describe, it, expect } from 'vitest'
import { toFFmpegJson } from './to-ffmpeg-json'
import type { Timeline } from '@/components/editor/types'

const timeline: Timeline = {
  tracks: [
    {
      id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false,
      clips: [
        { id: 'c1', mediaId: 'drive-abc', filename: 'goal.jpg', thumbnailUrl: undefined, start: 0, duration: 3 },
        { id: 'c2', mediaId: 'drive-def', filename: 'celeb.jpg', thumbnailUrl: undefined, start: 3, duration: 4 },
      ],
    },
    {
      id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false,
      clips: [
        { id: 'c3', mediaId: 'drive-mus', filename: 'champs.mp3', start: 0, duration: 30 },
      ],
    },
  ],
}

describe('toFFmpegJson', () => {
  it('emits correct output settings', () => {
    const result = toFFmpegJson(timeline, 'rangers_spring26')
    expect(result.output).toEqual({
      filename: 'rangers_spring26.mp4',
      width: 1920,
      height: 1080,
      fps: 30,
      audio_rate: 48000,
    })
  })

  it('derives duration from latest clip end', () => {
    const result = toFFmpegJson(timeline, 'test')
    expect(result.duration).toBe(30)
  })

  it('maps video clips with kenburns and fade transition', () => {
    const result = toFFmpegJson(timeline, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    expect(vTrack.clips[0]).toMatchObject({
      type: 'image',
      source: 'drive-abc',
      in: 0,
      out: 3,
      start: 0,
      end: 3,
      kenburns: { from: 'center', to: 'in', scale: 1.08 },
      transition: { in: 'fade', duration: 0.2 },
    })
  })

  it('maps audio clips without kenburns', () => {
    const result = toFFmpegJson(timeline, 'test')
    const aTrack = result.tracks.find((t) => t.id === 'A1')!
    expect(aTrack.clips[0]).toMatchObject({
      type: 'audio',
      source: 'drive-mus',
      in: 0,
      out: 30,
      start: 0,
      end: 30,
    })
    expect(aTrack.clips[0]).not.toHaveProperty('kenburns')
  })

  it('preserves muted flag on tracks', () => {
    const mutedTimeline: Timeline = {
      tracks: [
        { ...timeline.tracks[0], muted: true },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(mutedTimeline, 'test')
    const v = result.tracks.find((t) => t.id === 'V1')
    expect(v?.muted).toBe(true)
  })
})
