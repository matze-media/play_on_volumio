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
        const info = {
          artist: payload.artist || "",
          album: payload.album || "",
          title: payload.title || "",
          duration: payload.duration || 0,
          seek: payload.seek || 0,
          status: payload.status || "pause",
          volume: payload.volume || 0,
          albumart: buildAlbumartUrl(payload.albumart)
        };
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
    .executeScript({ target: { tabId }, files: ["content_overlay.js", "content_volumio.js"] })
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
        port.postMessage({
          action: "nowPlaying",
          data: {
            artist: state.artist || "",
            album: state.album || "",
            title: state.title || "",
            duration: state.duration || 0,
            seek: state.seek || 0,
            status: state.status || "pause",
            volume: state.volume || 0,
            albumart: buildAlbumartUrl(state.albumart)
          }
        });
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

      // --- WebSocket commands (require connected WebSocket) ---
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ success: false, error: "Volumio WebSocket not connected." });
        return;
      }

      if (msg.action === "playTrack") {
        ws.send(
          `42["playTrack",${JSON.stringify({ artist: msg.artist, album: msg.album, track: msg.track })}]`
        );
        sendResponse({ success: true, message: `${msg.artist} – ${msg.album} – ${msg.track}` });
        return;
      }

      if (msg.action === "pause") {
        ws.send('42["pause",{}]');
        sendResponse({ success: true, message: "Paused at seek: " + (lastState?.seek || 0) });
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
