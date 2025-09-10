function getOverlayHTML(track) {
  const vol = Number(track?.volume ?? 0);
  const duration = Number(track?.duration ?? 0);
  const seekSec = Number(Math.floor((track?.seek ?? 0) / 1000));
  const seekMin = formatTime(seekSec);
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
      padding: 0px;
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

    /* Progress slider */
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

    /* Custom vertical volume slider */
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
        <div style="font-weight:bold; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="Artist - Album">
          ${escapeHtml((track.artist || "") + " — " + (track.album || ""))}
        </div>
        <div style="font-size:12px; color:white; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="Trackinfo">
          ${escapeHtml(track.title || "")}
        </div>
        <input
          id="volumio-progress"
          class="progress-slider"
          type="range"
          min="0"
          max="${progMax}"
          title="${seekMin}"
          style="--val:${progPct}%"
          aria-label="Track position"
        />
      </div>

      <div class="controls-row">
        <div class="vertical-controls">
          <span id="volumio-previous" class="material-icons" title="Previous">skip_previous</span>
          <span id="volumio-playpause" class="material-icons" title="Play/Pause">${track.status === "play" ? "pause" : "play_arrow"}</span>
          <span id="volumio-next" class="material-icons" title="Next">skip_next</span>
        </div>

        <div id="volumio-slider-wrap" class="vol-wrap" aria-label="Volume" title="Volume:${volPct}">
          <div class="vol-fill" title="Volume:${volPct}" ></div>
          <div id="vol-thumb" title="Volume:${volPct}" class="vol-thumb"></div>
        </div>
      </div>
    </div>
  </div>
  `;
}


/* small helper to avoid injecting raw HTML from track metadata */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Overlay Setup
const overlay = document.createElement("div");
overlay.style.cssText = `
  position: fixed;
  top: 6px;
  left: 6px;
  background: rgba(56, 154, 69 ,0.85);
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
document.body.appendChild(overlay);

let currentTrack = null;
let timer = null;
let progressInterval = null;

// Format seconds to mm:ss
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2,"0")}`;
}



// Update overlay
function updateOverlay(track) {
  if (!track || !track.title) return;
  currentTrack = track;

  if (timer) clearInterval(timer);

  overlay.innerHTML = getOverlayHTML(track);

  // Previous button
  document.getElementById("volumio-previous").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "prev" }, (response) => {
      if (!response.success) console.info("Prev failed:", response.error);
    });
  });

  // Next button
  document.getElementById("volumio-next").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "next" }, (response) => {
      if (!response.success) console.info("Next failed:", response.error);
    });
  });

  const btn = document.getElementById("volumio-playpause");
  btn.addEventListener("click", () => {
    if (!currentTrack) return;
    const action = currentTrack.status === "play" ? "pause" : "play";
    chrome.runtime.sendMessage({ action }, (res) => {
      if (res.success) {
        currentTrack.status = currentTrack.status === "play" ? "pause" : "play";
        btn.innerText = currentTrack.status === "play" ? "⏸" : "▶";
      } else {
        console.warn("Play/Pause command failed:", res.error);
      }
    });
  });

  // Progress-Bar initialisieren
  const progressEl = document.getElementById("volumio-progress");
  if (progressEl) {
    const duration = track.duration || 0;
    const seekSec = Math.floor((track.seek || 0) / 1000);
    const seekMin = formatTime(seekSec);
    const pct = duration > 0 ? (Math.trunc((seekSec / duration) * 100)) : 0;

    progressEl.max = duration;
    //progressEl.value = seekSec;
    progressEl.title = seekMin;
    progressEl.style.setProperty("--val", `${pct}%`);

    // Scrubben erlauben
    progressEl.addEventListener("input", (e) => {
      const newSeek = parseInt(e.target.value, 10);
      chrome.runtime.sendMessage({ action: "seek", value: newSeek });
    });
  }

  // Bisheriges Interval stoppen
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }


  const volWrap = document.getElementById('volumio-slider-wrap');
  const volThumb = document.getElementById('vol-thumb');
  const volFill = volWrap.querySelector('.vol-fill');

  function setVolumeByY(y) {
    const rect = volWrap.getBoundingClientRect();
    const height = rect.height;
    let pct = 1 - (y / height); // oben=100%, unten=0%
    pct = Math.max(0, Math.min(1, pct));
    volThumb.style.bottom = (pct * 100) + '%';
    volFill.style.height = (pct * 100) + '%';
    const volValue = Math.round(pct * 100);
    console.info("Volume: " + volValue);
    chrome.runtime.sendMessage({action:"setVolume", value:volValue});
  }

  // Click on track
  volWrap.addEventListener('click', e => {
    const rect = volWrap.getBoundingClientRect();
    setVolumeByY(e.clientY - rect.top);
  });

  // Drag thumb
  volThumb.addEventListener('mousedown', e => {
    e.preventDefault();
    function onMove(eMove) { setVolumeByY(eMove.clientY - volWrap.getBoundingClientRect().top); }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });



  // Neues Interval starten, wenn playing
  if (track.status === "play" && progressEl) {
    let currentSeek = Math.floor((track.seek || 0) / 1000);
    
    progressInterval = setInterval(() => {
      currentSeek++;
      let currentSeekMin = formatTime(currentSeek);
      if (currentSeek <= (track.duration || 0)) {
        const pct = track.duration > 0 ? (Math.trunc((currentSeek / track.duration * 100))): 0;
        //progressEl.value = currentSeek;
        progressEl.title = currentSeekMin;
        progressEl.style.setProperty("--val", `${pct}%`);
      }
    }, 1000);
  }


  // Timer increments locally
  timer = setInterval(() => {
    if (!currentTrack || currentTrack.status !== "play") return;
    currentTrack.seek += 1000;
    const secLeft = Math.max(0, currentTrack.duration - Math.floor(currentTrack.seek / 1000));
    const span = document.getElementById("volumio-remaining");
    if (span) span.innerText = formatTime(secLeft);
  }, 1000);
}

// Connect to background worker
const port = chrome.runtime.connect({ name: "volumioOverlay" });
port.onMessage.addListener((msg) => {
  if (msg.action === "nowPlaying") {
    updateOverlay(msg.data);
  }
});

// Handshake: request current state immediately
port.postMessage({ action: "requestCurrentState" });

// -----------------------------
// Add Play Buttons for Albums
// -----------------------------
(async () => {
  const { volumioIp } = await chrome.storage.sync.get("volumioIp");
  if (!volumioIp) return;

  function createPlayButton(artist, album) {
    const button = document.createElement("button");
    button.innerText = "▶";
    button.title = "Play on Volumio";
    button.style.cssText = `
      cursor:pointer;
      margin-left:5px;
      padding:2px 6px;
      font-size:12px;
      color:white;
      font-weight:bold;
      border:none;
      border-radius:4px;
      background:transparent;
    `;
    button.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        { action: "playAlbum", volumioIp, artist, album },
        (res) => {
          if (res.success) button.title = `Now playing: ${artist} - ${album}`;
          else { button.title = res.error; button.style.color = "#d76666"; }
        }
      );
    });
    return button;
  }

  // Album Detail Page
  const artistElem = document.querySelector(".albumHeadline .artist a");
  const titleElem = document.querySelector(".albumHeadline .albumTitle span");
  if (artistElem && titleElem) {
    const artist = artistElem.innerText.trim();
    const album = titleElem.innerText.trim();
    const button = createPlayButton(artist, album);
    const headline = document.querySelector(".albumHeadline");
    if (headline) headline.appendChild(button);
  }

  // Album Lists / Ratings Pages
  const albumBlocks = document.querySelectorAll(".albumBlock");
  albumBlocks.forEach(block => {
    const artistElem = block.querySelector(".artistTitle");
    const albumElem = block.querySelector(".albumTitle");
    if (artistElem && albumElem) {
      const artist = artistElem.innerText.trim();
      const album = albumElem.innerText.trim();
      const button = createPlayButton(artist, album);
      albumElem.parentNode.insertBefore(button, albumElem.nextSibling);
    }
  });
})();
