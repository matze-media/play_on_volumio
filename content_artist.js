// =============================================================================
// Play on Volumio - Artist Pages (albumoftheyear.org/artist/*)
// Adds "Play on Volumio" buttons to album blocks
// =============================================================================

(async () => {
  const { volumioIp } = await chrome.storage.sync.get("volumioIp");
  if (!volumioIp) {
    console.warn("[Play on Volumio] No IP configured. Set it in extension options.");
    return;
  }

  const artistElem = document.querySelector("h1.artistHeadline");
  const albumBlocks = document.querySelectorAll(".albumBlock.small");

  if (!artistElem) return;

  const artist = artistElem.innerText.trim();

  albumBlocks.forEach((block) => {
    const albumElem = block.querySelector(".albumTitle.normal, .albumTitle");
    if (!albumElem) return;

    const album = albumElem.innerText.trim();

    const playButton = document.createElement("button");
    playButton.innerText = "▶ Play on Volumio";
    playButton.title = "Play on Volumio";
    playButton.style.cssText = `
      cursor: pointer;
      margin-left: 0;
      padding: 2px 6px;
      background: #61ce70;
      color: white;
      border: none;
      border-radius: 4px;
      font-weight: bold;
      font-size: 10px;
      vertical-align: middle;
    `;

    playButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "playAlbum", artist, album }, (response) => {
        if (response?.success) {
          playButton.innerText = "▶ Playing …";
          playButton.style.backgroundColor = "#61ce70";
          playButton.title = "Now playing: " + artist + " – " + album;
        } else {
          playButton.innerText = "✖ Failed to Play";
          playButton.title = response?.error || "Unknown error";
          playButton.style.backgroundColor = "#d76666";
        }
      });
    });

    albumElem.parentNode.insertAdjacentElement("afterend", playButton);
  });
})();
