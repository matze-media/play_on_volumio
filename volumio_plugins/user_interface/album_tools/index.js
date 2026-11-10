'use strict';

const libQ = require('kew');
const mpd = require('mpd');
const cmd = mpd.cmd;
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { execFile } = require('child_process');
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

const PRIOR_PLAYS = 100;
const LASTFM_INFO_CACHE_MS = 12 * 60 * 60 * 1000;
const LASTFM_TRACK_CONCURRENCY = 3;

function asBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'on') return true;
  if (text === 'false' || text === '0' || text === 'off') return false;
  return fallback;
}

function clampAlbumListeners(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1000000, parsed));
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

  this.commandRouter.addPluginRestEndpoint({
    endpoint: 'bytefm_now_playing',
    type: 'user_interface',
    name: 'album_tools',
    method: 'setBytefmNowPlaying'
  });

  this.commandRouter.addPluginRestEndpoint({
    endpoint: 'album_popularity',
    type: 'user_interface',
    name: 'album_tools',
    method: 'getAlbumPopularity'
  });

  this.logger.info('[AlbumTools] Plugin started, REST endpoints registered');
  self.bytefmLiveKey = '';
  self.bytefmLiveTimer = setInterval(function () {
    self.pollBytefmLive();
  }, 10000);
  self.pollBytefmLive();
  return resolve();
};

function isBytefmPlaybackUri(uri) {
  const value = String(uri || '');
  if (!/^https?:\/\//i.test(value)) return false;
  if (/byte\.?fm|radiohost\.de/i.test(value)) return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'www.byte.fm' || host === 'archiv.bytefm.com' || host.endsWith('.byte.fm') || host.endsWith('.radiohost.de');
  } catch (e) {
    return false;
  }
}

function looksLikeFileName(value) {
  return /\.(mp3|aac|ogg|flac)(\?|$)/i.test(value) || /^[0-9a-f-]{16,}(\.mp3)?$/i.test(value);
}

const BYTEFM_LOGO = '/albumart?sourceicon=user_interface/album_tools/bytefm-logo.jpg';

