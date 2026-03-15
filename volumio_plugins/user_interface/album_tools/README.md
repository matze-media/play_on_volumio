# Album Tools

Volumio plugin combining **Similar Albums** and **Recently Added Albums** in one place.

## Features

- **Similar Albums** – Uses Last.fm API to find similar artists/tracks, returns only albums in your MPD library
- **Recently Added Albums** – Returns albums from MPD library ordered by add date (MPD 0.24+)

## Requirements

- Volumio with MPD music library
- [Last.fm API key](https://www.last.fm/api/account/create) (free) – for Similar Albums only

## Installation

1. Copy the plugin to `/data/plugins/user_interface/album_tools/` on your Volumio device
2. Run `npm install` in the plugin directory
3. Restart Volumio
4. Enable in **Plugins → User Interface → Album Tools**

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| **Last.fm API Key** | Required for Similar Albums | — |
| **Similar artists limit** | Max similar artists from Last.fm | 15 |
| **Max similar albums to return** | Max albums in similar_albums response | 50 |
| **Max recently added albums** | Max albums in recently_added_albums response | 20 |

## REST API

**Base URL:** `http://<volumio-ip>:3000` (e.g. `http://localhost:3000`)

The plugin must be **enabled** (Plugins → User Interface → Album Tools) for these endpoints to work. If you get `"No valid Plugin REST Endpoint"`, the plugin is not loaded—enable it and restart Volumio.

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
