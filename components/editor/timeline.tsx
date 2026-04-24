'use client'
import { useRef, useCallback } from 'react'
import type { Timeline, Track, Clip, DragState } from './types'

type Props = {
  timeline: Timeline
  playhead: number
  zoom: number             // 30–200; pps = zoom * 0.8
  selectedClipId: string | null
  snapOn: boolean
  drag: DragState | null
  totalDuration: number
  onSeekRuler: (time: number) => void
  onZoomChange: (zoom: number) => void
  onMoveClip: (trackId: string, clipId: string, newStart: number) => void
  onResizeClip: (trackId: string, clipId: string, newDuration: number) => void
  onRemoveClip: (trackId: string, clipId: string) => void
  onSelectClip: (clipId: string | null) => void
  onToggleMute: (trackId: string) => void
  onToggleLock: (trackId: string) => void
  onDragOver: (trackId: string | null, time: number) => void
  onDrop: (trackId: string, time: number) => void
  onAddAudioTrack: () => void
  onRemoveAudioTrack: (trackId: string) => void
}

function pps(zoom: number) { return zoom * 0.8 }

function snapTime(t: number, clips: Clip[], snapOn: boolean, pixelsPerSecond: number): number {
  if (!snapOn) return t
  const snapThresholdSec = 8 / pixelsPerSecond
  const candidates = [0, ...clips.flatMap((c) => [c.start, c.start + c.duration])]
  let best = t
  let bestDist = snapThresholdSec
  for (const c of candidates) {
    const d = Math.abs(t - c)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return best
}

function formatRulerLabel(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type ClipViewProps = {
  clip: Clip
  track: Track
  selected: boolean
  pixelsPerSecond: number
  onSelect: () => void
  onMoveStart: (e: React.MouseEvent, clip: Clip) => void
  onResizeStart: (e: React.MouseEvent, clip: Clip) => void
}

function ClipView({ clip, track, selected, pixelsPerSecond, onSelect, onMoveStart, onResizeStart }: ClipViewProps) {
  const bg = track.kind === 'audio' ? 'var(--track-a)' : 'var(--track-v)'
  const left = clip.start * pixelsPerSecond
  const width = Math.max(clip.duration * pixelsPerSecond, 24)

  return (
    <div
      onMouseDown={(e) => { onSelect(); onMoveStart(e, clip) }}
      style={{
        position: 'absolute', left, width,
        top: 4, bottom: 4,
        background: bg,
        border: selected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
        borderRadius: 3,
        boxShadow: selected ? '0 0 0 2px var(--accent-2)' : undefined,
        cursor: track.locked ? 'not-allowed' : 'grab',
        opacity: track.muted ? 0.5 : 1,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <span style={{
        position: 'absolute', bottom: 2, left: 4,
        fontSize: 9, fontFamily: 'monospace', color: 'var(--ink-2)',
        whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '90%',
      }}>
        {clip.filename} · {clip.duration.toFixed(1)}s
      </span>
      {/* Resize handle */}
      <div
        onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, clip) }}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
          cursor: 'ew-resize', background: 'rgba(0,0,0,.15)',
        }}
      />
    </div>
  )
}

