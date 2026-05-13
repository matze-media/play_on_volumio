// =============================================================================
// Play on Volumio - Album Detail Page (albumoftheyear.org/album/*)
// Adds "Play on Volumio" button and per-track play icons
// Resilient selectors + MutationObserver for DOM / hydration changes
// =============================================================================

const ALBUM_BTN_ID = "play-on-volumio-album-btn";
const ICON_ATTR = "data-play-on-volumio-track";

function textContent(el) {
  if (!el) return "";
  return String(el.innerText || el.textContent || "").trim();
}

function parseOgTitle() {
  const meta = document.querySelector('meta[property="og:title"]');
  if (!meta || !meta.content) return null;
  let raw = meta.content.trim();
  raw = raw.split("|")[0].trim();
  const parts = raw.split(/\s+[–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), album: parts.slice(1).join(" – ").trim() };
  }
  const hyphen = raw.split(/\s+-\s+/);
  if (hyphen.length >= 2) {
    return { artist: hyphen[0].trim(), album: hyphen.slice(1).join(" - ").trim() };
  }
  return null;
}

function isExcludedArtistLink(anchor) {
  if (!anchor || !anchor.href) return true;
  if (anchor.closest("footer") || anchor.closest("header")) return true;
  if (anchor.closest('[class*="credit"]') || anchor.closest(".fullCredits")) return true;
  if (anchor.closest(".userReview") || anchor.closest("#comments")) return true;
  return false;
}

function findMainColumn() {
  return (
    document.querySelector(".albumHeadline") ||
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector("#content") ||
    document.querySelector("#mainBody") ||
    document.querySelector(".page") ||
    document.body
  );
}

function findAlbumTitleElement() {
  const legacy = document.querySelector(".albumHeadline .albumTitle span");
  if (legacy) return legacy;
  const albumTitle = document.querySelector(".albumHeadline .albumTitle");
  if (albumTitle) return albumTitle;
  const ah1 = document.querySelector(".albumHeadline h1");
  if (ah1) return ah1;
  return (
    document.querySelector("article h1") ||
    document.querySelector("main h1") ||
    document.querySelector("#content h1") ||
    document.querySelector(".page h1") ||
    document.querySelector("h1")
  );
}

function findArtistLinkForAlbum(mount, titleEl) {
  const trySelectors = [
    ".albumHeadline .artist a",
    ".albumHeadline .artistTitle a",
    ".albumHeadline a[href*='/artist/']",
    ".albumArtist a",
    "[class*='albumHead'] a[href*='/artist/']"
  ];
  for (const sel of trySelectors) {
    const a = document.querySelector(sel);
    if (a && !isExcludedArtistLink(a)) return a;
  }
  const scope = mount || findMainColumn();
  const links = scope.querySelectorAll("a[href*='/artist/']");
  for (const a of links) {
    if (isExcludedArtistLink(a)) continue;
    if (titleEl && titleEl.contains(a)) continue;
    if (a.closest("td") && a.closest("td").classList?.contains?.("trackTitle")) continue;
    return a;
  }
  return null;
}

function findButtonMount(mountHint, titleEl) {
  const legacy = document.querySelector(".albumHeadline");
  if (legacy) return legacy;
  if (mountHint) return mountHint;
  if (titleEl) {
    const p = titleEl.parentElement;
    if (p) return p;
  }
  return findMainColumn();
}

function resolveArtistAlbum() {
  const titleEl = findAlbumTitleElement();
  const mount = titleEl
    ? titleEl.closest(".albumHeadline") || titleEl.closest("article") || titleEl.closest("main") || titleEl.parentElement
    : findMainColumn();

  const artistFromLink = findArtistLinkForAlbum(mount, titleEl);
  const albumFromDom = titleEl ? textContent(titleEl) : "";

  if (artistFromLink && albumFromDom) {
    return {
      artist: textContent(artistFromLink),
      album: albumFromDom,
      mount: findButtonMount(mount, titleEl)
    };
  }

  const og = parseOgTitle();
  if (og && og.artist && og.album) {
    return {
      artist: og.artist,
      album: og.album,
      mount: findButtonMount(document.querySelector(".albumHeadline") || mount, titleEl)
    };
  }

  return null;
}

