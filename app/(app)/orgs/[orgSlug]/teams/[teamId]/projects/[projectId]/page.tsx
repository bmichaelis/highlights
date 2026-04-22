'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { PlaylistEditor } from '@/components/playlist-editor'
import { DriveFolderBrowser } from '@/components/drive-folder-browser'

type Project = { id: string; name: string; status: string; secondsPerImage: number; folderId: string | null; folderName: string | null }
type RenderJob = { id: string; status: string; outputDriveFileId: string | null; errorMsg: string | null }

export default function ProjectPage() {
  const { orgSlug, teamId, projectId } = useParams<{ orgSlug: string; teamId: string; projectId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null)
  const [renderLoading, setRenderLoading] = useState(false)
  const [showFolderBrowser, setShowFolderBrowser] = useState(false)
  const [pendingFolder, setPendingFolder] = useState<{ id: string; name: string } | null>(null)
  const [changingFolder, setChangingFolder] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`)
      .then((r) => { if (!r.ok) return null; return r.json() as Promise<Project> })
      .then((data) => setProject(data))
      .catch(() => {})
  }, [orgSlug, teamId, projectId])

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`)
      .then((r) => r.json() as Promise<RenderJob>)
      .then((job) => { if (job?.id) setRenderJob(job) })
      .catch(() => {})
  }, [orgSlug, teamId, projectId])

  useEffect(() => {
    if (!renderJob || renderJob.status === 'complete' || renderJob.status === 'failed') return
    const interval = setInterval(() => {
      fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`)
        .then((r) => r.json() as Promise<RenderJob>).then(setRenderJob)
    }, 5000)
    return () => clearInterval(interval)
  }, [renderJob, orgSlug, teamId, projectId])

  async function handleRender() {
    setRenderLoading(true)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`, { method: 'POST' })
      if (res.ok) {
        const job = await res.json() as RenderJob
        setRenderJob(job)
        setProject((p) => p ? { ...p, status: 'rendering' } : p)
      }
    } finally {
      setRenderLoading(false)
    }
  }

  async function handleConfirmFolderChange() {
    if (!pendingFolder) return
    setChangingFolder(true)
    setFolderError(null)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: pendingFolder.id, folderName: pendingFolder.name }),
      })
      if (!res.ok) { setFolderError('Failed to change folder.'); return }
      const updated = await res.json() as Project
      setProject(updated)
      setPendingFolder(null)
    } finally {
      setChangingFolder(false)
    }
  }

  if (!project) return <p className="p-8 text-gray-500">Loading…</p>

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <div className="text-right">
          {project.folderName && (
            <p className="text-xs text-gray-500 mb-1">Folder: {project.folderName}</p>
          )}
          <button onClick={() => setShowFolderBrowser(true)}
            className="text-xs text-blue-600 hover:underline">
            Change folder
          </button>
        </div>
      </div>

      {folderError && <p className="text-sm text-red-600">{folderError}</p>}

      {renderJob && (
        <div className={`p-4 rounded-lg border ${
          renderJob.status === 'complete' ? 'border-green-300 bg-green-50' :
          renderJob.status === 'failed' ? 'border-red-300 bg-red-50' :
          'border-blue-300 bg-blue-50'
        }`}>
          {renderJob.status === 'pending' && <p>Queued — waiting for GitHub Actions runner…</p>}
          {renderJob.status === 'running' && <p>Rendering… this takes 2–3 minutes.</p>}
          {renderJob.status === 'complete' && renderJob.outputDriveFileId && (
            <div className="space-y-2">
              <p className="text-green-800 font-medium">Render complete!</p>
              <video src={`https://drive.google.com/uc?id=${renderJob.outputDriveFileId}&export=download`}
                controls className="w-full rounded" />
              <a href={`https://drive.google.com/file/d/${renderJob.outputDriveFileId}/view`}
                target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">
                Open in Google Drive
              </a>
            </div>
          )}
          {renderJob.status === 'failed' && (
            <p className="text-red-800">Render failed: {renderJob.errorMsg}</p>
          )}
        </div>
      )}

      <PlaylistEditor
        orgSlug={orgSlug} teamId={teamId} projectId={projectId}
        defaultDuration={project.secondsPerImage}
        projectStatus={project.status}
        onRender={handleRender}
        renderLoading={renderLoading}
      />

      {showFolderBrowser && (
        <DriveFolderBrowser
          orgSlug={orgSlug}
          teamId={teamId}
          onSelect={(id, name) => { setPendingFolder({ id, name }); setShowFolderBrowser(false) }}
          onClose={() => setShowFolderBrowser(false)}
        />
      )}

      {pendingFolder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-semibold">Change folder?</h2>
            <p className="text-sm text-gray-600">
              Switching to <strong>{pendingFolder.name}</strong> will delete your current playlist and re-scan the new folder. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPendingFolder(null)}
                className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              <button onClick={handleConfirmFolderChange} disabled={changingFolder}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                {changingFolder ? 'Changing…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
