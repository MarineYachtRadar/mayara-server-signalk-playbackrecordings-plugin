import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { MrrPlayer } from '../src/mrr-player'
import { PlaybackServerAPI } from '../src/types'
import { buildMrrBuffer } from './helpers/mrr-fixture'

const emitData = vi.fn()
const setPluginStatus = vi.fn()

function createMockApp(): PlaybackServerAPI {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    setPluginStatus,
    setPluginError: vi.fn(),
    binaryStreamManager: { emitData }
  } as unknown as PlaybackServerAPI
}

let tmpFile: string

beforeEach(() => {
  emitData.mockClear()
  setPluginStatus.mockClear()
  const mrr = buildMrrBuffer({
    frames: [
      { timestampMs: 0, data: Buffer.from([0x10]) },
      { timestampMs: 10, data: Buffer.from([0x20]) },
      { timestampMs: 20, data: Buffer.from([0x30]) }
    ],
    initialState: { range: 3000 }
  })
  tmpFile = path.join(os.tmpdir(), `player-test-${Date.now()}.mrr`)
  fs.writeFileSync(tmpFile, mrr)
})

afterEach(() => {
  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile)
  }
})

describe('MrrPlayer', () => {
  it('loads a recording and sets metadata', () => {
    const app = createMockApp()
    const player = new MrrPlayer(app, tmpFile)
    player.load()

    expect(player.frameCount).toBe(3)
    expect(player.durationMs).toBe(20)
    expect(player.range).toBe(3000)
    expect(player.radarId).toMatch(/^playback-/)
    expect(player.playing).toBe(false)
  })

  it('reports correct status after load', () => {
    const app = createMockApp()
    const player = new MrrPlayer(app, tmpFile)
    player.load()

    const status = player.getStatus()
    expect(status.state).toBe('loaded')
    expect(status.frame).toBe(0)
    expect(status.frameCount).toBe(3)
    expect(status.loopPlayback).toBe(true)
  })

  it('transitions through play, pause, play, stop', () => {
    const app = createMockApp()
    const player = new MrrPlayer(app, tmpFile)
    player.load()

    player.play()
    expect(player.playing).toBe(true)
    expect(player.getStatus().state).toBe('playing')

    player.pause()
    expect(player.playing).toBe(false)
    expect(player.getStatus().state).toBe('paused')

    player.play()
    expect(player.playing).toBe(true)

    player.stop()
    expect(player.playing).toBe(false)
    expect(player.currentFrame).toBe(0)
    expect(player.positionMs).toBe(0)
    expect(player.getStatus().state).toBe('loaded')
  })

  it('reports paused when paused at frame 0', () => {
    vi.useFakeTimers()
    const app = createMockApp()
    const player = new MrrPlayer(app, tmpFile)
    player.load()

    player.play()
    player.pause()

    expect(player.currentFrame).toBe(1)
    expect(player.getStatus().state).toBe('paused')

    player.stop()
    player.play()
    player.pause()

    expect(player.getStatus().state).toBe('paused')
    player.stop()
    vi.useRealTimers()
  })

  it('emits frames via binaryStreamManager', () => {
    vi.useFakeTimers()
    const app = createMockApp()
    const player = new MrrPlayer(app, tmpFile)
    player.load()

    player.loop = false
    player.play()

    expect(emitData).toHaveBeenCalledTimes(1)
    expect(emitData).toHaveBeenCalledWith(`radars/${player.radarId}`, Buffer.from([0x10]))

    vi.advanceTimersByTime(10)
    expect(emitData).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(10)
    expect(emitData).toHaveBeenCalledTimes(3)

    player.stop()
    vi.useRealTimers()
  })

  it('loops when loop is enabled', () => {
    vi.useFakeTimers()
    const app = createMockApp()
    const player = new MrrPlayer(app, tmpFile)
    player.load()

    player.loop = true
    player.play()

    vi.advanceTimersByTime(10) // frame 2
    vi.advanceTimersByTime(10) // frame 3

    vi.advanceTimersByTime(100) // loop restart delay
    expect(player.currentFrame).toBeGreaterThan(0)
    expect(emitData).toHaveBeenCalledTimes(4) // 3 + 1 from loop

    player.stop()
    vi.useRealTimers()
  })

  it('stops at end when loop is disabled', () => {
    vi.useFakeTimers()
    const app = createMockApp()
    const player = new MrrPlayer(app, tmpFile)
    player.load()

    player.loop = false
    player.play()

    vi.advanceTimersByTime(10) // frame 2
    vi.advanceTimersByTime(10) // frame 3

    expect(player.playing).toBe(false)
    expect(setPluginStatus).toHaveBeenCalledWith(expect.stringContaining('Finished'))

    vi.useRealTimers()
  })
})
