import path from 'path'
import { MrrReader, MrrFrame } from './mrr-reader'
import { PlaybackServerAPI } from './types'

export type PlaybackState = 'idle' | 'loaded' | 'playing' | 'paused'

export class MrrPlayer {
  private app: PlaybackServerAPI
  private filePath: string
  private reader: MrrReader
  private playbackTimer: ReturnType<typeof setTimeout> | null = null
  private frames: MrrFrame[] = []

  filename: string
  radarId: string | null = null
  durationMs = 0
  frameCount = 0
  playing = false
  loop = true
  currentFrame = 0
  positionMs = 0
  spokesPerRev = 2048
  maxSpokeLen = 512
  pixelValues = 64
  range = 1852

  constructor(app: PlaybackServerAPI, filePath: string) {
    this.app = app
    this.filePath = filePath
    this.filename = path.basename(filePath)
    this.reader = new MrrReader(filePath)
  }

  load(): void {
    this.reader.load()

    const meta = this.reader.getMetadata()
    this.durationMs = meta.durationMs
    this.frameCount = meta.frameCount
    this.spokesPerRev = meta.spokesPerRev || 2048
    this.maxSpokeLen = meta.maxSpokeLen || 512
    this.pixelValues = meta.pixelValues || 64
    this.range = (meta.initialState.range as number) || 1852

    this.frames = []
    for (const frame of this.reader.frames()) {
      this.frames.push(frame)
    }
    this.app.debug(`Pre-loaded ${this.frames.length} frames`)

    const baseName = this.filename.replace(/\.mrr(\.gz)?$/, '')
    this.radarId = `playback-${baseName}`

    this.app.debug(
      `Loaded ${this.filename}: ${this.frameCount} frames, ${this.durationMs}ms, ${this.spokesPerRev} spokes/rev`
    )
  }

  play(): void {
    if (this.playing) return
    this.playing = true
    this.scheduleNextFrame()
  }

  pause(): void {
    this.playing = false
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
  }

  stop(): void {
    this.pause()
    this.currentFrame = 0
    this.positionMs = 0
  }

  getStatus(): {
    state: PlaybackState
    radarId: string | null
    filename: string
    positionMs: number
    durationMs: number
    frame: number
    frameCount: number
    loopPlayback: boolean
  } {
    let state: PlaybackState
    if (this.playing) {
      state = 'playing'
    } else if (this.currentFrame > 0) {
      state = 'paused'
    } else {
      state = 'loaded'
    }

    return {
      state,
      radarId: this.radarId,
      filename: this.filename,
      positionMs: this.positionMs,
      durationMs: this.durationMs,
      frame: this.currentFrame,
      frameCount: this.frameCount,
      loopPlayback: this.loop
    }
  }

  scheduleNextFrame(): void {
    if (!this.playing) return

    if (this.currentFrame >= this.frames.length) {
      if (this.loop) {
        this.currentFrame = 0
        this.positionMs = 0
        this.scheduleNextFrame()
      } else {
        this.playing = false
        this.app.setPluginStatus(`Finished: ${this.filename}`)
      }
      return
    }

    const frame = this.frames[this.currentFrame]

    if (this.app.binaryStreamManager) {
      try {
        const streamId = `radars/${this.radarId}`
        this.app.binaryStreamManager.emitData(streamId, frame.data)
      } catch (err) {
        this.app.debug(`Error emitting frame: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    this.positionMs = frame.timestampMs
    this.currentFrame++

    if (this.currentFrame < this.frames.length) {
      const nextFrame = this.frames[this.currentFrame]
      const deltaMs = nextFrame.timestampMs - frame.timestampMs
      this.playbackTimer = setTimeout(
        () => {
          this.scheduleNextFrame()
        },
        Math.max(1, deltaMs)
      )
    } else if (this.loop) {
      this.playbackTimer = setTimeout(() => {
        this.currentFrame = 0
        this.positionMs = 0
        this.scheduleNextFrame()
      }, 100)
    } else {
      this.playing = false
      this.app.setPluginStatus(`Finished: ${this.filename}`)
    }
  }
}
