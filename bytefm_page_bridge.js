// =============================================================================
// Play on Volumio - ByteFM page bridge (page world)
// Reads the Vue player on #q-app. Content scripts cannot see __vue__.
// =============================================================================

(function () {
  const REQUEST = "play-on-volumio";
  const REPLY = "play-on-volumio-page";

  function getPlayer() {
    const root = document.querySelector("#q-app");
    const player = root && root.__vue__ && root.__vue__.player;
    return player || null;
  }

  function archiveTitle(info) {
    const title = String((info && info.broadcast_title) || "").trim();
    const subtitle = String((info && info.show_subtitle) || "").trim();
    if (title && subtitle) return title + " – " + subtitle;
    return title || subtitle || "ByteFM";
  }

  function playlistRowAt(player, seconds) {
    const list = player.archivePlaylist;
    if (!Array.isArray(list) || !list.length) return null;
    const t = Number(seconds);
    let chosen = null;
    if (isFinite(t) && t >= 0) {
      for (let i = 0; i < list.length; i++) {
        const row = list[i];
        if (!row || typeof row.time !== "number") continue;
        if (row.time <= t + 0.25 && (!chosen || row.time >= chosen.time)) chosen = row;
      }
    }
    if (chosen && (chosen.artist || chosen.title)) return chosen;
    return list.find((row) => row && row.play === 0) || null;
  }

  function playlistRowTime(player) {
    const current = playlistRowAt(player, NaN);
    if (!current || typeof current.time !== "number") return 0;
    return Math.floor(current.time);
  }

  let mirroredSeconds = null;
  let mirroredUri = "";
  let postedArchiveUri = null;

  function currentArchiveUri(player) {
    if (!player || player._mode !== "archive") return "";
    const part = Number(player.archivePart) || 1;
    const recordings = player.archiveInfo && player.archiveInfo.recordings;
    const recording = recordings && recordings[part - 1];
    return recording && recording.recording_url ? String(recording.recording_url) : "";
  }

  function sameRecording(left, right) {
    const a = String(left || "");
    const b = String(right || "");
    if (!a || !b) return false;
    if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
    try {
      const aUrl = new URL(a);
      const bUrl = new URL(b);
      return aUrl.hostname === bUrl.hostname && aUrl.pathname === bUrl.pathname;
    } catch (err) {
      return false;
    }
  }

  // The painted clock belongs to one recording. A different show must start
  // at its own position, not at the previous file's minute.
  function rememberArchive(player) {
    if (!player || player._mode !== "archive") {
      if (postedArchiveUri) {
        postedArchiveUri = "";
        mirroredSeconds = null;
        mirroredUri = "";
        window.postMessage({ source: REPLY, type: "archiveIdentity", uri: "" }, window.location.origin);
      }
      return "";
    }
    const uri = currentArchiveUri(player);
    if (!uri) return mirroredUri;
    if (uri === postedArchiveUri) return uri;
    const previous = mirroredUri;
    mirroredSeconds = null;
    mirroredUri = uri;
    postedArchiveUri = uri;
    if (previous && previous !== uri) {
      player._progress = 0;
      const root = document.querySelector("#q-app");
      const app = root && root.__vue__;
      if (app && !app.seeking) app.progress = 0;
    }
    window.postMessage({ source: REPLY, type: "archiveIdentity", uri }, window.location.origin);
    return uri;
  }

  function positionSeconds(player) {
    if (typeof mirroredSeconds === "number" && isFinite(mirroredSeconds)) return Math.floor(mirroredSeconds);
    const howl = player.audio && player.audio.howl;
    if (howl && typeof howl.seek === "function") {
      try {
        const t = howl.seek();
        if (typeof t === "number" && isFinite(t) && t > 0) return Math.floor(t);
      } catch (err) {
        /* Howler is not ready yet */
      }
    }
    const progress = Number(player.progress);
    if (isFinite(progress) && progress > 0) return Math.floor(progress);
    return playlistRowTime(player);
  }

  function decodeText(value) {
    const el = document.createElement("textarea");
    el.innerHTML = String(value || "");
    return el.value.replace(/\s+/g, " ").trim();
  }

  function coverUrl(src) {
    if (!src) return "";
    try {
      const url = new URL(src, "https://www.byte.fm/");
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:") return "";
      if (host !== "www.byte.fm" && !host.endsWith(".byte.fm")) return "";
      if (/blank\.png/i.test(url.pathname)) return "";
      return url.href;
    } catch (err) {
      return "";
    }
  }

  function trackInfo() {
    const player = getPlayer();
    let meta = {};
    if (player && typeof player.getMediaSessionMetadata === "function") {
      try {
        meta = player.getMediaSessionMetadata() || {};
      } catch (err) {
        meta = {};
      }
    }
    const artwork = meta.artwork && meta.artwork[0] && meta.artwork[0].src;
    const info = {
      artist: decodeText(meta.artist),
      title: decodeText(meta.title),
      album: decodeText(meta.album),
      albumart: coverUrl(artwork)
    };
    if (!player || player._mode !== "archive") return info;

    // The archive file name is a UUID. The expanded player has the song and the show.
    const row = playlistRowAt(player, positionSeconds(player));
    const program = archiveTitle(player.archiveInfo);
    if (row) {
      info.artist = decodeText(row.artist) || info.artist;
      info.title = decodeText(row.title) || info.title;
    }
    if (program && program !== "ByteFM") info.album = program;
    if (!info.albumart && player.archiveInfo) {
      info.albumart = coverUrl(player.archiveInfo.show_image || player.archiveInfo.moderator_image);
    }
    return info;
  }

  let postedTrackKey = "";
  function publishTrackInfo() {
    const info = trackInfo();
    if (!info.title && !info.artist && !info.albumart) return;
    const key = [info.artist, info.title, info.album, info.albumart].join("\n");
    if (key === postedTrackKey) return;
    postedTrackKey = key;
    window.postMessage({ source: REPLY, type: "trackInfo", info }, window.location.origin);
  }

  function installMetadataHook() {
    const player = getPlayer();
    if (!player || typeof player.updateMediaSessionMetadata !== "function") return;
    if (player.updateMediaSessionMetadata.__playOnVolumio) return;
    const original = player.updateMediaSessionMetadata;
    function wrapped() {
      const result = original.apply(player, arguments);
      try {
        publishTrackInfo();
      } catch (err) {
        /* Metadata can be read on the next update. */
      }
      return result;
    }
    wrapped.__playOnVolumio = true;
    player.updateMediaSessionMetadata = wrapped;
  }

  function readPlayer() {
    const player = getPlayer();
    if (!player) return { error: "ByteFM player is not ready." };
    rememberArchive(player);
    const info = trackInfo();

    const isArchive = player._mode === "archive";
    if (isArchive) {
      const part = Number(player.archivePart) || 1;
      const recordings = player.archiveInfo && player.archiveInfo.recordings;
      const recording = recordings && recordings[part - 1];
      const uri = recording && recording.recording_url;
      if (!uri) {
        return {
          mode: "archive",
          uri: null,
          title: archiveTitle(player.archiveInfo),
          positionSeconds: 0,
          isPlaying: playerIsAudible(player),
          artist: info.artist,
          album: info.album,
          albumart: info.albumart,
          error: "This show is not available in this session."
        };
      }
      return {
        mode: "archive",
        uri: String(uri),
        title: info.title || archiveTitle(player.archiveInfo),
        artist: info.artist,
        album: info.album || archiveTitle(player.archiveInfo),
        albumart: info.albumart,
        positionSeconds: positionSeconds(player),
        isPlaying: playerIsAudible(player),
        error: null
      };
    }

    const uri = player.store && player.store.getters && player.store.getters.streamUrl;
    if (!uri) {
      return {
        mode: "live",
        uri: null,
        title: "ByteFM",
        positionSeconds: 0,
        isPlaying: playerIsAudible(player),
        artist: info.artist,
        album: info.album,
        albumart: info.albumart,
        error: "Live stream URL is not available."
      };
    }
    return {
      mode: "live",
      uri: String(uri),
      title: info.title || "ByteFM",
      artist: info.artist,
      album: info.album || "ByteFM",
      albumart: info.albumart,
      positionSeconds: 0,
      isPlaying: playerIsAudible(player),
      error: null
    };
  }

  function playerIsAudible(player) {
    return player._isPlaying === true || player.action === "play";
  }

  function pageMode(player) {
    if (player && typeof player.isArchive === "function" && player.isArchive()) return "archive";
    return "live";
  }

  // ByteFM has no pause() method. stop() without force pauses an archive
  // show and unloads the live stream. stop(true) would unload the archive too.
  function pauseLocal() {
    const player = getPlayer();
    if (!player) return { paused: false, mode: "live" };
    const mode = pageMode(player);
    if (typeof player.stop === "function") {
      player.stop();
      return { paused: true, mode };
    }
    const howl = player.audio && player.audio.howl;
    if (howl && typeof howl.stop === "function") {
      howl.stop();
      return { paused: true, mode };
    }
    if (howl && typeof howl.pause === "function") {
      howl.pause();
      return { paused: true, mode };
    }
    return { paused: false, mode };
  }

  let postedMode = null;
  function publishMode() {
    const player = getPlayer();
    if (!player) return;
    const mode = pageMode(player);
    if (mode === postedMode) return;
    postedMode = mode;
    window.postMessage({ source: REPLY, type: "playerMode", mode }, window.location.origin);
  }

  function findProgressBars(vm, out) {
    if (!vm) return;
    if (vm.$options && vm.$options.name === "ProgressBar") out.push(vm);
    const children = vm.$children || [];
    for (let i = 0; i < children.length; i++) findProgressBars(children[i], out);
  }

  function showPosition(payload) {
    const player = getPlayer();
    const root = document.querySelector("#q-app");
    const app = root && root.__vue__;
    if (!player || !app || player._mode !== "archive") return;
    const pageUri = rememberArchive(player);
    const clockUri = payload && payload.uri ? String(payload.uri) : "";
    if (!pageUri || !clockUri || !sameRecording(clockUri, pageUri)) return;
    if (app.seeking) return;
    const bars = [];
    findProgressBars(app, bars);
    if (bars.some((bar) => bar.isDragging)) return;
    const seconds = Number(payload && payload.seconds);
    const duration = Number(payload && payload.duration);
    if (!isFinite(seconds) || seconds < 0) return;
    if (player.audio) {
      player.audio.isSeekablePaused = true;
      player.audio.progressReliableAfterSeek = true;
    }
    if (isFinite(duration) && duration > 0 && player._duration !== duration) player.duration = duration;
    mirroredSeconds = seconds;
    app.progress = seconds;
    player._progress = seconds;
    publishTrackInfo();
  }

  function publishTrackPosition(app, relative) {
    if (!app || !app.uncollapsed) return;
    const player = app.player;
    if (!player || player._mode !== "archive") return;
    const duration = Number(player.duration);
    const rel = Number(relative);
    if (!isFinite(duration) || duration <= 0 || !isFinite(rel)) return;
    const seconds = Math.max(0, Math.floor(rel * duration));
    window.postMessage({ source: REPLY, type: "trackPosition", seconds }, window.location.origin);
  }

  function installTransportHook() {
    const player = getPlayer();
    if (!player || typeof player.toggle !== "function" || player.toggle.__playOnVolumio) return;
    const original = player.toggle;
    function wrapped() {
      const wasPlaying = player._isPlaying === true || player.action === "play";
      const result = original.apply(player, arguments);
      if (wasPlaying) {
        window.postMessage({ source: REPLY, type: "localStopped" }, window.location.origin);
      }
      return result;
    }
    wrapped.__playOnVolumio = true;
    player.toggle = wrapped;
  }

  function installSeekHook() {
    const root = document.querySelector("#q-app");
    const app = root && root.__vue__;
    if (!app) return;
    const bars = [];
    findProgressBars(app, bars);
    bars.forEach((bar) => {
      if (bar.__playOnVolumio) return;
      bar.__playOnVolumio = true;
      bar.$on("change", (relative) => publishTrackPosition(app, relative));
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== REQUEST) return;
    if (data.type === "showPosition") {
      try {
        showPosition(data.payload);
      } catch (err) {
        /* The bar can be missing while Vue re-renders. */
      }
      return;
    }
    if (data.type !== "readPlayer" && data.type !== "pauseLocal") return;

    let payload;
    try {
      payload = data.type === "readPlayer" ? readPlayer() : pauseLocal();
    } catch (err) {
      payload = { error: (err && err.message) || "Player error" };
    }
    window.postMessage(
      { source: REPLY, type: data.type, requestId: data.requestId, payload },
      window.location.origin
    );
  });

  let hookTimer = null;
  function scheduleSeekHook() {
    if (hookTimer) clearTimeout(hookTimer);
    hookTimer = setTimeout(() => {
      hookTimer = null;
      installSeekHook();
      installTransportHook();
      installMetadataHook();
      rememberArchive(getPlayer());
      publishMode();
      publishTrackInfo();
    }, 100);
  }

  installSeekHook();
  installTransportHook();
  installMetadataHook();
  rememberArchive(getPlayer());
  publishMode();
  publishTrackInfo();
  const hookObserver = new MutationObserver(() => scheduleSeekHook());
  hookObserver.observe(document.body, { childList: true, subtree: true });
})();
