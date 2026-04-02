import { HEADER_SIZE, FOOTER_SIZE, FRAME_FLAG_HAS_STATE } from '../../src/mrr-reader'

interface FixtureOptions {
  spokesPerRev?: number
  maxSpokeLen?: number
  pixelValues?: number
  radarBrand?: number
  capabilities?: Record<string, unknown>
  initialState?: Record<string, unknown>
  frames?: Array<{
    timestampMs: number
    data: Buffer
    stateDelta?: string
  }>
}

function writeU16(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16LE(value, offset)
}

function writeU32(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt32LE(value, offset)
}

function writeU64(buf: Buffer, offset: number, value: number): void {
  buf.writeBigUInt64LE(BigInt(value), offset)
}

export function buildMrrBuffer(opts: FixtureOptions = {}): Buffer {
  const capabilities = JSON.stringify(opts.capabilities ?? { make: 'Test', model: 'Fixture' })
  const initialState = JSON.stringify(opts.initialState ?? { range: 1852 })
  const capBuf = Buffer.from(capabilities, 'utf8')
  const stateBuf = Buffer.from(initialState, 'utf8')

  const frames = opts.frames ?? [
    { timestampMs: 0, data: Buffer.from([0x01, 0x02, 0x03]) },
    { timestampMs: 100, data: Buffer.from([0x04, 0x05, 0x06]) },
    { timestampMs: 200, data: Buffer.from([0x07, 0x08, 0x09]) }
  ]

  const capOffset = HEADER_SIZE
  const stateOffset = capOffset + capBuf.length
  const framesOffset = stateOffset + stateBuf.length

  let framesSize = 0
  for (const f of frames) {
    framesSize += 8 + 1 + 4 + f.data.length
    if (f.stateDelta) {
      framesSize += 4 + Buffer.byteLength(f.stateDelta, 'utf8')
    }
  }

  const totalSize = framesOffset + framesSize + FOOTER_SIZE
  const buf = Buffer.alloc(totalSize)

  // Header
  buf.write('MRR1', 0, 4, 'ascii')
  writeU16(buf, 4, 1) // version
  writeU16(buf, 6, 0) // flags
  writeU32(buf, 8, opts.radarBrand ?? 0) // radarBrand
  writeU32(buf, 12, opts.spokesPerRev ?? 2048) // spokesPerRev
  writeU32(buf, 16, opts.maxSpokeLen ?? 512) // maxSpokeLen
  writeU32(buf, 20, opts.pixelValues ?? 64) // pixelValues
  writeU64(buf, 24, Date.now()) // startTimeMs
  writeU64(buf, 32, capOffset) // capabilitiesOffset
  writeU32(buf, 40, capBuf.length) // capabilitiesLen
  writeU64(buf, 44, stateOffset) // initialStateOffset
  writeU32(buf, 52, stateBuf.length) // initialStateLen
  writeU64(buf, 56, framesOffset) // framesOffset

  // Capabilities & initial state
  capBuf.copy(buf, capOffset)
  stateBuf.copy(buf, stateOffset)

  // Frames
  let pos = framesOffset
  let durationMs = 0
  for (const f of frames) {
    writeU64(buf, pos, f.timestampMs)
    pos += 8

    const flags = f.stateDelta ? FRAME_FLAG_HAS_STATE : 0
    buf.writeUInt8(flags, pos)
    pos += 1

    writeU32(buf, pos, f.data.length)
    pos += 4

    f.data.copy(buf, pos)
    pos += f.data.length

    if (f.stateDelta) {
      const deltaBuf = Buffer.from(f.stateDelta, 'utf8')
      writeU32(buf, pos, deltaBuf.length)
      pos += 4
      deltaBuf.copy(buf, pos)
      pos += deltaBuf.length
    }

    durationMs = f.timestampMs
  }

  // Footer
  const footerOffset = pos
  buf.write('MRRF', footerOffset, 4, 'ascii')
  writeU64(buf, footerOffset + 4, 0) // indexOffset
  writeU32(buf, footerOffset + 12, 0) // indexCount
  writeU32(buf, footerOffset + 16, frames.length) // frameCount
  writeU64(buf, footerOffset + 20, durationMs) // durationMs

  return buf
}
