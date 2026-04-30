'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { editorReducer, initialHistory, emptyTimeline } from './use-editor'
import { useReducer } from 'react'
import { toFFmpegJson } from './to-ffmpeg-json'
import { EditorTopBar } from './editor-top-bar'
import { EditorToolbar } from './editor-toolbar'
import { MediaBrowser } from './media-browser'
import { PreviewPanel } from './preview-panel'
import { Timeline } from './timeline'
import { InspectorPanel } from './inspector-panel'
import { JsonPanel } from './json-panel'
import type { Timeline as TimelineType, MediaItem, Clip, DragState, EditorAction } from './types'

type Props = {
  orgSlug: string
  teamId: string
  projectId: string
  projectName: string
  projectSlug: string
  initialTimeline: TimelineType | null
  playlistItems: { driveFileId: string; duration: number | null; position: number; thumbnailUrl: string | null }[]
  secondsPerImage: number
}

function bootstrap(
  playlistItems: { driveFileId: string; duration: number | null; position: number; thumbnailUrl: string | null }[],
  secondsPerImage: number,
): TimelineType {
  const clips: Clip[] = playlistItems
    .sort((a, b) => a.position - b.position)
    .reduce<{ clips: Clip[]; cursor: number }>((acc, item, i) => {
      const dur = item.duration ?? secondsPerImage
      acc.clips.push({
        id: `boot-${i}`,
        mediaId: item.driveFileId,
        filename: item.driveFileId.slice(-8),
        thumbnailUrl: item.thumbnailUrl ?? undefined,
        start: acc.cursor,
        duration: dur,
      })
      acc.cursor += dur
      return acc
    }, { clips: [], cursor: 0 }).clips
  return {
    tracks: [
      { id: 'V1', kind: 'video', name: 'Photos', muted: false, locked: false, removable: false, clips },
      { id: 'A1', kind: 'audio', name: 'Music', muted: false, locked: false, removable: false, clips: [] },
    ],
  }
}

