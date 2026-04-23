'use client'
import Link from 'next/link'
import type { Timeline } from './types'
import type { HistoryState } from './types'

type Props = {
  projectName: string
  orgSlug: string
  teamId: string
  projectId: string
  history: HistoryState
  saveStatus: 'idle' | 'saving' | 'saved'
  renderStatus: string | null
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onExport: () => void
  dispatch: (action: { type: string }) => void
}

export function EditorTopBar({
  projectName, orgSlug, teamId, projectId,
  history, saveStatus, renderStatus,
  onUndo, onRedo, onSave, onExport,
}: Props) {
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0
  const isRendering = renderStatus === 'pending' || renderStatus === 'running'

  return (
    <div
      className="flex items-center gap-2 px-3 shrink-0"
      style={{ height: 42, background: 'var(--paper-2)', borderBottom: '1.5px solid var(--line)' }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Caveat, cursive' }}>
        KickReel
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {projectName}
      </span>

      <div className="flex items-center gap-1 ml-auto">
        {saveStatus === 'saving' && (
          <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }}>Saving…</span>
        )}
        {saveStatus === 'saved' && (
          <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }}>Saved</span>
        )}

        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          style={{ fontSize: 11, color: canUndo ? 'var(--ink-2)' : 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '2px 6px', background: 'transparent', cursor: canUndo ? 'pointer' : 'default' }}
        >
          ↩ Undo
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
          style={{ fontSize: 11, color: canRedo ? 'var(--ink-2)' : 'var(--ink-3)', border: '1px solid var(--line-soft)', borderRadius: 3, padding: '2px 6px', background: 'transparent', cursor: canRedo ? 'pointer' : 'default' }}
        >
          ↪ Redo
        </button>
        <button
          onClick={onSave}
          style={{ fontSize: 11, color: 'var(--ink)', border: '1.5px solid var(--line)', borderRadius: 3, padding: '2px 8px', background: 'transparent', cursor: 'pointer' }}
        >
          Save
        </button>
        <button
          onClick={onExport}
          disabled={isRendering}
          style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: isRendering ? 'var(--ink-3)' : 'var(--accent)', border: 'none', borderRadius: 3, padding: '3px 10px', cursor: isRendering ? 'default' : 'pointer' }}
        >
          {isRendering ? 'Rendering…' : 'Export'}
        </button>
        <Link
          href={`/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/settings`}
          title="Project settings"
          style={{ fontSize: 14, color: 'var(--ink-3)', textDecoration: 'none', padding: '0 4px' }}
        >
          ⚙
        </Link>
      </div>
    </div>
  )
}
