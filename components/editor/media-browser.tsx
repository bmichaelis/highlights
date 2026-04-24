'use client'
import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from './types'

type PlaylistItem = {
  id: string
  driveFileId: string
  thumbnailUrl: string | null
  playerName: string
}

type Props = {
  orgSlug: string
  teamId: string
  projectId: string
  onDragStart: (media: MediaItem, e: React.PointerEvent) => void
}

export function MediaBrowser({ orgSlug, teamId, projectId, onDragStart }: Props) {
  const [tab, setTab] = useState<'photos' | 'audio'>('photos')
  const [photos, setPhotos] = useState<PlaylistItem[]>([])
  const [audioFiles, setAudioFiles] = useState<{ id: string; name: string }[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [uploadGeneration, setUploadGeneration] = useState(0)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const audioLoadedRef = useRef(false)
  const apiBase = `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`

  useEffect(() => { loadPhotos() }, [projectId, uploadGeneration])

  useEffect(() => {
    audioLoadedRef.current = false
    setAudioFiles([])
  }, [projectId, uploadGeneration])

  useEffect(() => {
    if (tab === 'audio' && !audioLoadedRef.current) {
      audioLoadedRef.current = true
      loadAudio()
    }
  }, [tab, projectId, uploadGeneration])

  async function loadPhotos() {
    const res = await fetch(`${apiBase}/playlist`)
    if (!res.ok) return
    const items = await res.json() as PlaylistItem[]
    setPhotos(items)
  }

  async function loadAudio() {
    const res = await fetch(`${apiBase}/audio`)
    if (!res.ok) return
    const data = await res.json() as { files: { id: string; name: string }[] }
    setAudioFiles(data.files)
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || uploadStatus) return
    const total = files.length
    try {
      for (let i = 0; i < total; i++) {
        setUploadStatus(`Uploading ${i + 1}/${total}…`)
        const fd = new FormData()
        fd.append('file', files[i])
        await fetch(`${apiBase}/upload`, { method: 'POST', body: fd })
      }
      if (tab === 'photos') {
        await fetch(`${apiBase}/playlist`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'resequence' }),
        })
      }
      setUploadGeneration((g) => g + 1)
    } finally {
      setUploadStatus(null)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch(`${apiBase}/playlist`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'resequence' }),
      })
      await loadPhotos()
      if (tab === 'audio') await loadAudio()
    } finally {
      setRefreshing(false)
    }
  }

  const tabStyle = (active: boolean) => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 3,
    border: '1px solid',
    borderColor: active ? 'var(--line)' : 'var(--line-soft)',
    background: active ? 'var(--paper-2)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink-3)',
    cursor: 'pointer',
  } as React.CSSProperties)

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 270, background: 'var(--paper-2)', borderRight: '1.5px solid var(--line)', overflow: 'hidden' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--line-soft)' }}>
        <span style={{ fontSize: 19, fontWeight: 600, fontFamily: 'Caveat, cursive', color: 'var(--ink)' }}>Media</span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button style={tabStyle(tab === 'photos')} onClick={() => setTab('photos')}>Photos</button>
        <button style={tabStyle(tab === 'audio')} onClick={() => setTab('audio')}>Audio</button>
        <div style={{ flex: 1 }} />
        {uploadStatus ? (
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{uploadStatus}</span>
        ) : (
          <button
            onClick={() => (tab === 'photos' ? photoInputRef : audioInputRef).current?.click()}
            style={{ fontSize: 11, color: 'var(--ink-3)', background: 'none', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer' }}
          >
            Upload
          </button>
        )}
        <input
          ref={photoInputRef}
          type="file"
          multiple
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { handleUpload(e.target.files); e.target.value = '' }}
        />
        <input
          ref={audioInputRef}
          type="file"
          multiple
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => { handleUpload(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2">
        {tab === 'photos' && (
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {photos.map((item) => {
              const media: MediaItem = {
                id: item.driveFileId,
                kind: 'image',
                filename: item.playerName,
                thumbnailUrl: item.thumbnailUrl ?? undefined,
                defaultDuration: 3.5,
              }
              return (
                <div
                  key={item.id}
                  onPointerDown={(e) => onDragStart(media, e)}
                  style={{
                    width: 72, height: 54, borderRadius: 2,
                    border: '1px solid var(--line-soft)',
                    background: 'var(--paper-3)',
                    overflow: 'hidden', cursor: 'grab', touchAction: 'none',
                  }}
                >
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt={item.playerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'var(--track-v)' }} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'audio' && (
          <div className="flex flex-col gap-1 py-1">
            {audioFiles.map((f) => {
              const media: MediaItem = {
                id: f.id,
                kind: 'audio',
                filename: f.name,
                defaultDuration: 120,
              }
              return (
                <div
                  key={f.id}
                  onPointerDown={(e) => onDragStart(media, e)}
                  className="flex items-center gap-2 px-2 py-2"
                  style={{ border: '1px solid var(--line-soft)', borderRadius: 3, background: 'var(--paper)', cursor: 'grab', touchAction: 'none' }}
                >
                  <span style={{ fontSize: 14 }}>♪</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                </div>
              )
            })}
            {audioFiles.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--ink-3)', padding: '8px 4px' }}>No audio files in this folder</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2" style={{ borderTop: '1px solid var(--line-soft)' }}>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ width: '100%', fontSize: 11, color: 'var(--ink-2)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '4px 0', background: 'transparent', cursor: refreshing ? 'default' : 'pointer' }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh from Drive'}
        </button>
      </div>
    </div>
  )
}
