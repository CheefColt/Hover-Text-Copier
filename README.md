# Hover Text Copier (v1.1)

A premium, high-performance Chrome extension that allows you to copy text elements from any webpage by simply hovering. Designed for researchers, developers, and writers to copy blocks, sentences, or words with pixel-perfect precision and ZERO layout interference.

---

## 🚀 Key Features

- 🖱️ **Hover-to-Copy**: Hover over text elements to reveal a floating, premium copy button.
- 📐 **Geometry-Union Safe Zone**: High-performance $O(1)$ viewport containment checks prevent button flickering.
- 📑 **Multi-Granularity Parsing**:
  - **Block Mode** (Default): Copy the entire containing element.
  - **Sentence Mode** (`Hold Alt`): Extracts the sentence under the cursor using punctuation detection.
  - **Word Mode** (`Alt + Shift`): Extracts the exact word under the cursor.
- 🕒 **Visual Mode Badge**: Shows the active granularity mode (`BLOCK`, `SENTENCE`, `WORD`) centered directly above the highlighted selection.
- 📜 **Page-level History Dropdown (🕒)**: Access, copy, and clear your last 20 copied clips directly from the floating page toolbar.
- ⚙️ **Control Center Popup**: Elegant charcoal UI to configure copying formats:
  - **Plain Text**: Standard unformatted string.
  - **Markdown**: Formats tags, headings, and resolves context-aware links (e.g. `[text](url)`).
  - **HTML Markup**: Extracts the exact outer HTML of elements (or cloned range elements for sub-selections).
  - **Append Page URL**: Appends source page details to the copied clipboard text.
- ⚡ **Instant Keyboard Action**: Press **`C`** on your keyboard while hovering to copy immediately.
- 🔒 **Input Safeguards**: Keyboard shortcuts and overlays automatically bypass inputs, forms, and contentEditable regions.
- 🎨 **Closed Shadow DOM Isolation**: All UI elements (toolbar, badges, highlights, dropdowns) are encapsulated inside a closed shadow root, ensuring zero stylesheet leakage or conflicts with hosting websites.

---

## 🛠️ Installation

1. **Download / Clone** the repository folder.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Toggle **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `Hover-Text-Copier` folder.
6. Pin the extension to your toolbar for easy access.

---

## ⌨️ Shortcuts Cheat-Sheet

| Action | Shortcut | Description |
|---|---|---|
| **Toggle Extension** | `Ctrl + Shift + H` | Turns the hover engine ON or OFF. |
| **Sentence Mode** | `Hold Alt` | Highlights the sentence under the cursor. |
| **Word Mode** | `Alt + Shift` | Highlights the word under the cursor. |
| **Instant Copy** | `Press C` | Copies highlighted text immediately. |

*Note: The extension automatically overrides Windows Chrome's default Alt-key menu focus behavior and Wikipedia's accesskeys when active, ensuring smooth hotkey delivery.*

---

## 📂 Project Structure

- [manifest.json](file:///e:/Hover-Text-Copier/manifest.json) — Extension manifest (MV3) defining permissions, scripts, and popup.
- [content.js](file:///e:/Hover-Text-Copier/content.js) — The core background/injected script that builds the viewport overlay inside a closed Shadow DOM, tracks coordinates, manages keyboard shortcuts, and parses text granularity.
- [popup.html](file:///e:/Hover-Text-Copier/popup.html) — The sleek, solid charcoal popup UI for configuring format options.
- [popup.js](file:///e:/Hover-Text-Copier/popup.js) — Binds configuration elements to `chrome.storage.local`.

---

## 🛠️ Advanced Customization

### Minimum Text Selection Length
To adjust the minimum text length considered valid for hover selections, modify the threshold check inside `isTextElement` in [content.js](file:///e:/Hover-Text-Copier/content.js):
```javascript
const text = el.innerText?.trim() || "";
if (text.length < 1) return false; // Change 1 to your minimum limit
```

### Delay Buffers for Cursor Transition
To adjust the timing buffer before the copy button hides (giving you time to move the cursor to it), update the delay millisecond value inside `hideButtonWithDelay` in [content.js](file:///e:/Hover-Text-Copier/content.js):
```javascript
setTimeout(() => {
  hideButton();
}, 400); // Set to your preferred time in milliseconds
```

---

## 🛡️ Privacy & Performance

- **100% Client-Side**: No telemetry or network requests are ever made. Your copy history is stored purely in your browser's private local extension storage (`chrome.storage.local`).
- **High Performance**: Employs early-exit cursor coordinate containment checks to prevent layout thrashing and maintain 60FPS.
