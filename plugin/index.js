/**
 * MaYaRa Radar Playback SignalK Plugin
 *
 * Plays .mrr radar recordings through SignalK's Radar API.
 * This is a developer tool for testing SignalK Radar API consumers
 * with consistent recorded data.
 *
 * Does NOT require mayara-server - reads .mrr files directly.
 */

const fs = require('fs')
const path = require('path')
const { MrrReader } = require('./mrr-reader')

module.exports = function (app) {
  let player = null
  let recordingsDir = null

  /**
   * Create RadarProvider methods for SignalK Radar API
   * Returns playback radar info when a recording is loaded
   */
  function createRadarProvider() {
    return {
      async getRadars() {
        if (player && player.radarId) {
          return [player.radarId]
        }
        return []
      },

      async getRadarInfo(radarId) {
        if (!player || player.radarId !== radarId) return null

        return {
          id: player.radarId,
          name: `Playback: ${player.filename}`,
          brand: 'Playback',
          model: 'Recording',
          status: player.playing ? 'transmit' : 'standby',
          spokesPerRevolution: player.spokesPerRev || 2048,
          maxSpokeLen: player.maxSpokeLen || 512,
          range: player.range || 1852,
          controls: {
            power: player.playing ? 2 : 1,
            range: player.range || 1852
          },
          isPlayback: true
        }
      },

      async getCapabilities(radarId) {
        if (!player || player.radarId !== radarId) return null

        return {
          id: player.radarId,
          make: 'Playback',
          model: 'Recording',
          characteristics: {
            spokesPerRevolution: player.spokesPerRev || 2048,
            maxSpokeLength: player.maxSpokeLen || 512,
            pixelValues: player.pixelValues || 64
          },
          // Controls must be an array for buildControlsFromCapabilities()
          controls: [
            {
              id: 'power',
              type: 'enum',
              values: ['off', 'standby', 'transmit'],
              readOnly: true
            },
            {
              id: 'range',
              type: 'number',
              min: 50,
              max: 96000,
              readOnly: true
            }
          ],
          isPlayback: true
        }
      },

      async getState(radarId) {
        if (!player || player.radarId !== radarId) return null

        return {
          status: player.playing ? 'transmit' : 'standby',
          controls: {
            power: player.playing ? 2 : 1,
            range: player.range || 1852
          }
        }
      },

      async getControl(radarId, controlId) {
        if (!player || player.radarId !== radarId) return null
        const state = await this.getState(radarId)
        return state?.controls?.[controlId] ?? null
      },

      // Control methods - playback is read-only
      async setPower(radarId, state) {
        app.debug(`setPower ignored for playback radar (read-only)`)
        return false
      },

      async setRange(radarId, range) {
        app.debug(`setRange ignored for playback radar (read-only)`)
        return false
      },

      async setControl(radarId, controlId, value) {
        app.debug(`setControl ignored for playback radar (read-only)`)
        return false
      },

      async setControls(radarId, controls) {
        app.debug(`setControls ignored for playback radar (read-only)`)
        return false
      },

      // ARPA not supported for playback
      async getTargets(radarId) {
        return { targets: [] }
      },

      async acquireTarget(radarId, bearing, distance) {
        return { success: false, error: 'Not supported for playback' }
      },

      async cancelTarget(radarId, targetId) {
        return false
      }
    }
  }

  const plugin = {
    id: 'mayara-server-signalk-playbackrecordings-plugin',
    name: 'MaYaRa Radar Playback',
    description: 'Play .mrr radar recordings through SignalK Radar API (Developer Tool)',

    schema: () => ({
      type: 'object',
      title: 'MaYaRa Radar Playback Settings',
      properties: {
        recordingsDir: {
          type: 'string',
          title: 'Recordings Directory',
          description: 'Directory containing .mrr files (leave empty for plugin data directory)',
          default: ''
        }
      }
    }),

    start: function (settings) {
      app.debug('Starting mayara-playback plugin')

      // Set recordings directory
      recordingsDir = settings.recordingsDir || path.join(app.getDataDirPath(), 'recordings')

      // Ensure directory exists
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true })
        app.debug(`Created recordings directory: ${recordingsDir}`)
      }

      // Register with SignalK Radar API
      if (app.radarApi) {
        try {
          app.radarApi.register(plugin.id, {
            name: plugin.name,
            methods: createRadarProvider()
          })
          app.debug('Registered as radar provider with SignalK Radar API')
        } catch (err) {
          app.error(`Failed to register radar provider: ${err.message}`)
        }
      } else {
        app.debug('SignalK Radar API not available - spoke streaming will not work')
      }

      app.setPluginStatus('Ready - No recording loaded')
    },

    stop: function () {
      app.debug('Stopping mayara-playback plugin')

      // Unregister from radar API
      if (app.radarApi) {
        try {
          app.radarApi.unRegister(plugin.id)
          app.debug('Unregistered from radar API')
        } catch (err) {
          app.debug(`Error unregistering: ${err.message}`)
        }
      }

      if (player) {
        player.stop()
        player = null
      }

      app.setPluginStatus('Stopped')
    },

    registerWithRouter: function (router) {
      // List available recordings
      router.get('/recordings', (req, res) => {
        try {
          const files = listRecordings()
          res.json({ recordings: files })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      })

      // Upload a recording
      router.post('/recordings/upload', async (req, res) => {
        try {
          // Handle multipart form data
          const chunks = []
          req.on('data', chunk => chunks.push(chunk))
          req.on('end', () => {
            const body = Buffer.concat(chunks)

            // Extract filename from Content-Disposition header or generate one
            let filename = `upload_${Date.now()}.mrr`
            const contentDisp = req.headers['content-disposition']
            if (contentDisp) {
              const match = contentDisp.match(/filename="?([^";\s]+)"?/)
              if (match) filename = match[1]
            }

            // Save file
            const filePath = path.join(recordingsDir, filename)
            fs.writeFileSync(filePath, body)

            app.debug(`Uploaded recording: ${filename} (${body.length} bytes)`)
            res.json({ filename, size: body.length })
          })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      })

      // Delete a recording
      router.delete('/recordings/:filename', (req, res) => {
        try {
          const filePath = path.join(recordingsDir, req.params.filename)
          if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Recording not found' })
          }
          fs.unlinkSync(filePath)
          res.json({ ok: true })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      })

      // Load a recording for playback
      router.post('/playback/load', async (req, res) => {
        try {
          const { filename } = req.body
          if (!filename) {
            return res.status(400).json({ error: 'filename required' })
          }

          const filePath = path.join(recordingsDir, filename)
          if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Recording not found' })
          }

          // Stop existing player and wait for cleanup
          if (player) {
            app.debug(`Stopping existing playback before loading new: ${player.filename}`)
            player.stop()
            player = null
            // Small delay to allow old playback to fully stop
            await new Promise(resolve => setTimeout(resolve, 100))
          }

          // Create new player
          player = new MrrPlayer(app, filePath)
          await player.load()

          app.setPluginStatus(`Loaded: ${filename}`)
          res.json({
            radarId: player.radarId,
            filename: filename,
            durationMs: player.durationMs,
            frameCount: player.frameCount
          })
        } catch (err) {
          app.error(`Load failed: ${err.message}`)
          res.status(500).json({ error: err.message })
        }
      })

      // Play
      router.post('/playback/play', (req, res) => {
        if (!player) {
          return res.status(400).json({ error: 'No recording loaded' })
        }
        player.play()
        app.setPluginStatus(`Playing: ${player.filename}`)
        res.json({ ok: true })
      })

      // Pause
      router.post('/playback/pause', (req, res) => {
        if (!player) {
          return res.status(400).json({ error: 'No recording loaded' })
        }
        player.pause()
        app.setPluginStatus(`Paused: ${player.filename}`)
        res.json({ ok: true })
      })

      // Stop
      router.post('/playback/stop', (req, res) => {
        if (!player) {
          return res.status(400).json({ error: 'No recording loaded' })
        }
        player.stop()
        player = null
        app.setPluginStatus('Ready - No recording loaded')
        res.json({ ok: true })
      })

      // Get status
      router.get('/playback/status', (req, res) => {
        if (!player) {
          return res.json({ state: 'idle', loopPlayback: true })
        }
        res.json(player.getStatus())
      })

      // Settings (loop)
      router.put('/playback/settings', (req, res) => {
        if (!player) {
          return res.status(400).json({ error: 'No recording loaded' })
        }
        const { loopPlayback } = req.body
        if (typeof loopPlayback === 'boolean') {
          player.loop = loopPlayback
        }
        res.json({ ok: true })
      })
    }
  }

  /**
   * List recordings in the recordings directory
   */
  function listRecordings() {
    if (!fs.existsSync(recordingsDir)) {
      return []
    }

    const files = fs.readdirSync(recordingsDir)
      .filter(f => f.endsWith('.mrr') || f.endsWith('.mrr.gz'))
      .map(filename => {
        const filePath = path.join(recordingsDir, filename)
        const stats = fs.statSync(filePath)

        // Try to read metadata
        let metadata = {}
        try {
          const reader = new MrrReader(filePath)
          // Sync load for listing (could optimize later)
          const data = fs.readFileSync(filePath)
          const zlib = require('zlib')
          const buf = filename.endsWith('.gz') ? zlib.gunzipSync(data) : data

          // Quick parse just header and footer
          const { MrrHeader, MrrFooter, HEADER_SIZE, FOOTER_SIZE } = require('./mrr-reader')
          const header = MrrHeader.fromBuffer(buf)
          const footer = MrrFooter.fromBuffer(buf.subarray(buf.length - FOOTER_SIZE))

          metadata = {
            durationMs: footer.durationMs,
            frameCount: footer.frameCount,
            spokesPerRev: header.spokesPerRev,
            radarBrand: header.radarBrand
          }
        } catch (e) {
          app.debug(`Could not read metadata for ${filename}: ${e.message}`)
        }

        return {
          filename,
          size: stats.size,
          modifiedMs: stats.mtimeMs,
          ...metadata
        }
      })

    // Sort by modification time, newest first
    files.sort((a, b) => b.modifiedMs - a.modifiedMs)

    return files
  }

  return plugin
}

