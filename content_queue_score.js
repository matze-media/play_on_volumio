// =============================================================================
// Play on Volumio - Last.fm popularity bars on the Volumio /queue page
// =============================================================================

(function () {
  if (window.__playOnVolumioQueueScore) return;
  window.__playOnVolumioQueueScore = true;

  const ACCENT = "#61ce70";
  const BAR_CLASS = "volumio-popularity-bar";
  const FLEX_SLOT = 184;

  function isQueuePath() {
    const path = window.location.pathname || "";
    const hash = window.location.hash || "";
    return path === "/queue" || path.startsWith("/queue/") || hash === "#/queue" || hash.startsWith("#/queue/");
  }

  function isBrowsePath() {
    const path = window.location.pathname || "";
    const hash = window.location.hash || "";
    return path === "/browse" || path.startsWith("/browse/") || hash === "#/browse" || hash.startsWith("#/browse/");
  }

  function isScorePath() {
    return isQueuePath() || isBrowsePath();
  }

  function flat(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function formatCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return number.toLocaleString();
  }

  function clearBars() {
    const bars = document.querySelectorAll("." + BAR_CLASS);
    for (let i = 0; i < bars.length; i++) bars[i].remove();
  }

  function findRows(queue) {
    const titles = document.querySelectorAll("#playQueueList .title");
    return queue.map((item, index) => {
      const byId = document.getElementById("itemQueue-" + index);
      if (byId) return byId;
      const title = titles[index];
      if (!title) return null;
      const expected = flat(item && (item.name || item.title));
      if (expected && flat(title.textContent) !== expected) return null;
      return title.closest ? title.closest("li") : null;
    });
  }

  function makeFlexSlot() {
    const slot = document.createElement("div");
    slot.className = BAR_CLASS;
    slot.style.cssText = "flex:0 0 " + FLEX_SLOT + "px;width:" + FLEX_SLOT + "px;height:22px;margin:0 12px;";
    return slot;
  }

  function makeBar(popularity, layout) {
    const score = Math.max(0, Math.min(100, Number(popularity.score) || 0));
    const bar = document.createElement("div");
    const width = layout === "flex"
      ? Math.round(64 + (score / 100) * (FLEX_SLOT - 64)) + "px"
      : "max(72px, " + (Math.max(score, 8) * 0.42) + "%)";
    bar.style.cssText = [
      "position:relative",
      "height:22px",
      "width:" + width,
      "box-sizing:border-box",
      "border-radius:4px",
      "background:rgba(97,206,112,0.22)",
      "overflow:hidden"
    ].join(";");
    if (layout !== "flex") {
      bar.className = BAR_CLASS;
      bar.title = formatCount(popularity.playcount) + " plays";
      bar.style.cssText += ";position:absolute;right:56px;top:50%;transform:translateY(-50%);max-width:46%;pointer-events:auto;z-index:2";
    }
    const fill = document.createElement("div");
    fill.style.cssText = [
      "position:absolute",
      "left:0",
      "top:0",
      "bottom:0",
      "width:100%",
      "background:" + ACCENT,
      "opacity:0.45"
    ].join(";");
    const label = document.createElement("div");
    label.textContent = formatCount(popularity.listeners);
    label.style.cssText = [
      "position:relative",
      "z-index:1",
      "padding:0 8px",
      "font:600 12px/22px system-ui,-apple-system,sans-serif",
      "color:#fff",
      "white-space:nowrap"
    ].join(";");
    bar.appendChild(fill);
    bar.appendChild(label);
    if (layout !== "flex") return bar;
    const slot = makeFlexSlot();
    slot.title = formatCount(popularity.playcount) + " plays";
    slot.style.display = "flex";
    slot.style.justifyContent = "flex-end";
    slot.style.alignItems = "center";
    slot.appendChild(bar);
    return slot;
  }

  function paint(queue) {
    painting = true;
    try {
      clearBars();
      if (!isQueuePath() || !Array.isArray(queue)) return;
      const rows = findRows(queue);
      for (let i = 0; i < queue.length; i++) {
        const popularity = queue[i] && queue[i].popularity;
        const row = rows[i];
        if (!popularity || !row || row.querySelector("." + BAR_CLASS)) continue;
        const position = window.getComputedStyle(row).position;
        if (position === "static") row.style.position = "relative";
        row.appendChild(makeBar(popularity, "overlay"));
      }
    } finally {
      painting = false;
    }
  }

  function browseTrackRows() {
    const headerAlbum = flat((document.querySelector(".header__album") || {}).textContent);
    const headerArtist = flat((document.querySelector(".header__artist") || {}).textContent);
    const nodes = document.querySelectorAll("#browse-page .album__tracks .music-item");
    const rows = [];
    for (let i = 0; i < nodes.length; i++) {
      const row = nodes[i];
      if (row.classList.contains("title")) continue;
      const titleEl = row.querySelector(".item__title");
      if (!titleEl) continue;
      const title = flat(titleEl.getAttribute("title") || titleEl.textContent);
      const album = flat((row.querySelector(".item__album") || {}).textContent) || headerAlbum;
      let artist = flat((row.querySelector(".item__artist") || {}).textContent);
      if (headerArtist && headerAlbum && album.toLowerCase() === headerAlbum.toLowerCase()) artist = headerArtist;
      if (!title || !album || !artist) continue;
      rows.push({ row: row, title: title, album: album, artist: artist });
    }
    return rows;
  }

  function paintBrowse(requestedRows, groups) {
    painting = true;
    try {
      clearBars();
      if (!isBrowsePath()) return;
      const live = browseTrackRows();
      const used = new Set();
      for (let i = 0; i < live.length; i++) {
        const row = live[i];
        let score = null;
        for (let j = 0; j < requestedRows.length; j++) {
          if (used.has(j)) continue;
          const wanted = requestedRows[j];
          if (wanted.title !== row.title) continue;
          if (wanted.album.toLowerCase() !== row.album.toLowerCase()) continue;
          const group = groups[wanted.group];
          score = group && group.scores ? group.scores[wanted.scoreIndex] : null;
          used.add(j);
          break;
        }
        if (row.row.querySelector("." + BAR_CLASS)) continue;
        const bar = score ? makeBar(score, "flex") : makeFlexSlot();
        const duration = row.row.querySelector(".item__duration");
        if (duration) row.row.insertBefore(bar, duration);
        else row.row.appendChild(bar);
      }
    } finally {
      painting = false;
    }
  }

  let painting = false;
  let requestGen = 0;
  let timer = null;
  let inFlight = false;
  let dirty = false;
  let stopped = false;
  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    observer.disconnect();
    try {
      painting = true;
      clearBars();
    } catch (err) {
      /* the page may already be going away */
    }
    painting = false;
  }

  function browseRequest() {
    const rows = browseTrackRows();
    const groups = [];
    const groupIndex = new Map();
    rows.forEach(function (entry) {
      const key = entry.artist.toLowerCase() + "\n" + entry.album.toLowerCase();
      if (!groupIndex.has(key)) {
        groupIndex.set(key, groups.length);
        groups.push({ artist: entry.artist, album: entry.album, titles: [] });
      }
      const index = groupIndex.get(key);
      entry.group = index;
      entry.scoreIndex = groups[index].titles.length;
      groups[index].titles.push(entry.title);
    });
    return { rows: rows, groups: groups };
  }

  function refresh() {
    if (stopped) return;
    if (!isQueuePath() && !isBrowsePath()) {
      painting = true;
      clearBars();
      painting = false;
      return;
    }
    if (inFlight) {
      dirty = true;
      return;
    }
    const browse = isBrowsePath() ? browseRequest() : null;
    if (browse && !browse.groups.length) {
      painting = true;
      clearBars();
      painting = false;
      return;
    }
    inFlight = true;
    const gen = ++requestGen;
    const message = browse
      ? { action: "getBrowsePopularity", groups: browse.groups }
      : { action: "getQueuePopularity" };
    try {
      chrome.runtime.sendMessage(message, (response) => {
        let failure = "";
        try {
          if (chrome.runtime && chrome.runtime.lastError) failure = chrome.runtime.lastError.message || "failed";
        } catch (err) {
          failure = "invalidated";
        }
        inFlight = false;
        if (failure && /invalidated/i.test(failure)) {
          stop();
          return;
        }
        if (stopped || gen !== requestGen || !isScorePath()) {
          if (dirty && !stopped && isScorePath()) {
            dirty = false;
            schedule();
          }
          return;
        }
        if (failure || !response || !response.success) {
          painting = true;
          clearBars();
          painting = false;
          return;
        }
        try {
          const data = response.data || {};
          if (browse) paintBrowse(browse.rows, data.groups || []);
          else paint(data.queue || []);
        } catch (err) {
          painting = true;
          clearBars();
          painting = false;
        }
        if (dirty && !stopped && isScorePath()) {
          dirty = false;
          schedule();
        }
      });
    } catch (err) {
      inFlight = false;
      stop();
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  }

  function mutationIsOurs(mutation) {
    const nodes = [];
    mutation.addedNodes.forEach((node) => nodes.push(node));
    mutation.removedNodes.forEach((node) => nodes.push(node));
    if (!nodes.length) return false;
    return nodes.every((node) => {
      if (!node || node.nodeType !== 1) return false;
      return node.classList.contains(BAR_CLASS) || (node.closest && node.closest("." + BAR_CLASS));
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (painting) return;
    if (mutations.every(mutationIsOurs)) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    schedule();
  };
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    schedule();
  };

  if (isQueuePath() || isBrowsePath()) schedule();
})();