function isBytefmLiveUri(uri) {
  const value = String(uri || '');
  if (!/^https?:\/\//i.test(value)) return false;
  if (/archiv\.bytefm\.com/i.test(value)) return false;
  return /byte\.fm/i.test(value) || /radiohost\.de/i.test(value);
}

function currentQueueTrack(sm) {
  if (!sm || typeof sm.getTrack !== 'function') return null;
  return sm.getTrack(sm.currentPosition) || null;
}

function bytefmLiveTrack(sm) {
  const track = currentQueueTrack(sm);
  if (!track) return null;
  if (isBytefmLiveUri(track.uri)) return track;
  if (String(track.service || '') !== 'webradio') return null;
  const consumeUri = sm.consumeState && sm.consumeState.uri;
  if (isBytefmLiveUri(consumeUri)) return track;
  return null;
}

const BYTEFM_LIVE_CHANNEL = 'web';
const BYTEFM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BYTEFM_COVER_FILE = 'bytefm-cover.jpg';
const BYTEFM_COVER_SOURCE = 'user_interface/album_tools/' + BYTEFM_COVER_FILE;

function decodeHtml(value) {
  const named = { ndash: '–', mdash: '—', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value || '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (entity, body) {
      if (body.charAt(0) === '#') {
        const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        return isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      const key = body.toLowerCase();
      return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function splitBytefmTrack(value) {
  const text = decodeHtml(value);
  const parts = text.split(/\s+[–—-]\s+/);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' – ') };
  return { artist: '', title: text };
}

function bytefmCover(src) {
  const text = String(src || '').trim();
  if (!text || /blank\.png/i.test(text)) return '';
  try {
    const url = new URL(text, 'https://www.byte.fm/');
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (host !== 'www.byte.fm' && !host.endsWith('.byte.fm'))) return '';
    if (/blank\.png/i.test(url.pathname)) return '';
    return url.href;
  } catch (e) {
    return '';
  }
}

function bytefmChannel(field) {
  if (!field || typeof field !== 'object') return '';
  const value = field[BYTEFM_LIVE_CHANNEL];
  return value == null ? '' : value;
}

function coverToken(url) {
  let hash = 0;
  const text = String(url || '');
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function localBytefmCover(url) {
  return '/albumart?sourceicon=' + BYTEFM_COVER_SOURCE + '&v=' + coverToken(url);
}

function runConverter(bin, args) {
  return new Promise(function (resolve, reject) {
    execFile(bin, args, function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

// The ESP32 decoder only accepts a baseline JPEG. Last.fm covers are often
// progressive JPEG or PNG, and a browser still displays those.
function writeCoverAsJpeg(buffer, dest) {
  const tmp = dest + '.bin';
  writeFileAtomicSync(tmp, buffer);
  const ffmpegArgs = ['-y', '-loglevel', 'error', '-i', tmp, '-pix_fmt', 'yuvj420p', '-q:v', '5', dest];
  return runConverter('/usr/bin/ffmpeg', ffmpegArgs)
    .catch(function () { return runConverter('ffmpeg', ffmpegArgs); })
    .catch(function () {
      return runConverter('/usr/bin/convert', [tmp, '-interlace', 'None', '-sampling-factor', '4:2:0', '-quality', '85', 'jpeg:' + dest]);
    })
    .catch(function () {
      return runConverter('convert', [tmp, '-interlace', 'None', '-sampling-factor', '4:2:0', '-quality', '85', 'jpeg:' + dest]);
    })
    .then(function () {
      fs.removeSync(tmp);
    }, function () {
      try { fs.removeSync(tmp); } catch (e) {}
      if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        writeFileAtomicSync(dest, buffer);
        return;
      }
      throw new Error('Cover is not a JPEG and could not be converted.');
    });
}

function writeWsFrame(socket, opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  const head = [0x80 | opcode];
  if (data.length < 126) {
    head.push(0x80 | data.length);
  } else if (data.length < 65536) {
    head.push(0x80 | 126, data.length >> 8, data.length & 0xff);
  } else {
    return;
  }
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  socket.write(Buffer.concat([Buffer.from(head), mask, masked]));
}

// The ByteFM player keeps this socket open and receives a new message when the
// song changes. Reading one message and disconnecting left Volumio on the
// first song, because a later connection often never replaced it.
function connectBytefmHistory(handlers) {
  let closed = false;
  let netSocket = null;
  const fail = function (err) {
    if (closed) return;
    closed = true;
    if (netSocket) netSocket.destroy();
    if (handlers.onEnd) handlers.onEnd(err);
  };
  const req = https.request({
    host: 'www.byte.fm',
    path: '/ws/song-history/',
    method: 'GET',
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      Origin: 'https://www.byte.fm',
      'User-Agent': BYTEFM_UA
    },
    timeout: 8000
  });
  req.on('upgrade', function (res, socket) {
    req.setTimeout(0);
    socket.setTimeout(0);
    netSocket = socket;
    let raw = Buffer.alloc(0);
    let text = Buffer.alloc(0);
    socket.on('data', function (chunk) {
      if (closed) return;
      raw = Buffer.concat([raw, chunk]);
      while (raw.length >= 2) {
        const opcode = raw[0] & 0x0f;
        const fin = (raw[0] & 0x80) !== 0;
        let len = raw[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (raw.length < 4) return;
          len = raw.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (raw.length < 10) return;
          if (raw.readUInt32BE(2) !== 0 || raw.readUInt32BE(6) > 1000000) {
            fail(new Error('ByteFM song history frame is too large.'));
            return;
          }
          len = raw.readUInt32BE(6);
          offset = 10;
        }
        if (len > 1000000) {
          fail(new Error('ByteFM song history frame is too large.'));
          return;
        }
        if (raw.length < offset + len) return;
        const body = raw.slice(offset, offset + len);
        raw = raw.slice(offset + len);
        if (opcode === 0x9) {
          writeWsFrame(socket, 0xA, body);
          continue;
        }
        if (opcode === 0x8) {
          fail(new Error('ByteFM song history closed.'));
          return;
        }
        if (opcode === 0x1 || opcode === 0x0) {
          text = Buffer.concat([text, body]);
          if (!fin) continue;
          const message = text;
          text = Buffer.alloc(0);
          try {
            handlers.onMessage(JSON.parse(message.toString('utf8')));
          } catch (e) {
            fail(e);
            return;
          }
        }
      }
    });
    socket.on('error', fail);
    socket.on('end', function () { fail(new Error('ByteFM song history closed.')); });
  });
  req.on('response', function (res) {
    res.resume();
    fail(new Error('ByteFM song history failed: ' + res.statusCode));
  });
  req.on('error', fail);
  req.on('timeout', function () {
    fail(new Error('ByteFM song history timed out.'));
  });
  req.end();
  return {
    close: function () {
      closed = true;
      if (netSocket) netSocket.destroy();
      req.destroy();
    }
  };
}

function downloadBytefmCover(url, dest, redirects) {
  const hops = redirects || 0;
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error('ByteFM cover must be https.'));
      return;
    }
    const req = https.get(parsed, {
      headers: {
        'User-Agent': BYTEFM_UA,
        Accept: 'image/*,*/*;q=0.8',
        Referer: 'https://www.byte.fm/'
      },
      timeout: 8000
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
        res.resume();
        resolve(downloadBytefmCover(new URL(res.headers.location, parsed).href, dest, hops + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('ByteFM cover failed: ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const body = Buffer.concat(chunks);
        if (!body.length) {
          reject(new Error('ByteFM cover was empty.'));
          return;
        }
        writeCoverAsJpeg(body, dest).then(resolve, reject);
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy(new Error('ByteFM cover timed out.'));
    });
  });
}

function isBytefmCoverUrl(uri) {
  try {
    const url = new URL(uri);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'www.byte.fm' || host.endsWith('.byte.fm'));
  } catch (e) {
    return false;
  }
}

function isFetchableCoverUrl(uri) {
  if (isBytefmCoverUrl(uri)) return true;
  try {
    const url = new URL(uri);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'lastfm.freetls.fastly.net' ||
      host === 'lastfm-img.freetls.fastly.net' ||
      host.endsWith('.last.fm')
    );
  } catch (e) {
    return false;
  }
}

function largestLastFmImage(images) {
  if (!Array.isArray(images)) return '';
  const order = ['extralarge', 'large', 'medium', 'small'];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < images.length; j++) {
      if (images[j] && images[j].size === order[i] && images[j]['#text']) return images[j]['#text'];
    }
  }
  return '';
}