export function Editor({ orgSlug, teamId, projectId, projectName, projectSlug, initialTimeline, playlistItems, secondsPerImage }: Props) {
  const startTimeline = initialTimeline ?? (playlistItems.length > 0 ? bootstrap(playlistItems, secondsPerImage) : emptyTimeline)
  const [history, dispatch] = useReducer(editorReducer, initialHistory(startTimeline))
  const timeline = history.present

  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(() => Number(typeof window !== 'undefined' ? localStorage.getItem('kr-zoom') ?? '80' : '80'))
  const [snapOn, setSnapOn] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('kr-snap') !== 'false' : true)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [renderStatus, setRenderStatus] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didMountRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const apiBase = `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`
  const audioBase = `${apiBase}/audio`

  const audioDurationCache = useRef<Map<string, Promise<number | null>>>(new Map())

  const probeAudioDuration = useCallback((mediaId: string): Promise<number | null> => {
    const cached = audioDurationCache.current.get(mediaId)
    if (cached) return cached
    const p = new Promise<number | null>((resolve) => {
      const a = new Audio()
      a.preload = 'metadata'
      const finish = (dur: number | null) => {
        // Release the connection so the preview-panel <audio> isn't competing
        // for the same URL on the HTTP/2 connection.
        a.removeAttribute('src')
        a.load()
        resolve(dur)
      }
      a.onloadedmetadata = () => finish(isFinite(a.duration) ? a.duration : null)
      a.onerror = () => finish(null)
      a.src = `${audioBase}/${mediaId}`
    })
    audioDurationCache.current.set(mediaId, p)
    return p
  }, [audioBase])

  // Stable ref for values needed by keyboard handler (avoids stale closures in useEffect([]))
  const editorStateRef = useRef({ timeline, playhead, snapOn })
  useEffect(() => { editorStateRef.current = { timeline, playhead, snapOn } })

  const totalDuration = Math.max(
    ...timeline.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)),
    0
  )

  const canSplit = timeline.tracks.some((t) => {
    if (t.locked) return false
    return t.clips.some((c) => c.start < playhead && playhead < c.start + c.duration)
  })

  function handleSplit() {
    const { timeline: tl, playhead: ph } = editorStateRef.current
    for (const track of tl.tracks) {
      if (track.locked) continue
      const clip = track.clips.find((c) => c.start < ph && ph < c.start + c.duration)
      if (clip) dispatch({ type: 'SPLIT_CLIP', trackId: track.id, clipId: clip.id, at: ph })
    }
  }

  // Ref to call stable handleSplit in keyboard handler
  const handleSplitRef = useRef(handleSplit)
  useEffect(() => { handleSplitRef.current = handleSplit })

  // Play loop
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastTimeRef.current = null; return }
    function tick(now: number) {
      if (lastTimeRef.current === null) { lastTimeRef.current = now }
      const dt = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now
      setPlayhead((p) => {
        const next = p + dt
        if (next >= totalDuration) { setPlaying(false); return totalDuration }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playing, totalDuration])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const meta = e.metaKey || e.ctrlKey
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p) }
      if (meta && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      if (meta && e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); dispatch({ type: 'REDO' }) }
      if (meta && e.code === 'KeyY') { e.preventDefault(); dispatch({ type: 'REDO' }) }
      if (e.code === 'KeyS' && !meta) { e.preventDefault(); handleSplitRef.current() }
      if (e.code === 'KeyN' && !meta) {
        e.preventDefault()
        setSnapOn((s) => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // localStorage persistence
  useEffect(() => { localStorage.setItem('kr-zoom', String(zoom)) }, [zoom])
  useEffect(() => { localStorage.setItem('kr-snap', String(snapOn)) }, [snapOn])

  // Auto-save on timeline change
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await fetch(`${apiBase}/timeline`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeline }),
        })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch { setSaveStatus('idle') }
    }, 1000)
  }, [timeline, apiBase])

  // Poll render status on mount
  useEffect(() => {
    fetch(`${apiBase}/render`).then((r) => r.json()).then((job: unknown) => { const j = job as { status?: string }; if (j?.status) setRenderStatus(j.status) }).catch(() => {})
  }, [apiBase])

  // Drag-from-browser global pointer handlers
  useEffect(() => {
    if (!drag) return
    function onPointerMove(e: PointerEvent) {
      setDrag((d) => d ? { ...d, curX: e.clientX, curY: e.clientY } : null)
    }
    function onPointerUp() { setDrag(null) }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp) }
  }, [!!drag])

  const handleDragStart = useCallback((media: MediaItem, e: React.PointerEvent) => {
    e.preventDefault()
    setDrag({ media, curX: e.clientX, curY: e.clientY, overTrackId: null, overTime: 0 })
  }, [])

  const handleDragOver = useCallback((trackId: string | null, time: number) => {
    setDrag((d) => d ? { ...d, overTrackId: trackId, overTime: time } : null)
  }, [])

  const handleDrop = useCallback(async (trackId: string, time: number) => {
    if (!drag) return
    const media = drag.media
    setDrag(null)
    const newClip: Clip = {
      id: `c-${crypto.randomUUID()}`,
      mediaId: media.id,
      filename: media.filename,
      thumbnailUrl: media.thumbnailUrl,
      start: time,
      duration: media.defaultDuration,
    }
    if (media.kind === 'audio') {
      const dur = await probeAudioDuration(media.id)
      if (dur === null) {
        console.warn('Audio duration probe failed for', media.id)
      } else {
        newClip.sourceDuration = dur
      }
    }
    dispatch({ type: 'ADD_CLIP', trackId, clip: newClip })
  }, [drag, probeAudioDuration])

  const handleUpdateClip = useCallback((trackId: string, clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>>) => {
    dispatch({ type: 'UPDATE_CLIP', trackId, clipId, patch })
  }, [])

  const handleAddAudioTrack = useCallback(() => {
    dispatch({ type: 'ADD_AUDIO_TRACK' })
  }, [])

  const handleRemoveAudioTrack = useCallback((trackId: string) => {
    dispatch({ type: 'REMOVE_AUDIO_TRACK', trackId })
  }, [])

  async function handleExport() {
    const ffmpegJson = toFFmpegJson(timeline, projectSlug)
    const res = await fetch(`${apiBase}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timelineJson: JSON.stringify(ffmpegJson) }),
    })
    if (res.ok) {
      const job = await res.json() as { status: string }
      setRenderStatus(job.status)
    }
  }

  function handleManualSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    fetch(`${apiBase}/timeline`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline }),
    }).then(() => { setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000) })
  }

  const v1 = timeline.tracks.find((t) => t.id === 'V1')!
  const prevTime = v1.clips.map((c) => c.start).filter((s) => s < playhead - 0.01).sort((a, b) => b - a)[0] ?? 0
  const nextTime = v1.clips.map((c) => c.start).filter((s) => s > playhead + 0.01).sort((a, b) => a - b)[0] ?? playhead

  return (
    <div
      className="editor-root flex flex-col"
      style={{ height: 'calc(100dvh - 3.5rem)', overflow: 'hidden' }}
    >
      <EditorTopBar
        projectName={projectName}
        orgSlug={orgSlug}
        teamId={teamId}
        projectId={projectId}
        history={history}
        saveStatus={saveStatus}
        renderStatus={renderStatus}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
        onSave={handleManualSave}
        onExport={handleExport}
        dispatch={dispatch as (a: { type: string }) => void}
      />
      <EditorToolbar
        snapOn={snapOn}
        onSnapChange={setSnapOn}
        canSplit={canSplit}
        onSplit={handleSplit}
        showJson={showJson}
        onToggleJson={() => setShowJson((v) => !v)}
      />

      <div className="flex flex-1 min-h-0">
        <MediaBrowser
          orgSlug={orgSlug}
          teamId={teamId}
          projectId={projectId}
          onDragStart={handleDragStart}
        />
        <PreviewPanel
          timeline={timeline}
          playhead={playhead}
          playing={playing}
          totalDuration={totalDuration}
          audioBaseUrl={audioBase}
          onSeek={setPlayhead}
          onPlayPause={() => setPlaying((p) => !p)}
          onPrev={() => setPlayhead(prevTime)}
          onNext={() => setPlayhead(nextTime)}
        />
        <InspectorPanel
          timeline={timeline}
          selectedClipId={selectedClipId}
          onUpdateClip={handleUpdateClip}
          onTrimLeft={(tid, cid, newSourceIn) => dispatch({ type: 'TRIM_LEFT', trackId: tid, clipId: cid, newSourceIn })}
          onResizeClip={(tid, cid, dur) => dispatch({ type: 'RESIZE_CLIP', trackId: tid, clipId: cid, newDuration: dur })}
        />
      </div>

      <Timeline
        timeline={timeline}
        playhead={playhead}
        zoom={zoom}
        selectedClipId={selectedClipId}
        snapOn={snapOn}
        drag={drag}
        totalDuration={totalDuration}
        onSeekRuler={setPlayhead}
        onZoomChange={setZoom}
        onMoveClip={(tid, cid, start) => dispatch({ type: 'MOVE_CLIP', trackId: tid, clipId: cid, newStart: start })}
        onResizeClip={(tid, cid, dur) => dispatch({ type: 'RESIZE_CLIP', trackId: tid, clipId: cid, newDuration: dur })}
        onTrimLeftClip={(tid, cid, newSourceIn) => dispatch({ type: 'TRIM_LEFT', trackId: tid, clipId: cid, newSourceIn })}
        onRemoveClip={(tid, cid) => dispatch({ type: 'REMOVE_CLIP', trackId: tid, clipId: cid })}
        onSelectClip={setSelectedClipId}
        onToggleMute={(tid) => dispatch({ type: 'TOGGLE_MUTE', trackId: tid })}
        onToggleLock={(tid) => dispatch({ type: 'TOGGLE_LOCK', trackId: tid })}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onAddAudioTrack={handleAddAudioTrack}
        onRemoveAudioTrack={handleRemoveAudioTrack}
      />

      {/* Drag ghost */}
      {drag && (
        <div
          style={{
            position: 'fixed',
            left: drag.curX - 36,
            top: drag.curY - 27,
            width: 72, height: 54,
            background: 'var(--paper-3)',
            border: '1.5px solid var(--line)',
            borderRadius: 3,
            boxShadow: '0 10px 24px rgba(0,0,0,.28)',
            transform: 'rotate(-2deg)',
            pointerEvents: 'none',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {drag.media.thumbnailUrl && (
            <img src={drag.media.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>
      )}

      {showJson && (
        <JsonPanel
          timeline={timeline}
          projectSlug={projectSlug}
          onClose={() => setShowJson(false)}
        />
      )}
    </div>
  )
}
