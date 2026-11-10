// =============================================================================
// Play on Volumio - Background Service Worker
// Connects to local Volumio server via REST API and WebSocket
// =============================================================================

let ws = null;
let volumioIp = null;
let volumioApiPort = 3000;
let volumioWebPort = null;
let pingInterval = null;
let ports = [];
let lastState = null;

const HTTP_DEFAULT_PORT = 80; // When URL has no port, browser uses 80

function getBaseUrl() {
  if (!volumioIp) return "";
  return volumioApiPort === HTTP_DEFAULT_PORT ? `http://${volumioIp}` : `http://${volumioIp}:${volumioApiPort}`;
}

function buildAlbumartUrl(albumart) {
  if (!albumart || typeof albumart !== "string") return "";
  if (albumart.startsWith("http")) return albumart;
  return getBaseUrl() + (albumart.startsWith("/") ? "" : "/") + albumart;
}

function toNowPlaying(payload) {
  return {
    artist: payload.artist || "",
    album: payload.album || "",
    title: payload.title || "",
    duration: payload.duration || 0,
    seek: payload.seek || 0,
    status: payload.status || "pause",
    volume: payload.volume || 0,
    stream: payload.stream === true,
    service: payload.service || "",
    trackType: payload.trackType || "",
    uri: payload.uri || "",
    albumart: buildAlbumartUrl(payload.albumart)
  };
}

function isAllowedBytefmUri(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:") return false;
    return url.hostname === "www.byte.fm" || url.hostname === "archiv.bytefm.com";
  } catch {
    return false;
  }
}

const BYTEFM_LOGO = "/albumart?sourceicon=user_interface/album_tools/bytefm-logo.jpg";

function isBytefmCoverUrl(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "www.byte.fm" || host.endsWith(".byte.fm");
  } catch {
    return false;
  }
}

function trackFields(msg) {
  const title = typeof msg.title === "string" ? msg.title.trim() : "";
  const artist = typeof msg.artist === "string" ? msg.artist.trim() : "";
  const album = typeof msg.album === "string" ? msg.album.trim() : "";
  const supplied = typeof msg.albumart === "string" ? msg.albumart.trim() : "";
  const albumart = isBytefmCoverUrl(supplied) ? supplied : BYTEFM_LOGO;
  return { title, artist, album, albumart };
}

function isPublicHttps(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "::1") return false;
    if (/^(127\.|10\.|192\.168\.|0\.|169\.254\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// www.byte.fm/live answers with redirects. HEAD follows them and stops at the
// audio URL, without holding the endless MP3 open.
async function resolveBytefmStreamUrl(uri) {
  if (!isPublicHttps(uri)) throw new Error("Stream URL is not a public https address.");
  const res = await withTimeout(
    fetch(uri, { method: "HEAD", redirect: "follow" }),
    8000,
    "Could not reach the ByteFM stream."
  );
  const finalUrl = res.url || uri;
  if (!isPublicHttps(finalUrl)) throw new Error("Stream URL is not a public https address.");
  return finalUrl;
}

async function waitForBytefmPlayback(baseUrl, playbackUri, title) {
  let host = "";
  try {
    host = new URL(playbackUri).hostname;
  } catch {
    host = "";
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const res = await fetch(`${baseUrl}/api/v1/getState`);
      if (!res.ok) continue;
      const state = await res.json();
      const stateUri = String(state.uri || "");
      const stateTitle = String(state.title || state.name || "");
      const playing = state.status === "play";
      const sameStream = (host && stateUri.includes(host)) || /byte\.?fm|radiohost\.de/i.test(stateUri);
      const sameTitle = !!title && stateTitle === title;
      if (playing && (sameStream || sameTitle)) return true;
    } catch {
      /* keep polling until the deadline */
    }
  }
  return false;
}

async function pushBytefmNowPlaying(baseUrl, info) {
  let lastError = "Could not update track information.";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const res = await fetch(`${baseUrl}/api/v1/pluginEndpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "bytefm_now_playing", data: info }),
        signal: AbortSignal.timeout(5000)
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (res.ok && json && json.success !== false) return { success: true };
      lastError = (json && (json.error || json.message)) || lastError;
      if (/Plugin REST Endpoint/i.test(String(lastError))) break;
    } catch (err) {
      lastError = err.name === "TimeoutError" || err.name === "AbortError"
        ? "Track information update timed out."
        : err.message || lastError;
    }
  }
  return { success: false, error: lastError };
}

// -----------------------------------------------------------------------------
// Volumio WebSocket Connection
// -----------------------------------------------------------------------------
function connectVolumio() {
  if (!volumioIp) return;

  const wsPort = volumioApiPort === HTTP_DEFAULT_PORT ? "" : `:${volumioApiPort}`;
  const url = `ws://${volumioIp}${wsPort}/socket.io/?EIO=3&transport=websocket`;
  console.log("[Play on Volumio] Connecting to:", url);

  if (ws) ws.close();
  if (pingInterval) clearInterval(pingInterval);

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[Play on Volumio] WebSocket connected");
    ws.send("40"); // Socket.IO handshake
    ws.send('42["subscribe","pushState"]');

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("2"); // Heartbeat
    }, 25000);
  };

  ws.onmessage = (event) => {
    const data = event.data;
    if (typeof data !== "string" || !data.startsWith("42")) return;

    try {
      const msg = JSON.parse(data.substring(2));
      const [eventName, payload] = msg;

      if (eventName === "pushState") {
        lastState = payload;
        const info = toNowPlaying(payload);
        ports.forEach((port) => port.postMessage({ action: "nowPlaying", data: info }));
      }
    } catch (err) {
      console.warn("[Play on Volumio] Failed to parse pushState:", err);
    }
  };

  ws.onclose = () => {
    console.warn("[Play on Volumio] WebSocket closed. Reconnecting in 5s…");
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(connectVolumio, 5000);
  };

  ws.onerror = (err) => console.error("[Play on Volumio] WebSocket error:", err);
}

