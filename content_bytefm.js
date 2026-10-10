// =============================================================================
// Play on Volumio - ByteFM player bar (https://www.byte.fm/*)
// Live: play or stop, no time track. Archive: play and pause. While Volumio
// has the show, ByteFM's progress bar follows Volumio and ByteFM's own play
// button is left idle, so there is one timeline.
// =============================================================================

const CLUSTER_ATTR = "data-play-on-volumio-bytefm";
const STYLE_ID = "play-on-volumio-bytefm-style";
const REQUEST = "play-on-volumio";
const REPLY = "play-on-volumio-page";
const GREEN = "#61ce70";
const RED = "#d76666";
const SEEK_WAIT_MS = 15000;

let requestSeq = 0;
let overlayPort = null;
let lastState = null;
let pendingSeek = null;
let pendingSeekTimer = null;
let draggingVolume = false;
let volumeTimer = null;
let activeBytefm = null;
let bytefmOnVolumio = false;
let placeTimer = null;
let transportHold = null;
let pageMode = "live";
let archiveClock = null;
let archiveClockTimer = null;
let lastTrackKey = "";

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [${CLUSTER_ATTR}] {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 8px;
      flex: 0 0 auto;
      position: relative;
      z-index: 5;
      color: #222;
      font-size: 12px;
      line-height: 1;
    }
    [${CLUSTER_ATTR}] button[data-role="transport"] {
      width: 29px;
      height: 29px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: ${GREEN};
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    [${CLUSTER_ATTR}] button[data-role="transport"] svg {
      width: 16px;
      height: 16px;
      display: block;
      pointer-events: none;
    }
    [${CLUSTER_ATTR}] button:disabled {
      opacity: 0.7;
      cursor: default;
    }
    [${CLUSTER_ATTR}] button.is-error {
      background: ${RED};
    }
    [${CLUSTER_ATTR}] label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 0;
      color: #222;
      font-weight: 600;
    }
    [${CLUSTER_ATTR}] input[type="range"] {
      width: 72px;
      accent-color: ${GREEN};
      margin: 0;
    }
    [${CLUSTER_ATTR}] input.is-error {
      outline: 2px solid ${RED};
    }
    html[data-play-on-volumio-owns="archive"] #q-app .player-play-button {
      opacity: 0.35;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function injectBridge() {
  if (document.documentElement.dataset.playOnVolumioBytefmBridge) return;
  document.documentElement.dataset.playOnVolumioBytefmBridge = "1";
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("bytefm_page_bridge.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function callPage(type) {
  injectBridge();
  return new Promise((resolve, reject) => {
    const requestId = ++requestSeq;
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("ByteFM player did not respond."));
    }, 1500);
    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== REPLY || data.requestId !== requestId || data.type !== type) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.payload || {});
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: REQUEST, type, requestId }, window.location.origin);
  });
}

function sendWorker(message) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: "Volumio did not respond." });
    }, 20000);
    try {
      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: "No response" });
      });
    } catch (err) {
      clearTimeout(timer);
      resolve({ success: false, error: err.message || "Extension was reloaded. Refresh this page." });
    }
  });
}

async function ensureHost() {
  const { volumioIp } = await chrome.storage.sync.get("volumioIp");
  if (!volumioIp) {
    chrome.runtime.openOptionsPage();
    return false;
  }
  return true;
}

function setButtonState(button, state, title) {
  button.classList.toggle("is-error", state === "error");
  button.disabled = state === "busy";
  if (title) button.title = title;
}

function setSliderError(slider, error) {
  slider.classList.toggle("is-error", !!error);
  if (error) slider.title = error;
}

function clearPendingSeek() {
  pendingSeek = null;
  if (pendingSeekTimer) {
    clearTimeout(pendingSeekTimer);
    pendingSeekTimer = null;
  }
}

function pendingSeekReady(data) {
  if (!pendingSeek || !data) return false;
  if (data.status !== "play" || !hasDuration(data)) return false;
  if (data.stream === true && !(Number(data.duration) > 0)) return false;
  if (data.uri && data.uri === pendingSeek.uri) return true;
  if (data.title && data.title === pendingSeek.title) return true;
  const moved =
    (data.uri && data.uri !== pendingSeek.previousUri) ||
    (data.title && data.title !== pendingSeek.previousTitle);
  return moved;
}

function hasDuration(data) {
  return !!data && Number(data.duration) > 0;
}

function transportButton() {
  const cluster = document.querySelector("[" + CLUSTER_ATTR + "]");
  return cluster ? cluster.querySelector('button[data-role="transport"]') : null;
}

