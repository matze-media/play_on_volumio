// =============================================================================
// Play on Volumio - Similar Albums overlay for Volumio tab
// Floating button + modal to search and play similar albums
// =============================================================================

(function () {
  if (window.__playOnVolumioVolumioInjected) return;
  window.__playOnVolumioVolumioInjected = true;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const ACCENT = "#61ce70";

  // ---------------------------------------------------------------------------
  // DOM: Button + Modal
  // ---------------------------------------------------------------------------
  function isBrowsePath() {
    const path = window.location.pathname || "";
    const hash = window.location.hash || "";
    const pathMatch = (p, h) =>
      path === p || path.startsWith(p + "/") || hash === h || hash.startsWith(h + "/");
    return pathMatch("/browse", "#/browse") || pathMatch("/playback", "#/playback");
  }

  const buttonStyle = `
    padding: 8px 14px;
    background: ${ACCENT};
    color: white;
    border: none;
    border-radius: 6px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;

  const button = document.createElement("button");
  button.textContent = "Search similar album";
  button.id = "volumio-similar-btn";
  button.style.cssText = buttonStyle;

  const buttonRecentlyAdded = document.createElement("button");
  buttonRecentlyAdded.textContent = "Recently added";
  buttonRecentlyAdded.id = "volumio-recently-added-btn";
  buttonRecentlyAdded.style.cssText = buttonStyle;

  [button, buttonRecentlyAdded].forEach((btn) => {
    btn.addEventListener("mouseenter", () => { btn.style.background = "#52b861"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = ACCENT; });
  });

  const buttonContainer = document.createElement("div");
  buttonContainer.style.cssText = `
    position: fixed;
    top: 12px;
    right: 52px;
    z-index: 99998;
    display: flex;
    gap: 8px;
  `;
  buttonContainer.appendChild(buttonRecentlyAdded);
  buttonContainer.appendChild(button);

  const modalBackdrop = document.createElement("div");
  modalBackdrop.id = "volumio-similar-backdrop";
  modalBackdrop.style.cssText = `
    display: none;
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(0,0,0,0.5);
    align-items: center;
    justify-content: center;
  `;

  const modalPanel = document.createElement("div");
  modalPanel.style.cssText = `
    background: #1a1a1a;
    border-radius: 12px;
    max-width: 90vw;
    max-height: 85vh;
    width: 560px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    overflow: hidden;
  `;

  const modalHeader = document.createElement("div");
  modalHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  `;

  const modalTitle = document.createElement("h2");
  modalTitle.textContent = "Similar Albums";
  modalTitle.style.cssText = `
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 18px;
    font-weight: 600;
    color: white;
  `;

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.style.cssText = `
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: none;
    color: #999;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    border-radius: 4px;
  `;
  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.color = "white";
    closeBtn.style.background = "#333";
  });
  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.color = "#999";
    closeBtn.style.background = "transparent";
  });

  const modalBody = document.createElement("div");
  modalBody.style.cssText = `
    padding: 20px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `;

  modalHeader.appendChild(modalTitle);
  modalHeader.appendChild(closeBtn);
  modalPanel.appendChild(modalHeader);
  modalPanel.appendChild(modalBody);
  modalBackdrop.appendChild(modalPanel);

  function updateButtonVisibility() {
    buttonContainer.style.display = isBrowsePath() ? "flex" : "none";
  }

  updateButtonVisibility();
  document.body.appendChild(buttonContainer);
  document.body.appendChild(modalBackdrop);

  // Re-check on SPA navigation (Volumio may use client-side routing)
  window.addEventListener("popstate", updateButtonVisibility);
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    updateButtonVisibility();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    updateButtonVisibility();
  };

  // ---------------------------------------------------------------------------
  // Modal states
  // ---------------------------------------------------------------------------
  function showLoading(message) {
    const text = message || "Loading…";
    modalBody.innerHTML = `
      <div style="text-align:center; padding: 40px; color: #999;">
        <div style="width: 32px; height: 32px; border: 3px solid #333; border-top-color: ${ACCENT}; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px;"></div>
        <div>${escapeHtml(text)}</div>
      </div>
    `;
    addSpinKeyframes();
  }

  function addSpinKeyframes() {
    if (document.getElementById("volumio-similar-spin")) return;
    const style = document.createElement("style");
    style.id = "volumio-similar-spin";
    style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }

  function showError(message) {
    modalBody.innerHTML = `
      <div style="text-align:center; padding: 40px; color: #e74c3c;">
        <div style="font-size: 14px;">${escapeHtml(message)}</div>
      </div>
    `;
  }

  function showEmpty(message) {
    const text = message || "No similar albums found in your library.";
    modalBody.innerHTML = `
      <div style="text-align:center; padding: 40px; color: #999;">
        <div style="font-size: 14px;">${escapeHtml(text)}</div>
      </div>
    `;
  }

  function renderAlbumCard(album) {
    const card = document.createElement("div");
    card.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      padding: 12px;
      border-radius: 8px;
      transition: background 0.15s;
    `;
    card.addEventListener("mouseenter", () => {
      card.style.background = "#2a2a2a";
    });
    card.addEventListener("mouseleave", () => {
      card.style.background = "transparent";
    });

    const imgWrap = document.createElement("div");
    imgWrap.style.cssText = `
      position: relative;
      width: 120px;
      height: 120px;
      border-radius: 6px;
      overflow: hidden;
      background: #333;
      flex-shrink: 0;
    `;

    const img = document.createElement("img");
    img.alt = escapeHtml(album.title || "");
    img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
    img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect fill='%23333' width='120' height='120'/%3E%3C/svg%3E";

    if (album.albumart) {
      chrome.runtime.sendMessage({ action: "getAlbumArt", url: album.albumart }, (dataUrl) => {
        if (dataUrl && !chrome.runtime.lastError) {
          img.src = dataUrl;
        }
      });
    }

    imgWrap.appendChild(img);

    if (album.match != null && !Number.isNaN(Number(album.match))) {
      const matchVal = Number(album.match);
      const matchEl = document.createElement("div");
      matchEl.textContent = `${Math.round(matchVal)}%`;
      matchEl.style.cssText = `
        position: absolute;
        bottom: 4px;
        right: 4px;
        font-size: 10px;
        font-weight: 600;
        color: white;
        background: rgba(0,0,0,0.65);
        padding: 2px 5px;
        border-radius: 4px;
      `;
      imgWrap.appendChild(matchEl);
    }

    if (album.year) {
      const yearEl = document.createElement("div");
      yearEl.textContent = String(album.year);
      yearEl.style.cssText = `
        position: absolute;
        top: 4px;
        right: 4px;
        font-size: 10px;
        font-weight: 600;
        color: white;
        background: rgba(0,0,0,0.65);
        padding: 2px 5px;
        border-radius: 4px;
      `;
      imgWrap.appendChild(yearEl);
    }

    card.appendChild(imgWrap);

    const titleEl = document.createElement("div");
    titleEl.textContent = album.title || "—";
    titleEl.style.cssText = `
      margin-top: 8px;
      font-size: 13px;
      font-weight: 600;
      color: white;
      text-align: center;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    card.appendChild(titleEl);

    const artistEl = document.createElement("div");
    artistEl.textContent = album.artist || "";
    artistEl.style.cssText = `
      font-size: 12px;
      color: #999;
      text-align: center;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    card.appendChild(artistEl);

    card.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        { action: "playAlbum", artist: album.artist || "", album: album.title || "" },
        (res) => {
          if (res?.success) {
            hideModal();
          } else if (res?.error) {
            showError(res.error);
          }
        }
      );
    });

    return card;
  }

  function showResults(albums, currentArtist, currentAlbum, matchRate) {
    modalBody.innerHTML = "";

    if (currentArtist || currentAlbum) {
      const info = document.createElement("div");
      info.style.cssText = "margin-bottom: 16px; font-size: 13px; color: #999;";
      info.textContent = `Similar to ${escapeHtml(currentArtist || "")}${currentAlbum ? " – " + escapeHtml(currentAlbum) : ""}${matchRate != null ? ` (${matchRate}% match)` : ""}`;
      modalBody.appendChild(info);
    }

    const grid = document.createElement("div");
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    `;
    albums.forEach((album) => {
      grid.appendChild(renderAlbumCard(album));
    });
    modalBody.appendChild(grid);
  }

  // ---------------------------------------------------------------------------
  // Open / Close modal
  // ---------------------------------------------------------------------------
  const DEFAULT_MAX_SIMILAR_ALBUMS = 12;
  const DEFAULT_MAX_RECENTLY_ADDED_ALBUMS = 9;

  function showModal() {
    modalBackdrop.style.display = "flex";
    modalTitle.textContent = "Similar Albums";
    showLoading("Loading similar albums…");

    chrome.runtime.sendMessage({ action: "getSimilarAlbums" }, (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message || "Extension error");
        return;
      }
      if (!response) {
        showError("No response from extension");
        return;
      }
      if (!response.success) {
        showError(response.error || "Unknown error");
        return;
      }
      const data = response.data || {};
      const albums = data.albums || [];
      if (albums.length === 0) {
        showEmpty("No similar albums found in your library.");
      } else {
        chrome.storage.sync.get(["maxSimilarAlbums"], (res) => {
          const max = res.maxSimilarAlbums ?? DEFAULT_MAX_SIMILAR_ALBUMS;
          const limited = albums.slice(0, Math.max(1, Math.min(50, max)));
          modalBody.innerHTML = "";
          showResults(limited, data.currentArtist, data.currentAlbum, data.matchRate);
        });
      }
    });
  }

  function showModalRecentlyAdded() {
    modalBackdrop.style.display = "flex";
    modalTitle.textContent = "Recently Added Albums";
    showLoading("Loading recently added albums…");

    chrome.runtime.sendMessage({ action: "getRecentlyAddedAlbums" }, (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message || "Extension error");
        return;
      }
      if (!response) {
        showError("No response from extension");
        return;
      }
      if (!response.success) {
        showError(response.error || "Unknown error");
        return;
      }
      const data = response.data || {};
      const albums = data.albums || [];
      if (albums.length === 0) {
        showEmpty("No recently added albums found.");
      } else {
        chrome.storage.sync.get(["maxRecentlyAddedAlbums"], (res) => {
          const max = res.maxRecentlyAddedAlbums ?? DEFAULT_MAX_RECENTLY_ADDED_ALBUMS;
          const limited = albums.slice(0, Math.max(1, Math.min(50, max)));
          modalBody.innerHTML = "";
          showResults(limited, null, null, null);
        });
      }
    });
  }

  function hideModal() {
    modalBackdrop.style.display = "none";
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------
  button.addEventListener("click", showModal);
  buttonRecentlyAdded.addEventListener("click", showModalRecentlyAdded);

  closeBtn.addEventListener("click", hideModal);

  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) hideModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalBackdrop.style.display === "flex") {
      hideModal();
    }
  });
})();