// -----------------------------------------------------------------------------
// Storage: Load & Watch Volumio IP
// -----------------------------------------------------------------------------
chrome.storage.sync.get(["volumioIp", "volumioApiPort", "volumioWebPort", "volumioPort"], (res) => {
  volumioIp = res.volumioIp || null;
  volumioApiPort = res.volumioApiPort ?? res.volumioPort ?? 3000;
  volumioWebPort = res.volumioWebPort ?? null;
  connectVolumio();
  injectIntoMatchingTabs();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.volumioIp) volumioIp = changes.volumioIp.newValue;
  if (changes.volumioApiPort) volumioApiPort = changes.volumioApiPort.newValue ?? 3000;
  if (changes.volumioWebPort) volumioWebPort = changes.volumioWebPort.newValue ?? null;
  connectVolumio();
  injectIntoMatchingTabs();
});

// -----------------------------------------------------------------------------
// Programmatic Injection: Volumio Controller Tab
// -----------------------------------------------------------------------------
function isVolumioTabUrl(url) {
  if (!volumioIp || !url) return false;
  const port = parseInt(volumioWebPort ?? volumioApiPort, 10) || volumioApiPort;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return false;
    if (u.hostname !== volumioIp) return false;
    const tabPort = u.port ? parseInt(u.port, 10) : HTTP_DEFAULT_PORT;
    return tabPort === port;
  } catch {
    return false;
  }
}

function injectOverlayIntoVolumioTab(tabId) {
  if (!volumioIp) return;
  chrome.scripting
    .executeScript({ target: { tabId }, files: ["content_overlay.js", "content_volumio.js", "content_queue_score.js"] })
    .then(() => console.log("[Play on Volumio] Injected into tab", tabId))
    .catch((err) => console.warn("[Play on Volumio] Injection failed:", err));
}

function injectIntoMatchingTabs() {
  if (!volumioIp) return;
  chrome.tabs.query({}, (tabs) => {
    const port = parseInt(volumioWebPort ?? volumioApiPort, 10) || volumioApiPort;
    console.log("[Play on Volumio] Scanning tabs for", volumioIp + ":" + port);
    tabs.forEach((tab) => {
      if (tab.id && tab.url && tab.status === "complete" && isVolumioTabUrl(tab.url)) {
        console.log("[Play on Volumio] Found Volumio tab:", tab.url);
        injectOverlayIntoVolumioTab(tab.id);
      }
    });
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isVolumioTabUrl(tab.url)) {
    injectOverlayIntoVolumioTab(tabId);
  }
});

// -----------------------------------------------------------------------------
// Port Communication (Overlay)
// -----------------------------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "volumioOverlay") return;

  ports.push(port);

  if (volumioIp) {
    fetch(`${getBaseUrl()}/api/v1/getState`)
      .then((res) => res.json())
      .then((state) => {
        lastState = state;
        port.postMessage({ action: "nowPlaying", data: toNowPlaying(state) });
      })
      .catch((err) => console.warn("[Play on Volumio] Failed to get state:", err));
  }

  port.onDisconnect.addListener(() => {
    ports = ports.filter((p) => p !== port);
  });
});

