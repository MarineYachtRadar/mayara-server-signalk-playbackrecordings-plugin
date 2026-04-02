import fs from 'fs'
import zlib from 'zlib'

const MRR_MAGIC = Buffer.from('MRR1')
const MRR_FOOTER_MAGIC = Buffer.from('MRRF')
const MRR_VERSION = 1
export const HEADER_SIZE = 256
export const FOOTER_SIZE = 32
export const FRAME_FLAG_HAS_STATE = 0x01

export function readU16(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset)
}

export function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset)
}

export function readU64(buf: Buffer, offset: number): number {
  return Number(buf.readBigUInt64LE(offset))
}

export class MrrHeader {
  version = MRR_VERSION
  flags = 0
  radarBrand = 0
  spokesPerRev = 0
  maxSpokeLen = 0
  pixelValues = 0
  startTimeMs = 0
  capabilitiesOffset = 0
  capabilitiesLen = 0
  initialStateOffset = 0
  initialStateLen = 0
  framesOffset = 0

  static fromBuffer(buf: Buffer): MrrHeader {
    if (buf.length < HEADER_SIZE) {
      throw new Error(`Buffer too small for header: ${buf.length} < ${HEADER_SIZE}`)
    }

    if (!buf.subarray(0, 4).equals(MRR_MAGIC)) {
      throw new Error('Invalid MRR file: bad magic bytes')
    }

    const header = new MrrHeader()
    header.version = readU16(buf, 4)

    if (header.version > MRR_VERSION) {
      throw new Error(`Unsupported MRR version: ${header.version}`)
    }

    header.flags = readU16(buf, 6)
    header.radarBrand = readU32(buf, 8)
    header.spokesPerRev = readU32(buf, 12)
    header.maxSpokeLen = readU32(buf, 16)
    header.pixelValues = readU32(buf, 20)
    header.startTimeMs = readU64(buf, 24)
    header.capabilitiesOffset = readU64(buf, 32)
    header.capabilitiesLen = readU32(buf, 40)
    header.initialStateOffset = readU64(buf, 44)
    header.initialStateLen = readU32(buf, 52)
    header.framesOffset = readU64(buf, 56)

    return header
  }
}

export class MrrFooter {
  indexOffset = 0
  indexCount = 0
  frameCount = 0
  durationMs = 0

  static fromBuffer(buf: Buffer): MrrFooter {
    if (buf.length < FOOTER_SIZE) {
      throw new Error(`Buffer too small for footer: ${buf.length} < ${FOOTER_SIZE}`)
    }

    if (!buf.subarray(0, 4).equals(MRR_FOOTER_MAGIC)) {
      throw new Error('Invalid MRR footer: bad magic bytes')
    }

    const footer = new MrrFooter()
    footer.indexOffset = readU64(buf, 4)
    footer.indexCount = readU32(buf, 12)
    footer.frameCount = readU32(buf, 16)
    footer.durationMs = readU64(buf, 20)

    return footer
  }
}

export class MrrFrame {
  timestampMs = 0
  flags = 0
  data: Buffer = Buffer.alloc(0)
  stateDelta: Buffer | null = null

  static fromBuffer(buf: Buffer, offset: number): { frame: MrrFrame; bytesRead: number } {
    const frame = new MrrFrame()
    let pos = offset

    frame.timestampMs = readU64(buf, pos)
    pos += 8

    frame.flags = buf.readUInt8(pos)
    pos += 1

    const dataLen = readU32(buf, pos)
    pos += 4

    frame.data = buf.subarray(pos, pos + dataLen)
    pos += dataLen

    if (frame.flags & FRAME_FLAG_HAS_STATE) {
      const stateLen = readU32(buf, pos)
      pos += 4
      frame.stateDelta = buf.subarray(pos, pos + stateLen)
      pos += stateLen
    }

    return { frame, bytesRead: pos }
  }
}

export interface MrrMetadata {
  version: number
  radarBrand: number
  spokesPerRev: number
  maxSpokeLen: number
  pixelValues: number
  startTimeMs: number
  frameCount: number
  durationMs: number
  capabilities: unknown
  initialState: Record<string, unknown>
}

export class MrrReader {
  private filePath: string
  private buffer: Buffer = Buffer.alloc(0)
  header: MrrHeader = new MrrHeader()
  footer: MrrFooter = new MrrFooter()
  capabilities: unknown = null
  initialState: Record<string, unknown> = {}
  private currentOffset = 0
  private currentFrame = 0

  constructor(filePath: string) {
    this.filePath = filePath
  }

  load(): void {
    let data: Buffer = fs.readFileSync(this.filePath)

    if (this.filePath.endsWith('.gz') || this.filePath.endsWith('.mrr.gz')) {
      data = zlib.gunzipSync(data)
    }

    this.buffer = data

    this.header = MrrHeader.fromBuffer(this.buffer)

    const footerBuf = this.buffer.subarray(this.buffer.length - FOOTER_SIZE)
    this.footer = MrrFooter.fromBuffer(footerBuf)

    const capBuf = this.buffer.subarray(
      this.header.capabilitiesOffset,
      this.header.capabilitiesOffset + this.header.capabilitiesLen
    )
    this.capabilities = JSON.parse(capBuf.toString('utf8'))

    const stateBuf = this.buffer.subarray(
      this.header.initialStateOffset,
      this.header.initialStateOffset + this.header.initialStateLen
    )
    this.initialState = JSON.parse(stateBuf.toString('utf8')) as Record<string, unknown>

    this.currentOffset = this.header.framesOffset
    this.currentFrame = 0
  }

  getMetadata(): MrrMetadata {
    return {
      version: this.header.version,
      radarBrand: this.header.radarBrand,
      spokesPerRev: this.header.spokesPerRev,
      maxSpokeLen: this.header.maxSpokeLen,
      pixelValues: this.header.pixelValues,
      startTimeMs: this.header.startTimeMs,
      frameCount: this.footer.frameCount,
      durationMs: this.footer.durationMs,
      capabilities: this.capabilities,
      initialState: this.initialState
    }
  }

  readFrame(): MrrFrame | null {
    if (this.currentFrame >= this.footer.frameCount) {
      return null
    }

    const { frame, bytesRead } = MrrFrame.fromBuffer(this.buffer, this.currentOffset)
    this.currentOffset = bytesRead
    this.currentFrame++

    return frame
  }

  rewind(): void {
    this.currentOffset = this.header.framesOffset
    this.currentFrame = 0
  }

  *frames(): Generator<MrrFrame> {
    this.rewind()
    let frame: MrrFrame | null
    while ((frame = this.readFrame()) !== null) {
      yield frame
    }
  }
}
