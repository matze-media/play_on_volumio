(async () => {
  const { volumioIp } = await chrome.storage.sync.get("volumioIp");
  if (!volumioIp) {
    console.warn("No Volumio-IP configured within the options.");
    return;
  }

  console.info("Scanning Albumoftheyear - Ratings");

  // Serach for Album headline
  const albumHeaders = document.querySelectorAll("h2.albumListTitle");

  albumHeaders.forEach((header) => {
    const linkElem = header.querySelector("a[itemprop='url']");
    if (!linkElem) return;

    const fullText = linkElem.innerText.trim(); // z.B. "Hayley Williams - Ego Death At a Bachelorette Party"
    
    // Artist / Album split
    const [artist, album] = fullText.split(" - ").map(s => s.trim());
    if (!artist || !album) return;

    // create button
    const button = document.createElement("button");
    button.innerText = "▶ Play on Volumio";
    button.style.cssText = `
      margin-left:10px;
      padding:5px 8px;
      background:#61ce70;
      color:white;
      border:none;
      border-radius:5px;
      cursor:pointer;
      font-weight:bold;
      font-size:12px;
      vertical-align:middle;
    `;

    // Click handler
    button.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        { action: "playAlbum", volumioIp, artist, album },
        (response) => {
          if (response.success) {
            button.innerText = "▶ Playing …";
            button.title = `Now playing: ${artist} - ${album}`;
            button.style.backgroundColor = "#61ce70";
          } else {
            button.innerText = "✖ Failed to Play";
            button.title = response.error;
            button.style.backgroundColor = "#d76666";
          }
        }
      );
    });

    // Add button
    linkElem.insertAdjacentElement("afterend", button);
  });
})();