function songFromPlayback(state) {
  const title = String((state && state.title) || '').trim();
  const artist = String((state && state.artist) || '').trim();
  const split = splitBytefmTrack(title);
  if (split.artist && split.title && !/byte\.?fm/i.test(split.artist)) return split;
  if (artist && title && !/byte\.?fm/i.test(artist)) return { artist: artist, title: title };
  return null;
}

// A status update that started before this write can put the file name back.
// Later writes of the same song must not be overwritten by an older timer.
let bytefmApplyGeneration = 0;

// The live stream's own tags replace the title, and an archive file has no tags,
// so Volumio would show the MP3 name. This writes ByteFM's artist, title, program,
// and cover onto the current item and keeps them in place until the next song.
// The player-state announcement is not awaited: waiting on it holds the HTTP
// request open, and the extension then reports that Volumio did not respond.
ControllerAlbumTools.prototype.applyBytefmNowPlaying = function (data) {
  const self = this;
  const sm = self.commandRouter.stateMachine;
  if (!sm) return { ok: false, error: 'Player is not ready.' };
  const track = currentQueueTrack(sm);
  // The stream address can stay in consumeState after the queue has moved on
  // to a library album. Only the queue item decides that ByteFM is playing.
  if (!track || !isBytefmPlaybackUri(track.uri)) {
    return { ok: false, error: 'ByteFM is not the current item.' };
  }

  let title = data && data.title ? String(data.title).trim() : '';
  const artist = data && data.artist ? String(data.artist).trim() : '';
  const album = data && data.album ? String(data.album).trim() : '';
  const suppliedArt = data && data.albumart ? String(data.albumart).trim() : '';
  // The playback page loads a cover from Volumio. A ByteFM address is fetched
  // here and published as a local albumart path, otherwise the image stays blank.
  const albumart = self.albumartForPlayer(suppliedArt);
  if (looksLikeFileName(title)) title = '';
  if (!title && !artist && !album && !suppliedArt) return { ok: false, error: 'No track information.' };
  if (!title && album) title = album;

  if (title) {
    track.name = title;
    track.title = title;
  }
  if (artist) track.artist = artist;
  if (album) track.album = album;
  track.albumart = albumart;
  sm.consumeIgnoreMetadata = true;
  if (sm.consumeState) {
    if (title) sm.consumeState.title = title;
    if (artist) sm.consumeState.artist = artist;
    if (album) sm.consumeState.album = album;
    sm.consumeState.albumart = albumart;
  }
  try {
    sm.pushState();
  } catch (e) {
    self.logger.error('[AlbumTools] Could not push ByteFM track information: ' + e);
  }
  if (isBytefmCoverUrl(suppliedArt)) {
    self.cacheBytefmCover(suppliedArt, data);
  } else if (suppliedArt.indexOf('bytefm-cover.jpg') === -1) {
    self.bytefmCoverTicket = (self.bytefmCoverTicket || 0) + 1;
  }
  return { ok: true };
};

