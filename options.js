// =============================================================================
// Play on Volumio – Options Page
// =============================================================================

const DEFAULT_API_PORT = 3000;

function parsePort(val, defaultVal) {
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) || n < 1 ? defaultVal : Math.min(65535, n);
}

function parseAlbumLimit(val, defaultVal) {
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) || n < 1 ? defaultVal : Math.min(50, Math.max(1, n));
}

document.getElementById("save").addEventListener("click", () => {
  const volumioIp = document.getElementById("volumioIp").value.trim();
  const volumioApiPort = parsePort(document.getElementById("volumioApiPort").value, DEFAULT_API_PORT);
  const webPortVal = document.getElementById("volumioWebPort").value.trim();
  const volumioWebPort = webPortVal ? parsePort(webPortVal, volumioApiPort) : null;
  const maxSimilarAlbums = parseAlbumLimit(document.getElementById("maxSimilarAlbums").value, 12);
  const maxRecentlyAddedAlbums = parseAlbumLimit(document.getElementById("maxRecentlyAddedAlbums").value, 9);
  if (volumioIp) {
    chrome.storage.sync.set(
      { volumioIp, volumioApiPort, volumioWebPort, maxSimilarAlbums, maxRecentlyAddedAlbums },
      () => {
        alert("Volumio saved: " + volumioIp + " (API:" + volumioApiPort + (volumioWebPort ? ", Web:" + volumioWebPort + ")" : ")"));
      }
    );
  }
});

chrome.storage.sync.get(
  ["volumioIp", "volumioApiPort", "volumioWebPort", "volumioPort", "maxSimilarAlbums", "maxRecentlyAddedAlbums"],
  (res) => {
    if (res.volumioIp) document.getElementById("volumioIp").value = res.volumioIp;
    document.getElementById("volumioApiPort").value = res.volumioApiPort ?? res.volumioPort ?? DEFAULT_API_PORT;
    document.getElementById("volumioWebPort").value = res.volumioWebPort ?? "";
    document.getElementById("maxSimilarAlbums").value = res.maxSimilarAlbums ?? 12;
    document.getElementById("maxRecentlyAddedAlbums").value = res.maxRecentlyAddedAlbums ?? 9;
  }
);