/**
 * MRR Playback Player
 * Reads frames from .mrr file and emits them through SignalK Radar API
 */
class MrrPlayer {
  constructor(app, filePath) {
    this.app = app
    this.filePath = filePath
    this.filename = path.basename(filePath)
    this.reader = new MrrReader(filePath)
    this.radarId = null
    this.durationMs = 0
    this.frameCount = 0
    this.playing = false
    this.loop = true  // Default to looping
    this.currentFrame = 0
    this.positionMs = 0
    this.playbackTimer = null
    this.frames = [] // Pre-loaded frames for proper timing
    // Metadata for RadarProvider
    this.spokesPerRev = 2048
    this.maxSpokeLen = 512
    this.pixelValues = 64
    this.range = 1852
  }

  async load() {
    await this.reader.load()

    const meta = this.reader.getMetadata()
    this.durationMs = meta.durationMs
    this.frameCount = meta.frameCount

    // Store metadata for RadarProvider to access
    this.spokesPerRev = meta.spokesPerRev || 2048
    this.maxSpokeLen = meta.maxSpokeLen || 512
    this.pixelValues = meta.pixelValues || 64
    this.range = meta.initialState?.range || 1852

    // Pre-load all frames for proper timing (avoids hacky read-ahead)
    this.frames = []
    for (const frame of this.reader.frames()) {
      this.frames.push(frame)
    }
    this.app.debug(`Pre-loaded ${this.frames.length} frames`)

    // Generate radar ID from filename
    const baseName = this.filename.replace(/\.mrr(\.gz)?$/, '')
    this.radarId = `playback-${baseName}`

    this.app.debug(`Loaded ${this.filename}: ${this.frameCount} frames, ${this.durationMs}ms, ${this.spokesPerRev} spokes/rev`)
  }

