"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const zlib_1 = __importDefault(require("zlib"));
const mrr_reader_1 = require("./mrr-reader");
const mrr_player_1 = require("./mrr-player");
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
function safeMrrFilename(filename) {
    const base = path_1.default.basename(filename);
    if (base !== filename ||
        filename.includes('..') ||
        (!filename.endsWith('.mrr') && !filename.endsWith('.mrr.gz'))) {
        return null;
    }
    return base;
}
module.exports = function (app) {
    let player = null;
    let recordingsDir = '';
    function createRadarProvider() {
        const provider = {
            getRadars() {
                if (player?.radarId) {
                    return Promise.resolve([player.radarId]);
                }
                return Promise.resolve([]);
            },
            getRadarInfo(radarId) {
                if (!player || player.radarId !== radarId)
                    return Promise.resolve(null);
                return Promise.resolve({
                    id: player.radarId,
                    name: `Playback: ${player.filename}`,
                    brand: 'Playback',
                    status: player.playing ? 'transmit' : 'standby',
                    spokesPerRevolution: player.spokesPerRev,
                    maxSpokeLen: player.maxSpokeLen,
                    range: player.range,
                    controls: {
                        gain: { auto: false, value: 0 }
                    }
                });
            },
            getCapabilities(radarId) {
                if (!player || player.radarId !== radarId)
                    return Promise.resolve(null);
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
                });
            },
            getState(radarId) {
                if (!player || player.radarId !== radarId)
                    return Promise.resolve(null);
                return Promise.resolve({
                    id: player.radarId,
                    timestamp: new Date().toISOString(),
                    status: player.playing ? 'transmit' : 'standby',
                    controls: {
                        power: player.playing ? 'transmit' : 'standby',
                        range: player.range
                    }
                });
            },
            async getControl(radarId, controlId) {
                if (!player || player.radarId !== radarId)
                    return null;
                const getStateFn = provider.getState;
                if (!getStateFn)
                    return null;
                const state = await getStateFn(radarId);
                return state?.controls[controlId] ?? null;
            }
        };
        return provider;
    }
    function listRecordings() {
        if (!fs_1.default.existsSync(recordingsDir)) {
            return [];
        }
        const files = fs_1.default
            .readdirSync(recordingsDir)
            .filter((f) => f.endsWith('.mrr') || f.endsWith('.mrr.gz'))
            .map((filename) => {
            const filePath = path_1.default.join(recordingsDir, filename);
            const stats = fs_1.default.statSync(filePath);
            const info = {
                filename,
                size: stats.size,
                modifiedMs: stats.mtimeMs
            };
            try {
                const data = fs_1.default.readFileSync(filePath);
                const buf = filename.endsWith('.gz') ? zlib_1.default.gunzipSync(data) : data;
                const header = mrr_reader_1.MrrHeader.fromBuffer(buf);
                const footer = mrr_reader_1.MrrFooter.fromBuffer(buf.subarray(buf.length - mrr_reader_1.FOOTER_SIZE));
                info.durationMs = footer.durationMs;
                info.frameCount = footer.frameCount;
                info.spokesPerRev = header.spokesPerRev;
                info.radarBrand = header.radarBrand;
            }
            catch (e) {
                app.debug(`Could not read metadata for ${filename}: ${e instanceof Error ? e.message : String(e)}`);
            }
            return info;
        });
        files.sort((a, b) => b.modifiedMs - a.modifiedMs);
        return files;
    }
    const plugin = {
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
        start(config) {
            app.debug('Starting mayara-playback plugin');
            const settings = config;
            recordingsDir = settings.recordingsDir || path_1.default.join(app.getDataDirPath(), 'recordings');
            if (!fs_1.default.existsSync(recordingsDir)) {
                fs_1.default.mkdirSync(recordingsDir, { recursive: true });
                app.debug(`Created recordings directory: ${recordingsDir}`);
            }
            try {
                app.radarApi.register(plugin.id, {
                    name: plugin.name,
                    methods: createRadarProvider()
                });
                app.debug('Registered as radar provider with SignalK Radar API');
            }
            catch (err) {
                app.error(`Failed to register radar provider: ${err instanceof Error ? err.message : String(err)}`);
            }
            app.setPluginStatus('Ready - No recording loaded');
        },
        stop() {
            app.debug('Stopping mayara-playback plugin');
            try {
                app.radarApi.unRegister(plugin.id);
                app.debug('Unregistered from radar API');
            }
            catch (err) {
                app.debug(`Error unregistering: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (player) {
                player.stop();
                player = null;
            }
            app.setPluginStatus('Stopped');
        },
        registerWithRouter(router) {
            router.get('/recordings', (req, res) => {
                try {
                    const files = listRecordings();
                    res.json({ recordings: files });
                }
                catch (err) {
                    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
                }
            });
            router.post('/recordings/upload', (req, res) => {
                const chunks = [];
                let totalSize = 0;
                let aborted = false;
                req.on('data', (chunk) => {
                    totalSize += chunk.length;
                    if (totalSize > MAX_UPLOAD_SIZE) {
                        aborted = true;
                        req.destroy();
                        res.status(413).json({ error: 'Upload too large' });
                        return;
                    }
                    chunks.push(chunk);
                });
                req.on('error', (err) => {
                    if (!aborted) {
                        res.status(500).json({ error: err.message });
                    }
                });
                req.on('end', () => {
                    if (aborted)
                        return;
                    try {
                        const body = Buffer.concat(chunks);
                        let filename = `upload_${Date.now()}.mrr`;
                        const contentDisp = req.headers['content-disposition'];
                        if (contentDisp) {
                            const match = /filename="?([^";\s]+)"?/.exec(contentDisp);
                            if (match) {
                                const safe = safeMrrFilename(match[1]);
                                if (safe)
                                    filename = safe;
                            }
                        }
                        const filePath = path_1.default.join(recordingsDir, filename);
                        fs_1.default.writeFileSync(filePath, body);
                        app.debug(`Uploaded recording: ${filename} (${body.length} bytes)`);
                        res.json({ filename, size: body.length });
                    }
                    catch (err) {
                        res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
                    }
                });
            });
            router.delete('/recordings/:filename', (req, res) => {
                try {
                    const safe = safeMrrFilename(req.params.filename);
                    if (!safe) {
                        res.status(400).json({ error: 'Invalid filename' });
                        return;
                    }
                    const filePath = path_1.default.join(recordingsDir, safe);
                    if (!fs_1.default.existsSync(filePath)) {
                        res.status(404).json({ error: 'Recording not found' });
                        return;
                    }
                    fs_1.default.unlinkSync(filePath);
                    res.json({ ok: true });
                }
                catch (err) {
                    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
                }
            });
            router.post('/playback/load', async (req, res) => {
                try {
                    const { filename } = req.body;
                    if (!filename) {
                        res.status(400).json({ error: 'filename required' });
                        return;
                    }
                    const safe = safeMrrFilename(filename);
                    if (!safe) {
                        res.status(400).json({ error: 'Invalid filename' });
                        return;
                    }
                    const filePath = path_1.default.join(recordingsDir, safe);
                    if (!fs_1.default.existsSync(filePath)) {
                        res.status(404).json({ error: 'Recording not found' });
                        return;
                    }
                    if (player) {
                        app.debug(`Stopping existing playback before loading new: ${player.filename}`);
                        player.stop();
                        player = null;
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }
                    player = new mrr_player_1.MrrPlayer(app, filePath);
                    player.load();
                    app.setPluginStatus(`Loaded: ${filename}`);
                    res.json({
                        radarId: player.radarId,
                        filename,
                        durationMs: player.durationMs,
                        frameCount: player.frameCount
                    });
                }
                catch (err) {
                    app.error(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
                    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
                }
            });
            router.post('/playback/play', (req, res) => {
                if (!player) {
                    res.status(400).json({ error: 'No recording loaded' });
                    return;
                }
                player.play();
                app.setPluginStatus(`Playing: ${player.filename}`);
                res.json({ ok: true });
            });
            router.post('/playback/pause', (req, res) => {
                if (!player) {
                    res.status(400).json({ error: 'No recording loaded' });
                    return;
                }
                player.pause();
                app.setPluginStatus(`Paused: ${player.filename}`);
                res.json({ ok: true });
            });
            router.post('/playback/stop', (req, res) => {
                if (!player) {
                    res.status(400).json({ error: 'No recording loaded' });
                    return;
                }
                player.stop();
                player = null;
                app.setPluginStatus('Ready - No recording loaded');
                res.json({ ok: true });
            });
            router.get('/playback/status', (req, res) => {
                if (!player) {
                    res.json({ state: 'idle', loopPlayback: true });
                    return;
                }
                res.json(player.getStatus());
            });
            router.put('/playback/settings', (req, res) => {
                if (!player) {
                    res.status(400).json({ error: 'No recording loaded' });
                    return;
                }
                const { loopPlayback } = req.body;
                if (typeof loopPlayback === 'boolean') {
                    player.loop = loopPlayback;
                }
                res.json({ ok: true });
            });
        }
    };
    return plugin;
};
//# sourceMappingURL=index.js.map