'use strict';

const libQ = require('kew');
const mpd = require('mpd');
const cmd = mpd.cmd;
const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const vConf = require('v-conf');
const writeFileAtomicSync = require('write-file-atomic').sync;

module.exports = ControllerAlbumTools;

function ControllerAlbumTools(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
}

function resolve() {
  return libQ.resolve();
}

ControllerAlbumTools.prototype.getConfigPath = function () {
  return this.commandRouter.pluginManager.getPluginConfigurationFile('user_interface', 'album_tools', 'config.json');
};

ControllerAlbumTools.prototype.onVolumioStart = function () {
  const self = this;
  self.configFile = self.getConfigPath();
  self.config = new vConf();
  self.config.loadFile(self.configFile);
  return resolve();
};

ControllerAlbumTools.prototype.onStart = function () {
  const self = this;
  self.getConf(self.configFile);

  this.commandRouter.addPluginRestEndpoint({
    endpoint: 'similar_albums',
    type: 'user_interface',
    name: 'album_tools',
    method: 'getSimilarAlbums'
  });

  this.commandRouter.addPluginRestEndpoint({
    endpoint: 'recently_added_albums',
    type: 'user_interface',
    name: 'album_tools',
    method: 'getRecentlyAddedAlbums'
  });

  this.logger.info('[AlbumTools] Plugin started, REST endpoints registered');
  return resolve();
};

ControllerAlbumTools.prototype.onStop = function () {
  this.commandRouter.removePluginRestEndpoint({ endpoint: 'similar_albums' });
  this.commandRouter.removePluginRestEndpoint({ endpoint: 'recently_added_albums' });
  return resolve();
};

ControllerAlbumTools.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerAlbumTools.prototype.getConf = function (configFile) {
  const self = this;
  const file = configFile || self.getConfigPath();
  if (self.config) {
    self.config.loadFile(file);
  } else {
    self.config = new vConf();
    self.config.loadFile(file);
  }
  return resolve();
};

ControllerAlbumTools.prototype.getConfigValue = function (key, def) {
  const self = this;
  const v = self.config.get(key);
  if (v === undefined || v === null) return def;
  return (typeof v === 'object' && v !== null && 'value' in v) ? v.value : v;
};

ControllerAlbumTools.prototype.getUIConfig = function () {
  const defer = libQ.defer();
  const self = this;
  const langCode = this.commandRouter.sharedVars.get('language_code') || 'en';
  const configPath = self.configFile || self.getConfigPath();

  self.logger.info('[AlbumTools] getUIConfig: configPath=' + configPath + ', exists=' + fs.existsSync(configPath));
  self.getConf(configPath);

  const getConfigVal = function (key, def) {
    const extractVal = function (v) {
      if (v === undefined || v === null) return v;
      return (typeof v === 'object' && v !== null && 'value' in v) ? v.value : v;
    };
    let v = self.config.get(key);
    v = extractVal(v);
    if (v !== undefined && v !== null) return v;
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readJsonSync(configPath);
        const entry = raw && raw[key];
        const val = (entry && typeof entry === 'object' && 'value' in entry) ? entry.value : def;
        if (key === 'lastfmApiKey' && val) {
          self.logger.info('[AlbumTools] getUIConfig: read ' + key + ' from file (len=' + String(val).length + ')');
        }
        return val;
      } catch (e) {
        self.logger.info('[AlbumTools] Fallback config read: ' + e.message);
      }
    }
    return def;
  };

  this.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + langCode + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  )
    .then(function (uiconf) {
      const apiKey = getConfigVal('lastfmApiKey', '') || '';
      const limit = getConfigVal('similarArtistsLimit', 15) ?? 15;
      const maxSimilar = getConfigVal('maxSimilarAlbums', 50) ?? 50;
      const maxRecent = getConfigVal('maxRecentlyAddedAlbums', 20) ?? 20;
      uiconf.sections[0].content[0].value = apiKey;
      uiconf.sections[0].content[1].value = limit;
      uiconf.sections[0].content[2].value = maxSimilar;
      uiconf.sections[1].content[0].value = maxRecent;
      self.logger.info('[AlbumTools] getUIConfig: returning lastfmApiKey=' + (apiKey ? '(len=' + apiKey.length + ')' : '(empty)') +
        ', similarArtistsLimit=' + limit + ', maxSimilarAlbums=' + maxSimilar + ', maxRecentlyAddedAlbums=' + maxRecent);
      defer.resolve(uiconf);
    })
    .fail(function (err) {
      self.logger.error('[AlbumTools] Failed to parse UI Configuration: ' + err);
      defer.reject(new Error());
    });

  return defer.promise;
};

