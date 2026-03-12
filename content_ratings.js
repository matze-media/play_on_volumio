// =============================================================================
// Play on Volumio - Ratings & List Pages (albumoftheyear.org/ratings/*, list/*)
// Adds "Play on Volumio" buttons to album headers
// =============================================================================

(async () => {
  const { volumioIp } = await chrome.storage.sync.get("volumioIp");
  if (!volumioIp) {
    console.warn("[Play on Volumio] No IP configured. Set it in extension options.");
    return;
  }

  const albumHeaders = document.querySelectorAll("h2.albumListTitle");

  albumHeaders.forEach((header) => {
    const linkElem = header.querySelector("a[itemprop='url']");
    if (!linkElem) return;

    const fullText = linkElem.innerText.trim();
    const [artist, album] = fullText.split(/\s*[-–]\s*/).map((s) => s.trim());
    if (!artist || !album) return;

    const button = document.createElement("button");
    button.innerText = "▶ Play on Volumio";
    button.style.cssText = `
      margin-left: 10px;
      padding: 5px 8px;
      background: #61ce70;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      vertical-align: middle;
    `;

    button.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "playAlbum", artist, album }, (response) => {
        if (response?.success) {
          button.innerText = "▶ Playing …";
          button.title = "Now playing: " + artist + " – " + album;
          button.style.backgroundColor = "#61ce70";
        } else {
          button.innerText = "✖ Failed to Play";
          button.title = response?.error || "Unknown error";
          button.style.backgroundColor = "#d76666";
        }
      });
    });

    linkElem.insertAdjacentElement("afterend", button);
  });
})();
