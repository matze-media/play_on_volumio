(async () => {
  const { volumioIp } = await chrome.storage.sync.get("volumioIp");

  if (!volumioIp) {
    console.warn("No Volumio-IP configured within the options.");
    return;
  }

  console.info("Scanning Albumoftheyear - Disvovery");

  // search for album
  const albumBlocks = document.querySelectorAll("div.albumBlock");

  albumBlocks.forEach((block) => {
    const artistElem = block.querySelector("div.artistTitle");
    const albumElem = block.querySelector("div.albumTitle");

    if (!artistElem || !albumElem) return;

    const artist = artistElem.innerText.trim();
    const album = albumElem.innerText.trim();

    // create small button
    const playButton = document.createElement("button");
    playButton.innerText = "▶"; // kleiner Pfeil als Buttontext
    playButton.title = "Play on Volumio";
    playButton.innerText = "▶ Play on Volumio";
    playButton.style.cssText = `
      cursor: pointer;
      margin-left: 0px;
      padding: 2px 6px;
      background: #61ce70;
      color: white;
      border: none;
      border-radius: 4px;
      font-weight: bold;
      font-size: 10px;
      vertical-align: middle;
    `;

    // Click handler
    playButton.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        { action: "playAlbum", volumioIp, artist, album },
        (response) => {
          if (response.success) {
            playButton.innerText = "▶ Playing …";
            playButton.style.backgroundColor = "#61ce70";
            playButton.title = `Now playing: ${artist} - ${album}`;
          } else {
            playButton.innerText = "✖ Failed to Play";
            playButton.title = response.error;
            playButton.style.backgroundColor = "#d76666";
          }
        }
      );
    });

    // Add button
    albumElem.parentNode.insertAdjacentElement("afterend", playButton);
  });
})();