ControllerAlbumTools.prototype.setUIConfig = function (data) {
  const self = this;
  self.logger.info('[AlbumTools] setUIConfig called, hasData=' + !!data);
  if (data) {
    self.updateConfig(data);
  }
  return resolve();
};

ControllerAlbumTools.prototype.updateConfig = function (data) {
  const self = this;
  self.logger.info('[AlbumTools] updateConfig called, data keys: ' + (data ? Object.keys(data).join(', ') : 'null'));
  try {
    self.logger.info('[AlbumTools] updateConfig raw data: ' + JSON.stringify(data));
  } catch (e) {
    self.logger.info('[AlbumTools] updateConfig raw data stringify failed: ' + e.message);
  }

  if (!data) {
    self.logger.info('[AlbumTools] updateConfig: no data, skipping');
    return resolve();
  }
  if (!self.config) {
    self.config = new vConf();
    self.config.loadFile(self.configFile || self.getConfigPath());
  }

  const configPath = self.configFile || self.getConfigPath();
  self.logger.info('[AlbumTools] updateConfig: configPath=' + configPath);
  self.logger.info('[AlbumTools] updateConfig: config file exists before=' + fs.existsSync(configPath));

  const getVal = function (v) {
    if (v === undefined) return undefined;
    return (typeof v === 'object' && v !== null && 'value' in v) ? v.value : v;
  };

  const d = data.section_similar_albums || data.section_api || data;
  const apiKey = getVal(d.lastfmApiKey);
  const limit = getVal(d.similarArtistsLimit);
  const maxSimilar = getVal(d.maxSimilarAlbums);
  const d2 = data.section_recently_added || data;
  const maxRecent = getVal(d2.maxRecentlyAddedAlbums);

  self.logger.info('[AlbumTools] updateConfig: extracted lastfmApiKey=' + (apiKey !== undefined ? '(set)' : '(none)') +
    ', similarArtistsLimit=' + (limit !== undefined ? limit : '(none)') +
    ', maxSimilarAlbums=' + (maxSimilar !== undefined ? maxSimilar : '(none)') +
    ', maxRecentlyAddedAlbums=' + (maxRecent !== undefined ? maxRecent : '(none)'));

  try {
    let current = {};
    if (fs.existsSync(configPath)) {
      try {
        current = fs.readJsonSync(configPath);
        self.logger.info('[AlbumTools] updateConfig: read from file keys=' + Object.keys(current).join(', '));
      } catch (e) {
        self.logger.info('[AlbumTools] updateConfig: could not read existing config: ' + e.message);
      }
    }
    const getCurrentVal = function (key) {
      const e = current[key];
      return (e && typeof e === 'object' && 'value' in e) ? e.value : undefined;
    };
    const toWrite = {
      lastfmApiKey: { type: 'string', value: apiKey !== undefined ? String(apiKey || '') : (getCurrentVal('lastfmApiKey') ?? '') },
      similarArtistsLimit: { type: 'number', value: limit !== undefined ? Math.max(5, Math.min(50, parseInt(limit, 10) || 15)) : (getCurrentVal('similarArtistsLimit') ?? 15) },
      maxSimilarAlbums: { type: 'number', value: maxSimilar !== undefined ? Math.max(1, Math.min(200, parseInt(maxSimilar, 10) || 50)) : (getCurrentVal('maxSimilarAlbums') ?? 50) },
      maxRecentlyAddedAlbums: { type: 'number', value: maxRecent !== undefined ? Math.max(1, Math.min(200, parseInt(maxRecent, 10) || 20)) : (getCurrentVal('maxRecentlyAddedAlbums') ?? 20) }
    };
    const dirPath = path.dirname(configPath);
    self.logger.info('[AlbumTools] updateConfig: ensuring dir ' + dirPath);
    fs.ensureDirSync(dirPath);
    self.logger.info('[AlbumTools] updateConfig: writing to ' + configPath);
    const jsonStr = JSON.stringify(toWrite, null, 2);
    writeFileAtomicSync(configPath, jsonStr);
    self.logger.info('[AlbumTools] updateConfig: write done, file exists after=' + fs.existsSync(configPath));

    const pluginFolderConfig = path.join(__dirname, 'config.json');
    if (pluginFolderConfig !== configPath && pluginFolderConfig.startsWith('/data/plugins/') && fs.existsSync(path.dirname(pluginFolderConfig))) {
      self.logger.info('[AlbumTools] updateConfig: also writing to plugin folder ' + pluginFolderConfig);
      try {
        writeFileAtomicSync(pluginFolderConfig, jsonStr);
      } catch (e2) {
        self.logger.info('[AlbumTools] updateConfig: plugin folder write failed: ' + e2.message);
      }
    }
    if (fs.existsSync(configPath)) {
      const written = fs.readJsonSync(configPath);
      const writtenMax = written.maxRecentlyAddedAlbums && written.maxRecentlyAddedAlbums.value;
      self.logger.info('[AlbumTools] updateConfig: file content keys=' + Object.keys(written).join(', ') +
        ', maxRecentlyAddedAlbums(verify)=' + writtenMax);
    }
    self.config.loadFile(configPath);
    self.logger.info('[AlbumTools] updateConfig: toWrite lastfmApiKey=' + (toWrite.lastfmApiKey.value ? '(len=' + toWrite.lastfmApiKey.value.length + ')' : '(empty)') +
      ', similarArtistsLimit=' + toWrite.similarArtistsLimit.value + ', maxSimilarAlbums=' + toWrite.maxSimilarAlbums.value +
      ', maxRecentlyAddedAlbums=' + toWrite.maxRecentlyAddedAlbums.value);

    self.commandRouter.pushToastMessage('success', 'Album Tools', 'Configuration saved');

    self.commandRouter.getUIConfigOnPlugin('user_interface', 'album_tools', {}).then(function (config) {
      self.commandRouter.broadcastMessage('pushUiConfig', config);
    });
  } catch (e) {
    self.logger.error('[AlbumTools] Failed to save config: ' + e.message);
    self.logger.error('[AlbumTools] Save error stack: ' + (e.stack || ''));
    self.commandRouter.pushToastMessage('error', 'Album Tools', 'Failed to save configuration');
  }
  return resolve();
};

