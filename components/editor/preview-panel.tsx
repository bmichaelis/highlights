'use client'
import { useRef, useCallback, useEffect } from 'react'
import type { Timeline, Clip } from './types'

type Props = {
  timeline: Timeline
  playhead: number
  playing: boolean
  totalDuration: number
  audioBaseUrl: string
  onSeek: (time: number) => void
  onPlayPause: () => void
  onPrev: () => void
  onNext: () => void
}

function activeClip(timeline: Timeline, playhead: number): Clip | null {
  const v1 = timeline.tracks.find((t) => t.id === 'V1')
  if (!v1) return null
  return v1.clips.find((c) => playhead >= c.start && playhead < c.start + c.duration) ?? null
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PreviewPanel({ timeline, playhead, playing, totalDuration, audioBaseUrl, onSeek, onPlayPause, onPrev, onNext }: Props) {
  const clip = activeClip(timeline, playhead)
  const scrubRef = useRef<HTMLDivElement>(null)
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())
  const loadedClipIdRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const audioTracks = timeline.tracks.filter((t) => t.kind === 'audio')
    for (const track of audioTracks) {
      const audio = audioRefs.current.get(track.id)
      if (!audio) continue
      const activeAudioClip = track.clips.find(
        (c) => c.start <= playhead && playhead < c.start + c.duration
      ) ?? null
      if (!activeAudioClip || track.muted) {
        audio.pause()
        continue
      }
      const prevClipId = loadedClipIdRef.current.get(track.id)
      if (prevClipId !== activeAudioClip.id) {
        audio.src = `${audioBaseUrl}/${activeAudioClip.mediaId}`
        audio.currentTime = playhead - activeAudioClip.start
        loadedClipIdRef.current.set(track.id, activeAudioClip.id)
      } else if (!playing) {
        audio.currentTime = playhead - activeAudioClip.start
      } else {
        const expected = playhead - activeAudioClip.start
        if (Math.abs(audio.currentTime - expected) > 0.25) {
          audio.currentTime = expected
        }
      }
      if (playing) {
        audio.play().catch((e: Error) => {
          if (e.name !== 'AbortError') console.warn('Audio play failed', e)
        })
      } else {
        audio.pause()
      }
    }
  }, [playhead, playing, timeline, audioBaseUrl])

  const handleScrubClick = useCallback((e: React.MouseEvent) => {
    if (!scrubRef.current) return
    const rect = scrubRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(ratio * totalDuration)
  }, [totalDuration, onSeek])

  const progress = totalDuration > 0 ? Math.min(1, playhead / totalDuration) : 0

  const kenBurnsScale = clip ? 1 + 0.08 * ((playhead - clip.start) / clip.duration) : 1

  return (
    <div
      className="flex flex-col items-center justify-center flex-1 gap-3"
      style={{ background: 'var(--paper-2)', minWidth: 0 }}
    >
      {/* Video frame */}
      <div
        style={{
          width: '82%', aspectRatio: '16/9',
          background: '#1b1814',
          border: '1.5px solid var(--line)',
          borderRadius: 6,
          boxShadow: '0 10px 30px rgba(40,30,20,.22)',
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        {clip?.thumbnailUrl ? (
          <img
            src={clip.thumbnailUrl}
            alt={clip.filename}
            style={{
              width: '100%', height: '100%', objectFit: 'cover',
              transform: `scale(${kenBurnsScale})`,
              transformOrigin: 'center',
              transition: playing ? 'none' : 'transform 0.1s',
            }}
          />
        ) : (
          <p style={{ fontSize: 12, color: '#6b6258', textAlign: 'center', padding: '0 16px' }}>
            {clip ? clip.filename : 'no clip at playhead — drag a photo to V1 to begin'}
          </p>
        )}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3" style={{ width: '82%' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'monospace', width: 92, flexShrink: 0 }}>
          {formatTime(playhead)} / {formatTime(totalDuration)}
        </span>

        <button onClick={onPrev} style={{ fontSize: 16, color: 'var(--ink-2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>⏮</button>

        <button
          onClick={onPlayPause}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'var(--accent)', border: 'none',
            color: '#fff', fontSize: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <button onClick={onNext} style={{ fontSize: 16, color: 'var(--ink-2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>⏭</button>

        {/* Scrubber */}
        <div
          ref={scrubRef}
          onClick={handleScrubClick}
          style={{
            flex: 1, height: 8, borderRadius: 4,
            background: 'var(--paper-3)', cursor: 'pointer', position: 'relative',
          }}
        >
          <div style={{ width: `${progress * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
        </div>

        <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>🔊</span>
      </div>
      {timeline.tracks.filter((t) => t.kind === 'audio').map((track) => (
        <audio
          key={track.id}
          style={{ display: 'none' }}
          ref={(el) => {
            if (el) {
              audioRefs.current.set(track.id, el)
            } else {
              audioRefs.current.get(track.id)?.pause()
              audioRefs.current.delete(track.id)
              loadedClipIdRef.current.delete(track.id)
            }
          }}
        />
      ))}
    </div>
  )
}
