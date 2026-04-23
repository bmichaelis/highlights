'use client'
import type { CSSProperties } from 'react'
import type { Timeline, Clip, KBPosition } from './types'
import { DEFAULT_KB } from './types'

type Props = {
  timeline: Timeline
  selectedClipId: string | null
  onUpdateClip: (trackId: 'V1' | 'A1', clipId: string, patch: Partial<Pick<Clip, 'fadeIn' | 'fadeOut' | 'kenBurns'>>) => void
}

const panelStyle: CSSProperties = {
  width: 180,
  flexShrink: 0,
  background: 'var(--paper-2)',
  borderLeft: '1.5px solid var(--line)',
  padding: '10px',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
}

const KB_POSITIONS: KBPosition[][] = [
  ['top-left', 'top', 'top-right'],
  ['left', 'center', 'right'],
  ['bottom-left', 'bottom', 'bottom-right'],
]

function FadeControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{label}</span>
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={value}
          onChange={(e) => onChange(Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)))}
          style={{
            width: 40,
            fontSize: 10,
            fontFamily: 'monospace',
            background: 'var(--paper-3)',
            color: 'var(--ink)',
            border: '1px solid var(--line-soft)',
            borderRadius: 2,
            padding: '1px 3px',
            textAlign: 'right',
          }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={2}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
    </div>
  )
}

function KBGrid({
  label,
  value,
  onChange,
}: {
  label: string
  value: KBPosition
  onChange: (v: KBPosition) => void
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 20px)', gap: 2 }}>
        {KB_POSITIONS.flat().map((pos) => (
          <button
            key={pos}
            title={pos}
            onClick={() => onChange(pos)}
            style={{
              width: 20,
              height: 20,
              border: `1px solid ${pos === value ? 'var(--accent)' : 'var(--line-soft)'}`,
              borderRadius: 2,
              background: pos === value ? 'var(--accent)' : 'var(--paper)',
              opacity: pos === value ? 0.8 : 1,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function InspectorPanel({ timeline, selectedClipId, onUpdateClip }: Props) {
  let selectedClip: Clip | null = null
  let selectedTrackId: 'V1' | 'A1' | null = null
  for (const track of timeline.tracks) {
    const c = track.clips.find((c) => c.id === selectedClipId)
    if (c) { selectedClip = c; selectedTrackId = track.id as 'V1' | 'A1'; break }
  }

  if (!selectedClip || !selectedTrackId) {
    return (
      <div style={panelStyle}>
        <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace', textAlign: 'center', marginTop: 24 }}>
          Select a clip to edit its properties
        </span>
      </div>
    )
  }

  const clip = selectedClip
  const trackId = selectedTrackId
  const fadeIn = clip.fadeIn ?? 0.2
  const fadeOut = clip.fadeOut ?? 0.2
  const filename = clip.filename.length > 20 ? clip.filename.slice(0, 17) + '…' : clip.filename
  const isVideo = trackId === 'V1'
  const isOn = clip.kenBurns !== null
  const effectiveKB = clip.kenBurns ?? DEFAULT_KB

  return (
    <div style={panelStyle}>
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ink)', marginBottom: 2, wordBreak: 'break-all' }}>
        {filename}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ink-3)', marginBottom: 10 }}>
        {clip.duration.toFixed(1)}s
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '0 0 10px' }} />
      <FadeControl
        label="Fade In"
        value={fadeIn}
        onChange={(v) => onUpdateClip(trackId, clip.id, { fadeIn: v })}
      />
      <FadeControl
        label="Fade Out"
        value={fadeOut}
        onChange={(v) => onUpdateClip(trackId, clip.id, { fadeOut: v })}
      />
      {isVideo && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '0 0 10px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>Ken Burns</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isOn}
                onChange={(e) => onUpdateClip(trackId, clip.id, { kenBurns: e.target.checked ? DEFAULT_KB : null })}
                style={{ accentColor: 'var(--accent)', width: 11, height: 11 }}
              />
              <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{isOn ? 'on' : 'off'}</span>
            </label>
          </div>
          {isOn && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <KBGrid
                  label="Start"
                  value={effectiveKB.from}
                  onChange={(v) => onUpdateClip(trackId, clip.id, { kenBurns: { ...effectiveKB, from: v } })}
                />
                <KBGrid
                  label="End"
                  value={effectiveKB.to}
                  onChange={(v) => onUpdateClip(trackId, clip.id, { kenBurns: { ...effectiveKB, to: v } })}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>Scale</span>
                <input
                  type="range"
                  min={1}
                  max={1.3}
                  step={0.01}
                  value={effectiveKB.scale}
                  onChange={(e) => onUpdateClip(trackId, clip.id, { kenBurns: { ...effectiveKB, scale: parseFloat(e.target.value) } })}
                  style={{ width: 60, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 10, color: 'var(--ink)', minWidth: 30, textAlign: 'right', fontFamily: 'monospace' }}>
                  {effectiveKB.scale.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