// -----------------------------------------------------------------------------
// Similar Albums (uses executeBrowseSource, artist.getSimilar + track.getSimilar)
// -----------------------------------------------------------------------------

ControllerAlbumTools.prototype.getSimilarAlbums = function (data) {
  const self = this;

  self.configFile = self.getConfigPath();
  if (!self.config) {
    self.config = new vConf();
  }
  try {
    self.config.loadFile(self.configFile);
  } catch (e) {
    self.logger.info('[AlbumTools] loadFile error: ' + e.message);
  }

  const apiKey = (self.getConfigValue('lastfmApiKey', '') || '').trim();
  if (!apiKey || apiKey === '') {
    return Promise.reject('Last.fm API key not configured');
  }

  const state = self.commandRouter.volumioGetState();
  const artist = state && state.artist ? state.artist.trim() : '';
  const track = state && state.title ? state.title.trim() : '';
  const album = state && state.album ? state.album.trim() : '';

  self.logger.info('[AlbumTools] Similar albums: artist="' + (artist || '') + '", track="' + (track || '') + '", album="' + (album || '') + '"');
  if (!artist) {
    return Promise.reject('No track playing or missing artist');
  }

  const blacklistedServices = ['webradio', 'airplay'];
  if (state.service && blacklistedServices.indexOf(state.service) !== -1) {
    return Promise.reject('Similar albums not available for this playback source');
  }

  const similarArtistsLimit = Math.max(5, Math.min(50, parseInt(self.getConfigValue('similarArtistsLimit', 15), 10) || 15));
  const maxAlbums = Math.max(1, Math.min(200, parseInt(self.getConfigValue('maxSimilarAlbums', 50), 10) || 50));

  const artistPromise = self.callLastFmSimilarArtists(artist, apiKey, similarArtistsLimit);
  const trackPromise = track
    ? self.callLastFmSimilarTracks(artist, track, apiKey, similarArtistsLimit)
    : Promise.resolve([]);

  return Promise.all([artistPromise, trackPromise])
    .then(function (results) {
      const artistList = results[0] || [];
      const trackArtistList = results[1] || [];
      const seen = {};
      const combined = [];
      artistList.forEach(function (a) {
        const n = typeof a === 'object' ? a.name : a;
        const m = typeof a === 'object' && a.match != null ? (parseFloat(a.match) <= 1 ? parseFloat(a.match) * 100 : parseFloat(a.match)) : null;
        if (n && !seen[n]) {
          seen[n] = true;
          combined.push({ name: n, match: m });
        }
      });
      trackArtistList.forEach(function (a) {
        const n = typeof a === 'object' ? a.name : a;
        const m = typeof a === 'object' && a.match != null ? (parseFloat(a.match) <= 1 ? parseFloat(a.match) * 100 : parseFloat(a.match)) : null;
        if (!n) return;
        if (!seen[n]) {
          seen[n] = true;
          combined.push({ name: n, match: m });
        } else {
          const idx = combined.findIndex(function (x) { return x.name === n; });
          if (idx >= 0 && m != null && (combined[idx].match == null || m > combined[idx].match)) {
            combined[idx].match = m;
          }
        }
      });
      self.logger.info('[AlbumTools] Last.fm results: artist.getSimilar=' + artistList.length + ', track.getSimilar=' + trackArtistList.length + ', combined=' + combined.length);
      if (combined.length === 0) {
        return { currentArtist: artist, currentAlbum: album || null, albums: [], matchRate: 0 };
      }
      return self.collectLocalAlbumsForArtists(combined, maxAlbums)
        .then(function (data) {
          const matchRate = data.totalSimilarArtists > 0
            ? Math.round(100 * data.artistsWithAlbums / data.totalSimilarArtists)
            : 0;
          return {
            currentArtist: artist,
            currentAlbum: album || null,
            albums: data.albums,
            matchRate: matchRate
          };
        });
    })
    .then(function (result) {
      self.logger.info('[AlbumTools] Similar albums: ' + (result.albums ? result.albums.length : 0) + ' albums');
      return result;
    })
    .catch(function (err) {
      self.logger.error('[AlbumTools] Similar albums error: ' + err);
      throw err;
    });
};

