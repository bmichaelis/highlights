'use client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PlaylistItem } from './types'

type Props = {
  item: PlaylistItem
  defaultDuration: number
  onRemove: (id: string) => void
  onDurationChange: (id: string, duration: number) => void
}

export function ImageCard({ item, defaultDuration, onRemove, onDurationChange }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const date = item.exifDate ? new Date(item.exifDate).toLocaleDateString() : 'Unknown date'

  return (
    <div ref={setNodeRef} style={style}
      className="flex items-center gap-3 p-3 border border-gray-700 rounded-lg bg-gray-800 shadow-sm">
      <button {...attributes} {...listeners}
        className="cursor-grab text-gray-500 hover:text-gray-300 px-1">⠿</button>

      {item.thumbnailUrl ? (
        <img src={item.thumbnailUrl} alt={item.playerName} className="w-16 h-12 object-cover rounded" />
      ) : (
        <div className="w-16 h-12 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-500">
          No preview
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate text-gray-100">{item.playerName}</p>
        <p className="text-xs text-gray-400">{date}</p>
      </div>

      <div className="flex items-center gap-1">
        <input
          type="number" min={0.5} max={30} step={0.5}
          value={item.durationOverride ?? defaultDuration}
          onChange={(e) => onDurationChange(item.id, Number(e.target.value))}
          className="w-16 border border-gray-600 bg-gray-700 text-gray-100 rounded px-2 py-1 text-sm text-center"
        />
        <span className="text-xs text-gray-400">sec</span>
      </div>

      <button onClick={() => onRemove(item.id)}
        className="text-red-500 hover:text-red-400 px-1 text-lg leading-none">×</button>
    </div>
  )
}
