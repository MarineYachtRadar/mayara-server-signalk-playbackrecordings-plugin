import { ServerAPI } from '@signalk/server-api'

interface BinaryStreamManager {
  emitData(streamId: string, data: Buffer): void
}

export interface PlaybackServerAPI extends ServerAPI {
  binaryStreamManager?: BinaryStreamManager
}

export interface PlaybackSettings {
  recordingsDir: string
}

export interface RecordingInfo {
  filename: string
  size: number
  modifiedMs: number
  durationMs?: number
  frameCount?: number
  spokesPerRev?: number
  radarBrand?: number
}
