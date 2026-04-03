import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { Plugin, radar } from '@signalk/server-api'
import { Request, Response, IRouter } from 'express'
import { MrrHeader, MrrFooter, FOOTER_SIZE } from './mrr-reader'
import { MrrPlayer } from './mrr-player'
import { PlaybackServerAPI, PlaybackSettings, RecordingInfo } from './types'

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024

function safeMrrFilename(filename: string): string | null {
  const base = path.basename(filename)
  if (
    base !== filename ||
    filename.includes('..') ||
    (!filename.endsWith('.mrr') && !filename.endsWith('.mrr.gz'))
  ) {
    return null
  }
  return base
}

module.exports = function (app: PlaybackServerAPI): Plugin {
  let player: MrrPlayer | null = null
  let recordingsDir: string = ''

  function createRadarProvider(): radar.RadarProviderMethods {
    const provider: radar.RadarProviderMethods = {
      getRadars(): Promise<string[]> {
        if (player?.radarId) {
          return Promise.resolve([player.radarId])
        }
        return Promise.resolve([])
      },

      getRadarInfo(radarId: string): Promise<radar.RadarInfo | null> {
        if (!player || player.radarId !== radarId) return Promise.resolve(null)

        return Promise.resolve({
          id: player.radarId,
          name: `Playback: ${player.filename}`,
          brand: 'Playback',
          status: player.playing ? ('transmit' as const) : ('standby' as const),
          spokesPerRevolution: player.spokesPerRev,
          maxSpokeLen: player.maxSpokeLen,
          range: player.range,
          controls: {
            gain: { auto: false, value: 0 }
          }
        })
      },

      getCapabilities(radarId: string): Promise<radar.CapabilityManifest | null> {
        if (!player || player.radarId !== radarId) return Promise.resolve(null)

        return Promise.resolve({
          id: player.radarId,
          make: 'Playback',
          model: 'Recording',
          pixelValues: player.pixelValues,
          characteristics: {
            spokesPerRevolution: player.spokesPerRev,
            maxSpokeLength: player.maxSpokeLen,
            maxRange: 96000,
            minRange: 50,
            supportedRanges: [50, 100, 250, 500, 1000, 1852, 3704, 9260, 18520, 37040, 96000],
            hasDoppler: false,
            hasDualRange: false,
            noTransmitZoneCount: 0
          },
          controls: [
            {
              id: 'power',
              name: 'Power',
              description: 'Radar power state',
              category: 'base',
              type: 'enum',
              values: [
                { value: 'off', label: 'Off' },
                { value: 'standby', label: 'Standby' },
                { value: 'transmit', label: 'Transmit' }
              ],
              readOnly: true
            },
            {
              id: 'range',
              name: 'Range',
              description: 'Radar range in meters',
              category: 'base',
              type: 'number',
              range: { min: 50, max: 96000 },
              readOnly: true
            }
          ]
        })
      },

      getState(radarId: string): Promise<radar.RadarState | null> {
        if (!player || player.radarId !== radarId) return Promise.resolve(null)

        return Promise.resolve({
          id: player.radarId,
          timestamp: new Date().toISOString(),
          status: player.playing ? ('transmit' as const) : ('standby' as const),
          controls: {
            power: player.playing ? 'transmit' : 'standby',
            range: player.range
          }
        })
      },

      async getControl(radarId: string, controlId: string): Promise<unknown> {
        if (!player || player.radarId !== radarId) return null
        const getStateFn = provider.getState
        if (!getStateFn) return null
        const state = await getStateFn(radarId)
        return state?.controls[controlId] ?? null
      }
    }
    return provider
  }

  function listRecordings(): RecordingInfo[] {
    if (!fs.existsSync(recordingsDir)) {
      return []
    }

    const files = fs
      .readdirSync(recordingsDir)
      .filter((f) => f.endsWith('.mrr') || f.endsWith('.mrr.gz'))
      .map((filename): RecordingInfo => {
        const filePath = path.join(recordingsDir, filename)
        const stats = fs.statSync(filePath)

        const info: RecordingInfo = {
          filename,
          size: stats.size,
          modifiedMs: stats.mtimeMs
        }

        try {
          const data = fs.readFileSync(filePath)
          const buf = filename.endsWith('.gz') ? zlib.gunzipSync(data) : data

          const header = MrrHeader.fromBuffer(buf)
          const footer = MrrFooter.fromBuffer(buf.subarray(buf.length - FOOTER_SIZE))

          info.durationMs = footer.durationMs
          info.frameCount = footer.frameCount
          info.spokesPerRev = header.spokesPerRev
          info.radarBrand = header.radarBrand
        } catch (e) {
          app.debug(
            `Could not read metadata for ${filename}: ${e instanceof Error ? e.message : String(e)}`
          )
        }

        return info
      })

    files.sort((a, b) => b.modifiedMs - a.modifiedMs)
    return files
  }

  const plugin: Plugin = {
    id: 'mayara-server-signalk-playbackrecordings-plugin',
    name: 'MaYaRa Radar Playback',
    description: 'Play .mrr radar recordings through SignalK Radar API (Developer Tool)',
    enabledByDefault: true,

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

    start(config: object) {
      app.debug('Starting mayara-playback plugin')

      const settings = config as PlaybackSettings
      recordingsDir = settings.recordingsDir || path.join(app.getDataDirPath(), 'recordings')

      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true })
        app.debug(`Created recordings directory: ${recordingsDir}`)
      }

      try {
        app.radarApi.register(plugin.id, {
          name: plugin.name,
          methods: createRadarProvider()
        })
        app.debug('Registered as radar provider with SignalK Radar API')
      } catch (err) {
        app.error(
          `Failed to register radar provider: ${err instanceof Error ? err.message : String(err)}`
        )
      }

      app.setPluginStatus('Ready - No recording loaded')
    },

    stop() {
      app.debug('Stopping mayara-playback plugin')

      try {
        app.radarApi.unRegister(plugin.id)
        app.debug('Unregistered from radar API')
      } catch (err) {
        app.debug(`Error unregistering: ${err instanceof Error ? err.message : String(err)}`)
      }

      if (player) {
        player.stop()
        player = null
      }

      app.setPluginStatus('Stopped')
    },

    registerWithRouter(router: IRouter) {
      router.get('/recordings', (req: Request, res: Response) => {
        try {
          const files = listRecordings()
          res.json({ recordings: files })
        } catch (err) {
          res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
        }
      })

      router.post('/recordings/upload', (req: Request, res: Response) => {
        const chunks: Buffer[] = []
        let totalSize = 0
        let aborted = false

        req.on('data', (chunk: Buffer) => {
          totalSize += chunk.length
          if (totalSize > MAX_UPLOAD_SIZE) {
            aborted = true
            req.destroy()
            res.status(413).json({ error: 'Upload too large' })
            return
          }
          chunks.push(chunk)
        })

        req.on('error', (err: Error) => {
          if (!aborted) {
            res.status(500).json({ error: err.message })
          }
        })

        req.on('end', () => {
          if (aborted) return
          try {
            const body = Buffer.concat(chunks)

            let filename = `upload_${Date.now()}.mrr`
            const contentDisp = req.headers['content-disposition']
            if (contentDisp) {
              const match = /filename="?([^";\s]+)"?/.exec(contentDisp)
              if (match) {
                const safe = safeMrrFilename(match[1])
                if (safe) filename = safe
              }
            }

            const filePath = path.join(recordingsDir, filename)
            fs.writeFileSync(filePath, body)

            app.debug(`Uploaded recording: ${filename} (${body.length} bytes)`)
            res.json({ filename, size: body.length })
          } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
          }
        })
      })

      router.delete(
        '/recordings/:filename',
        (req: Request<{ filename: string }>, res: Response) => {
          try {
            const safe = safeMrrFilename(req.params.filename)
            if (!safe) {
              res.status(400).json({ error: 'Invalid filename' })
              return
            }
            const filePath = path.join(recordingsDir, safe)
            if (!fs.existsSync(filePath)) {
              res.status(404).json({ error: 'Recording not found' })
              return
            }
            fs.unlinkSync(filePath)
            res.json({ ok: true })
          } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
          }
        }
      )

      router.post('/playback/load', async (req: Request, res: Response) => {
        try {
          const { filename } = req.body as { filename: string }
          if (!filename) {
            res.status(400).json({ error: 'filename required' })
            return
          }

          const safe = safeMrrFilename(filename)
          if (!safe) {
            res.status(400).json({ error: 'Invalid filename' })
            return
          }

          const filePath = path.join(recordingsDir, safe)
          if (!fs.existsSync(filePath)) {
            res.status(404).json({ error: 'Recording not found' })
            return
          }

          if (player) {
            app.debug(`Stopping existing playback before loading new: ${player.filename}`)
            player.stop()
            player = null
            await new Promise<void>((resolve) => setTimeout(resolve, 100))
          }

          player = new MrrPlayer(app, filePath)
          player.load()

          app.setPluginStatus(`Loaded: ${filename}`)
          res.json({
            radarId: player.radarId,
            filename,
            durationMs: player.durationMs,
            frameCount: player.frameCount
          })
        } catch (err) {
          app.error(`Load failed: ${err instanceof Error ? err.message : String(err)}`)
          res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
        }
      })

      router.post('/playback/play', (req: Request, res: Response) => {
        if (!player) {
          res.status(400).json({ error: 'No recording loaded' })
          return
        }
        player.play()
        app.setPluginStatus(`Playing: ${player.filename}`)
        res.json({ ok: true })
      })

      router.post('/playback/pause', (req: Request, res: Response) => {
        if (!player) {
          res.status(400).json({ error: 'No recording loaded' })
          return
        }
        player.pause()
        app.setPluginStatus(`Paused: ${player.filename}`)
        res.json({ ok: true })
      })

      router.post('/playback/stop', (req: Request, res: Response) => {
        if (!player) {
          res.status(400).json({ error: 'No recording loaded' })
          return
        }
        player.stop()
        player = null
        app.setPluginStatus('Ready - No recording loaded')
        res.json({ ok: true })
      })

      router.get('/playback/status', (req: Request, res: Response) => {
        if (!player) {
          res.json({ state: 'idle', loopPlayback: true })
          return
        }
        res.json(player.getStatus())
      })

      router.put('/playback/settings', (req: Request, res: Response) => {
        if (!player) {
          res.status(400).json({ error: 'No recording loaded' })
          return
        }
        const { loopPlayback } = req.body as { loopPlayback?: boolean }
        if (typeof loopPlayback === 'boolean') {
          player.loop = loopPlayback
        }
        res.json({ ok: true })
      })
    }
  }

  return plugin
}
