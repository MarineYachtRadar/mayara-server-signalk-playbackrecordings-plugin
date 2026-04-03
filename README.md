# MaYaRa Radar Playback Plugin for SignalK

A SignalK plugin for playing back `.mrr` radar recordings through the SignalK Radar API.

## Prerequisites

This plugin requires SignalK server with the **Radar API** enabled. The Radar API is not yet in upstream SignalK — it is available via:

- **PR [SignalK/signalk-server#2357](https://github.com/SignalK/signalk-server/pull/2357)** — Radar API refactored

Until that PR is merged, use a SignalK server build that includes the Radar API (e.g. from the `radar_api` branch).

## What This Plugin Does

This plugin allows you to play pre-recorded radar data (`.mrr` files) through SignalK's Radar API. During playback, the recording appears as a virtual radar that any SignalK radar consumer can connect to and display.

**Use cases:**
- Test and develop SignalK radar display applications without live radar hardware
- Demo radar functionality at exhibitions or presentations
- Debug radar rendering code with consistent, repeatable data
- Share interesting radar captures with other developers

## Installation

Install from the **SignalK App Store**:

1. Open your SignalK server web interface
2. Go to **Appstore** > **Available**
3. Search for "MaYaRa Radar Playback"
4. Click **Install**
5. Restart SignalK when prompted

## Getting Started

### 1. Access the Playback Interface

After installation, navigate to:
```
http://your-signalk-server:3000/@marineyachtradar/signalk-playback-plugin/playback.html
```

Or find it in SignalK's **Webapps** menu.

### 2. Upload a Recording

You can upload `.mrr` or `.mrr.gz` files:
- **Drag and drop** a file onto the upload zone
- Or **click** the upload zone to browse for a file

Recordings are stored on the SignalK server and persist across restarts.

### 3. Load and Play

1. Select a recording from the list
2. Click **Load** to prepare it for playback
3. Click **Play** to start playback
4. Use **Pause** and **Stop** as needed
5. Enable **Loop** to repeat the recording continuously

### 4. View the Radar

Click **View Radar** to open the radar display. This shows the playback radar using the built-in viewer.

## Viewing with Other Clients

During playback, the recording registers as a virtual radar in SignalK. The radar ID follows the pattern `playback-{filename}`.

Any application that implements the SignalK Radar API can display the playback:
- The radar appears at `/signalk/v2/api/vessels/self/radars/playback-{filename}`
- Spoke data streams via SignalK's binary WebSocket at `/signalk/v2/api/vessels/self/radars/{id}/stream`

## Obtaining Recording Files

Recording files (`.mrr`) are created by **mayara-server** when connected to a live radar:

1. Run mayara-server with a radar connected
2. Open the recordings page at `http://localhost:6502/recordings.html`
3. Select a radar and click **Start Recording**
4. Click **Stop Recording** when done
5. Download the recording as `.mrr.gz` (compressed)
6. Upload to this SignalK plugin

## File Format

- `.mrr` - MaYaRa Radar Recording (uncompressed)
- `.mrr.gz` - Gzip-compressed recording (~95% smaller for transfer)

Both formats are supported for upload. Files are stored uncompressed on the server for fast playback.

## Development

### Building

The GUI is sourced from [mayara-server](https://github.com/MarineYachtRadar/mayara-server)'s `web/gui/` directory (expected as a sibling checkout at `../mayara-server/`).

```bash
npm install
npm run build
```

To specify a different GUI source path:

```bash
node build.js --gui-path /path/to/mayara-server/web/gui
```

### Scripts

- `npm run format` — prettier + eslint --fix
- `npm run lint` — eslint check
- `npm run build` — compile TypeScript + copy GUI
- `npm run test` — run tests (vitest)
- `npm run build:all` — lint + build + test

## Related Projects

- **[mayara-server](https://github.com/MarineYachtRadar/mayara-server)** - Standalone radar server (creates recordings, provides GUI)
- **[signalk-server#2357](https://github.com/SignalK/signalk-server/pull/2357)** - Radar API for SignalK server

## License

MIT License - See [LICENSE](LICENSE) for details.
