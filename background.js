chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Wrap all logic in an async IIFE
  (async () => {
    try {
      if (!volumioIp) {
        sendResponse({ success: false, error: "Volumio IP not configured." });
        return;
      }

      // Handle playAlbum via REST search + replaceAndPlay
      if (msg.action === "playAlbum") {
        const baseUrl = `http://${volumioIp}:3000`;
        const query = encodeURIComponent(`${msg.artist} ${msg.album}`);
        const searchUrl = `${baseUrl}/api/v1/search?query=${query}`;
        console.log("Search URL:", searchUrl);

        const res = await fetch(searchUrl);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();

        // extract songs
        let songs = [];
        if (data?.navigation?.lists) {
          data.navigation.lists.forEach(list => {
            if (list.items) {
              list.items.forEach(item => {
                if (item.type === "song") songs.push(item);
              });
            }
          });
        }

        if (songs.length === 0) {
          sendResponse({ success: false, error: `No songs found for ${msg.artist} ${msg.album}` });
          return;
        }

        const payload = { item: songs[0], list: songs, index: 0 };
        const playRes = await fetch(`${baseUrl}/api/v1/replaceAndPlay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        await playRes.json().catch(() => ({}));

        sendResponse({ success: true, message: `Playing album ${msg.album} by ${msg.artist}` });
        return;
      }

      // Handle WebSocket commands
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ success: false, error: "Volumio WebSocket not connected." });
        return;
      }

      if (msg.action === "playTrack") {
        ws.send(`42["playTrack",${JSON.stringify({ artist: msg.artist, album: msg.album, track: msg.track })}]`);
        sendResponse({ success: true, message: `${msg.artist} - ${msg.album} - ${msg.track}` });
        return;
      }

      if (msg.action === "play") {
        const res = await fetch(`http://${volumioIp}:3000/api/v1/commands/?cmd=play`);
        const data = await res.json();
        sendResponse({ success: true, message: "Play command sent" });
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

      sendResponse({ success: false, error: "Unknown action" });

    } catch (err) {
      console.error("Error in onMessage:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  // IMPORTANT: Keep the message channel open for async IIFE
  return true;
});


let ws = null;
let volumioIp = null;
let pingInterval = null;
let ports = [];
let lastState = null;

// -----------------------------
// Connect to Volumio WebSocket
// -----------------------------
function connectVolumio() {
  if (!volumioIp) return;

  const url = `ws://${volumioIp}:3000/socket.io/?EIO=3&transport=websocket`;
  console.log("Connecting to Volumio:", url);

  if (ws) ws.close();
  if (pingInterval) clearInterval(pingInterval);

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("WebSocket connected. Sending handshake...");
    ws.send("40"); // socket.io handshake
    ws.send('42["subscribe","pushState"]'); // subscribe pushState

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("2"); // heartbeat
    }, 25000);
  };

  ws.onmessage = (event) => {
    const data = event.data;
    if (typeof data !== "string" || !data.startsWith("42")) return;

    try {
      const msg = JSON.parse(data.substring(2));
      const eventName = msg[0];
      const payload = msg[1];

      if (eventName === "pushState") {
        lastState = payload;

        const info = {
          artist: payload.artist || "",
          album: payload.album || "",
          title: payload.title || "",
          duration: payload.duration || 0,
          seek: payload.seek || 0,
          status: payload.status || "pause",
          volume: payload.volume || 0
        };

        // Send update to all connected overlays
        ports.forEach(port => port.postMessage({ action: "nowPlaying", data: info }));
      }
    } catch (err) {
      console.warn("Failed to parse pushState:", data, err);
    }
  };

  ws.onclose = () => {
    console.warn("WebSocket closed. Reconnecting in 5s...");
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(connectVolumio, 5000);
  };

  ws.onerror = (err) => console.error("WebSocket error:", err);
}

// -----------------------------
// Load Volumio IP
// -----------------------------
chrome.storage.sync.get("volumioIp", (res) => {
  if (res.volumioIp) {
    volumioIp = res.volumioIp;
    connectVolumio();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.volumioIp) {
    volumioIp = changes.volumioIp.newValue;
    connectVolumio();
  }
});

// -----------------------------
// Port Communication for Overlay
// -----------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "volumioOverlay") {
    ports.push(port);

    // Request current state from Volumio REST API to get accurate seek
    if (volumioIp) {
      fetch(`http://${volumioIp}:3000/api/v1/getState`)
        .then(res => res.json())
        .then(state => {
          lastState = state;
          port.postMessage({ action: "nowPlaying", data: {
            artist: state.artist || "",
            album: state.album || "",
            title: state.title || "",
            duration: state.duration || 0,
            seek: state.seek || 0,
            status: state.status || "pause",
            volume: state.volume || 0
          }});
        })
        .catch(err => {
          console.warn("Failed to get current state:", err);
        });
    }

    port.onDisconnect.addListener(() => {
      ports = ports.filter(p => p !== port);
    });
  }
});