function renderTransport(button, playing) {
  if (!button) return;
  const archive = pageMode === "archive";
  let icon = PLAY_ICON;
  let mode = "play";
  let label = "Play on Volumio";
  if (playing && archive) {
    icon = PAUSE_ICON;
    mode = "pause";
    label = "Pause on Volumio";
  } else if (playing) {
    icon = STOP_ICON;
    mode = "stop";
    label = "Stop on Volumio";
  }
  button.innerHTML = icon;
  button.dataset.mode = mode;
  button.setAttribute("aria-label", label);
  if (!button.classList.contains("is-error")) button.title = label;
}

function urisMatch(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function volumioMatchesPage() {
  if (!lastState || lastState.status !== "play" || !activeBytefm) return false;
  if (activeBytefm.mode !== pageMode) return false;
  if (pageMode === "archive") return volumioHasBytefmArchive(lastState);
  if (urisMatch(lastState.uri, activeBytefm.uri) || urisMatch(lastState.uri, activeBytefm.sourceUri)) return true;
  return lastState.stream === true && /byte\.?fm|radiohost\.de/i.test(String(lastState.uri || ""));
}

function syncTransport(button) {
  const target = button || transportButton();
  if (!target || target.disabled) return;
  const matches = volumioMatchesPage();
  if (transportHold === "play" && matches) transportHold = null;
  if (transportHold === "off" && lastState && lastState.status !== "play") transportHold = null;
  const playing = transportHold === "play" ? true : transportHold === "off" ? false : matches;
  renderTransport(target, playing);
}

function pageMatchesActive(uri) {
  if (!activeBytefm || !uri) return false;
  return urisMatch(uri, activeBytefm.uri) || urisMatch(uri, activeBytefm.sourceUri);
}

function volumioHasBytefmArchive(data) {
  if (!data || !hasDuration(data) || !activeBytefm) return false;
  return pageMatchesActive(String(data.uri || ""));
}

function postPage(type, payload) {
  injectBridge();
  window.postMessage({ source: REQUEST, type, payload }, window.location.origin);
}

function stopArchiveClock() {
  archiveClock = null;
  if (archiveClockTimer) {
    clearInterval(archiveClockTimer);
    archiveClockTimer = null;
  }
}

function paintArchiveClock() {
  if (!archiveClock || pageMode !== "archive") return;
  let seconds = archiveClock.seekSeconds;
  if (archiveClock.playing) seconds += (Date.now() - archiveClock.at) / 1000;
  if (archiveClock.duration > 0) seconds = Math.min(seconds, archiveClock.duration);
  postPage("showPosition", { seconds, duration: archiveClock.duration, uri: archiveClock.uri });
}

function syncArchiveClock(data) {
  const follow = pageMode === "archive" && bytefmOnVolumio && volumioHasBytefmArchive(data);
  if (!follow) {
    stopArchiveClock();
    return;
  }
  const seekMs = Number(data.seek);
  archiveClock = {
    seekSeconds: Number.isFinite(seekMs) && seekMs > 0 ? seekMs / 1000 : 0,
    at: Date.now(),
    duration: Number(data.duration) > 0 ? Number(data.duration) : 0,
    playing: data.status === "play",
    uri: activeBytefm.sourceUri || activeBytefm.uri || ""
  };
  if (!archiveClockTimer) archiveClockTimer = setInterval(paintArchiveClock, 500);
  paintArchiveClock();
}

function syncOwnership() {
  const owns = bytefmOnVolumio && pageMode === "archive" && activeBytefm?.mode === "archive";
  if (owns) document.documentElement.dataset.playOnVolumioOwns = "archive";
  else delete document.documentElement.dataset.playOnVolumioOwns;
}

function applyState(data) {
  if (!data) return;
  lastState = data;
  syncArchiveClock(data);
  syncOwnership();
  const cluster = document.querySelector("[" + CLUSTER_ATTR + "]");
  const volume = cluster && cluster.querySelector('input[data-role="volume"]');
  if (volume && !draggingVolume && typeof data.volume === "number") {
    volume.value = String(Math.max(0, Math.min(100, Math.round(data.volume))));
  }
  syncTransport();

  if (!pendingSeekReady(data)) return;
  const target = pendingSeek.seconds;
  clearPendingSeek();
  sendWorker({ action: "seek", value: target }).then((response) => {
    const button = transportButton();
    if (!button || response?.success) return;
    setButtonState(button, "error", response?.error || "Seek failed");
  });
}

function transportOffAction() {
  return pageMode === "archive" ? "pause" : "stop";
}

function onPageMessage(event) {
  onTrackPositionMessage(event);
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== REPLY) return;
  if (data.type === "playerMode") {
    if (data.mode !== "live" && data.mode !== "archive") return;
    if (pageMode === data.mode) return;
    pageMode = data.mode;
    transportHold = null;
    if (pageMode !== "archive") stopArchiveClock();
    syncOwnership();
    syncTransport();
    return;
  }
  if (data.type === "archiveIdentity") {
    const uri = typeof data.uri === "string" ? data.uri : "";
    if (pageMatchesActive(uri)) return;
    clearPendingSeek();
    stopArchiveClock();
    if (bytefmOnVolumio && activeBytefm?.mode === "archive") {
      bytefmOnVolumio = false;
      transportHold = null;
      syncOwnership();
      syncTransport();
    }
    return;
  }
  if (data.type === "trackInfo") {
    pushTrackInfo(data.info);
    return;
  }
  if (data.type !== "localStopped") return;
  if (!bytefmOnVolumio || activeBytefm?.mode !== pageMode) return;
  const button = transportButton();
  if (button?.disabled) return;
  if (button?.dataset.mode !== "pause" && button?.dataset.mode !== "stop") return;
  onPause(button);
}