  play() {
    if (this.playing) return

    this.playing = true
    this.scheduleNextFrame()
  }

  pause() {
    this.playing = false
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
  }

  stop() {
    this.pause()

    // Unregister radar
    if (this.app.radarApi && this.radarId) {
      try {
        // Unregister from SignalK
        this.app.debug(`Unregistering radar: ${this.radarId}`)
      } catch (err) {
        this.app.debug(`Error unregistering: ${err.message}`)
      }
    }

    // Reset position
    this.currentFrame = 0
    this.positionMs = 0
  }

  getStatus() {
    return {
      state: this.playing ? 'playing' : (this.currentFrame > 0 ? 'paused' : 'loaded'),
      radarId: this.radarId,
      filename: this.filename,
      positionMs: this.positionMs,
      durationMs: this.durationMs,
      frame: this.currentFrame,
      frameCount: this.frameCount,
      loopPlayback: this.loop
    }
  }

  scheduleNextFrame() {
    if (!this.playing) return

    // Check if we've reached the end
    if (this.currentFrame >= this.frames.length) {
      // End of recording
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

    // Emit frame through SignalK binary stream
    // Stream ID must be "radars/{radarId}" to match WebSocket endpoint
    if (this.app.binaryStreamManager) {
      try {
        const streamId = `radars/${this.radarId}`
        this.app.binaryStreamManager.emitData(streamId, frame.data)
      } catch (err) {
        this.app.debug(`Error emitting frame: ${err.message}`)
      }
    }

    this.positionMs = frame.timestampMs
    this.currentFrame++

    // Schedule next frame based on timestamp delta
    if (this.currentFrame < this.frames.length) {
      const nextFrame = this.frames[this.currentFrame]
      const deltaMs = nextFrame.timestampMs - frame.timestampMs
      this.playbackTimer = setTimeout(() => this.scheduleNextFrame(), Math.max(1, deltaMs))
    } else if (this.loop) {
      // Last frame, schedule loop restart
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