// -----------------------------------------------------------------------------
// Message Handler: Actions from Content Scripts
// -----------------------------------------------------------------------------
function looseTitle(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u2026|\.{3,}/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchPopularityTrack(queueTitle, tracks, used) {
  const left = looseTitle(queueTitle);
  if (!left) return null;
  let exact = -1;
  let partial = -1;
  let partialGap = Infinity;
  for (let i = 0; i < tracks.length; i++) {
    if (used.has(i)) continue;
    const right = looseTitle(tracks[i] && tracks[i].title);
    if (!right) continue;
    if (left === right) {
      exact = i;
      break;
    }
    if (left.includes(right) || right.includes(left)) {
      const gap = Math.abs(left.length - right.length);
      if (gap < partialGap) {
        partialGap = gap;
        partial = i;
      }
    }
  }
  const index = exact >= 0 ? exact : partial;
  if (index < 0) return null;
  used.add(index);
  return tracks[index];
}

function queueItems(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.queue)) return body.queue;
  return [];
}

function canScoreQueueItem(item) {
  if (!item || typeof item !== "object") return false;
  const service = String(item.service || "").toLowerCase();
  const trackType = String(item.trackType || item.type || "").toLowerCase();
  if (service === "webradio" || trackType === "webradio") return false;
  return !!(String(item.artist || "").trim() && String(item.album || "").trim());
}

function albumLookupArtist(artist) {
  const name = String(artist || "").trim();
  const primary = name.split(",")[0].trim();
  return primary || name;
}

