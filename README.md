# Hover Text Copier

A Chrome extension that allows you to easily copy text from web pages by simply hovering over text elements. Perfect for quickly copying text without having to select it manually.

## Features

- 🖱️ **Hover to Copy**: Simply hover over text elements to see a copy button
- ⌨️ **Keyboard Shortcut**: Toggle the extension on/off with `Ctrl+Shift+H` (or `Cmd+Shift+H` on Mac)
- 🔄 **Cross-Tab Sync**: State changes are synchronized across all open tabs
- 📱 **Smart Detection**: Automatically detects suitable text elements while avoiding buttons, inputs, and other interactive elements
- ✅ **Visual Feedback**: Copy button changes to checkmark when text is copied
- 🔔 **Status Notifications**: Shows current state when toggling or switching tabs
- 🎯 **Intelligent Positioning**: Copy button appears at the top-right of text elements
- 🚫 **Input Field Safe**: Keyboard shortcuts don't interfere when typing in forms

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension icon should appear in your browser toolbar

## Usage

### Basic Usage
1. **Enable the extension** by clicking the extension icon in the toolbar or using the keyboard shortcut
2. **Hover over text** on any webpage
3. **Click the clipboard button** (📋) that appears to copy the text
4. The button will briefly show a checkmark (✅) to confirm the copy

### Keyboard Shortcut
- **Windows/Linux**: `Ctrl + Shift + H`
- **Mac**: `Cmd + Shift + H`

The shortcut toggles the extension on/off and works on any webpage (except when typing in input fields).

### Visual Indicators
- **Green notification**: "Hover Select: ON" - Extension is active
- **Red notification**: "Hover Select: OFF" - Extension is disabled
- **"(synced)" label**: Indicates the state change came from another tab

## How It Works

### Smart Text Detection
The extension intelligently identifies text elements suitable for copying by:
- ✅ Including: paragraphs, divs, spans, headings, and other text containers
- ❌ Excluding: buttons, inputs, textareas, links, images, and SVGs
- 📏 Filtering: Elements with less than 1 character or very small fonts
- 👁️ Checking: Element visibility (hidden or transparent elements are ignored)

### Parent Element Traversal
When you hover over an element, the extension checks:
1. The element itself
2. Up to 2 parent elements

This allows hovering over child elements (like spans or emphasized text) to target their parent containers.

### Cross-Tab Synchronization
- State changes are saved to Chrome storage
- All open tabs automatically sync when you toggle the extension
- Notifications appear on all tabs when state changes
- Tab focus shows current state for awareness

## File Structure

```
hoverSelect/
├── manifest.json       # Extension configuration
├── content.js         # Main functionality (injected into web pages)
├── popup.html        # Extension popup interface
├── popup.js          # Popup functionality
└── README.md         # This file
```

## Technical Details

### Permissions Required
- `storage`: For saving extension state across sessions
- `<all_urls>`: For content script injection on all websites

### Browser Compatibility
- Chrome (Manifest V3)
- Chromium-based browsers (Edge, Brave, etc.)

### Performance Considerations
- Lightweight content script (< 10KB)
- Event listeners are efficiently managed
- Mouse position tracking only when needed
- Smart element caching to avoid repeated DOM queries

## Customization

### Modifying Text Length Threshold
In `content.js`, find the `isTextElement` function and modify:
```javascript
if (text.length < 1) return false; // Change minimum character count
```

### Changing Font Size Threshold
```javascript
parseFloat(style.fontSize) < 10 // Change minimum font size (pixels)
```

### Adjusting Button Position
In the `showButton` function:
```javascript
hoverButton.style.left = `${window.scrollX + rect.right - 40}px`; // Change offset from right edge
```

### Modifying Keyboard Shortcut
In the keydown event listener:
```javascript
if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
  // Change 'H' to your preferred key
}
```

## Troubleshooting

### Keyboard Shortcut Not Working
1. Check browser console for debug messages
2. Ensure you're not typing in an input field
3. Try both uppercase and lowercase versions of the shortcut
4. Check if another extension is using the same shortcut

### Button Not Appearing
1. Make sure the extension is enabled (check notification)
2. Verify you're hovering over text elements (not images or buttons)
3. Check if the text element has sufficient content (> 1 character)
4. Ensure the element is visible (not hidden or transparent)

### Cross-Tab Sync Issues
1. Refresh affected tabs if sync seems stuck
2. Check browser console for storage-related errors
3. Try disabling and re-enabling the extension

### Extension Not Loading
1. Verify all files are in the correct directory
2. Check `manifest.json` for syntax errors
3. Reload the extension in `chrome://extensions/`
4. Check browser console for loading errors

## Development

### Debug Mode
The extension includes comprehensive logging. Open browser DevTools (F12) and check the Console tab for:
- Extension initialization messages
- Keyboard shortcut detection
- Storage sync events
- Element detection details

### Testing
1. Test on various websites with different layouts
2. Verify keyboard shortcuts work across different tab contexts
3. Check cross-tab synchronization
4. Test with different text elements and sizes

## Privacy

This extension:
- ✅ Only processes text content when you hover over elements
- ✅ Does not send any data to external servers
- ✅ Only stores extension state locally in Chrome storage
- ✅ Does not track browsing history or personal information

## Contributing

Feel free to submit issues, fork the repository, and create pull requests for any improvements.

## License

This project is open source and available under the [MIT License](https://opensource.org/licenses/MIT).

## Version History

### v1.0
- Initial release with basic hover-to-copy functionality
- Keyboard shortcut support (`Ctrl+Shift+H`)
- Cross-tab state synchronization
- Smart text element detection
- Visual feedback notifications