ControllerAlbumTools.prototype.callLastFmSimilarTracks = function (artist, track, apiKey, limit) {
  const self = this;

  return new Promise(function (resolve) {
    const query = '/2.0/?method=track.getsimilar&artist=' + encodeURIComponent(artist) +
      '&track=' + encodeURIComponent(track) +
      '&api_key=' + encodeURIComponent(apiKey) + '&format=json&limit=' + (limit || 20);

    self.logger.info('[AlbumTools] Last.fm track.getSimilar: artist="' + artist + '", track="' + track + '"');

    const options = {
      host: 'ws.audioscrobbler.com',
      port: 80,
      path: query
    };

    http.get(options, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            self.logger.info('[AlbumTools] track.getSimilar API error: ' + (json.message || json.error));
            resolve([]);
            return;
          }
          const tracks = json.similartracks && json.similartracks.track;
          if (!tracks) {
            resolve([]);
            return;
          }
          const list = Array.isArray(tracks)
            ? tracks.map(function (t) {
                const name = t.artist && t.artist.name ? t.artist.name : null;
                const m = t.match != null ? parseFloat(t.match) : null;
                return name ? { name: name, match: m } : null;
              })
            : (tracks.artist && tracks.artist.name
              ? [{ name: tracks.artist.name, match: tracks.match != null ? parseFloat(tracks.match) : null }]
              : []);
          resolve(list.filter(Boolean));
        } catch (e) {
          self.logger.info('[AlbumTools] track.getSimilar parse error: ' + e.message);
          resolve([]);
        }
      });
    }).on('error', function (err) {
      self.logger.info('[AlbumTools] track.getSimilar HTTP error: ' + (err && err.message));
      resolve([]);
    });
  });
};

