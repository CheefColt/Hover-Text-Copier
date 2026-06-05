document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById("toggleBtn");
  const radioButtons = document.querySelectorAll('input[name="format"]');
  const cleanCodeBtn = document.getElementById("cleanCodeBtn");
  const regexModeSelect = document.getElementById("regexModeSelect");
  const customRegexContainer = document.getElementById("customRegexContainer");
  const customRegexInput = document.getElementById("customRegexInput");
  const regexFallbackBtn = document.getElementById("regexFallbackBtn");

  // Load active settings from Chrome storage
  chrome.storage.local.get([
    "hoverEnabled", "copyFormat", "cleanCodeBlocks", "regexMode", "customRegexPattern", "regexFallback"
  ], (res) => {
    toggleBtn.checked = res.hoverEnabled ?? false;
    cleanCodeBtn.checked = res.cleanCodeBlocks ?? true;
    regexModeSelect.value = res.regexMode || "none";
    customRegexInput.value = res.customRegexPattern || "";
    regexFallbackBtn.checked = res.regexFallback ?? true;

    // Show custom regex container if selected
    if (regexModeSelect.value === "custom") {
      customRegexContainer.style.display = "block";
    }

    const format = res.copyFormat || "plain";
    radioButtons.forEach(btn => {
      if (btn.value === format) {
        btn.checked = true;
      }
    });
  });

  // Toggle active extension state
  toggleBtn.addEventListener("change", () => {
    chrome.storage.local.set({ hoverEnabled: toggleBtn.checked });
  });

  // Toggle active copy format options
  radioButtons.forEach(btn => {
    btn.addEventListener("change", () => {
      if (btn.checked) {
        chrome.storage.local.set({ copyFormat: btn.value });
      }
    });
  });

  // Clean code setting
  cleanCodeBtn.addEventListener("change", () => {
    chrome.storage.local.set({ cleanCodeBlocks: cleanCodeBtn.checked });
  });

  // Regex settings
  regexModeSelect.addEventListener("change", () => {
    const val = regexModeSelect.value;
    chrome.storage.local.set({ regexMode: val });
    if (val === "custom") {
      customRegexContainer.style.display = "block";
    } else {
      customRegexContainer.style.display = "none";
    }
  });

  customRegexInput.addEventListener("input", () => {
    chrome.storage.local.set({ customRegexPattern: customRegexInput.value });
  });

  regexFallbackBtn.addEventListener("change", () => {
    chrome.storage.local.set({ regexFallback: regexFallbackBtn.checked });
  });
});