ControllerAlbumTools.prototype.albumartForPlayer = function (supplied) {
  const value = String(supplied || '');
  if (value.indexOf('sourceicon=user_interface/album_tools/') !== -1) return value;
  if (value && value === this.bytefmCoverSource && this.bytefmCoverArt) return this.bytefmCoverArt;
  return BYTEFM_LOGO;
};

ControllerAlbumTools.prototype.cacheBytefmCover = function (url, data, onReady) {
  const self = this;
  if (!isFetchableCoverUrl(url)) return;
  if (url === self.bytefmCoverSource && self.bytefmCoverArt) {
    if (typeof onReady === 'function') onReady(self.bytefmCoverArt);
    return;
  }
  if (self.bytefmCoverFetching === url) return;
  const ticket = (self.bytefmCoverTicket || 0) + 1;
  self.bytefmCoverTicket = ticket;
  self.bytefmCoverFetching = url;
  const dest = path.join(__dirname, BYTEFM_COVER_FILE);
  downloadBytefmCover(url, dest).then(function () {
    if (self.bytefmCoverTicket !== ticket) return;
    self.bytefmCoverSource = url;
    self.bytefmCoverArt = localBytefmCover(url);
    self.bytefmCoverFetching = '';
    if (typeof onReady === 'function') {
      onReady(self.bytefmCoverArt);
      return;
    }
    self.applyBytefmNowPlaying({
      title: data && data.title,
      artist: data && data.artist,
      album: data && data.album,
      albumart: self.bytefmCoverArt
    });
  }).catch(function (err) {
    if (self.bytefmCoverFetching === url) self.bytefmCoverFetching = '';
    self.logger.warn('[AlbumTools] ByteFM cover: ' + (err && err.message ? err.message : err));
    if (typeof onReady === 'function') onReady('');
  });
};

ControllerAlbumTools.prototype.releaseBytefmMetadata = function (sm) {
  if (!sm || !sm.consumeIgnoreMetadata) return;
  sm.consumeIgnoreMetadata = false;
  this.bytefmLiveKey = '';
  this.bytefmPendingKey = '';
  const track = currentQueueTrack(sm);
  if (track && String(track.albumart || '').indexOf('user_interface/album_tools/bytefm') !== -1) {
    track.albumart = '';
  }
  try {
    sm.pushState();
  } catch (e) {
    this.logger.error('[AlbumTools] Could not restore track information: ' + e);
  }
};

ControllerAlbumTools.prototype.closeBytefmSocket = function () {
  if (this.bytefmReconnectTimer) {
    clearTimeout(this.bytefmReconnectTimer);
    this.bytefmReconnectTimer = null;
  }
  const socket = this.bytefmHistorySocket;
  this.bytefmHistorySocket = null;
  this.bytefmHistoryActive = false;
  if (socket) socket.close();
};

ControllerAlbumTools.prototype.openBytefmHistorySocket = function () {
  const self = this;
  if (self.bytefmHistoryActive) return;
  self.bytefmHistoryActive = true;
  const conn = connectBytefmHistory({
    onMessage: function (data) {
      self.onBytefmHistory(data);
    },
    onEnd: function (err) {
      if (self.bytefmHistorySocket !== conn) return;
      self.bytefmHistorySocket = null;
      self.bytefmHistoryActive = false;
      if (err && !self.bytefmHistoryWarned) {
        self.bytefmHistoryWarned = true;
        self.logger.warn('[AlbumTools] ByteFM song history is blocked (' + (err && err.message ? err.message : err) + '). Using the stream title until it reconnects.');
      }
      if (!self.bytefmLiveTimer) return;
      self.bytefmReconnectTimer = setTimeout(function () {
        self.bytefmReconnectTimer = null;
        self.pollBytefmLive();
      }, 5000);
    }
  });
  self.bytefmHistorySocket = conn;
};

