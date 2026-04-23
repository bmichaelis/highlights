'use client'

type Props = {
  snapOn: boolean
  onSnapChange: (on: boolean) => void
}

export function EditorToolbar({ snapOn, onSnapChange }: Props) {
  return (
    <div
      className="flex items-center gap-2 px-3 shrink-0"
      style={{ height: 34, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--line)' }}
    >
      <button
        title="Import media (coming soon)"
        disabled
        style={{ fontSize: 11, color: 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 8px', background: 'transparent', cursor: 'not-allowed' }}
      >
        ⬆ Import
      </button>
      <button
        title="Split clip at playhead (coming soon)"
        disabled
        style={{ fontSize: 11, color: 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '1px 8px', background: 'transparent', cursor: 'not-allowed' }}
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

      <span style={{ fontSize: 9, color: 'var(--ink-3)', fontFamily: 'monospace', marginLeft: 'auto' }}>
        16:9 · 1920×1080 · 30fps
      </span>
    </div>
  )
}
