(async () => {
  const { volumioIp } = await chrome.storage.sync.get("volumioIp");
  if (!volumioIp) {
    console.warn("No Volumio-IP configured within the options.");
    return;
  }

  // Search artist / title from albumoftheyear
  const artistElem = document.querySelector(".albumHeadline .artist a");
  const titleElem = document.querySelector(".albumHeadline .albumTitle span");

  if (!artistElem || !titleElem) {
    console.warn("Album information not found on this page.");
    return;
  }

  const artist = artistElem.innerText.trim();
  const album = titleElem.innerText.trim();

  console.log("Album found:", artist, "-", album);

  const button = document.createElement("button");
  button.innerText = "▶ Play on Volumio";
  button.style.cssText = `
    margin:4px 10px 0px 0px;
    padding:8px 12px;
    background:#61ce70;
    color:white;
    border:none;
    border-radius:6px;
    cursor:pointer;
    font-weight:bold;
    font-size:14px;
  `;

  // Click handler sends message to background.js
  button.addEventListener("click", () => {
    chrome.runtime.sendMessage(
      { action: "playAlbum", volumioIp, artist, album },
      (response) => {
        if (response.success) {
          button.innerText = "▶ Playing …";
          button.title = `Now playing:` + response.message;
          button.style.backgroundColor = "#61ce70";
          console.log(`Now playing: ...` + response.message);
        } else {
          button.innerText = "✖ Failed to Play";
          button.title = response.error;
          button.style.backgroundColor = `#d76666`;
          console.log("Error: " + response.error);
        }
      }
    );
  });

  const headline = document.querySelector(".albumHeadline");
  if (headline) headline.appendChild(button);

  // Alle Track-Zellen auswählen
  const trackCells = document.querySelectorAll("td.trackTitle");

  trackCells.forEach((cell) => {
    const trackLink = cell.querySelector("a");
    if (!trackLink) return;

    const trackName = trackLink.innerText.trim();


    // Icon / Button erstellen
    const iconButton = document.createElement("span");
    iconButton.innerHTML = "▶"; 
    iconButton.style.cssText = `
      cursor:pointer;
      margin-left:8px;
      color:#61ce70;
      font-weight:bold;
    `;

    const album = trackName;

    // Click handler
    iconButton.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        { action: "playAlbum", volumioIp, artist, album},
        (response) => {
          if (response.success) {
            iconButton.innerText = "▶"; 
            iconButton.title = `Now playing: ${trackName}`;
            iconButton.style.color = "#61ce70";
          } else {
            iconButton.innerText = "✖";
            iconButton.title = response.error;
            iconButton.style.color = "#d76666";
          }
        }
      );
    });

    // Icon hinter dem Track-Link einfügen
    trackLink.insertAdjacentElement("afterend", iconButton);
  });

})();
