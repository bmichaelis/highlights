'use client'
import { useEffect, useState } from 'react'

type AudioFile = { id: string; name: string }
type Props = { orgSlug: string; teamId: string; projectId: string }

export function MusicPanel({ orgSlug, teamId, projectId }: Props) {
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/audio`)
      .then((r) => r.json())
      .then(setAudioFiles)
      .finally(() => setLoading(false))
  }, [orgSlug, teamId, projectId])

  if (loading) return <p className="text-sm text-gray-500">Loading audio…</p>

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <h3 className="font-semibold text-sm">Music</h3>
      {audioFiles.length === 0 ? (
        <p className="text-sm text-gray-500">
          No audio files found in Drive folder. Add .mp3 or .wav files to your team root folder,
          named alphanumerically (e.g. 01_song.mp3, 02_song.mp3).
        </p>
      ) : (
        <ul className="space-y-1">
          {audioFiles.map((f, i) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
              <span>{f.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
