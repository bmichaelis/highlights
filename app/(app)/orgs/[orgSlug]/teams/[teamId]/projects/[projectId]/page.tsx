'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { PlaylistEditor } from '@/components/playlist-editor'

type Project = { id: string; name: string; status: string; secondsPerImage: number }
type RenderJob = { id: string; status: string; outputDriveFileId: string | null; errorMsg: string | null }

export default function ProjectPage() {
  const { orgSlug, teamId, projectId } = useParams<{ orgSlug: string; teamId: string; projectId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null)
  const [renderLoading, setRenderLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}`)
      .then((r) => {
        if (!r.ok) return null
        return r.json()
      })
      .then((data) => setProject(data))
      .catch(() => {})
  }, [orgSlug, teamId, projectId])

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`)
      .then((r) => r.json())
      .then((job) => { if (job?.id) setRenderJob(job) })
      .catch(() => {})
  }, [orgSlug, teamId, projectId])

  useEffect(() => {
    if (!renderJob || renderJob.status === 'complete' || renderJob.status === 'failed') return
    const interval = setInterval(() => {
      fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`)
        .then((r) => r.json()).then(setRenderJob)
    }, 5000)
    return () => clearInterval(interval)
  }, [renderJob, orgSlug, teamId, projectId])

  async function handleRender() {
    setRenderLoading(true)
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/render`, {
        method: 'POST',
      })
      if (res.ok) {
        const job = await res.json()
        setRenderJob(job)
        setProject((p) => p ? { ...p, status: 'rendering' } : p)
      }
    } finally {
      setRenderLoading(false)
    }
  }

  if (!project) return <p className="p-8 text-gray-500">Loading…</p>

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-bold">{project.name}</h1>

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
              <video
                src={`https://drive.google.com/uc?id=${renderJob.outputDriveFileId}&export=download`}
                controls className="w-full rounded" />
              <a
                href={`https://drive.google.com/file/d/${renderJob.outputDriveFileId}/view`}
                target="_blank" rel="noopener noreferrer"
                className="text-sm text-blue-600 underline">
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
    </main>
  )
}
