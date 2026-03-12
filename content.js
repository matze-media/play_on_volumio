// =============================================================================
// Play on Volumio - Album Detail Page (albumoftheyear.org/album/*)
// Adds "Play on Volumio" button and per-track play icons
// =============================================================================

(async () => {
  const { volumioIp } = await chrome.storage.sync.get("volumioIp");
  if (!volumioIp) {
    console.warn("[Play on Volumio] No IP configured. Set it in extension options.");
    return;
  }

  const artistElem = document.querySelector(".albumHeadline .artist a");
  const titleElem = document.querySelector(".albumHeadline .albumTitle span");

  if (!artistElem || !titleElem) {
    console.warn("[Play on Volumio] Album info not found on this page.");
    return;
  }

  const artist = artistElem.innerText.trim();
  const album = titleElem.innerText.trim();

  // --- Album "Play on Volumio" button ---
  const button = document.createElement("button");
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

  const headline = document.querySelector(".albumHeadline");
  if (headline) headline.appendChild(button);

  // --- Per-track play icons ---
  document.querySelectorAll("td.trackTitle").forEach((cell) => {
    const trackLink = cell.querySelector("a");
    if (!trackLink) return;

    const trackName = trackLink.innerText.trim();
    const iconButton = document.createElement("span");
    iconButton.innerHTML = "▶";
    iconButton.style.cssText = `
      cursor: pointer;
      margin-left: 8px;
      color: #61ce70;
      font-weight: bold;
    `;
    iconButton.title = "Play this track on Volumio";

    iconButton.addEventListener("click", () => {
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
})();