ControllerAlbumTools.prototype.onBytefmHistory = function (data) {
  const self = this;
  const sm = self.commandRouter.stateMachine;
  if (!sm || sm.currentStatus !== 'play' || !bytefmLiveTrack(sm)) return;

  const tracks = bytefmChannel(data.tracks);
  const song = splitBytefmTrack(Array.isArray(tracks) ? tracks[0] : '');
  const show = decodeHtml(bytefmChannel(data.current_show_title));
  const subtitle = decodeHtml(bytefmChannel(data.current_show_subtitle));
  const album = show && subtitle ? show + ' – ' + subtitle : show || subtitle || 'ByteFM';
  const info = {
    title: song.title || 'ByteFM',
    artist: song.artist,
    album: album,
    albumart: bytefmCover(bytefmChannel(data.artistImageURL)) || bytefmCover(bytefmChannel(data.moderator_image))
  };
  const key = [info.artist, info.title, info.album].join('\n');
  if (key === self.bytefmLiveKey) return;
  self.bytefmLiveKey = key;
  self.bytefmPendingKey = info.albumart ? key + '\n' + info.albumart : key;
  const applied = self.applyBytefmNowPlaying(info);
  if (!applied || !applied.ok) {
    self.bytefmLiveKey = '';
    return;
  }
  self.logger.info('[AlbumTools] ByteFM now playing: ' + (info.artist ? info.artist + ' – ' : '') + info.title);
};

ControllerAlbumTools.prototype.pollBytefmLive = function () {
  const self = this;
  const sm = self.commandRouter.stateMachine;
  if (!sm || !bytefmLiveTrack(sm)) {
    self.closeBytefmSocket();
    if (sm) self.releaseBytefmMetadata(sm);
    return;
  }
  if (sm.currentStatus !== 'play') return;
  self.openBytefmHistorySocket();
};

ControllerAlbumTools.prototype.applyBytefmLiveArt = function (albumart) {
  const sm = this.commandRouter.stateMachine;
  if (!sm || !albumart) return;
  if (!bytefmLiveTrack(sm)) return;
  const track = currentQueueTrack(sm);
  if (track) track.albumart = albumart;
  sm.consumeIgnoreMetadata = false;
  if (sm.consumeState) sm.consumeState.albumart = albumart;
  try {
    sm.pushState();
  } catch (e) {
    this.logger.error('[AlbumTools] Could not push ByteFM cover: ' + e);
  }
};

ControllerAlbumTools.prototype.lookupLastFmTrack = function (artist, track) {
  const self = this;
  const configured = self.getConfigValue('lastfmApiKey', '');
  const apiKey = configured || '4cb074e4b8ec4ee9ad3eb37d6f7eb240';
  const query = '/2.0/?method=track.getInfo&artist=' + encodeURIComponent(artist) +
    '&track=' + encodeURIComponent(track) +
    '&api_key=' + encodeURIComponent(apiKey) + '&format=json';
  return new Promise(function (resolve, reject) {
    const req = http.get({ host: 'ws.audioscrobbler.com', port: 80, path: query, timeout: 8000 }, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            reject(new Error(json.message || 'Last.fm error'));
            return;
          }
          const album = json.track && json.track.album;
          resolve({
            artist: artist,
            title: track,
            album: album && album.title ? album.title : '',
            albumart: largestLastFmImage(album && album.image)
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy(new Error('Last.fm timed out.'));
    });
  });
};

