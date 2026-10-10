// =============================================================================
// Play on Volumio - Overlay (albumoftheyear.org) + Media Session (Volumio tab)
// Floating player, Media Session API: Control Center, media keys
// =============================================================================

(function () {
  if (window.__playOnVolumioInjected) return;
  window.__playOnVolumioInjected = true;

  const DEFAULT_API_PORT = 3000;
  const HTTP_DEFAULT_PORT = 80; // When URL has no port (e.g. http://192.168.1.100)
  const SILENT_AUDIO =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function extensionAlive() {
  try {
    return Boolean(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function runtimeSend(message, callback) {
  if (!extensionAlive()) return;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      try {
        if (chrome.runtime.lastError) {
          if (callback) callback(undefined);
          return;
        }
      } catch {
        return;
      }
      if (callback) callback(response);
    });
  } catch {
    // The extension was reloaded. This page still has the previous content script.
  }
}

// -----------------------------------------------------------------------------
// Media Session API (macOS Control Center, media keys)
// Requires a playing audio element to activate
// -----------------------------------------------------------------------------
let mediaSessionAudio = null;
let mediaSessionReady = false;
let mediaSessionPlayToken = 0;
let mediaSessionGesture = false;

/** Closing the laptop makes macOS pause Now Playing. That pause can arrive while the
 *  page is still visible, or several seconds after it is hidden. Hold it briefly and
 *  send it to Volumio only if the page is still on screen.
 */
let mediaPauseTimer = null;

function cancelPendingMediaPause() {
  if (!mediaPauseTimer) return;
  clearTimeout(mediaPauseTimer);
  mediaPauseTimer = null;
}

function noteMediaSessionGesture() {
  mediaSessionGesture = true;
  if (mediaSessionReady || currentTrack?.status !== "play") return;
  syncMediaSessionAudio("play");
}

document.addEventListener("pointerdown", noteMediaSessionGesture, true);
document.addEventListener("keydown", noteMediaSessionGesture, true);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    cancelPendingMediaPause();
    return;
  }
  if (currentTrack) {
    setupMediaSession();
    updateMediaSessionMetadata(currentTrack);
  }
});
document.addEventListener("freeze", cancelPendingMediaPause);
document.addEventListener("pagehide", cancelPendingMediaPause);

function setupMediaSession() {
  if (mediaSessionAudio) return;

  const audio = document.createElement("audio");
  audio.loop = true;
  audio.src = SILENT_AUDIO;
  audio.style.cssText = "position:absolute;opacity:0;pointer-events:none;width:0;height:0;";
  document.body.appendChild(audio);
  mediaSessionAudio = audio;

  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => {
      mediaSessionGesture = true;
      syncMediaSessionAudio("play");
      navigator.mediaSession.playbackState = "playing";
      if (currentTrack) currentTrack.status = "play";
      syncOverlayPlayPauseButton("play");
      runtimeSend({ action: "play" }, (r) => {
        if (!r?.success) {
          syncMediaSessionAudio("pause");
          navigator.mediaSession.playbackState = "paused";
          if (currentTrack) currentTrack.status = "pause";
          syncOverlayPlayPauseButton("pause");
          console.info("Play failed:", r?.error);
        }
      });
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (document.visibilityState !== "visible") return;
      cancelPendingMediaPause();
      mediaPauseTimer = setTimeout(() => {
        mediaPauseTimer = null;
        if (document.visibilityState !== "visible") return;
        syncMediaSessionAudio("pause");
        navigator.mediaSession.playbackState = "paused";
        if (currentTrack) currentTrack.status = "pause";
        syncOverlayPlayPauseButton("pause");
        runtimeSend({ action: "pause" }, (r) => {
          if (!r?.success) {
            mediaSessionGesture = true;
            syncMediaSessionAudio("play");
            navigator.mediaSession.playbackState = "playing";
            if (currentTrack) currentTrack.status = "play";
            syncOverlayPlayPauseButton("play");
            console.info("Pause failed:", r?.error);
          }
        });
      }, 1000);
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      runtimeSend({ action: "prev" }, (r) => !r?.success && console.info("Prev failed:", r?.error));
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      runtimeSend({ action: "next" }, (r) => !r?.success && console.info("Next failed:", r?.error));
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) {
        runtimeSend({ action: "seek", value: Math.floor(details.seekTime) });
      }
    });
  }
}

