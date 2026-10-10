// =============================================================================
// Play on Volumio - Ratings & List Pages (albumoftheyear.org/ratings/*, list/*)
// Adds Volumio chip in .albumListLinks (Amazon/Spotify row)
// =============================================================================

const STYLE_ID = "play-on-volumio-ratings-style";
const BTN_ATTR = "data-play-on-volumio";
const GREEN = "#61ce70";
const GREEN_BORDER = "#52b860";
const RED = "#d76666";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .albumListLinks button[${BTN_ATTR}] {
      background: none;
      border: none;
      padding: 0;
      margin: 0;
      cursor: pointer;
      font: inherit;
      color: inherit;
    }
    .albumListLinks div.playOnVolumio {
      background: ${GREEN};
      color: #fff;
      border-color: ${GREEN_BORDER};
      font-weight: bold;
    }
    .albumListLinks div.playOnVolumio.is-error {
      background: ${RED};
      border-color: ${RED};
    }
  `;
  document.head.appendChild(style);
}

function parseArtistAlbum(linkElem) {
  const meta = linkElem.closest("h2.albumListTitle")?.querySelector('meta[itemprop="name"]');
  const fullText = (
    linkElem.textContent ||
    linkElem.innerText ||
    meta?.getAttribute("content") ||
    ""
  ).trim();
  const parts = fullText.split(/\s*[-–]\s*/).map((s) => s.trim());
  if (parts.length < 2) return null;
  const artist = parts[0];
  const album = parts.slice(1).join(" – ");
  if (!artist || !album) return null;
  return { artist, album };
}

function removeLegacyTitleButtons() {
  document.querySelectorAll("h2.albumListTitle button:not([" + BTN_ATTR + "])").forEach((btn) => btn.remove());
}

function createVolumioButton(artist, album) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(BTN_ATTR, "1");
  button.title = "Play on Volumio";

  const face = document.createElement("div");
  face.className = "playOnVolumio";
  face.innerHTML = '<i class="fas fa-play"></i><span>Volumio</span>';

  const labelSpan = face.querySelector("span");

  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "playAlbum", artist, album }, (response) => {
      if (response?.success) {
        labelSpan.textContent = "Playing …";
        button.title = "Now playing: " + artist + " – " + album;
        face.classList.remove("is-error");
      } else {
        labelSpan.textContent = "Failed";
        button.title = response?.error || "Unknown error";
        face.classList.add("is-error");
      }
    });
  });

  button.appendChild(face);
  return button;
}

function injectAll() {
  ensureStyles();
  removeLegacyTitleButtons();

  document.querySelectorAll("div.albumListLinks").forEach((container) => {
    if (container.querySelector("button[" + BTN_ATTR + "]")) return;

    const row = container.closest(".albumListRow");
    const linkElem = row?.querySelector("h2.albumListTitle a[itemprop='url']");
    if (!linkElem) return;

    const meta = parseArtistAlbum(linkElem);
    if (!meta) return;

    container.appendChild(createVolumioButton(meta.artist, meta.album));
  });
}

function allLinksDecorated() {
  const containers = document.querySelectorAll("div.albumListLinks");
  if (containers.length === 0) return false;
  return [...containers].every((c) => c.querySelector("button[" + BTN_ATTR + "]"));
}

(async () => {
  if (window.__playOnVolumioRatingsInit) return;
  window.__playOnVolumioRatingsInit = true;

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
      injectAll();
      if (allLinksDecorated() || Date.now() - start > OBSERVE_MS) {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      }
    }, 200);
  }

  injectAll();

  observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
})();
