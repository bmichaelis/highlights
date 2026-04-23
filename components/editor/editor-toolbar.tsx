'use client'
import type { CSSProperties } from 'react'

type Props = {
  snapOn: boolean
  onSnapChange: (on: boolean) => void
  canSplit: boolean
  onSplit: () => void
  showJson: boolean
  onToggleJson: () => void
}

export function EditorToolbar({ snapOn, onSnapChange, canSplit, onSplit, showJson, onToggleJson }: Props) {
  const btnBase: CSSProperties = {
    fontSize: 11,
    border: '1px solid var(--line-soft)',
    borderRadius: 3,
    padding: '1px 8px',
    background: 'transparent',
  }

  return (
    <div
      className="flex items-center gap-2 px-3 shrink-0"
      style={{ height: 34, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--line)' }}
    >
      <button
        title="Import media (coming soon)"
        disabled
        style={{ ...btnBase, color: 'var(--ink-3)', cursor: 'not-allowed' }}
      >
        ⬆ Import
      </button>
      <button
        title={canSplit ? 'Split clip at playhead (S)' : 'Move playhead over a clip to split'}
        disabled={!canSplit}
        onClick={onSplit}
        style={{ ...btnBase, color: canSplit ? 'var(--ink)' : 'var(--ink-3)', cursor: canSplit ? 'pointer' : 'not-allowed' }}
      >
        ✂ Split
      </button>

      <div style={{ width: 1, height: 16, background: 'var(--line-soft)', margin: '0 4px' }} />

      <label className="flex items-center gap-1" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={snapOn}
          onChange={(e) => onSnapChange(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 12, height: 12 }}
        />
        <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>Snap</span>
      </label>

      <button
        title="View ffmpeg JSON"
        onClick={onToggleJson}
        style={{
          ...btnBase,
          marginLeft: 'auto',
          fontFamily: 'monospace',
          color: showJson ? 'var(--accent)' : 'var(--ink-2)',
          borderColor: showJson ? 'var(--accent)' : 'var(--line-soft)',
          cursor: 'pointer',
        }}
      >
        {'{ }'}
      </button>

      <span style={{ fontSize: 9, color: 'var(--ink-3)', fontFamily: 'monospace' }}>
        16:9 · 1920×1080 · 30fps
      </span>
    </div>
  )
}
