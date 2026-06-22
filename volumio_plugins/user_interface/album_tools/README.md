# Album Tools

Volumio plugin combining **Similar Albums** and **Recently Added Albums** in one place.

## Features

- **Similar Albums** – Uses Last.fm API to find similar artists/tracks, returns only albums in your MPD library
- **Recently Added Albums** – Returns albums from MPD library ordered by add date (MPD 0.24+)

## Requirements

- Volumio 3 with MPD music library
- SSH access to your Volumio device
- [Last.fm API key](https://www.last.fm/api/account/create) (free) – for Similar Albums only

## Installation

Install using the [official Volumio plugin workflow](https://developers.volumio.com/plugins/writing-a-plugin): copy source into `volumio-plugins-sources`, then run `volumio plugin refresh`.

### Before you start

| Topic | Detail |
|-------|--------|
| **Do not use `volumio plugin init`** | That creates a blank new plugin. Album Tools is already complete in this repo. |
| **Source path on Volumio** | `~/volumio-plugins-sources/album_tools` (repo root) |
| **Runtime path on Volumio** | `/data/plugins/user_interface/album_tools/` (category from `package.json`) |
| **Replace placeholders** | Use your real IP, e.g. `192.168.1.100`, not `YOUR_VOLUMIO_IP` |

### Step 1 — Clone `volumio-plugins-sources` (Volumio device, once)

```bash
ssh volumio@YOUR_VOLUMIO_IP
git clone https://github.com/volumio/volumio-plugins-sources.git
ls ~/volumio-plugins-sources
```

You should see plugin folders like `personal_radio` and `example_plugin` at the top level.

### Step 2 — Copy plugin from your Mac

From the **root of the play-on-volumio-extension repo** on your Mac:

```bash
cd /path/to/play-on-volumio-extension
scp -r volumio_plugins/user_interface/album_tools \
  volumio@YOUR_VOLUMIO_IP:~/volumio-plugins-sources/album_tools
```

Verify on the Volumio device:

```bash
ls ~/volumio-plugins-sources/album_tools/package.json
```

If `package.json` is missing, the copy failed. Check that step 1 completed and that you ran `scp` from the repo root.

### Step 3 — Install npm dependencies (Volumio device)

```bash
cd ~/volumio-plugins-sources/album_tools
npm install
chmod +x install.sh uninstall.sh
```

### Step 4 — Create target folder (fresh Volumio only)

On a **fresh install**, `/data/plugins/user_interface/album_tools/` does not exist. `volumio plugin refresh` will fail with:

```text
/bin/cp: target '/data/plugins/user_interface/album_tools': No such file or directory
```

Create the folder first:

```bash
sudo mkdir -p /data/plugins/user_interface/album_tools
sudo chown -R volumio:volumio /data/plugins/user_interface/album_tools
```

Skip this step when updating an already installed plugin.

### Step 5 — Deploy

```bash
cd ~/volumio-plugins-sources/album_tools
volumio plugin refresh
volumio vrestart
```

Expected output: `Plugin succesfully refreshed`.

### Step 6 — Enable and configure

1. Open Volumio Web UI → **Plugins** → **User Interface** → **Album Tools** → **Enable**
2. Open settings (cog) → enter your [Last.fm API key](https://www.last.fm/api/account/create) → **Save**

Config is stored at `/data/configuration/user_interface/album_tools/config.json`.

### Step 7 — Verify

```bash
curl "http://localhost:3000/api/v1/pluginEndpoint?endpoint=recently_added_albums"
```

Expected: JSON with `"success": true`.

If you see `"No valid Plugin REST Endpoint"`, enable the plugin and run `volumio vrestart`.

### Updating after code changes

When Album Tools is already installed, repeat from step 2 (or edit files directly in `~/volumio-plugins-sources/album_tools`), then:

```bash
cd ~/volumio-plugins-sources/album_tools
npm install          # only if package.json dependencies changed
volumio plugin refresh
volumio vrestart
```

No `mkdir` needed for updates.

### Alternative: install from zip (first time)

If `refresh` keeps failing, package and install instead:

```bash
cd ~/volumio-plugins-sources/album_tools
npm install
volumio plugin package
volumio plugin install
volumio vrestart
```

This creates the target folder automatically. Follow the on-screen prompts for the generated `.zip` file.

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| **Last.fm API Key** | Required for Similar Albums | — |
| **Similar artists limit** | Max similar artists from Last.fm | 15 |
| **Max similar albums to return** | Max albums in similar_albums response | 50 |
| **Max recently added albums** | Max albums in recently_added_albums response | 20 |

## REST API

**Base URL:** `http://<volumio-ip>:3000` (e.g. `http://localhost:3000`)

The plugin must be **enabled** for these endpoints to work.

### Similar Albums

```
GET /api/v1/pluginEndpoint?endpoint=similar_albums
```

Requires a track to be playing. Returns albums from similar artists that exist in your MPD library.

**Example:** `curl "http://localhost:3000/api/v1/pluginEndpoint?endpoint=similar_albums"`

**Response:** `{ success, data: { currentArtist, currentAlbum, albums, matchRate } }`

### Recently Added Albums

```
GET /api/v1/pluginEndpoint?endpoint=recently_added_albums
```

Returns albums from MPD library ordered by add date (newest first).

**Example:** `curl "http://localhost:3000/api/v1/pluginEndpoint?endpoint=recently_added_albums"`

**Response:** `{ success, data: { albums } }`

## License

GPL-3.0
