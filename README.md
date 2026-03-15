# Play on Volumio

A Chrome extension that adds **"Play on Volumio"** buttons to [albumoftheyear.org](https://www.albumoftheyear.org/album/), so you can browse albums and play them directly on your local Volumio player.

## Features

- **Play on Volumio** – One-click album playback from album pages
- **Now playing overlay** – Floating player on albumoftheyear.org (artist, album, track, seek bar)
- **Media Session** – Control playback from macOS Control Center, media keys, keyboard shortcuts
- **Album art** – Shown in OS media controls when available
- **Works on Volumio tab** – Media Session also controls when the Volumio Web UI tab is open
- **Similar albums** – On the Volumio browse/playback pages, a "Search similar album" button finds albums similar to the currently playing track (requires Album Tools plugin)
- **Recently added** – A "Recently added" button shows albums from your MPD library ordered by add date (requires Album Tools plugin)

## Requirements

- **Chrome** (or Chromium-based browser)
- **Volumio** running on your local network
- **albumoftheyear.org** – Extension only works on this site
- **Album Tools Volumio plugin** – Required for Similar Albums and Recently Added features (included in this repo)

## Installation

### 1. Chrome extension

1. Clone or download this repository:
   ```bash
   git clone https://github.com/matze-media/play_on_volumio.git
   cd play_on_volumio
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the repository folder (root of the clone)

### 2. Volumio plugin (Album Tools)

The Similar Albums and Recently Added buttons require the **Album Tools** plugin on your Volumio device.

1. Copy the plugin folder to your Volumio device:
   ```bash
   # From this repo, copy volumio_plugins/user_interface/album_tools/
   # to /data/plugins/user_interface/album_tools/ on your Volumio device
   ```
   Use SSH (`ssh volumio@<volumio-ip>`) or SCP to copy the folder.
2. On the Volumio device, run `npm install` in the plugin directory
3. Restart Volumio
4. Enable the plugin: **Plugins → User Interface → Album Tools**
5. Configure a [Last.fm API key](https://www.last.fm/api/account/create) (free) in the plugin settings for Similar Albums

See [volumio_plugins/user_interface/album_tools/README.md](volumio_plugins/user_interface/album_tools/README.md) for plugin details and API reference.

## Configuration

1. Right-click the extension icon → **Options**
2. Set your Volumio settings:

| Setting | Description |
|---------|-------------|
| **Volumio server IP** | Your Volumio device IP (e.g. `192.168.1.100`) |
| **Volumio API port** | REST API and WebSocket port (default: `3000`) |
| **Volumio Web UI port** | Optional. Port from the browser when Volumio is open. Use `80` for `http://192.168.1.100`, or `8080` for `http://192.168.1.100:8080`. Leave empty to use the API port. |
| **Max. similar albums** | Maximum number of similar albums shown in the modal (default: `12`) |
| **Max. recently added albums** | Maximum number of recently added albums shown in the modal (default: `9`) |

## Usage

- **Album pages** – Click **▶ Play on Volumio** to play the album
- **Discover / artist / ratings pages** – Play buttons on album cards
- **Now playing** – Use the floating overlay or OS media controls (play, pause, next, previous, seek)
- **Similar albums** – Open the Volumio Web UI, go to **Browse** (`/browse`) or **Playback** (`/playback`), play a track, then click **Search similar album**. A modal lists similar albums from your library; click a cover to play.
- **Recently added** – On the same Volumio pages, click **Recently added** to see albums from your library ordered by add date; click a cover to play.

## Supported Pages

- Album detail pages (`/album/*`)
- Artist pages (`/artist/*`)
- Discover, search, genres, releases
- Ratings and lists

## License

MIT