function syncOverlayPlayPauseButton(status) {
  const btn = document.getElementById("volumio-playpause");
  if (btn) {
    btn.textContent = status === "play" ? "pause" : "play_arrow";
    btn.dataset.icon = status === "play" ? "pause" : "play_arrow";
  }
}

function syncMediaSessionAudio(status) {
  const audio = mediaSessionAudio;
  if (!audio) return;
  const token = ++mediaSessionPlayToken;
  if (status === "play") {
    if (!mediaSessionGesture) return;
    audio.play().then(
      () => {
        if (token !== mediaSessionPlayToken) return;
        mediaSessionReady = true;
      },
      (err) => {
        if (token !== mediaSessionPlayToken) return;
        if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) return;
      }
    );
    return;
  }
  audio.pause();
}

function updateMediaSessionMetadata(track) {
  if (!("mediaSession" in navigator)) return;

  syncMediaSessionAudio(track.status);

  function setMetadata(artwork) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "—",
      artist: track.artist || "",
      album: track.album || "",
      artwork: artwork || []
    });
  }

  setMetadata([]);

  if (track.albumart) {
    try {
      const artOrigin = new URL(track.albumart).origin;
      const isSameOrigin = artOrigin === window.location.origin;
      if (isSameOrigin) {
        const artwork = [
          { src: track.albumart, sizes: "96x96", type: "image/jpeg" },
          { src: track.albumart, sizes: "256x256", type: "image/jpeg" },
          { src: track.albumart, sizes: "512x512", type: "image/jpeg" }
        ];
        setMetadata(artwork);
      } else {
        runtimeSend({ action: "getAlbumArt", url: track.albumart }, (dataUrl) => {
          if (dataUrl) {
            const mime = dataUrl.match(/^data:([^;]+)/)?.[1] || "image/jpeg";
            const artwork = [
              { src: dataUrl, sizes: "96x96", type: mime },
              { src: dataUrl, sizes: "256x256", type: mime },
              { src: dataUrl, sizes: "512x512", type: mime }
            ];
            setMetadata(artwork);
          }
        });
      }
    } catch {
      runtimeSend({ action: "getAlbumArt", url: track.albumart }, (dataUrl) => {
        if (dataUrl) {
          const mime = dataUrl.match(/^data:([^;]+)/)?.[1] || "image/jpeg";
          const artwork = [
            { src: dataUrl, sizes: "96x96", type: mime },
            { src: dataUrl, sizes: "256x256", type: mime },
            { src: dataUrl, sizes: "512x512", type: mime }
          ];
          setMetadata(artwork);
        }
      });
    }
  }

  navigator.mediaSession.playbackState = track.status === "play" ? "playing" : "paused";

  const duration = track.duration || 0;
  const position = (track.seek || 0) / 1000;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: 1,
      position
    });
  } catch {
    // setPositionState can throw if duration/position invalid
  }
}

