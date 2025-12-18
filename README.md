# MaYaRa Radar Playback Plugin for SignalK

A SignalK plugin for playing back `.mrr` radar recordings through the SignalK Radar API.

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
http://your-signalk-server:3000/plugins/@marineyachtradar/signalk-playback-plugin/playback.html
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

### Using mayara-server-signalk-plugin

If you have the **mayara-server-signalk-plugin** installed (the main MaYaRa radar plugin), you can also view playback recordings through its interface:

1. Start playback in this plugin
2. Open the mayara-server-signalk-plugin's radar viewer
3. The playback radar will appear in the radar list
4. Select it to view the recording with full MaYaRa GUI features

### Using Other SignalK Radar Consumers

Any application that implements the SignalK Radar API can display the playback:
- The radar appears at `/signalk/v2/api/vessels/self/radars/playback-{filename}`
- Spoke data streams via SignalK's binary WebSocket

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

## Troubleshooting

**Recording won't load:**
- Check the SignalK server logs for errors
- Ensure the file is a valid `.mrr` or `.mrr.gz` file
- Verify the file wasn't corrupted during transfer

**No radar appears in SignalK:**
- Make sure playback is started (not just loaded)
- Refresh the radar consumer application
- Check that SignalK's Radar API is enabled

**Playback stutters:**
- This can happen on slower systems with large recordings
- Try using recordings with fewer spokes per revolution

## Technical Details

This plugin:
- Reads `.mrr` files directly (no mayara-server required)
- Registers as a RadarProvider via SignalK's Radar API
- Emits spoke frames through SignalK's `binaryStreamManager`
- Plays back frames at their original recorded timing
- Sets power status to "transmit" so GUI shows radar as active (not STANDBY)
- Pre-loads all frames for accurate timing
- Auto-stops current playback when loading a different file

## Development

Build options:

```bash
# Build with GUI from npm (default)
node build.js

# Build with local mayara-gui (for development)
node build.js --local-gui

# Create tarball for manual install (includes public/)
node build.js --local-gui --pack
```

The `--local-gui` option copies GUI files from the sibling `../mayara-gui` directory instead of from npm.

The `--pack` option creates a `.tgz` tarball with `public/` included (normally excluded by `.npmignore`). Install with:

```bash
npm install /path/to/marineyachtradar-signalk-playback-plugin-0.1.0.tgz
```

## Related Projects

- **[mayara-server](https://github.com/MaYaRa-Marine/mayara-server)** - Standalone radar server (creates recordings)
- **[mayara-server-signalk-plugin](https://github.com/MaYaRa-Marine/mayara-server-signalk-plugin)** - SignalK plugin for live radar (connects to mayara-server)

## License

MIT License - See [LICENSE](LICENSE) for details.