ControllerAlbumTools.prototype.callLastFmSimilarArtists = function (artist, apiKey, limit) {
  const self = this;

  return new Promise(function (resolve, reject) {
    const query = '/2.0/?method=artist.getsimilar&artist=' + encodeURIComponent(artist) +
      '&api_key=' + encodeURIComponent(apiKey) + '&format=json&limit=' + (limit || 20);

    self.logger.info('[AlbumTools] Last.fm artist.getSimilar: artist="' + artist + '"');

    const options = {
      host: 'ws.audioscrobbler.com',
      port: 80,
      path: query
    };

    http.get(options, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            self.logger.info('[AlbumTools] artist.getSimilar API error: ' + (json.message || json.error));
            reject('Last.fm API error: ' + (json.message || json.error));
            return;
          }
          const artists = json.similarartists && json.similarartists.artist;
          if (!artists) {
            resolve([]);
            return;
          }
          const list = Array.isArray(artists)
            ? artists.map(function (a) {
                const m = a.match != null ? parseFloat(a.match) : null;
                return { name: a.name, match: m };
              })
            : [{ name: artists.name, match: artists.match != null ? parseFloat(artists.match) : null }];
          resolve(list.filter(function (a) { return a.name; }));
        } catch (e) {
          self.logger.info('[AlbumTools] artist.getSimilar parse error: ' + e.message);
          reject('Failed to parse Last.fm response');
        }
      });
    }).on('error', function (err) {
      self.logger.error('[AlbumTools] Last.fm request failed: ' + (err && err.message));
      reject('Last.fm API unavailable');
    });
  });
};