function ensureAlbumButton(artist, album, mount) {
  if (document.getElementById(ALBUM_BTN_ID)) return;

  const button = document.createElement("button");
  button.id = ALBUM_BTN_ID;
  button.innerText = "▶ Play on Volumio";
  button.style.cssText = `
    margin: 4px 10px 0 0;
    padding: 8px 12px;
    background: #61ce70;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: bold;
    font-size: 14px;
  `;

  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "playAlbum", artist, album }, (response) => {
      if (response?.success) {
        button.innerText = "▶ Playing …";
        button.title = "Now playing: " + response.message;
        button.style.backgroundColor = "#61ce70";
      } else {
        button.innerText = "✖ Failed to Play";
        button.title = response?.error || "Unknown error";
        button.style.backgroundColor = "#d76666";
      }
    });
  });

  if (mount && mount.appendChild) {
    mount.appendChild(button);
  } else {
    document.body.appendChild(button);
  }
}

const TRACK_CONTAINER_SELECTORS = [
  "td.trackTitle",
  "div.trackTitle",
  "th.trackTitle",
  ".trackList .trackTitle",
  "tr[class*='track'] td:first-child",
  "li[class*='track']"
];

function collectSongAnchors() {
  const roots = new Set();
  for (const sel of TRACK_CONTAINER_SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => roots.add(el));
  }
  const fromContainers = [];
  roots.forEach((cell) => {
    const a = cell.querySelector('a[href*="/song/"]');
    if (a) fromContainers.push(a);
  });

  const mainScope =
    document.querySelector("#tracklist") ||
    document.querySelector(".trackList") ||
    document.querySelector('[class*="trackList"]') ||
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector("#content") ||
    findMainColumn();

  const broad = mainScope.querySelectorAll('a[href*="/song/"]');
  const merged = new Map();
  function add(a) {
    if (!a || !a.href) return;
    if (a.closest("footer") || a.closest("header")) return;
    try {
      const u = new URL(a.href, location.origin);
      if (!u.pathname.includes("/song/")) return;
      const key = u.pathname;
      if (!merged.has(key)) merged.set(key, a);
    } catch {
      merged.set(a.href, a);
    }
  }
  fromContainers.forEach(add);
  broad.forEach(add);

  return Array.from(merged.values());
}

function injectTrackIcons(artist, album) {
  collectSongAnchors().forEach((trackLink) => {
    if (trackLink.getAttribute(ICON_ATTR) === "1") return;

    const trackName = textContent(trackLink);
    if (!trackName) return;

    trackLink.setAttribute(ICON_ATTR, "1");

    const iconButton = document.createElement("span");
    iconButton.innerHTML = "▶";
    iconButton.style.cssText = `
      cursor: pointer;
      margin-left: 8px;
      color: #61ce70;
      font-weight: bold;
    `;
    iconButton.title = "Play this track on Volumio";

    iconButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage(
        { action: "playTrack", artist, album, track: trackName },
        (response) => {
          if (response?.success) {
            iconButton.title = "Now playing: " + trackName;
            iconButton.style.color = "#61ce70";
          } else {
            iconButton.title = response?.error || "Failed";
            iconButton.style.color = "#d76666";
          }
        }
      );
    });

    trackLink.insertAdjacentElement("afterend", iconButton);
  });
}

function trySetup() {
  const meta = resolveArtistAlbum();
  if (!meta) return false;
  ensureAlbumButton(meta.artist, meta.album, meta.mount);
  injectTrackIcons(meta.artist, meta.album);
  return true;
}

(async () => {
  if (window.__playOnVolumioAlbumInit) return;
  window.__playOnVolumioAlbumInit = true;

  const { volumioIp } = await chrome.storage.sync.get("volumioIp");
  if (!volumioIp) {
    console.warn("[Play on Volumio] No IP configured. Set it in extension options.");
    return;
  }

  let debounceTimer = null;
  let observer = null;
  const OBSERVE_MS = 12000;
  const start = Date.now();

  function schedule() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const ok = trySetup();
      const songCount = collectSongAnchors().length;
      const btn = document.getElementById(ALBUM_BTN_ID);
      if (ok && btn && (songCount > 0 || Date.now() - start > OBSERVE_MS)) {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      }
      if (Date.now() - start > OBSERVE_MS && observer) {
        observer.disconnect();
        observer = null;
      }
    }, 200);
  }

  trySetup();

  observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
})();