export function Timeline({
  timeline, playhead, zoom, selectedClipId, snapOn, drag, totalDuration,
  onSeekRuler, onZoomChange, onMoveClip, onResizeClip, onRemoveClip,
  onSelectClip, onToggleMute, onToggleLock, onDragOver, onDrop,
  onAddAudioTrack, onRemoveAudioTrack,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pixelsPerSecond = pps(zoom)
  const rulerWidth = Math.max(totalDuration * pixelsPerSecond + 200, 800)

  const allClips = timeline.tracks.flatMap((t) => t.clips)
  const clipCount = allClips.length

  // Ruler click → seek
  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    if (!scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const scrollLeft = scrollRef.current.scrollLeft
    const time = (e.clientX - rect.left + scrollLeft - 140) / pixelsPerSecond
    onSeekRuler(Math.max(0, time))
  }, [pixelsPerSecond, onSeekRuler])

  // Clip drag (move)
  const startClipMove = useCallback((e: React.MouseEvent, clip: Clip, track: Track) => {
    if (track.locked) return
    e.preventDefault()
    const origStart = clip.start
    const origX = e.clientX
    const otherClips = track.clips.filter((c) => c.id !== clip.id)

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - origX
      const newStart = snapTime(Math.max(0, origStart + dx / pixelsPerSecond), otherClips, snapOn, pixelsPerSecond)
      onMoveClip(track.id, clip.id, newStart)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pixelsPerSecond, snapOn, onMoveClip])

  // Clip resize
  const startClipResize = useCallback((e: React.MouseEvent, clip: Clip, track: Track) => {
    if (track.locked) return
    e.preventDefault()
    const origDur = clip.duration
    const origX = e.clientX

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - origX
      onResizeClip(track.id, clip.id, Math.max(0.3, origDur + dx / pixelsPerSecond))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pixelsPerSecond, onResizeClip])

  // Keyboard: delete selected clip
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
      for (const track of timeline.tracks) {
        if (track.clips.some((c) => c.id === selectedClipId)) {
          onRemoveClip(track.id, selectedClipId)
          break
        }
      }
    }
  }, [selectedClipId, timeline.tracks, onRemoveClip])

  // Drop zone pointer events for inter-panel drag
  const handleTrackPointerMove = useCallback((e: React.PointerEvent, track: Track) => {
    if (!drag) return
    if (!scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const scrollLeft = scrollRef.current.scrollLeft
    const rawTime = (e.clientX - rect.left + scrollLeft - 140) / pixelsPerSecond
    const snapped = snapTime(Math.max(0, rawTime), track.clips, snapOn, pixelsPerSecond)
    onDragOver(track.id, snapped)
  }, [drag, pixelsPerSecond, snapOn, onDragOver])

  const handleTrackPointerUp = useCallback((e: React.PointerEvent, track: Track) => {
    if (!drag) return
    const compatible = (drag.media.kind === 'image' && track.kind === 'video') || (drag.media.kind === 'audio' && track.kind === 'audio')
    if (!compatible || track.locked) { onDragOver(null, 0); return }
    if (!scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const scrollLeft = scrollRef.current.scrollLeft
    const rawTime = (e.clientX - rect.left + scrollLeft - 140) / pixelsPerSecond
    const snapped = snapTime(Math.max(0, rawTime), track.clips, snapOn, pixelsPerSecond)
    onDrop(track.id, snapped)
  }, [drag, pixelsPerSecond, snapOn, onDragOver, onDrop])

  // Ruler ticks
  const rulerStep = pixelsPerSecond >= 40 ? 1 : pixelsPerSecond >= 20 ? 2 : 5
  const majorEvery = 5
  const tickCount = Math.ceil(rulerWidth / pixelsPerSecond) + 1

  const playheadLeft = 140 + playhead * pixelsPerSecond

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col shrink-0 outline-none"
      style={{ height: 280, background: 'var(--paper-2)', borderTop: '1.5px solid var(--line)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 36, borderBottom: '1px solid var(--line-soft)' }}>
        <span style={{ fontSize: 20, fontWeight: 600, fontFamily: 'Caveat, cursive', color: 'var(--ink)' }}>Timeline</span>
        <button disabled style={{ fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 6px', background: 'transparent', cursor: 'not-allowed' }}>+ Video track</button>
        <button
          onClick={onAddAudioTrack}
          style={{ fontSize: 10, color: 'var(--ink-2)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 6px', background: 'transparent', cursor: 'pointer' }}
        >+ Audio track</button>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--ink-3)', marginLeft: 'auto' }}>{clipCount} clips · {totalDuration.toFixed(1)}s</span>
        <label className="flex items-center gap-1">
          <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Zoom</span>
          <input type="range" min={30} max={200} value={zoom} onChange={(e) => onZoomChange(Number(e.target.value))}
            style={{ width: 80, accentColor: 'var(--accent)' }} />
        </label>
      </div>

      {/* Tracks + ruler area */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative">
        {/* Playhead line */}
        <div style={{
          position: 'absolute', left: playheadLeft, top: 0, bottom: 0,
          width: 2, background: 'var(--accent)', zIndex: 10, pointerEvents: 'none',
        }}>
          <div style={{ width: 10, height: 10, background: 'var(--accent)', clipPath: 'polygon(50% 100%, 0 0, 100% 0)', marginLeft: -4 }} />
        </div>

        {/* Ruler */}
        <div
          onClick={handleRulerClick}
          style={{
            position: 'sticky', top: 0, zIndex: 5,
            height: 24, display: 'flex', alignItems: 'flex-end',
            paddingLeft: 140, width: rulerWidth + 140,
            background: 'var(--paper-2)', borderBottom: '1px solid var(--line-soft)',
            cursor: 'crosshair',
          }}
        >
          {Array.from({ length: tickCount }, (_, i) => {
            const t = i * rulerStep
            const isMajor = t % (rulerStep * majorEvery) === 0
            return (
              <div key={i} style={{ position: 'absolute', left: 140 + t * pixelsPerSecond }}>
                <div style={{ width: 1, height: isMajor ? 12 : 6, background: 'var(--line-soft)', marginLeft: -0.5 }} />
                {isMajor && (
                  <span style={{ position: 'absolute', top: -13, left: 3, fontSize: 9, fontFamily: 'monospace', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                    {formatRulerLabel(t)}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Tracks */}
        {timeline.tracks.map((track) => {
          const isDropTarget = drag !== null && drag.overTrackId === track.id
          const compatible = drag !== null && ((drag.media.kind === 'image' && track.kind === 'video') || (drag.media.kind === 'audio' && track.kind === 'audio'))
          const trackHeight = track.kind === 'video' ? 52 : 36

          return (
            <div
              key={track.id}
              style={{
                display: 'flex',
                height: trackHeight,
                borderBottom: '1px dashed var(--line-soft)',
              }}
            >
              {/* Track header */}
              <div
                className="flex items-center gap-1 px-2 shrink-0"
                style={{ width: 140, background: 'var(--paper-2)', borderRight: '1.5px solid var(--line)' }}
              >
                <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>{track.kind === 'video' ? '🖼' : '♪'}</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>{track.id}</span>
                <span style={{ fontSize: 10, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</span>
                <button
                  onClick={() => onToggleMute(track.id)}
                  style={{ fontSize: 9, fontWeight: 700, color: track.muted ? 'var(--accent)' : 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px' }}
                  title="Mute"
                >M</button>
                <button
                  onClick={() => onToggleLock(track.id)}
                  style={{ fontSize: 9, color: track.locked ? 'var(--accent)' : 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px' }}
                  title="Lock"
                >🔒</button>
                {track.removable && (
                  <button
                    onClick={() => onRemoveAudioTrack(track.id)}
                    style={{ fontSize: 9, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px' }}
                    title="Remove track"
                  >✕</button>
                )}
              </div>

              {/* Clip area */}
              <div
                data-track-row={track.id}
                onPointerMove={(e) => handleTrackPointerMove(e, track)}
                onPointerUp={(e) => handleTrackPointerUp(e, track)}
                style={{
                  position: 'relative', flex: 1,
                  width: rulerWidth,
                  background: isDropTarget && compatible ? 'var(--accent-soft)' : (track.kind === 'audio' ? 'rgba(0,0,0,.03)' : 'transparent'),
                }}
              >
                {track.clips.map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    track={track}
                    selected={clip.id === selectedClipId}
                    pixelsPerSecond={pixelsPerSecond}
                    onSelect={() => onSelectClip(clip.id)}
                    onMoveStart={(e) => startClipMove(e, clip, track)}
                    onResizeStart={(e) => startClipResize(e, clip, track)}
                  />
                ))}

                {/* Drop insert line */}
                {isDropTarget && compatible && drag && (
                  <div style={{
                    position: 'absolute',
                    left: drag.overTime * pixelsPerSecond,
                    top: 0, bottom: 0, width: 3,
                    background: 'var(--accent)',
                    pointerEvents: 'none',
                  }} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
