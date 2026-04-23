'use client'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { toFFmpegJson } from './to-ffmpeg-json'
import type { Timeline } from './types'

type Props = {
  timeline: Timeline
  projectSlug: string
  onClose: () => void
}

export function JsonPanel({ timeline, projectSlug, onClose }: Props) {
  const json = JSON.stringify(toFFmpegJson(timeline, projectSlug), null, 2)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleCopy() {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const btnStyle: CSSProperties = {
    fontSize: 11,
    color: 'var(--ink-2)',
    background: 'transparent',
    border: '1px solid var(--line-soft)',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
  }

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000 }}
      />
      {/* panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 600,
          height: '70vh',
          background: 'var(--paper-2)',
          borderRadius: 8,
          boxShadow: '0 16px 48px rgba(0,0,0,.45)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1001,
          overflow: 'hidden',
        }}
      >
        {/* header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1.5px solid var(--line)',
            background: 'var(--paper-3)',
          }}
        >
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink)', flex: 1 }}>
            ffmpeg JSON
          </span>
          <button onClick={handleCopy} style={btnStyle}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={onClose} style={{ ...btnStyle, fontSize: 16, padding: '0 6px', lineHeight: '20px' }}>
            ×
          </button>
        </div>
        {/* body */}
        <pre
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 12,
            margin: 0,
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--ink)',
            lineHeight: 1.5,
          }}
        >
          {json}
        </pre>
      </div>
    </>
  )
}