// -----------------------------
// Handle Messages: Async + sendResponse
// -----------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!volumioIp) {
        sendResponse({ success: false, error: "Volumio IP not configured." });
        return;
      }

      const baseUrl = `http://${volumioIp}:3000`;

      // Play Album via REST
      if (msg.action === "playAlbum") {
        const query = encodeURIComponent(`${msg.artist} ${msg.album}`);
        const searchUrl = `${baseUrl}/api/v1/search?query=${query}`;
        console.log("Search URL:", searchUrl);

        const res = await fetch(searchUrl);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();
        console.log("Search-Response JSON:", data);

        let songs = [];
        if (data?.navigation?.lists) {
          data.navigation.lists.forEach(list => {
            if (list.items) {
              list.items.forEach(item => {
                if (item.type === "song") songs.push(item);
              });
            }
          });
        }

        if (songs.length === 0) {
          sendResponse({ success: false, error: `No songs found for ${msg.artist} ${msg.album}` });
          return;
        }

        const payload = { item: songs[0], list: songs, index: 0 };
        await fetch(`${baseUrl}/api/v1/replaceAndPlay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        sendResponse({ success: true, message: `Playing album ${msg.album} by ${msg.artist}` });
        return;
      }

      // WebSocket commands
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ success: false, error: "Volumio WebSocket not connected." });
        return;
      }

      if (msg.action === "playTrack") {
        ws.send(`42["playTrack",${JSON.stringify({ artist: msg.artist, album: msg.album, track: msg.track })}]`);
        sendResponse({ success: true, message: `${msg.artist} - ${msg.album} - ${msg.track}` });
        return;
      }

      if (msg.action === "play") {
        const res = await fetch(`${baseUrl}/api/v1/commands/?cmd=play`);
        const data = await res.json();
        sendResponse({ success: true, message: "Play command sent" });
        return;
      }

      if (msg.action === "pause") {
        ws.send('42["pause",{}]');
        sendResponse({ success: true, message: "Paused at seek: " + (lastState?.seek || 0) });
        return;
      }

      if (msg.action === "next") {
        const res = await fetch(`${baseUrl}/api/v1/commands/?cmd=next`);
        const data = await res.json();
        sendResponse({ success: true, message: "Next song command sent" });
        return;
      }

      if (msg.action === "prev") {
        const res = await fetch(`${baseUrl}/api/v1/commands/?cmd=prev`);
        const data = await res.json();
        sendResponse({ success: true, message: "Prev song command sent" });
        return;
      }

      if (msg.action === "seek") {
        ws.send(`42["seek",${msg.value}]`);
        sendResponse({ success: true, message: "Seek to " + msg.value + " sec" });
        return;
      }

      if (msg.action === "setVolume") {
        ws.send(`42["volume",${msg.value}]`);
        sendResponse({ success: true, message: "Volume set to " + msg.value });
        return;
      }

      sendResponse({ success: false, error: "Unknown action" });
    } catch (err) {
      console.error("Error in onMessage:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  // Keep the message channel open for async IIFE
  return true;
});