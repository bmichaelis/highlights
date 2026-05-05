import { describe, it, expect } from 'vitest'
import { parseDriveFiles, pickAudioFiles, partitionTopLevel } from './scanner'

describe('parseDriveFiles', () => {
  it('extracts subfolders as players', () => {
    const files = [
      { id: '1', name: 'John Smith', mimeType: 'application/vnd.google-apps.folder' },
      { id: '2', name: 'Jane Doe', mimeType: 'application/vnd.google-apps.folder' },
      { id: '3', name: 'photo.jpg', mimeType: 'image/jpeg' },
    ]
    expect(parseDriveFiles(files)).toEqual([
      { id: '1', name: 'John Smith' },
      { id: '2', name: 'Jane Doe' },
    ])
  })
})

describe('pickAudioFiles', () => {
  it('returns audio files sorted alphanumerically', () => {
    const files = [
      { id: 'c', name: '03_outro.mp3', mimeType: 'audio/mpeg' },
      { id: 'a', name: '01_intro.mp3', mimeType: 'audio/mpeg' },
      { id: 'b', name: '02_main.wav', mimeType: 'audio/wav' },
      { id: 'd', name: 'photo.jpg', mimeType: 'image/jpeg' },
    ]
    expect(pickAudioFiles(files)).toEqual([
      { id: 'a', name: '01_intro.mp3' },
      { id: 'b', name: '02_main.wav' },
      { id: 'c', name: '03_outro.mp3' },
    ])
  })

  it('ignores non-audio files', () => {
    const files = [{ id: '1', name: 'video.mp4', mimeType: 'video/mp4' }]
    expect(pickAudioFiles(files)).toEqual([])
  })
})

describe('partitionTopLevel', () => {
  it('returns all folders as players when no misc folder is present', () => {
    const folders = [
      { id: '1', name: 'Lucas' },
      { id: '2', name: 'Mia' },
    ]
    expect(partitionTopLevel(folders)).toEqual({
      players: [{ id: '1', name: 'Lucas' }, { id: '2', name: 'Mia' }],
      misc: null,
    })
  })

  it('extracts a misc folder (lowercase) into the misc slot', () => {
    const folders = [
      { id: '1', name: 'Lucas' },
      { id: '2', name: 'misc' },
      { id: '3', name: 'Mia' },
    ]
    const { players, misc } = partitionTopLevel(folders)
    expect(players).toEqual([
      { id: '1', name: 'Lucas' },
      { id: '3', name: 'Mia' },
    ])
    expect(misc).toEqual({ id: '2', name: 'misc' })
  })

  it('matches misc case-insensitively', () => {
    for (const variant of ['Misc', 'MISC', 'mISC', 'MiSc']) {
      const folders = [{ id: '1', name: 'Lucas' }, { id: '2', name: variant }]
      const { players, misc } = partitionTopLevel(folders)
      expect(players).toEqual([{ id: '1', name: 'Lucas' }])
      expect(misc).toEqual({ id: '2', name: variant })
    }
  })

  it('uses the last-encountered match when multiple folders look like misc', () => {
    const folders = [
      { id: '1', name: 'misc' },
      { id: '2', name: 'Misc' },
      { id: '3', name: 'MISC' },
    ]
    const { players, misc } = partitionTopLevel(folders)
    expect(players).toEqual([])
    expect(misc).toEqual({ id: '3', name: 'MISC' })
  })

  it('returns empty players and null misc for empty input', () => {
    expect(partitionTopLevel([])).toEqual({ players: [], misc: null })
  })
})