ControllerAlbumTools.prototype.coverFromStreamTitle = function () {
  const self = this;
  const sm = self.commandRouter.stateMachine;
  if (!sm || sm.currentStatus !== 'play') return Promise.resolve();
  if (!bytefmLiveTrack(sm)) return Promise.resolve();
  if (sm.consumeIgnoreMetadata) sm.consumeIgnoreMetadata = false;

  const song = songFromPlayback(sm.consumeState);
  if (!song) return Promise.resolve();
  const key = song.artist + '\n' + song.title;
  if (key === self.bytefmLiveKey || key === self.bytefmLivePending) return Promise.resolve();
  self.bytefmLivePending = key;

  return self.lookupLastFmTrack(song.artist, song.title).then(function (info) {
    if (!info.albumart) {
      self.bytefmLivePending = '';
      self.bytefmLiveKey = key;
      self.applyBytefmLiveArt(BYTEFM_LOGO);
      self.logger.info('[AlbumTools] No cover for ' + song.artist + ' – ' + song.title + ', using the ByteFM image.');
      return;
    }
    self.cacheBytefmCover(info.albumart, info, function (albumart) {
      if (!albumart) {
        self.bytefmLivePending = '';
        const nowSong = songFromPlayback(self.commandRouter.stateMachine && self.commandRouter.stateMachine.consumeState);
        if (nowSong && (nowSong.artist + '\n' + nowSong.title) === key) {
          self.bytefmLiveKey = key;
          self.applyBytefmLiveArt(BYTEFM_LOGO);
        }
        return;
      }
      const nowSong = songFromPlayback(self.commandRouter.stateMachine && self.commandRouter.stateMachine.consumeState);
      if (!nowSong || (nowSong.artist + '\n' + nowSong.title) !== key) {
        self.bytefmLivePending = '';
        return;
      }
      self.applyBytefmLiveArt(albumart);
      self.bytefmLiveKey = key;
      self.bytefmLivePending = '';
    });
  }).catch(function (err) {
    self.bytefmLivePending = '';
    self.logger.warn('[AlbumTools] ByteFM cover lookup: ' + (err && err.message ? err.message : err));
  });
};

ControllerAlbumTools.prototype.setBytefmNowPlaying = function (data) {
  const self = this;
  const generation = ++bytefmApplyGeneration;
  const applied = self.applyBytefmNowPlaying(data);
  if (!applied.ok) return Promise.reject(applied.error);
  [400, 1200].forEach(function (delay) {
    setTimeout(function () {
      if (generation !== bytefmApplyGeneration) return;
      self.applyBytefmNowPlaying(data);
    }, delay);
  });
  return { success: true };
};

ControllerAlbumTools.prototype.onStop = function () {
  if (this.bytefmLiveTimer) {
    clearInterval(this.bytefmLiveTimer);
    this.bytefmLiveTimer = null;
  }
  this.closeBytefmSocket();
  this.commandRouter.removePluginRestEndpoint({ endpoint: 'similar_albums' });
  this.commandRouter.removePluginRestEndpoint({ endpoint: 'recently_added_albums' });
  this.commandRouter.removePluginRestEndpoint({ endpoint: 'bytefm_now_playing' });
  this.commandRouter.removePluginRestEndpoint({ endpoint: 'album_popularity' });
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
      const popularityEnabled = asBool(getConfigVal('popularityBarEnabled', true), true);
      const minAlbumListeners = clampAlbumListeners(getConfigVal('minAlbumListeners', 50), 50);
      uiconf.sections[0].content[0].value = apiKey;
      uiconf.sections[0].content[1].value = limit;
      uiconf.sections[0].content[2].value = maxSimilar;
      uiconf.sections[1].content[0].value = maxRecent;
      let popularitySection = null;
      for (let i = 0; i < uiconf.sections.length; i++) {
        if (uiconf.sections[i].id === 'section_popularity') popularitySection = uiconf.sections[i];
      }
      if (popularitySection && popularitySection.content && popularitySection.content.length >= 2) {
        popularitySection.content[0].value = popularityEnabled;
        popularitySection.content[1].value = minAlbumListeners;
      }
      self.logger.info('[AlbumTools] getUIConfig: returning lastfmApiKey=' + (apiKey ? '(len=' + apiKey.length + ')' : '(empty)') +
        ', similarArtistsLimit=' + limit + ', maxSimilarAlbums=' + maxSimilar + ', maxRecentlyAddedAlbums=' + maxRecent +
        ', popularityBarEnabled=' + popularityEnabled + ', minAlbumListeners=' + minAlbumListeners);
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
  const d3 = data.section_popularity || data;
  const popularityEnabled = getVal(d3.popularityBarEnabled);
  const minAlbumListeners = getVal(d3.minAlbumListeners);

  self.logger.info('[AlbumTools] updateConfig: extracted lastfmApiKey=' + (apiKey !== undefined ? '(set)' : '(none)') +
    ', similarArtistsLimit=' + (limit !== undefined ? limit : '(none)') +
    ', maxSimilarAlbums=' + (maxSimilar !== undefined ? maxSimilar : '(none)') +
    ', maxRecentlyAddedAlbums=' + (maxRecent !== undefined ? maxRecent : '(none)') +
    ', popularityBarEnabled=' + (popularityEnabled !== undefined ? popularityEnabled : '(none)') +
    ', minAlbumListeners=' + (minAlbumListeners !== undefined ? minAlbumListeners : '(none)'));

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
      maxRecentlyAddedAlbums: { type: 'number', value: maxRecent !== undefined ? Math.max(1, Math.min(200, parseInt(maxRecent, 10) || 20)) : (getCurrentVal('maxRecentlyAddedAlbums') ?? 20) },
      popularityBarEnabled: {
        type: 'boolean',
        value: popularityEnabled !== undefined
          ? asBool(popularityEnabled, true)
          : asBool(getCurrentVal('popularityBarEnabled'), true)
      },
      minAlbumListeners: {
        type: 'number',
        value: minAlbumListeners !== undefined
          ? clampAlbumListeners(minAlbumListeners, 50)
          : clampAlbumListeners(getCurrentVal('minAlbumListeners'), 50)
      }
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
      ', maxRecentlyAddedAlbums=' + toWrite.maxRecentlyAddedAlbums.value +
      ', popularityBarEnabled=' + toWrite.popularityBarEnabled.value +
      ', minAlbumListeners=' + toWrite.minAlbumListeners.value);

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

