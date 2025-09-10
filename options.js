// store IP
document.getElementById("save").addEventListener("click", () => {
  const volumioIp = document.getElementById("volumioIp").value.trim();
  if (volumioIp) {
    chrome.storage.sync.set({ volumioIp }, () => {
      alert("Volumio-IP: "+volumioIp+" stored!");
    });
  }
});

// Display registered IP when loading
chrome.storage.sync.get("volumioIp", ({ volumioIp }) => {
  if (volumioIp) {
    document.getElementById("volumioIp").value = volumioIp;
  }
});