ControllerAlbumTools.prototype.fetchAlbumsForArtist = function (artistName, maxAlbums, artistMatch) {
  const self = this;
  const defer = libQ.defer();
  const safeArtist = String(artistName).replace(/"/g, '\\"');

  const client = mpd.connect({ port: 6600, host: 'localhost' });

  client.on('ready', function () {
    const findCmd = cmd('find artist "' + safeArtist + '"', []);
    client.sendCommand(findCmd, function (err, msg) {
      if (client.socket) client.socket.end();
      if (err) {
        defer.resolve([]);
        return;
      }
      const rawAlbums = self.parseFindResponse(msg, maxAlbums);
      const albums = rawAlbums.map(function (a) {
        const albumItem = Object.assign({}, a);
        if (artistMatch != null) {
          albumItem.match = Math.round(artistMatch * 10) / 10;
        }
        return albumItem;
      });
      defer.resolve(albums);
    });
  });

  client.on('error', function (err) {
    if (client.socket) client.socket.end();
    defer.resolve([]);
  });

  return defer.promise;
};

ControllerAlbumTools.prototype.collectLocalAlbumsForArtists = function (artistList, maxAlbums) {
  const self = this;
  const seenUris = {};
  const albums = [];
  let artistsWithAlbums = 0;
  let index = 0;

  return new Promise(function (resolve) {
    function collectNext() {
      if (index >= artistList.length || albums.length >= maxAlbums) {
        self.logger.info('[AlbumTools] Library browse: ' + albums.length + ' albums from ' + artistsWithAlbums + '/' + artistList.length + ' artists');
        resolve({
          albums: albums,
          artistsWithAlbums: artistsWithAlbums,
          totalSimilarArtists: artistList.length
        });
        return;
      }

      const artistEntry = artistList[index++];
      const artistName = typeof artistEntry === 'object' ? artistEntry.name : artistEntry;
      const artistMatch = typeof artistEntry === 'object' && artistEntry.match != null ? artistEntry.match : null;

      self.fetchAlbumsForArtist(artistName, maxAlbums - albums.length, artistMatch).then(function (artistAlbums) {
        let foundForArtist = 0;
        for (let i = 0; i < artistAlbums.length && albums.length < maxAlbums; i++) {
          const item = artistAlbums[i];
          if (item.uri && !seenUris[item.uri]) {
            seenUris[item.uri] = true;
            albums.push(item);
            foundForArtist++;
          }
        }
        if (foundForArtist > 0) {
          artistsWithAlbums++;
        }
        collectNext();
      });
    }

    collectNext();
  });
};

// -----------------------------------------------------------------------------
// Recently Added Albums
// -----------------------------------------------------------------------------

ControllerAlbumTools.prototype.getRecentlyAddedAlbums = function (data) {
  const self = this;
  const maxAlbums = Math.max(1, Math.min(200, parseInt(self.getConfigValue('maxRecentlyAddedAlbums', 20), 10) || 20));
  const initialWindowSize = Math.min(1000, Math.max(200, maxAlbums * 10));
  const maxWindowSize = 5000;

  const fetchWithExpansion = function (windowSize) {
    return self.fetchRecentlyAddedAlbums(windowSize, maxAlbums)
      .then(function (albums) {
        if (albums.length >= maxAlbums || windowSize >= maxWindowSize) {
          return albums;
        }
        const nextWindowSize = Math.min(maxWindowSize, windowSize * 2);
        self.logger.info('[AlbumTools] Recently added: only ' + albums.length + '/' + maxAlbums +
          ' unique albums in window=' + windowSize + ', retrying with window=' + nextWindowSize);
        return fetchWithExpansion(nextWindowSize);
      });
  };

  return new Promise(function (resolve, reject) {
    fetchWithExpansion(initialWindowSize)
      .then(function (albums) {
        resolve({ albums: albums });
      })
      .fail(function (err) {
        self.logger.error('[AlbumTools] Recently added albums error: ' + (err && err.message ? err.message : err));
        reject(err);
      });
  });
};

ControllerAlbumTools.prototype.fetchRecentlyAddedAlbums = function (windowSize, maxAlbums) {
  const self = this;
  const defer = libQ.defer();

  const client = mpd.connect({ port: 6600, host: 'localhost' });

  client.on('ready', function () {
    const findCmd = cmd('find', ["(Album != '')", 'sort', '-added', 'window', '0:' + windowSize]);
    client.sendCommand(findCmd, function (err, msg) {
      if (client.socket) client.socket.end();
      if (err) {
        self.logger.warn('[AlbumTools] MPD find -added failed, trying Last-Modified: ' + err.message);
        self.fetchWithLastModified(windowSize, maxAlbums).then(defer.resolve).fail(defer.reject);
        return;
      }
      defer.resolve(self.parseFindResponse(msg, maxAlbums));
    });
  });

  client.on('error', function (err) {
    if (client.socket) client.socket.end();
    defer.reject(err);
  });

  return defer.promise;
};

ControllerAlbumTools.prototype.fetchWithLastModified = function (windowSize, maxAlbums) {
  const self = this;
  const defer = libQ.defer();
  const client = mpd.connect({ port: 6600, host: 'localhost' });

  client.on('ready', function () {
    const findCmd = cmd('find', ["(Album != '')", 'sort', '-Last-Modified', 'window', '0:' + windowSize]);
    client.sendCommand(findCmd, function (err, msg) {
      if (client.socket) client.socket.end();
      if (err) {
        defer.reject(err);
        return;
      }
      defer.resolve(self.parseFindResponse(msg, maxAlbums));
    });
  });

  client.on('error', function (err) {
    if (client.socket) client.socket.end();
    defer.reject(err);
  });

  return defer.promise;
};

ControllerAlbumTools.prototype.parseFindResponse = function (msg, maxAlbums) {
  const lines = (msg || '').split('\n');
  const seen = new Set();
  const albums = [];

  for (let i = 0; i < lines.length && albums.length < maxAlbums; i++) {
    const line = lines[i];
    if (!line.startsWith('file:')) continue;

    const trackArtist = this.searchFor(lines, i + 1, 'Artist');
    const albumArtist = this.searchFor(lines, i + 1, 'AlbumArtist');
    const artist = albumArtist || trackArtist;
    const album = this.searchFor(lines, i + 1, 'Album');
    const file = line.slice(5).trim();
    const albumPath = file ? file.replace(/\/[^/]+$/, '') : '';
    const added = this.searchFor(lines, i + 1, 'Last-Modified') || this.searchFor(lines, i + 1, 'added');
    const year = this.searchFor(lines, i + 1, 'Date');

    if (!artist || !album) continue;

    // Deduplicate at album scope (folder/path first), not track-artist scope.
    const key = albumPath || (artist + '\0' + album);
    if (seen.has(key)) continue;
    seen.add(key);

    const uri = 'artists://' + encodeURIComponent(artist) + '/' + encodeURIComponent(album);
    const albumart = albumPath
      ? '/albumart?path=' + encodeURIComponent(albumPath) + '&web=' + encodeURIComponent(artist + '/' + album) + '/medium'
      : '/albumart?web=' + encodeURIComponent(artist + '/' + album) + '/medium';

    albums.push({
      service: 'mpd',
      type: 'folder',
      title: album,
      artist: artist,
      uri: uri,
      albumart: albumart,
      added: added || null,
      year: year || null
    });
  }

  return albums;
};

ControllerAlbumTools.prototype.searchFor = function (lines, start, key) {
  const prefix = (key.endsWith(':') ? key : key + ':');
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('file:') || line === 'OK') return null;
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }
  return null;
};