function onTrackPositionMessage(event) {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== REPLY || data.type !== "trackPosition") return;
  const seconds = Math.floor(Number(data.seconds));
  if (!Number.isFinite(seconds) || seconds < 0) return;
  if (pageMode !== "archive" || !volumioHasBytefmArchive(lastState)) return;
  forwardTrackPosition(seconds);
}

async function forwardTrackPosition(seconds) {
  if (!(await ensureHost())) return;
  const response = await sendWorker({ action: "seek", value: seconds });
  const button = transportButton();
  if (!button || response?.success) return;
  if (response?.error === "Volumio IP not configured.") chrome.runtime.openOptionsPage();
  setButtonState(button, "error", response?.error || "Seek failed");
}

function connectOverlay() {
  if (overlayPort) return;
  overlayPort = chrome.runtime.connect({ name: "volumioOverlay" });
  overlayPort.onMessage.addListener((msg) => {
    if (msg?.action === "nowPlaying") applyState(msg.data);
  });
  overlayPort.onDisconnect.addListener(() => {
    overlayPort = null;
  });
}

function createCluster() {
  const cluster = document.createElement("span");
  cluster.setAttribute(CLUSTER_ATTR, "1");

  const transport = document.createElement("button");
  transport.type = "button";
  transport.setAttribute("data-role", "transport");
  renderTransport(transport, false);
  const volumeLabel = document.createElement("label");
  volumeLabel.append("Vol");
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = "0";
  volume.setAttribute("data-role", "volume");
  volume.setAttribute("aria-label", "Volumio volume");
  volumeLabel.append(volume);

  volume.addEventListener("pointerdown", () => {
    draggingVolume = true;
  });
  volume.addEventListener("pointerup", () => {
    draggingVolume = false;
  });
  volume.addEventListener("pointercancel", () => {
    draggingVolume = false;
  });
  volume.addEventListener("input", () => {
    draggingVolume = true;
    setSliderError(volume, null);
    if (volumeTimer) clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => commitVolume(volume), 80);
  });
  volume.addEventListener("change", () => {
    draggingVolume = false;
    if (volumeTimer) clearTimeout(volumeTimer);
    commitVolume(volume);
  });

  cluster.append(transport, volumeLabel);
  return cluster;
}

function trackKey(info) {
  if (!info) return "";
  return [info.artist || "", info.title || "", info.album || "", info.albumart || ""].join("\n");
}

async function pushTrackInfo(info) {
  if (!bytefmOnVolumio || !info) return;
  const key = trackKey(info);
  if (!key.trim() || key === lastTrackKey) return;
  lastTrackKey = key;
  const response = await sendWorker({
    action: "updateBytefmNowPlaying",
    title: info.title || "",
    artist: info.artist || "",
    album: info.album || "",
    albumart: info.albumart || ""
  });
  if (!response?.success) console.warn("[Play on Volumio]", response?.error || "Track information was not updated.");
}

function onTransport(button) {
  const off = button.dataset.mode === "pause" || button.dataset.mode === "stop";
  console.info("[Play on Volumio] ByteFM", off && volumioMatchesPage() ? "stop" : "play", pageMode);
  if (off && volumioMatchesPage()) return onPause(button);
  return onPlay(button);
}

