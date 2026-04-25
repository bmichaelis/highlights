import { execSync } from 'child_process'
import { Readable } from 'stream'
import fs from 'fs'

const payload = JSON.parse(process.env.RENDER_PAYLOAD)
const { playlist, audioFileIds, accessToken, folderId, jobId,
        callbackUrl, callbackSecret, timelineJson } = payload

async function postCallback(status, extra = {}) {
  try {
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, status, secret: callbackSecret, ...extra }),
    })
    if (!res.ok) console.error(`Callback POST failed: ${res.status}`)
  } catch (err) {
    console.error('Callback POST error:', err.message)
  }
}

if (!timelineJson) {
  if (!playlist || playlist.length === 0) {
    await postCallback('failed', { errorMsg: 'Empty playlist' })
    process.exit(1)
  }
  for (let i = 0; i < playlist.length; i++) {
    const d = playlist[i].duration
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0)
      throw new Error(`Invalid duration at playlist[${i}]: ${d}`)
  }
}

const TMP = '/tmp/render'
fs.mkdirSync(`${TMP}/images`, { recursive: true })
fs.mkdirSync(`${TMP}/audio`, { recursive: true })

async function driveDownload(fileId, dest) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`Download ${fileId} failed: ${await res.text()}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
}

try {
  await postCallback('running')

  if (timelineJson) {
    // ── NEW PATH ─────────────────────────────────────────────────────────────
    const tfj = JSON.parse(timelineJson)  // { output, duration, tracks }
    const v1Track = tfj.tracks.find((t) => t.id === 'V1')
    const audioTracks = tfj.tracks.filter((t) => t.kind === 'audio' && !t.muted)
    const videoClips = v1Track?.clips ?? []

    // Collect unique source Drive file IDs
    const imageSources = new Map()  // Drive file ID → local path
    for (const clip of videoClips) {
      if (!imageSources.has(clip.source)) {
        imageSources.set(clip.source, `${TMP}/images/${imageSources.size}.jpg`)
      }
    }
    const audioSources = new Map()  // Drive file ID → local path
    for (const track of audioTracks) {
      for (const clip of track.clips) {
        if (!audioSources.has(clip.source)) {
          audioSources.set(clip.source, `${TMP}/audio/src_${audioSources.size}.raw`)
        }
      }
    }

    // Download each unique source once
    for (const [sourceId, localPath] of imageSources) {
      await driveDownload(sourceId, localPath)
      console.log(`Downloaded image source: ${sourceId}`)
    }
    for (const [sourceId, localPath] of audioSources) {
      await driveDownload(sourceId, localPath)
      console.log(`Downloaded audio source: ${sourceId}`)
    }

    // VIDEO SEGMENTS — Task 3
    // AUDIO PROCESSING — Task 4
    // CONCAT + MUX + UPLOAD — Task 5

  } else {
    // ── LEGACY PATH (unchanged) ───────────────────────────────────────────────
    for (let i = 0; i < playlist.length; i++) {
      const dest = `${TMP}/images/${String(i).padStart(4, '0')}.jpg`
      await driveDownload(playlist[i].driveFileId, dest)
      console.log(`Downloaded image ${i + 1}/${playlist.length}`)
    }

    const audioPaths = []
    for (let i = 0; i < audioFileIds.length; i++) {
      const raw = `${TMP}/audio/${String(i).padStart(4, '0')}.raw`
      await driveDownload(audioFileIds[i], raw)
      const aac = `${TMP}/audio/${String(i).padStart(4, '0')}.aac`
      execSync(`ffmpeg -y -i "${raw}" -c:a aac -q:a 2 "${aac}"`, { stdio: 'inherit' })
      audioPaths.push(aac)
      console.log(`Downloaded audio ${i + 1}/${audioFileIds.length}`)
    }

    const totalDuration = playlist.reduce((sum, item) => sum + item.duration, 0)

    const segPaths = []
    for (let i = 0; i < playlist.length; i++) {
      const img = `${TMP}/images/${String(i).padStart(4, '0')}.jpg`
      const seg = `${TMP}/seg_${i}.mp4`
      const dur = playlist[i].duration
      execSync(
        `ffmpeg -y -loop 1 -t ${dur} -i "${img}" ` +
        `-vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p" ` +
        `-c:v libx264 -preset fast -crf 22 "${seg}"`,
        { stdio: 'inherit' }
      )
      segPaths.push(seg)
    }

    let videoPath
    if (segPaths.length === 1) {
      videoPath = segPaths[0]
    } else {
      const FADE = 0.5
      const inputs = segPaths.map((p) => `-i "${p}"`).join(' ')
      let prevLabel = '[0:v]'
      const filterParts = []
      let accumulatedOffset = 0
      for (let i = 1; i < segPaths.length; i++) {
        accumulatedOffset += playlist[i - 1].duration - FADE
        const outLabel = i < segPaths.length - 1 ? `[v${i}]` : '[vout]'
        filterParts.push(
          `${prevLabel}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${accumulatedOffset.toFixed(3)}${outLabel}`
        )
        prevLabel = outLabel
      }
      videoPath = `${TMP}/video_only.mp4`
      execSync(
        `ffmpeg -y ${inputs} -filter_complex "${filterParts.join(';')}" -map "[vout]" -c:v libx264 -preset fast -crf 22 "${videoPath}"`,
        { stdio: 'inherit' }
      )
    }

    let audioPath
    if (audioPaths.length === 0) {
      audioPath = `${TMP}/audio_silent.aac`
      execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${totalDuration} -c:a aac "${audioPath}"`)
    } else {
      const concatPath = `${TMP}/audio_concat.aac`
      if (audioPaths.length === 1) {
        fs.copyFileSync(audioPaths[0], concatPath)
      } else {
        const listFile = `${TMP}/audio_list.txt`
        fs.writeFileSync(listFile, audioPaths.map((p) => `file '${p}'`).join('\n'))
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:a aac "${concatPath}"`, { stdio: 'inherit' })
      }
      audioPath = `${TMP}/audio_final.aac`
      execSync(`ffmpeg -y -stream_loop -1 -i "${concatPath}" -t ${totalDuration} -c:a aac "${audioPath}"`, { stdio: 'inherit' })
    }

    const outputPath = `${TMP}/output.mp4`
    execSync(`ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outputPath}"`, { stdio: 'inherit' })

    const fileSize = fs.statSync(outputPath).size
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({
          name: `highlights_${new Date().toISOString().slice(0, 10)}.mp4`,
          parents: [folderId],
          mimeType: 'video/mp4',
        }),
      }
    )
    if (!initRes.ok) throw new Error(`Upload init failed: ${await initRes.text()}`)
    const uploadUrl = initRes.headers.get('location')

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(fileSize) },
      body: Readable.toWeb(fs.createReadStream(outputPath)),
      duplex: 'half',
    })
    if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`)
    const { id: driveFileId } = await uploadRes.json()

    await postCallback('complete', { driveFileId })
    console.log('Render complete, Drive file ID:', driveFileId)
  }
} catch (err) {
  console.error('Render error:', err)
  await postCallback('failed', { errorMsg: err.message })
  process.exit(1)
}