// -----------------------------------------------------------------------------
// Album popularity (Last.fm play counts, scored within one album)
// -----------------------------------------------------------------------------

ControllerAlbumTools.prototype.readLastFmCache = function (key) {
  if (!this.lastFmInfoCache) return null;
  const hit = this.lastFmInfoCache[key];
  if (!hit) return null;
  if (Date.now() - hit.at > LASTFM_INFO_CACHE_MS) {
    delete this.lastFmInfoCache[key];
    return null;
  }
  return hit;
};

ControllerAlbumTools.prototype.writeLastFmCache = function (key, value) {
  if (!this.lastFmInfoCache) this.lastFmInfoCache = {};
  this.lastFmInfoCache[key] = { at: Date.now(), value: value };
};

ControllerAlbumTools.prototype.lastFmGet = function (query) {
  return new Promise(function (resolve, reject) {
    const req = http.get({
      host: 'ws.audioscrobbler.com',
      port: 80,
      path: query,
      timeout: 8000
    }, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            reject(new Error(json.message || 'Last.fm error'));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy(new Error('Last.fm timed out.'));
    });
  });
};

function lastFmTrackArtist(track, fallback) {
  if (!track || track.artist == null) return fallback;
  if (typeof track.artist === 'string') return track.artist;
  return track.artist.name || fallback;
}

function scoreAlbumTracks(tracks) {
  let maxAdjusted = 0;
  for (let i = 0; i < tracks.length; i++) {
    maxAdjusted = Math.max(maxAdjusted, tracks[i].playcount + PRIOR_PLAYS);
  }
  if (maxAdjusted <= 0) return [];
  return tracks.map(function (track) {
    return {
      title: track.title,
      playcount: track.playcount,
      listeners: track.listeners,
      score: Math.round(100 * (track.playcount + PRIOR_PLAYS) / maxAdjusted)
    };
  });
}

function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let active = 0;
  return new Promise(function (resolve, reject) {
    if (!items.length) {
      resolve(results);
      return;
    }
    let failed = false;
    function pump() {
      if (failed) return;
      if (next >= items.length && active === 0) {
        resolve(results);
        return;
      }
      while (active < limit && next < items.length) {
        const index = next++;
        active++;
        Promise.resolve(fn(items[index], index)).then(function (value) {
          results[index] = value;
          active--;
          pump();
        }, function (err) {
          failed = true;
          reject(err);
        });
      }
    }
    pump();
  });
}

ControllerAlbumTools.prototype.fetchLastFmAlbum = function (artist, album, apiKey) {
  const self = this;
  const key = 'album\n' + artist.toLowerCase() + '\n' + album.toLowerCase();
  const cached = self.readLastFmCache(key);
  if (cached) return Promise.resolve(cached.value);

  const query = '/2.0/?method=album.getInfo&artist=' + encodeURIComponent(artist) +
    '&album=' + encodeURIComponent(album) +
    '&autocorrect=1&api_key=' + encodeURIComponent(apiKey) + '&format=json';

  return self.lastFmGet(query).then(function (json) {
    const info = json && json.album;
    if (!info || !info.name) {
      throw new Error('Last.fm has no album for this artist');
    }
    let list = info.tracks && info.tracks.track;
    if (!list) list = [];
    if (!Array.isArray(list)) list = [list];
    const listeners = parseInt(info.listeners, 10);
    const value = {
      listeners: Number.isFinite(listeners) ? listeners : 0,
      tracks: list.map(function (track) {
        return {
          title: track && track.name ? String(track.name) : '',
          artist: lastFmTrackArtist(track, artist)
        };
      }).filter(function (track) { return track.title; })
    };
    self.writeLastFmCache(key, value);
    return value;
  });
};

