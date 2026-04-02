import { describe, it, expect } from 'vitest'
import {
  readU16,
  readU32,
  readU64,
  MrrHeader,
  MrrFooter,
  MrrFrame,
  MrrReader,
  HEADER_SIZE,
  FOOTER_SIZE,
  FRAME_FLAG_HAS_STATE
} from '../src/mrr-reader'
import { buildMrrBuffer } from './helpers/mrr-fixture'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('readU16 / readU32 / readU64', () => {
  it('reads little-endian uint16', () => {
    const buf = Buffer.from([0x34, 0x12])
    expect(readU16(buf, 0)).toBe(0x1234)
  })

  it('reads little-endian uint32', () => {
    const buf = Buffer.from([0x78, 0x56, 0x34, 0x12])
    expect(readU32(buf, 0)).toBe(0x12345678)
  })

  it('reads little-endian uint64', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64LE(BigInt(1_000_000_000_000), 0)
    expect(readU64(buf, 0)).toBe(1_000_000_000_000)
  })

  it('reads at non-zero offset', () => {
    const buf = Buffer.alloc(10)
    buf.writeUInt16LE(0xabcd, 4)
    expect(readU16(buf, 4)).toBe(0xabcd)
  })
})

describe('MrrHeader', () => {
  it('parses a valid header', () => {
    const mrr = buildMrrBuffer({ spokesPerRev: 1024, maxSpokeLen: 256, pixelValues: 32 })
    const header = MrrHeader.fromBuffer(mrr)

    expect(header.version).toBe(1)
    expect(header.spokesPerRev).toBe(1024)
    expect(header.maxSpokeLen).toBe(256)
    expect(header.pixelValues).toBe(32)
    expect(header.framesOffset).toBeGreaterThan(HEADER_SIZE)
  })

  it('throws on bad magic', () => {
    const buf = Buffer.alloc(HEADER_SIZE)
    buf.write('NOPE', 0, 4, 'ascii')
    expect(() => MrrHeader.fromBuffer(buf)).toThrow('bad magic')
  })

  it('throws on buffer too small', () => {
    const buf = Buffer.alloc(10)
    buf.write('MRR1', 0, 4, 'ascii')
    expect(() => MrrHeader.fromBuffer(buf)).toThrow('too small')
  })

  it('throws on unsupported version', () => {
    const buf = Buffer.alloc(HEADER_SIZE)
    buf.write('MRR1', 0, 4, 'ascii')
    buf.writeUInt16LE(99, 4)
    expect(() => MrrHeader.fromBuffer(buf)).toThrow('Unsupported MRR version')
  })
})

describe('MrrFooter', () => {
  it('parses a valid footer', () => {
    const mrr = buildMrrBuffer()
    const footer = MrrFooter.fromBuffer(mrr.subarray(mrr.length - FOOTER_SIZE))

    expect(footer.frameCount).toBe(3)
    expect(footer.durationMs).toBe(200)
  })

  it('throws on bad magic', () => {
    const buf = Buffer.alloc(FOOTER_SIZE)
    buf.write('NOPE', 0, 4, 'ascii')
    expect(() => MrrFooter.fromBuffer(buf)).toThrow('bad magic')
  })
})

