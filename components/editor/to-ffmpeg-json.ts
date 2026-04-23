import type { Timeline, Clip, Track } from '@/components/editor/types'

type FFmpegVideoClip = {
  id: string; type: 'image'; source: string
  in: number; out: number; start: number; end: number
  kenburns: { from: string; to: string; scale: number }
  transition: { in: string; duration: number }
}

type FFmpegAudioClip = {
  id: string; type: 'audio'; source: string
  in: number; out: number; start: number; end: number
}

type FFmpegClip = FFmpegVideoClip | FFmpegAudioClip

type FFmpegTrack = { id: string; kind: string; muted: boolean; clips: FFmpegClip[] }

type FFmpegJson = {
  output: { filename: string; width: number; height: number; fps: number; audio_rate: number }
  duration: number
  tracks: FFmpegTrack[]
}

function clipEnd(clip: Clip): number {
  return clip.start + clip.duration
}

function serializeClip(clip: Clip, kind: 'video' | 'audio'): FFmpegClip {
  const base = { id: clip.id, source: clip.mediaId, in: clip.start, out: clipEnd(clip), start: clip.start, end: clipEnd(clip) }
  if (kind === 'video') {
    return { ...base, type: 'image', kenburns: { from: 'center', to: 'in', scale: 1.08 }, transition: { in: 'fade', duration: 0.2 } }
  }
  return { ...base, type: 'audio' }
}

function serializeTrack(track: Track): FFmpegTrack {
  return {
    id: track.id,
    kind: track.kind,
    muted: track.muted,
    clips: track.clips.map((c) => serializeClip(c, track.kind)),
  }
}

export function toFFmpegJson(timeline: Timeline, projectSlug: string): FFmpegJson {
  const allEnds = timeline.tracks.flatMap((t) => t.clips.map(clipEnd))
  const duration = allEnds.length > 0 ? Math.max(...allEnds) : 0
  return {
    output: { filename: `${projectSlug}.mp4`, width: 1920, height: 1080, fps: 30, audio_rate: 48000 },
    duration,
    tracks: timeline.tracks.map(serializeTrack),
  }
}
