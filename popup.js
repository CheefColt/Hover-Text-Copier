const btn = document.getElementById("toggleBtn");

chrome.storage.local.get("hoverEnabled", (res) => {
  const enabled = res.hoverEnabled ?? false;
  btn.textContent = enabled ? "Disable Hover Copy" : "Enable Hover Copy";
});

btn.addEventListener("click", () => {
  chrome.storage.local.get("hoverEnabled", (res) => {
    const newValue = !(res.hoverEnabled ?? false);
    chrome.storage.local.set({ hoverEnabled: newValue }, () => {
      btn.textContent = newValue ? "Disable Hover Copy" : "Enable Hover Copy";
    });
  });
});
