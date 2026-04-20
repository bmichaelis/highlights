import { describe, it, expect } from 'vitest'
import { parseDriveFiles, pickAudioFiles } from './scanner'

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
