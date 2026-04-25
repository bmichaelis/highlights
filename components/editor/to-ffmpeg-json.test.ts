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
      kenburns: { from: 'center', to: 'bottom-right', scale: 1.08 },
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

  it('uses per-clip fadeIn for video transition duration', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        { ...timeline.tracks[0], clips: [{ ...timeline.tracks[0].clips[0], fadeIn: 0.8 }, timeline.tracks[0].clips[1]] },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    expect(vTrack.clips[0]).toMatchObject({ transition: { in: 'fade', duration: 0.8 } })
    // second clip has no fadeIn, should default to 0.2
    expect(vTrack.clips[1]).toMatchObject({ transition: { in: 'fade', duration: 0.2 } })
  })

  it('adds fade field to audio clips with default 0.2', () => {
    const result = toFFmpegJson(timeline, 'test')
    const aTrack = result.tracks.find((t) => t.id === 'A1')!
    expect(aTrack.clips[0]).toMatchObject({ fade: { in: 0.2, out: 0.2 } })
  })

  it('uses per-clip fadeIn/fadeOut for audio fade', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        timeline.tracks[0],
        { ...timeline.tracks[1], clips: [{ ...timeline.tracks[1].clips[0], fadeIn: 1.0, fadeOut: 0.5 }] },
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const aTrack = result.tracks.find((t) => t.id === 'A1')!
    expect(aTrack.clips[0]).toMatchObject({ fade: { in: 1.0, out: 0.5 } })
  })

  it('uses per-clip kenBurns values when set', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        {
          ...timeline.tracks[0],
          clips: [{ ...timeline.tracks[0].clips[0], kenBurns: { from: 'top-left', to: 'bottom-right', scale: 1.15 } }, timeline.tracks[0].clips[1]],
        },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    expect(vTrack.clips[0]).toMatchObject({
      kenburns: { from: 'top-left', to: 'bottom-right', scale: 1.15 },
    })
    // second clip has no kenBurns, should use default
    expect(vTrack.clips[1]).toMatchObject({
      kenburns: { from: 'center', to: 'bottom-right', scale: 1.08 },
    })
  })

  it('emits kenburns: null when kenBurns is null (static clip)', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        {
          ...timeline.tracks[0],
          clips: [{ ...timeline.tracks[0].clips[0], kenBurns: null }, timeline.tracks[0].clips[1]],
        },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    expect((vTrack.clips[0] as { kenburns: unknown }).kenburns).toBeNull()
  })

  it('uses sourceIn for in/out when set', () => {
    const tl: Timeline = {
      ...timeline,
      tracks: [
        {
          ...timeline.tracks[0],
          clips: [{ ...timeline.tracks[0].clips[0], sourceIn: 1.5 }, timeline.tracks[0].clips[1]],
        },
        timeline.tracks[1],
      ],
    }
    const result = toFFmpegJson(tl, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    // in/out are source offsets (1.5 → 4.5); start/end remain timeline positions (0 → 3)
    expect(vTrack.clips[0]).toMatchObject({ in: 1.5, out: 4.5, start: 0, end: 3 })
  })

  it('defaults sourceIn to 0 for clips without it even when start != 0', () => {
    const result = toFFmpegJson(timeline, 'test')
    const vTrack = result.tracks.find((t) => t.id === 'V1')!
    // c2: start=3, duration=4, no sourceIn → in=0 out=4 (NOT in=3 out=7)
    expect(vTrack.clips[1]).toMatchObject({ in: 0, out: 4, start: 3, end: 7 })
  })
})