describe('MrrFrame', () => {
  it('parses a frame without state delta', () => {
    const data = Buffer.from([0xaa, 0xbb])
    const frameBuf = Buffer.alloc(8 + 1 + 4 + data.length)
    frameBuf.writeBigUInt64LE(BigInt(42), 0)
    frameBuf.writeUInt8(0, 8)
    frameBuf.writeUInt32LE(data.length, 9)
    data.copy(frameBuf, 13)

    const { frame, bytesRead } = MrrFrame.fromBuffer(frameBuf, 0)
    expect(frame.timestampMs).toBe(42)
    expect(frame.flags).toBe(0)
    expect(frame.data).toEqual(data)
    expect(frame.stateDelta).toBeNull()
    expect(bytesRead).toBe(frameBuf.length)
  })

  it('parses a frame with state delta', () => {
    const data = Buffer.from([0x01])
    const stateJson = '{"range":500}'
    const stateBuf = Buffer.from(stateJson, 'utf8')
    const frameBuf = Buffer.alloc(8 + 1 + 4 + data.length + 4 + stateBuf.length)
    let pos = 0
    frameBuf.writeBigUInt64LE(BigInt(100), pos)
    pos += 8
    frameBuf.writeUInt8(FRAME_FLAG_HAS_STATE, pos)
    pos += 1
    frameBuf.writeUInt32LE(data.length, pos)
    pos += 4
    data.copy(frameBuf, pos)
    pos += data.length
    frameBuf.writeUInt32LE(stateBuf.length, pos)
    pos += 4
    stateBuf.copy(frameBuf, pos)

    const { frame } = MrrFrame.fromBuffer(frameBuf, 0)
    expect(frame.flags & FRAME_FLAG_HAS_STATE).toBeTruthy()
    expect(frame.stateDelta).not.toBeNull()
    const delta = frame.stateDelta
    expect(delta).toBeDefined()
    if (delta) {
      expect(delta.toString('utf8')).toBe(stateJson)
    }
  })

  it('throws on truncated frame', () => {
    const buf = Buffer.alloc(5)
    expect(() => MrrFrame.fromBuffer(buf, 0)).toThrow('Frame too small')
  })

  it('throws when data length overflows buffer', () => {
    const buf = Buffer.alloc(13)
    buf.writeBigUInt64LE(BigInt(0), 0)
    buf.writeUInt8(0, 8)
    buf.writeUInt32LE(9999, 9)
    expect(() => MrrFrame.fromBuffer(buf, 0)).toThrow('overflows buffer')
  })
})

describe('MrrReader', () => {
  it('loads and iterates all frames from a valid file', () => {
    const mrr = buildMrrBuffer({
      frames: [
        { timestampMs: 0, data: Buffer.from([0x01]) },
        { timestampMs: 50, data: Buffer.from([0x02]) },
        { timestampMs: 100, data: Buffer.from([0x03]) }
      ]
    })

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.mrr`)
    fs.writeFileSync(tmpFile, mrr)

    try {
      const reader = new MrrReader(tmpFile)
      reader.load()

      const meta = reader.getMetadata()
      expect(meta.frameCount).toBe(3)
      expect(meta.durationMs).toBe(100)
      expect(meta.spokesPerRev).toBe(2048)

      const frames = [...reader.frames()]
      expect(frames).toHaveLength(3)
      expect(frames[0].timestampMs).toBe(0)
      expect(frames[1].timestampMs).toBe(50)
      expect(frames[2].timestampMs).toBe(100)
      expect(frames[0].data).toEqual(Buffer.from([0x01]))
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  it('parses capabilities and initial state JSON', () => {
    const mrr = buildMrrBuffer({
      capabilities: { make: 'Furuno', model: 'DRS4D' },
      initialState: { range: 5000, gain: 50 }
    })

    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.mrr`)
    fs.writeFileSync(tmpFile, mrr)

    try {
      const reader = new MrrReader(tmpFile)
      reader.load()

      const meta = reader.getMetadata()
      expect(meta.capabilities).toEqual({ make: 'Furuno', model: 'DRS4D' })
      expect(meta.initialState).toEqual({ range: 5000, gain: 50 })
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  it('rewind resets to first frame', () => {
    const mrr = buildMrrBuffer()
    const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.mrr`)
    fs.writeFileSync(tmpFile, mrr)

    try {
      const reader = new MrrReader(tmpFile)
      reader.load()

      reader.readFrame()
      reader.readFrame()
      reader.rewind()

      const frame = reader.readFrame()
      expect(frame).not.toBeNull()
      if (frame) {
        expect(frame.timestampMs).toBe(0)
      }
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})
