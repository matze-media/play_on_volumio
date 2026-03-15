# Play on Volumio

A Chrome extension that adds **"Play on Volumio"** buttons to [albumoftheyear.org](https://www.albumoftheyear.org/album/), so you can browse albums and play them directly on your local Volumio player.

## Features

- **Play on Volumio** – One-click album playback from album pages
- **Now playing overlay** – Floating player on albumoftheyear.org (artist, album, track, seek bar)
- **Media Session** – Control playback from macOS Control Center, media keys, keyboard shortcuts
- **Album art** – Shown in OS media controls when available
- **Works on Volumio tab** – Media Session also controls when the Volumio Web UI tab is open

## Requirements

- **Chrome** (or Chromium-based browser)
- **Volumio** running on your local network
- **albumoftheyear.org** – Extension only works on this site

## Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/matze-media/play_on_volumio.git
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the folder containing the extension

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

## Supported Pages

- Album detail pages (`/album/*`)
- Artist pages (`/artist/*`)
- Discover, search, genres, releases
- Ratings and lists

## License

MIT
