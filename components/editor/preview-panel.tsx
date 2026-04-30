'use client'
import { memo, useRef, useCallback, useEffect } from 'react'
import type { Timeline, Clip } from './types'

// Memoized audio element with a stable ref callback. Inlining the ref
// function in the parent's .map() loop creates a fresh function reference
// every render, which React treats as a new ref — calling the old ref with
// null (which pauses the audio) and then the new ref with the element. With
// the play loop firing every animation frame, audio gets paused 60×/sec
// and never sustains playback.
const AudioTrackElement = memo(function AudioTrackElement({
  trackId,
  onMount,
  onUnmount,
}: {
  trackId: string
  onMount: (id: string, el: HTMLAudioElement) => void
  onUnmount: (id: string) => void
}) {
  const refCallback = useCallback((el: HTMLAudioElement | null) => {
    if (el) onMount(trackId, el)
    else onUnmount(trackId)
  }, [trackId, onMount, onUnmount])
  return <audio style={{ display: 'none' }} ref={refCallback} />
})

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
  const lastPlayAttemptRef = useRef<Map<string, number>>(new Map())

  const registerAudio = useCallback((id: string, el: HTMLAudioElement) => {
    audioRefs.current.set(id, el)
  }, [])
  const unregisterAudio = useCallback((id: string) => {
    audioRefs.current.get(id)?.pause()
    audioRefs.current.delete(id)
    loadedClipIdRef.current.delete(id)
    lastPlayAttemptRef.current.delete(id)
  }, [])

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
      const sourceIn = activeAudioClip.sourceIn ?? 0
      const expected = sourceIn + (playhead - activeAudioClip.start)
      const prevClipId = loadedClipIdRef.current.get(track.id)
      if (prevClipId !== activeAudioClip.id) {
        // New clip — load source and seek to where the playhead is.
        audio.src = `${audioBaseUrl}/${activeAudioClip.mediaId}`
        audio.currentTime = expected
        loadedClipIdRef.current.set(track.id, activeAudioClip.id)
        lastPlayAttemptRef.current.delete(track.id)
      } else if (!playing) {
        // Paused — keep audio aligned with the scrubbed playhead.
        audio.currentTime = expected
      }
      // While playing on the same clip, do NOT touch audio.currentTime.
      // The audio element is its own clock; setting currentTime each frame
      // creates seek→Range→cancel storms that exhaust the Worker.
      if (playing) {
        // Throttle play() retries: a buffer underrun pauses the audio
        // legitimately; calling play() every frame triggers a request
        // storm that prevents recovery. Bail out on hard errors entirely.
        if (audio.paused && !audio.error) {
          const now = Date.now()
          const last = lastPlayAttemptRef.current.get(track.id) ?? 0
          if (now - last > 1000) {
            lastPlayAttemptRef.current.set(track.id, now)
            audio.play().catch((e: Error) => {
              if (e.name !== 'AbortError') console.warn('Audio play failed', e)
            })
          }
        }
      } else if (!audio.paused) {
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
        <AudioTrackElement
          key={track.id}
          trackId={track.id}
          onMount={registerAudio}
          onUnmount={unregisterAudio}
        />
      ))}
    </div>
  )
}
