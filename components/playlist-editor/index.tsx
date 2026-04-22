'use client'
import { useEffect, useState, useCallback } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { ImageCard } from './image-card'
import { MusicPanel } from './music-panel'
import type { PlaylistItem } from './types'

type Props = {
  orgSlug: string; teamId: string; projectId: string
  defaultDuration: number; projectStatus: string
  onRender: () => void; renderLoading: boolean
}

export function PlaylistEditor({ orgSlug, teamId, projectId, defaultDuration, projectStatus, onRender, renderLoading }: Props) {
  const [items, setItems] = useState<PlaylistItem[]>([])
  const [loading, setLoading] = useState(true)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchPlaylist = useCallback(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/playlist`)
      .then((r) => r.json() as Promise<PlaylistItem[]>)
      .then(setItems)
      .finally(() => setLoading(false))
  }, [orgSlug, teamId, projectId])

  useEffect(() => { fetchPlaylist() }, [fetchPlaylist])

  async function patchPlaylist(body: object): Promise<boolean> {
    const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/playlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    const reordered = arrayMove(items, oldIndex, newIndex).map((item, pos) => ({ ...item, position: pos }))
    setItems(reordered)
    patchPlaylist({ type: 'reorder', items: reordered.map(({ id, position }) => ({ id, position })) })
      .then((ok) => { if (!ok) fetchPlaylist() })
  }

  function handleRemove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id).map((item, pos) => ({ ...item, position: pos })))
    patchPlaylist({ type: 'remove', id })
      .then((ok) => { if (!ok) fetchPlaylist() })
  }

  function handleDurationChange(id: string, duration: number) {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, durationOverride: duration } : i))
    patchPlaylist({ type: 'duration', id, duration })
      .then((ok) => { if (!ok) fetchPlaylist() })
  }

  async function handleResequence() {
    setLoading(true)
    const ok = await patchPlaylist({ type: 'resequence' })
    if (ok) {
      fetchPlaylist()
    } else {
      setLoading(false)
    }
  }

  const totalSecs = items.reduce((sum, i) => sum + (i.durationOverride ?? defaultDuration), 0)
  const totalMins = (totalSecs / 60).toFixed(1)
  const isRenderable = projectStatus === 'draft' || projectStatus === 'failed'

  if (loading) return <p className="text-gray-400">Loading playlist…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{items.length} images · ~{totalMins} min</p>
        <div className="flex gap-2">
          <button onClick={handleResequence}
            className="text-sm px-3 py-1.5 border border-gray-600 rounded-lg hover:bg-gray-800 text-gray-200">
            Re-sequence
          </button>
          {isRenderable && (
            <button onClick={onRender} disabled={renderLoading || items.length === 0}
              className="text-sm px-4 py-1.5 bg-green-600 text-white rounded-lg disabled:opacity-50">
              {renderLoading ? 'Queuing…' : 'Render Video'}
            </button>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((item) => (
              <ImageCard key={item.id} item={item} defaultDuration={defaultDuration}
                onRemove={handleRemove} onDurationChange={handleDurationChange} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <MusicPanel orgSlug={orgSlug} teamId={teamId} projectId={projectId} />
    </div>
  )
}
