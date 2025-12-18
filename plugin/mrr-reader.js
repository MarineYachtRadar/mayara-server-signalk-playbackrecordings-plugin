/**
 * MRR (MaYaRa Radar Recording) file format reader
 *
 * JavaScript port of mayara-server's file_format.rs
 * Reads .mrr binary files containing recorded radar data.
 */

const fs = require('fs')
const zlib = require('zlib')

// Constants matching Rust implementation
const MRR_MAGIC = Buffer.from('MRR1')
const MRR_FOOTER_MAGIC = Buffer.from('MRRF')
const MRR_VERSION = 1
const HEADER_SIZE = 256
const FOOTER_SIZE = 32
const INDEX_ENTRY_SIZE = 16
const FRAME_FLAG_HAS_STATE = 0x01

/**
 * Read a little-endian uint16 from buffer
 */
function readU16(buf, offset) {
  return buf.readUInt16LE(offset)
}

/**
 * Read a little-endian uint32 from buffer
 */
function readU32(buf, offset) {
  return buf.readUInt32LE(offset)
}

/**
 * Read a little-endian uint64 from buffer (as BigInt, then convert to Number)
 * Note: JavaScript Numbers can safely represent integers up to 2^53-1
 */
function readU64(buf, offset) {
  return Number(buf.readBigUInt64LE(offset))
}

/**
 * MRR file header (256 bytes)
 */
class MrrHeader {
  constructor() {
    this.version = MRR_VERSION
    this.flags = 0
    this.radarBrand = 0
    this.spokesPerRev = 0
    this.maxSpokeLen = 0
    this.pixelValues = 0
    this.startTimeMs = 0
    this.capabilitiesOffset = 0
    this.capabilitiesLen = 0
    this.initialStateOffset = 0
    this.initialStateLen = 0
    this.framesOffset = 0
  }

  /**
   * Parse header from buffer
   * @param {Buffer} buf - Buffer containing at least HEADER_SIZE bytes
   * @returns {MrrHeader}
   */
  static fromBuffer(buf) {
    if (buf.length < HEADER_SIZE) {
      throw new Error(`Buffer too small for header: ${buf.length} < ${HEADER_SIZE}`)
    }

    // Check magic
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

/**
 * MRR file footer (32 bytes)
 */
class MrrFooter {
  constructor() {
    this.indexOffset = 0
    this.indexCount = 0
    this.frameCount = 0
    this.durationMs = 0
  }

  /**
   * Parse footer from buffer
   * @param {Buffer} buf - Buffer containing at least FOOTER_SIZE bytes
   * @returns {MrrFooter}
   */
  static fromBuffer(buf) {
    if (buf.length < FOOTER_SIZE) {
      throw new Error(`Buffer too small for footer: ${buf.length} < ${FOOTER_SIZE}`)
    }

    // Check magic
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

/**
 * MRR frame data
 */
class MrrFrame {
  constructor() {
    this.timestampMs = 0
    this.flags = 0
    this.data = null      // Buffer - protobuf RadarMessage
    this.stateDelta = null // Buffer - optional JSON state delta
  }

  /**
   * Parse frame from buffer at given offset
   * @param {Buffer} buf - Full file buffer
   * @param {number} offset - Start offset of frame
   * @returns {{frame: MrrFrame, bytesRead: number}}
   */
  static fromBuffer(buf, offset) {
    const frame = new MrrFrame()

    // Timestamp (8 bytes)
    frame.timestampMs = readU64(buf, offset)
    offset += 8

    // Flags (1 byte)
    frame.flags = buf.readUInt8(offset)
    offset += 1

    // Data length (4 bytes)
    const dataLen = readU32(buf, offset)
    offset += 4

    // Data
    frame.data = buf.subarray(offset, offset + dataLen)
    offset += dataLen

    // State delta (if present)
    if (frame.flags & FRAME_FLAG_HAS_STATE) {
      const stateLen = readU32(buf, offset)
      offset += 4
      frame.stateDelta = buf.subarray(offset, offset + stateLen)
      offset += stateLen
    }

    return { frame, bytesRead: offset }
  }
}

/**
 * MRR file reader
 */
class MrrReader {
  /**
   * @param {string} filePath - Path to .mrr or .mrr.gz file
   */
  constructor(filePath) {
    this.filePath = filePath
    this.buffer = null
    this.header = null
    this.footer = null
    this.capabilities = null
    this.initialState = null
    this.currentOffset = 0
    this.currentFrame = 0
  }

  /**
   * Load and parse the file
   * Automatically decompresses .mrr.gz files
   */
  async load() {
    // Read file
    let data = fs.readFileSync(this.filePath)

    // Decompress if gzipped
    if (this.filePath.endsWith('.gz') || this.filePath.endsWith('.mrr.gz')) {
      data = zlib.gunzipSync(data)
    }

    this.buffer = data

    // Parse header
    this.header = MrrHeader.fromBuffer(this.buffer)

    // Parse footer (at end of file)
    const footerBuf = this.buffer.subarray(this.buffer.length - FOOTER_SIZE)
    this.footer = MrrFooter.fromBuffer(footerBuf)

    // Read capabilities JSON
    const capBuf = this.buffer.subarray(
      this.header.capabilitiesOffset,
      this.header.capabilitiesOffset + this.header.capabilitiesLen
    )
    this.capabilities = JSON.parse(capBuf.toString('utf8'))

    // Read initial state JSON
    const stateBuf = this.buffer.subarray(
      this.header.initialStateOffset,
      this.header.initialStateOffset + this.header.initialStateLen
    )
    this.initialState = JSON.parse(stateBuf.toString('utf8'))

    // Position at first frame
    this.currentOffset = this.header.framesOffset
    this.currentFrame = 0
  }

  /**
   * Get file metadata
   */
  getMetadata() {
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

  /**
   * Read the next frame
   * @returns {MrrFrame|null} Frame or null if at end
   */
  readFrame() {
    if (this.currentFrame >= this.footer.frameCount) {
      return null
    }

    const { frame, bytesRead } = MrrFrame.fromBuffer(this.buffer, this.currentOffset)
    this.currentOffset = bytesRead
    this.currentFrame++

    return frame
  }

  /**
   * Reset to beginning
   */
  rewind() {
    this.currentOffset = this.header.framesOffset
    this.currentFrame = 0
  }

  /**
   * Get current position info
   */
  getPosition() {
    return {
      frame: this.currentFrame,
      totalFrames: this.footer.frameCount
    }
  }

  /**
   * Create an async iterator for frames
   * Useful for playback with timing
   */
  *frames() {
    this.rewind()
    let frame
    while ((frame = this.readFrame()) !== null) {
      yield frame
    }
  }
}

module.exports = {
  MrrReader,
  MrrHeader,
  MrrFooter,
  MrrFrame,
  HEADER_SIZE,
  FOOTER_SIZE,
  FRAME_FLAG_HAS_STATE
}