ControllerAlbumTools.prototype.fetchLastFmTrackInfo = function (artist, title, apiKey) {
  const self = this;
  const key = 'track\n' + artist.toLowerCase() + '\n' + title.toLowerCase();
  const cached = self.readLastFmCache(key);
  if (cached) return Promise.resolve(cached.value);

  const query = '/2.0/?method=track.getInfo&artist=' + encodeURIComponent(artist) +
    '&track=' + encodeURIComponent(title) +
    '&autocorrect=1&api_key=' + encodeURIComponent(apiKey) + '&format=json';

  return self.lastFmGet(query).then(function (json) {
    const track = json && json.track;
    const playcount = track ? parseInt(track.playcount, 10) : NaN;
    const listeners = track ? parseInt(track.listeners, 10) : NaN;
    const value = Number.isFinite(playcount) ? {
      title: track.name || title,
      playcount: playcount,
      listeners: Number.isFinite(listeners) ? listeners : 0
    } : null;
    self.writeLastFmCache(key, value);
    return value;
  }).catch(function (err) {
    self.logger.info('[AlbumTools] track.getInfo failed for "' + artist + '" / "' + title + '": ' + (err && err.message ? err.message : err));
    return null;
  });
};

function requestedPopularityTracks(payload, artist) {
  if (!payload || !Array.isArray(payload.titles)) return null;
  const seen = new Set();
  const tracks = [];
  payload.titles.forEach(function (title) {
    const name = title == null ? '' : String(title).trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    tracks.push({ title: name, artist: artist });
  });
  return tracks.length ? tracks : null;
}

ControllerAlbumTools.prototype.getAlbumPopularity = function (data) {
  const self = this;
  self.configFile = self.getConfigPath();
  if (!self.config) self.config = new vConf();
  try {
    self.config.loadFile(self.configFile);
  } catch (e) {
    self.logger.info('[AlbumTools] loadFile error: ' + e.message);
  }

  if (!asBool(self.getConfigValue('popularityBarEnabled', true), true)) {
    return Promise.resolve({ enabled: false, tracks: [] });
  }

  const payload = data || {};
  const artist = payload.artist ? String(payload.artist).trim() : '';
  const album = payload.album ? String(payload.album).trim() : '';
  if (!artist || !album) {
    return Promise.reject('Artist and album are required');
  }

  const apiKey = (self.getConfigValue('lastfmApiKey', '') || '').trim();
  if (!apiKey) {
    return Promise.reject('Last.fm API key not configured');
  }

  const minAlbumListeners = clampAlbumListeners(self.getConfigValue('minAlbumListeners', 50), 50);

  return self.fetchLastFmAlbum(artist, album, apiKey).then(function (info) {
    if (info.listeners < minAlbumListeners) {
      self.logger.info('[AlbumTools] Popularity skipped for "' + artist + '" / "' + album +
        '": listeners=' + info.listeners + ' below ' + minAlbumListeners);
      return {
        enabled: true,
        belowThreshold: true,
        artist: artist,
        album: album,
        albumListeners: info.listeners,
        tracks: []
      };
    }

    const lookup = requestedPopularityTracks(payload, artist) || info.tracks;
    return mapWithConcurrency(lookup, LASTFM_TRACK_CONCURRENCY, function (track) {
      return self.fetchLastFmTrackInfo(track.artist || artist, track.title, apiKey).then(function (info) {
        if (!info) return null;
        return {
          title: track.title,
          playcount: info.playcount,
          listeners: info.listeners
        };
      });
    }).then(function (results) {
      const known = [];
      for (let i = 0; i < results.length; i++) {
        if (results[i]) known.push(results[i]);
      }
      const tracks = scoreAlbumTracks(known);
      self.logger.info('[AlbumTools] Popularity "' + artist + '" / "' + album + '": ' +
        tracks.length + '/' + info.tracks.length + ' tracks, albumListeners=' + info.listeners);
      return {
        enabled: true,
        artist: artist,
        album: album,
        albumListeners: info.listeners,
        tracks: tracks
      };
    });
  });
};