async function fetchAlbumPopularity(baseUrl, artist, album, titles) {
  const data = { artist, album };
  if (Array.isArray(titles) && titles.length) data.titles = titles;
  const res = await fetch(`${baseUrl}/api/v1/pluginEndpoint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "album_popularity", data }),
    signal: AbortSignal.timeout(60000)
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.success === false) {
    const error = (json && (json.error || json.message)) || `Popularity failed: ${res.status}`;
    throw new Error(error);
  }
  return json.data || {};
}

async function getQueuePopularity(baseUrl) {
  const res = await fetch(`${baseUrl}/api/v1/getQueue`);
  if (!res.ok) throw new Error(`Queue failed: ${res.status}`);
  const items = queueItems(await res.json());
  const albums = [];
  const albumIndex = new Map();
  items.forEach((item) => {
    if (!canScoreQueueItem(item)) return;
    const artist = albumLookupArtist(item.artist);
    const album = String(item.album).trim();
    const key = `${artist.toLowerCase()}\n${album.toLowerCase()}`;
    const title = String(item.name || item.title || "").trim();
    if (albumIndex.has(key)) {
      const known = albums[albumIndex.get(key)];
      if (title && !known.titles.includes(title)) known.titles.push(title);
      return;
    }
    albumIndex.set(key, albums.length);
    albums.push({ key, artist, album, titles: title ? [title] : [] });
  });

  const byAlbum = new Map();
  await Promise.all(albums.map(async (entry) => {
    try {
      const data = await fetchAlbumPopularity(baseUrl, entry.artist, entry.album, entry.titles);
      byAlbum.set(entry.key, data);
    } catch (err) {
      byAlbum.set(entry.key, null);
    }
  }));

  const usedByAlbum = new Map();
  const queue = items.map((item) => {
    if (!canScoreQueueItem(item)) return { ...item, popularity: null };
    const key = `${albumLookupArtist(item.artist).toLowerCase()}\n${String(item.album).trim().toLowerCase()}`;
    const data = byAlbum.get(key);
    const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
    if (!usedByAlbum.has(key)) usedByAlbum.set(key, new Set());
    const match = matchPopularityTrack(item.name || item.title, tracks, usedByAlbum.get(key));
    return {
      ...item,
      popularity: match
        ? {
            title: match.title,
            playcount: match.playcount,
            listeners: match.listeners,
            score: match.score
          }
        : null
    };
  });

  return { success: true, data: { queue } };
}

async function getBrowsePopularity(baseUrl, groups) {
  const requested = Array.isArray(groups) ? groups : [];
  const scored = await Promise.all(requested.map(async (group) => {
    const artist = albumLookupArtist(group && group.artist);
    const album = group && group.album ? String(group.album).trim() : "";
    const titles = Array.isArray(group && group.titles) ? group.titles : [];
    if (!artist || !album) return { scores: titles.map(() => null) };
    try {
      const data = await fetchAlbumPopularity(baseUrl, artist, album, titles);
      const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
      const used = new Set();
      return {
        scores: titles.map((title) => {
          const match = matchPopularityTrack(title, tracks, used);
          if (!match) return null;
          return {
            title: match.title,
            playcount: match.playcount,
            listeners: match.listeners,
            score: match.score
          };
        })
      };
    } catch (err) {
      return { scores: titles.map(() => null) };
    }
  }));
  return { success: true, data: { groups: scored } };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // --- getAlbumArt: Proxy image fetch to avoid Referrer Policy / mixed content ---
  if (msg.action === "getAlbumArt") {
    let url = msg.url;
    if (!url || !volumioIp) {
      sendResponse(null);
      return false;
    }
    const baseUrl = getBaseUrl();
    if (url.startsWith("/")) url = baseUrl + url;
    if (url !== baseUrl && !url.startsWith(baseUrl + "/")) {
      sendResponse(null);
      return false;
    }
    fetch(url, { referrerPolicy: "no-referrer" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!blob || blob.size === 0) throw new Error("Empty blob");
        const reader = new FileReader();
        reader.onloadend = () => sendResponse(reader.result);
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        console.warn("[Play on Volumio] Album art fetch failed:", url, err.message);
        sendResponse(null);
      });
    return true;
  }

  (async () => {
    try {
      if (!volumioIp) {
        sendResponse({ success: false, error: "Volumio IP not configured." });
        return;
      }

      const baseUrl = getBaseUrl();

      // --- playAlbum: REST search + replaceAndPlay ---
      if (msg.action === "playAlbum") {
        const query = encodeURIComponent(`${msg.artist} ${msg.album}`);
        const searchUrl = `${baseUrl}/api/v1/search?query=${query}`;

        const res = await fetch(searchUrl);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();

        const songs = [];
        data?.navigation?.lists?.forEach((list) => {
          list.items?.forEach((item) => {
            if (item.type === "song") songs.push(item);
          });
        });

        if (songs.length === 0) {
          sendResponse({ success: false, error: `No songs found for ${msg.artist} – ${msg.album}` });
          return;
        }

        const payload = { item: songs[0], list: songs, index: 0 };
        await fetch(`${baseUrl}/api/v1/replaceAndPlay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        sendResponse({ success: true, message: `Playing ${msg.album} by ${msg.artist}` });
        return;
      }

      // --- playTrack: REST search + replaceAndPlay (same as playAlbum, search for track) ---
      if (msg.action === "playTrack") {
        const query = encodeURIComponent(`${msg.artist} ${msg.album} ${msg.track}`);
        const searchUrl = `${baseUrl}/api/v1/search?query=${query}`;

        const res = await fetch(searchUrl);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();

        const songs = [];
        data?.navigation?.lists?.forEach((list) => {
          list.items?.forEach((item) => {
            if (item.type === "song") songs.push(item);
          });
        });

        const trackLower = (msg.track || "").toLowerCase();
        const match = songs.find(
          (s) =>
            (s.title || "").toLowerCase() === trackLower ||
            (s.title || "").toLowerCase().includes(trackLower) ||
            trackLower.includes((s.title || "").toLowerCase())
        );
        const toPlay = match || songs[0];

        if (!toPlay || songs.length === 0) {
          sendResponse({ success: false, error: `No songs found for ${msg.artist} – ${msg.album} – ${msg.track}` });
          return;
        }

        const idx = songs.indexOf(toPlay);
        const payload = { item: toPlay, list: songs, index: idx };
        await fetch(`${baseUrl}/api/v1/replaceAndPlay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        sendResponse({ success: true, message: `Playing ${msg.track} by ${msg.artist}` });
        return;
      }

      // --- Plugin endpoints: similar_albums, recently_added_albums ---
      if (msg.action === "getSimilarAlbums") {
        const res = await fetch(`${baseUrl}/api/v1/pluginEndpoint?endpoint=similar_albums`);
        if (!res.ok) throw new Error(`Similar albums failed: ${res.status}`);
        const data = await res.json();
        sendResponse(data);
        return;
      }

      if (msg.action === "getRecentlyAddedAlbums") {
        const res = await fetch(`${baseUrl}/api/v1/pluginEndpoint?endpoint=recently_added_albums`);
        if (!res.ok) throw new Error(`Recently added albums failed: ${res.status}`);
        const data = await res.json();
        sendResponse(data);
        return;
      }

      if (msg.action === "getQueuePopularity") {
        sendResponse(await getQueuePopularity(baseUrl));
        return;
      }

      if (msg.action === "getBrowsePopularity") {
        sendResponse(await getBrowsePopularity(baseUrl, msg.groups));
        return;
      }

      // --- ByteFM: REST replaceAndPlay. Must stay before the WebSocket gate. ---
      if (msg.action === "playOnVolumio") {
        const uri = typeof msg.uri === "string" ? msg.uri.trim() : "";
        const title = typeof msg.title === "string" ? msg.title.trim() : "";
        if (!uri || !title) {
          sendResponse({ success: false, error: "Missing stream URI or title." });
          return;
        }
        if (!isAllowedBytefmUri(uri)) {
          sendResponse({ success: false, error: "Stream URL is not a ByteFM address." });
          return;
        }
        const playbackUri = await resolveBytefmStreamUrl(uri);
        const track = trackFields(msg);
        const playRes = await fetch(`${baseUrl}/api/v1/replaceAndPlay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service: "webradio",
            type: "webradio",
            title: track.title || title,
            name: track.title || title,
            artist: track.artist,
            album: track.album,
            albumart: BYTEFM_LOGO,
            uri: playbackUri
          })
        });
        const bodyText = await playRes.text();
        let body = null;
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = null;
        }
        if (!playRes.ok || (body && body.error)) {
          sendResponse({
            success: false,
            error: (body && body.error) || bodyText || `Playback failed: ${playRes.status}`
          });
          return;
        }
        const started = await waitForBytefmPlayback(baseUrl, playbackUri, title);
        if (!started) {
          sendResponse({
            success: false,
            error: "Volumio accepted the stream but did not start playing."
          });
          return;
        }
        const trackInfo = track.title ? track : { ...track, title };
        sendResponse({
          success: true,
          message: `Playing ${title}`,
          uri: playbackUri
        });
        // The Volumio button only starts the live stream. Album Tools on the
        // device polls ByteFM and updates the song for every client.
        if (msg.followStream) return;
        // Playback is already running. Updating the label must not keep this
        // response open, or the page reports that Volumio did not respond.
        pushBytefmNowPlaying(baseUrl, trackInfo).then((meta) => {
          if (!meta.success) console.warn("[Play on Volumio]", meta.error);
        }).catch((err) => {
          console.warn("[Play on Volumio]", err.message || err);
        });
        return;
      }

      if (msg.action === "updateBytefmNowPlaying") {
        const track = trackFields(msg);
        if (!track.title && !track.artist && !track.albumart) {
          sendResponse({ success: false, error: "No track information." });
          return;
        }
        const meta = await pushBytefmNowPlaying(baseUrl, track);
        sendResponse(meta);
        return;
      }

      // Live webradio ignores pause. Stop ends it. Always hit REST as well:
      // a WebSocket that only looks open can accept the message and still leave the stream playing.
      if (msg.action === "pause" || msg.action === "stop") {
        let wsSent = false;
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(`42["${msg.action}",{}]`);
            wsSent = true;
          } catch (err) {
            console.warn("[Play on Volumio] WebSocket " + msg.action + " failed:", err);
          }
        }
        let restOk = false;
        let restError = "";
        try {
          const cmdRes = await fetch(`${baseUrl}/api/v1/commands/?cmd=${msg.action}`);
          restOk = cmdRes.ok;
          if (!cmdRes.ok) restError = (await cmdRes.text()) || `Command failed: ${cmdRes.status}`;
        } catch (err) {
          restError = err.message;
        }
        if (!wsSent && !restOk) {
          sendResponse({ success: false, error: restError || "Volumio is not connected." });
          return;
        }
        sendResponse({ success: true, message: msg.action });
        return;
      }

      // --- WebSocket commands (require connected WebSocket) ---
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ success: false, error: "Volumio WebSocket not connected." });
        return;
      }

      if (msg.action === "setVolume") {
        ws.send(`42["volume",${msg.value}]`);
        sendResponse({ success: true, message: "Volume set to " + msg.value });
        return;
      }

      if (msg.action === "seek") {
        ws.send(`42["seek",${msg.value}]`);
        sendResponse({ success: true, message: "Seek to " + msg.value + " sec" });
        return;
      }

      // --- REST-only commands ---
      if (msg.action === "play") {
        await fetch(`${baseUrl}/api/v1/commands/?cmd=play`);
        sendResponse({ success: true, message: "Play command sent" });
        return;
      }

      if (msg.action === "next") {
        await fetch(`${baseUrl}/api/v1/commands/?cmd=next`);
        sendResponse({ success: true, message: "Next track" });
        return;
      }

      if (msg.action === "prev") {
        await fetch(`${baseUrl}/api/v1/commands/?cmd=prev`);
        sendResponse({ success: true, message: "Previous track" });
        return;
      }

      sendResponse({ success: false, error: "Unknown action" });
    } catch (err) {
      console.error("[Play on Volumio] Error:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep channel open for async sendResponse
});