async function onPlay(button) {
  if (!(await ensureHost())) {
    setButtonState(button, "error", "Set the Volumio host in extension options.");
    return;
  }
  setButtonState(button, "busy", "Starting on Volumio…");
  let item;
  try {
    item = await callPage("readPlayer");
  } catch (err) {
    setButtonState(button, "error", err.message);
    renderTransport(button, false);
    return;
  }
  if (!item || item.error || !item.uri) {
    setButtonState(button, "error", item?.error || "Nothing to play.");
    renderTransport(button, false);
    return;
  }

  const response = await sendWorker({
    action: "playOnVolumio",
    uri: item.uri,
    title: item.title,
    artist: item.artist || "",
    album: item.album || "",
    albumart: item.albumart || ""
  });
  if (!response?.success) {
    const error = response?.error || "Failed to play";
    console.warn("[Play on Volumio]", error);
    if (error === "Volumio IP not configured.") chrome.runtime.openOptionsPage();
    setButtonState(button, "error", error);
    renderTransport(button, false);
    return;
  }

  pageMode = item.mode === "archive" ? "archive" : "live";
  transportHold = "play";
  const nowPlaying = [item.artist, item.title].filter(Boolean).join(" – ") || item.title;
  setButtonState(button, "ok", "Now playing: " + nowPlaying);
  renderTransport(button, true);
  activeBytefm = {
    uri: response.uri || item.uri,
    sourceUri: item.uri,
    title: item.title,
    mode: pageMode
  };
  bytefmOnVolumio = true;
  lastTrackKey = trackKey(item);
  syncOwnership();
  if (response.metadata && response.metadata !== "updated") {
    console.warn("[Play on Volumio]", response.metadata);
  }
  if (pageMode === "live" || item.isPlaying) {
    try {
      await callPage("pauseLocal");
    } catch (err) {
      button.title = "Playing on Volumio. Local pause failed: " + err.message;
    }
  }

  clearPendingSeek();
  if (item.mode === "archive" && Number(item.positionSeconds) > 0) {
    pendingSeek = {
      seconds: Math.floor(Number(item.positionSeconds)),
      title: item.title,
      uri: response.uri || item.uri,
      previousTitle: lastState?.title || "",
      previousUri: lastState?.uri || ""
    };
    pendingSeekTimer = setTimeout(clearPendingSeek, SEEK_WAIT_MS);
    if (lastState) applyState(lastState);
  }
}

async function onPause(button) {
  if (!(await ensureHost())) {
    if (button) setButtonState(button, "error", "Set the Volumio host in extension options.");
    return;
  }
  const action = transportOffAction();
  if (button) setButtonState(button, "busy", action === "stop" ? "Stopping Volumio…" : "Pausing Volumio…");
  const silenceLocal = callPage("pauseLocal").catch(() => {});
  const response = await sendWorker({ action });
  await silenceLocal;
  if (!response?.success) {
    if (response?.error === "Volumio IP not configured.") chrome.runtime.openOptionsPage();
    if (button) {
      setButtonState(button, "error", response?.error || "Failed to pause");
      renderTransport(button, true);
    }
    return;
  }
  bytefmOnVolumio = false;
  lastTrackKey = "";
  stopArchiveClock();
  syncOwnership();
  transportHold = "off";
  if (button) {
    setButtonState(button, "ok", action === "stop" ? "Stopped on Volumio" : "Paused on Volumio");
    renderTransport(button, false);
  }
}

async function commitVolume(slider) {
  if (!(await ensureHost())) {
    setSliderError(slider, "Set the Volumio host in extension options.");
    return;
  }
  const value = Math.round(Number(slider.value));
  if (!Number.isFinite(value)) return;
  const response = await sendWorker({ action: "setVolume", value: Math.max(0, Math.min(100, value)) });
  if (!response?.success) {
    if (response?.error === "Volumio IP not configured.") chrome.runtime.openOptionsPage();
    setSliderError(slider, response?.error || "Failed to set volume");
    return;
  }
  setSliderError(slider, null);
  slider.title = "Volumio volume " + value;
}

function placeCluster() {
  const playControl = document.querySelector("#q-app .player-play-button");
  if (!playControl) return;
  let cluster = document.querySelector("[" + CLUSTER_ATTR + "]");
  if (cluster && !cluster.querySelector('button[data-role="transport"]')) {
    cluster.remove();
    cluster = null;
  }
  if (!cluster) {
    ensureStyles();
    cluster = createCluster();
  }
  if (playControl.nextElementSibling !== cluster) {
    playControl.insertAdjacentElement("afterend", cluster);
  }
  if (lastState) applyState(lastState);
}

function schedulePlace() {
  if (placeTimer) clearTimeout(placeTimer);
  placeTimer = setTimeout(() => {
    placeTimer = null;
    placeCluster();
  }, 50);
}

(function init() {
  if (window.__playOnVolumioBytefmInit) return;
  window.__playOnVolumioBytefmInit = true;

  injectBridge();
  connectOverlay();
  ensureStyles();
  placeCluster();
  window.addEventListener("message", onPageMessage);
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      const button = target && typeof target.closest === "function"
        ? target.closest("[" + CLUSTER_ATTR + '] button[data-role="transport"]')
        : null;
      if (!button || button.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      onTransport(button);
    },
    true
  );
  callPage("readPlayer").then((item) => {
    if (!item || (item.mode !== "live" && item.mode !== "archive")) return;
    pageMode = item.mode;
    syncTransport();
  }).catch(() => {});

  const observer = new MutationObserver(() => schedulePlace());
  observer.observe(document.body, { childList: true, subtree: true });
})();