function getOverlayHTML(track) {
  const vol = Number(track?.volume ?? 0);
  const duration = Number(track?.duration ?? 0);
  const seekSec = Number(Math.floor((track?.seek ?? 0) / 1000));
  const volPct = Math.max(0, Math.min(100, Math.round(vol)));
  const progPct = duration > 0 ? Math.max(0, Math.min(100, (seekSec / duration) * 100)) : 0;
  const progMax = Math.max(1, duration);

  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Material+Icons&display=swap');
    .material-icons {
      font-family: 'Material Icons';
      font-weight: normal;
      font-style: normal;
      font-size: 18px;
      line-height: 1;
      display: block;
      cursor: pointer;
      color: white;
      margin: 0;
    }
    .overlay-root {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 290px;
      padding: 0;
      box-sizing: border-box;
      color: white;
      font-family: Arial, sans-serif;
    }
    .top-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .track-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 240px;
      max-width: 240px;
    }
    .controls-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vertical-controls {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .progress-slider {
      -webkit-appearance: none;
      width: 100%;
      height: 6px;
      background: #ddd;
      border-radius: 3px;
      outline: none;
      margin-top: 14px;
    }
    .progress-slider::-webkit-slider-runnable-track {
      height: 6px;
      background: linear-gradient(to right, #61ce70 0%, #61ce70 var(--val, 50%), #ddd var(--val, 50%), #ddd 100%);
      border-radius: 3px;
    }
    .progress-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 0; height: 0; }
    .progress-slider::-moz-range-track { background: #ddd; height: 6px; border-radius: 3px; }
    .progress-slider::-moz-range-progress { background: #61ce70; height: 6px; border-radius: 3px; }
    .progress-slider::-moz-range-thumb { width: 0; height: 0; border: none; }
    .vol-wrap {
      position: relative;
      width: 12px;
      height: 60px;
      background: #ddd;
      display: flex;
      justify-content: center;
      cursor: pointer;
    }
    .vol-fill {
      position: absolute;
      bottom: 0;
      width: 100%;
      height: ${volPct}%;
      background: #61ce70;
    }
    .vol-thumb {
      position: absolute;
      bottom: ${volPct}%;
      left: 50%;
      transform: translate(-50%, 50%);
      width: 12px;
      height: 6px;
      background: white;
      cursor: pointer;
    }
  </style>
  <div class="overlay-root">
    <div class="top-row">
      <div class="track-info">
        <div style="font-weight:bold; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="Artist – Album">
          ${escapeHtml((track.artist || "") + " – " + (track.album || ""))}
        </div>
        <div style="font-size:12px; color:white; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="Track">
          ${escapeHtml(track.title || "—")}
        </div>
        <input
          id="volumio-progress"
          class="progress-slider"
          type="range"
          min="0"
          max="${progMax}"
          title="${formatTime(seekSec)}"
          style="--val:${progPct}%"
          aria-label="Track position"
        />
      </div>
      <div class="controls-row">
        <div class="vertical-controls">
          <span id="volumio-previous" class="material-icons" title="Previous">skip_previous</span>
          <span id="volumio-playpause" class="material-icons" title="Play/Pause" data-icon="${track.status === "play" ? "pause" : "play_arrow"}">${track.status === "play" ? "pause" : "play_arrow"}</span>
          <span id="volumio-next" class="material-icons" title="Next">skip_next</span>
        </div>
        <div id="volumio-slider-wrap" class="vol-wrap" aria-label="Volume" title="Volume: ${volPct}%">
          <div class="vol-fill"></div>
          <div id="vol-thumb" class="vol-thumb"></div>
        </div>
      </div>
    </div>
  </div>
  `;
}

let overlay = null;
let currentTrack = null;
let progressInterval = null;

// -----------------------------------------------------------------------------
// Update Overlay
// -----------------------------------------------------------------------------
function updateOverlay(track) {
  if (!track) return;

  currentTrack = { ...track };

  setupMediaSession();
  updateMediaSessionMetadata(track);

  if (!overlay) return;

  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  overlay.innerHTML = getOverlayHTML(track);

  // Previous
  document.getElementById("volumio-previous").addEventListener("click", () => {
    runtimeSend({ action: "prev" }, (r) => !r?.success && console.info("Prev failed:", r?.error));
  });

  // Next
  document.getElementById("volumio-next").addEventListener("click", () => {
    runtimeSend({ action: "next" }, (r) => !r?.success && console.info("Next failed:", r?.error));
  });

  // Play / Pause (keep Material Icons)
  const playPauseBtn = document.getElementById("volumio-playpause");
  playPauseBtn.addEventListener("click", () => {
    if (!currentTrack) return;
    const action = currentTrack.status === "play" ? "pause" : "play";
    runtimeSend({ action }, (res) => {
      if (res?.success) {
        currentTrack.status = currentTrack.status === "play" ? "pause" : "play";
        const icon = currentTrack.status === "play" ? "pause" : "play_arrow";
        playPauseBtn.textContent = icon;
        playPauseBtn.dataset.icon = icon;
      } else {
        console.warn("Play/Pause failed:", res?.error);
      }
    });
  });

  // Progress bar
  const progressEl = document.getElementById("volumio-progress");
  if (progressEl) {
    const duration = track.duration || 0;
    let seekSec = Math.floor((track.seek || 0) / 1000);

    progressEl.addEventListener("input", (e) => {
      const newSeek = parseInt(e.target.value, 10);
      runtimeSend({ action: "seek", value: newSeek });
    });

    if (track.status === "play" && duration > 0) {
      progressInterval = setInterval(() => {
        seekSec++;
        if (seekSec <= duration) {
          const pct = (seekSec / duration) * 100;
          progressEl.value = seekSec;
          progressEl.title = formatTime(seekSec);
          progressEl.style.setProperty("--val", `${pct}%`);
        }
      }, 1000);
    }
  }

  // Volume
  const volWrap = document.getElementById("volumio-slider-wrap");
  const volThumb = document.getElementById("vol-thumb");
  const volFill = volWrap?.querySelector(".vol-fill");

  function setVolumeByY(y) {
    if (!volWrap || !volThumb || !volFill) return;
    const rect = volWrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, 1 - y / rect.height));
    volThumb.style.bottom = `${pct * 100}%`;
    volFill.style.height = `${pct * 100}%`;
    runtimeSend({ action: "setVolume", value: Math.round(pct * 100) });
  }

  volWrap?.addEventListener("click", (e) => {
    setVolumeByY(e.clientY - volWrap.getBoundingClientRect().top);
  });

  volThumb?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const onMove = (e2) => setVolumeByY(e2.clientY - volWrap.getBoundingClientRect().top);
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// -----------------------------------------------------------------------------
// Init: Overlay (albumoftheyear) or Media Session only (Volumio tab)
// -----------------------------------------------------------------------------
(async () => {
  let volumioIp;
  let volumioApiPort;
  let volumioWebPort;
  try {
    ({ volumioIp, volumioApiPort, volumioWebPort } = await chrome.storage.sync.get([
      "volumioIp",
      "volumioApiPort",
      "volumioWebPort"
    ]));
  } catch {
    return;
  }
  const webPort = parseInt(volumioWebPort ?? volumioApiPort ?? DEFAULT_API_PORT, 10);
  const expectedHost = webPort === HTTP_DEFAULT_PORT ? volumioIp : `${volumioIp}:${webPort}`;
  const isVolumioPage = volumioIp && window.location.host === expectedHost;

  if (!isVolumioPage) {
    overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      top: 6px;
      left: 6px;
      background: rgba(56, 154, 69, 0.85);
      color: white;
      padding: 2px 12px;
      border-radius: 6px;
      font-family: sans-serif;
      font-size: 12px;
      line-height: 1.4;
      z-index: 99999;
      min-width: 220px;
    `;
    overlay.innerText = "Waiting for Volumio…";
    overlay.addEventListener("click", () => {
      noteMediaSessionGesture();
    });
    document.body.appendChild(overlay);
  }

  setupMediaSession();
  if (!extensionAlive()) return;
  let port;
  try {
    port = chrome.runtime.connect({ name: "volumioOverlay" });
  } catch {
    return;
  }
  port.onMessage.addListener((msg) => {
    if (msg.action === "nowPlaying") {
      updateOverlay(msg.data);
    }
  });
})();
})();
