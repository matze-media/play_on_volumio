// =============================================================================
// Play on Volumio - Last.fm biography on the Volumio /playback page
// =============================================================================

(function () {
  if (window.__playOnVolumioPlaybackInfo) return;
  window.__playOnVolumioPlaybackInfo = true;

  const BUTTON_ID = "volumio-playback-info-btn";
  const EMPTY_TEXT = "Last.fm has no text for this.";

  function isPlaybackPath() {
    const path = window.location.pathname || "";
    const hash = window.location.hash || "";
    return path === "/playback" || path.startsWith("/playback/") || hash === "#/playback" || hash.startsWith("#/playback/");
  }

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (!isPlaybackPath()) {
      if (existing) existing.remove();
      return;
    }
    const bar = document.getElementById("trackButtonBar");
    if (!bar) return;
    if (bar.contains(existing)) return;
    if (existing) existing.remove();

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "btn btn-link";
    button.title = "Last.fm info";
    button.setAttribute("aria-label", "Last.fm info");
    button.innerHTML = '<i class="fa fa-info-circle" aria-hidden="true"></i>';
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openPanel();
    });
    const heart = bar.querySelector("favourite-track-btn");
    if (heart) bar.insertBefore(button, heart);
    else bar.insertBefore(button, bar.firstChild);
  }

  const backdrop = document.createElement("div");
  backdrop.id = "volumio-playback-info-backdrop";
  backdrop.style.cssText = [
    "display:none",
    "position:fixed",
    "inset:0",
    "z-index:100000",
    "background:rgba(0,0,0,0.5)",
    "align-items:center",
    "justify-content:center"
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "background:#1a1a1a",
    "border-radius:12px",
    "max-width:90vw",
    "max-height:85vh",
    "width:640px",
    "display:flex",
    "flex-direction:column",
    "box-shadow:0 8px 32px rgba(0,0,0,0.4)",
    "overflow:hidden"
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "padding:16px 20px",
    "border-bottom:1px solid #333",
    "flex-shrink:0"
  ].join(";");

  const title = document.createElement("h2");
  title.textContent = "Last.fm";
  title.style.cssText = "margin:0;font:600 18px system-ui,-apple-system,sans-serif;color:#fff";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.style.cssText = "width:32px;height:32px;padding:0;background:transparent;border:none;color:#999;font-size:24px;line-height:1;cursor:pointer;border-radius:4px";

  const body = document.createElement("div");
  body.style.cssText = "padding:8px 20px 20px;overflow-y:auto;flex:1;min-height:0";

  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);
  panel.appendChild(body);
  backdrop.appendChild(panel);

  function closePanel() {
    backdrop.style.display = "none";
  }

  closeBtn.addEventListener("click", closePanel);
  backdrop.addEventListener("click", function (event) {
    if (event.target === backdrop) closePanel();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && backdrop.style.display === "flex") closePanel();
  });

  function showLoading() {
    body.textContent = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "text-align:center;padding:40px;color:#999;font:14px system-ui,-apple-system,sans-serif";
    wrap.textContent = "Loading…";
    body.appendChild(wrap);
  }

  function showError(message) {
    body.textContent = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "text-align:center;padding:40px;color:#e74c3c;font:14px system-ui,-apple-system,sans-serif";
    wrap.textContent = message || "Last.fm info is unavailable.";
    body.appendChild(wrap);
  }

  function addChapter(headline, chapter) {
    const section = document.createElement("section");
    section.style.cssText = "padding-top:16px";
    const heading = document.createElement("h3");
    heading.textContent = headline;
    heading.style.cssText = "margin:0 0 8px;font:600 15px system-ui,-apple-system,sans-serif;color:#fff";
    const text = document.createElement("p");
    const value = chapter && chapter.text ? String(chapter.text).trim() : "";
    text.textContent = value || EMPTY_TEXT;
    text.style.cssText = "margin:0;white-space:pre-wrap;font:14px/1.5 system-ui,-apple-system,sans-serif;color:" + (value ? "#ddd" : "#888");
    section.appendChild(heading);
    section.appendChild(text);
    body.appendChild(section);
  }

  function showInfo(data) {
    body.textContent = "";
    const info = data || {};
    addChapter("Artist", info.artist);
    addChapter("Album", info.album);
    addChapter("Track", info.track);
  }

  function openPanel() {
    backdrop.style.display = "flex";
    showLoading();
    try {
      chrome.runtime.sendMessage({ action: "getPlaybackInfo" }, function (response) {
        let failure = "";
        try {
          if (chrome.runtime && chrome.runtime.lastError) failure = chrome.runtime.lastError.message || "failed";
        } catch (err) {
          failure = "invalidated";
        }
        if (backdrop.style.display !== "flex") return;
        if (failure || !response || !response.success) {
          showError((response && response.error) || failure || "Last.fm info is unavailable.");
          return;
        }
        showInfo(response.data);
      });
    } catch (err) {
      showError("Last.fm info is unavailable.");
    }
  }

  function mutationIsButton(mutation) {
    const nodes = [];
    mutation.addedNodes.forEach(function (node) { nodes.push(node); });
    mutation.removedNodes.forEach(function (node) { nodes.push(node); });
    if (!nodes.length) return false;
    return nodes.every(function (node) {
      return node && node.nodeType === 1 && (node.id === BUTTON_ID || (node.closest && node.closest("#" + BUTTON_ID)));
    });
  }

  const observer = new MutationObserver(function (mutations) {
    if (mutations.every(mutationIsButton)) return;
    ensureButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("popstate", ensureButton);
  window.addEventListener("hashchange", ensureButton);
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    ensureButton();
  };
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    ensureButton();
  };

  document.body.appendChild(backdrop);
  ensureButton();
})();
