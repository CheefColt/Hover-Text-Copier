// Global variables to manage the hover-to-copy functionality
let hoverEnabled = false;  // Flag to control whether the hover feature is active
let hoverButton = null;    // Reference to the copy button DOM element
let currentTarget = null;  // Currently targeted text element for copying
let lastMouseX = 0;        // Last known mouse X coordinate for keyboard shortcut
let lastMouseY = 0;        // Last known mouse Y coordinate for keyboard shortcut

// Load the extension's enabled/disabled state from Chrome storage on initialization
chrome.storage.local.get("hoverEnabled", (res) => {
  hoverEnabled = res.hoverEnabled ?? false;  // Default to false if not set
  console.log('Extension initialized on', window.location.href, 'with hoverEnabled:', hoverEnabled);
});

// Listen for changes to the extension settings (e.g., from popup or options page)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.hoverEnabled) {
    console.log('Storage changed - updating hoverEnabled from', hoverEnabled, 'to', changes.hoverEnabled.newValue);
    const oldState = hoverEnabled;
    hoverEnabled = changes.hoverEnabled.newValue;  // Update local state
    
    if (!hoverEnabled) {
      hideButton();              // Hide button if disabled
    } else {
      // When enabling from another tab, check if we should show button immediately
      const elementUnderMouse = document.elementFromPoint(lastMouseX || 0, lastMouseY || 0);
      if (elementUnderMouse) {
        const el = getValidTarget(elementUnderMouse);
        if (el) {
          showButton(el);
        }
      }
    }
    
    // Show notification if the state actually changed (to indicate cross-tab sync)
    if (oldState !== hoverEnabled) {
      showToggleNotification(hoverEnabled, true); // true indicates it's from another tab
    }
  }
});

/**
 * Creates the hover copy button (singleton pattern - only creates once)
 * The button appears as a clipboard emoji with dark styling
 */
function createHoverButton() {
  if (hoverButton) return;  // Exit early if button already exists

  // Create the button element
  hoverButton = document.createElement("button");
  hoverButton.textContent = "📋";  // Clipboard emoji as default text
  
  // Apply comprehensive styling to make it look professional and non-intrusive
  Object.assign(hoverButton.style, {
    position: "absolute",           // Absolute positioning to appear anywhere on page
    zIndex: "99999",               // High z-index to appear above other elements
    padding: "4px 6px",            // Compact padding for small button size
    fontSize: "13px",              // Small font size to be unobtrusive
    display: "none",               // Hidden by default
    cursor: "pointer",             // Pointer cursor to indicate clickability
    border: "none",                // Clean look without borders
    borderRadius: "4px",           // Rounded corners for modern appearance
    backgroundColor: "#333",        // Dark background for contrast
    color: "#fff",                 // White text for readability
    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",  // Subtle shadow for depth
  });

  // Add click event handler for copying functionality
  hoverButton.addEventListener("click", () => {
    if (currentTarget) {
      const text = currentTarget.innerText.trim();  // Extract and clean text
      
      // Use modern Clipboard API to copy text
      navigator.clipboard.writeText(text).then(() => {
        // Provide visual feedback: change to checkmark briefly
        hoverButton.textContent = "✅";
        setTimeout(() => hoverButton.textContent = "📋", 800);  // Reset after 800ms
      });
    }
  });

  // Append button to document body so it can be positioned anywhere
  document.body.appendChild(hoverButton);
}

/**
 * Determines if an element is suitable for text copying
 * Filters out interactive elements, empty elements, and hidden elements
 * @param {HTMLElement} el - The element to check
 * @returns {boolean} - True if element is suitable for text copying
 */
function isTextElement(el) {
  // Basic validation: must be a valid HTML element
  if (!el || !(el instanceof HTMLElement)) return false;

  // Get element tag name for filtering
  const tag = el.tagName.toLowerCase();
  
  // Skip interactive and non-text elements that shouldn't be copied
  const skipTags = ["button", "input", "textarea", "select", "svg", "img", "a"];
  if (skipTags.includes(tag)) return false;

  // Check if element has sufficient text content (at least 1 character)
  const text = el.innerText?.trim() || "";
  if (text.length < 1) return false;

  // Check element visibility and styling
  const style = getComputedStyle(el);
  if (
    style.display === "none" ||        // Element is not displayed
    style.visibility === "hidden" ||   // Element is hidden
    style.opacity === "0" ||           // Element is transparent
    parseFloat(style.fontSize) < 10    // Font is too small to be readable
  ) return false;

  return true;  // Element passed all checks
}

/**
 * Finds a valid text element starting from the given element
 * Searches the element itself and up to 2 parent elements
 * This allows hovering over child elements (like spans) to target parent containers
 * @param {HTMLElement} el - The starting element to check
 * @returns {HTMLElement|null} - Valid text element or null if none found
 */
function getValidTarget(el) {
  // Check current element and up to 2 parent levels
  for (let i = 0; i < 2 && el; i++) {
    if (isTextElement(el)) return el;  // Return first valid element found
    el = el.parentElement;             // Move up to parent element
  }
  return null;  // No valid element found
}

/**
 * Shows the copy button positioned near the target element
 * Creates the button if it doesn't exist and positions it at the top-right of the element
 * @param {HTMLElement} el - The target element to show the button for
 */
function showButton(el) {
  createHoverButton();       // Ensure button exists
  currentTarget = el;        // Set the target for copying
  
  // Get element's position and dimensions
  const rect = el.getBoundingClientRect();
  
  // Position button at top-right corner of element, accounting for scroll position
  hoverButton.style.top = `${window.scrollY + rect.top}px`;        // Vertical position
  hoverButton.style.left = `${window.scrollX + rect.right - 40}px`; // Horizontal position (40px from right edge)
  hoverButton.style.display = "block";  // Make button visible
}

/**
 * Hides the copy button and clears the current target
 */
function hideButton() {
  if (hoverButton) {
    hoverButton.style.display = "none";  // Hide the button
    currentTarget = null;                // Clear current target
  }
}

// Main mouse movement handler - tracks cursor position and manages button visibility
document.addEventListener("mousemove", (e) => {
  // Always track mouse position for keyboard shortcut functionality
  lastMouseX = e.clientX;  // Store current mouse X coordinate
  lastMouseY = e.clientY;  // Store current mouse Y coordinate
  
  // Exit early if hover feature is disabled
  if (!hoverEnabled) {
    hideButton();
    return;
  }

  // Ignore mouse events over the button itself to prevent flickering
  if (e.target === hoverButton || hoverButton?.contains(e.target)) return;

  // Find valid text element under mouse cursor
  const el = getValidTarget(e.target);
  
  if (el && el !== currentTarget) {
    // Show button for new valid element (different from current target)
    showButton(el);
  } else if (!el) {
    // Hide button when hovering over invalid elements
    hideButton();
  }
});

// Hide button when scrolling (positioning would become incorrect)
document.addEventListener("scroll", hideButton);

// Show current state when user focuses on this tab (helpful for cross-tab awareness)
window.addEventListener("focus", () => {
  // Small delay to ensure tab is fully focused
  setTimeout(() => {
    showToggleNotification(hoverEnabled, false, 1000); // Shorter duration for focus events
  }, 100);
});

// Keyboard shortcut functionality for toggling the hover feature
document.addEventListener("keydown", (e) => {
  // Only handle keyboard shortcuts when not in input fields
  const activeElement = document.activeElement;
  const isInInputField = activeElement && (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.contentEditable === 'true'
  );
  
  // Skip if typing in an input field
  if (isInInputField) return;
  
  // Debug logging to help troubleshoot keyboard shortcut issues
  if (e.key === 'H' || e.key === 'h') {
    console.log('H key pressed:', {
      key: e.key,           // The actual key pressed
      ctrlKey: e.ctrlKey,   // Whether Ctrl is pressed
      metaKey: e.metaKey,   // Whether Cmd (Mac) is pressed
      shiftKey: e.shiftKey, // Whether Shift is pressed
      code: e.code,         // The physical key code
      activeElement: activeElement?.tagName,
      url: window.location.href
    });
  }
  
  // Toggle with Ctrl+Shift+H (Windows/Linux) or Cmd+Shift+H (Mac)
  // Accepts both uppercase and lowercase 'h' for better compatibility
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
    console.log('Keyboard shortcut triggered on:', window.location.href);
    e.preventDefault();      // Prevent default browser behavior
    e.stopPropagation();     // Stop event from bubbling up
    toggleHoverFeature();    // Toggle the extension
  }
});

/**
 * Toggles the hover feature on/off and provides immediate feedback
 * Called by keyboard shortcut or potentially other triggers
 */
function toggleHoverFeature() {
  console.log('toggleHoverFeature called on', window.location.href, 'current state:', hoverEnabled);
  hoverEnabled = !hoverEnabled;  // Flip the enabled state
  console.log('New state:', hoverEnabled);
  
  // Save the new state to Chrome storage (syncs across all tabs and components)
  chrome.storage.local.set({ hoverEnabled }, () => {
    console.log('State saved to storage:', hoverEnabled);
  });
  
  if (!hoverEnabled) {
    // When disabling: hide the button immediately
    hideButton();
  } else {
    // When enabling: check if we should immediately show button at current mouse position
    // This prevents needing to move the mouse after enabling via keyboard shortcut
    const elementUnderMouse = document.elementFromPoint(lastMouseX || 0, lastMouseY || 0);
    if (elementUnderMouse) {
      const el = getValidTarget(elementUnderMouse);
      if (el) {
        showButton(el);  // Show button if hovering over valid text
      }
    }
  }
  
  // Show visual notification to user about the state change
  showToggleNotification(hoverEnabled);
}

/**
 * Creates and displays a temporary notification showing the extension's current state
 * Appears in the top-right corner with green (ON) or red (OFF) styling
 * @param {boolean} enabled - Whether the extension is currently enabled
 * @param {boolean} fromOtherTab - Whether this change came from another tab
 * @param {number} duration - How long to show the notification (default: 2000ms)
 */
function showToggleNotification(enabled, fromOtherTab = false, duration = 2000) {
  // Remove any existing notifications first
  const existingNotifications = document.querySelectorAll('[data-hover-select-notification]');
  existingNotifications.forEach(n => n.remove());
  
  // Create notification element
  const notification = document.createElement("div");
  notification.setAttribute('data-hover-select-notification', 'true');
  
  // Different text based on source
  if (fromOtherTab) {
    notification.textContent = enabled ? "Hover Select: ON (synced)" : "Hover Select: OFF (synced)";
  } else {
    notification.textContent = enabled ? "Hover Select: ON" : "Hover Select: OFF";
  }
  
  // Apply styling for professional, non-intrusive notification
  Object.assign(notification.style, {
    position: "fixed",                    // Fixed positioning relative to viewport
    top: "20px",                         // 20px from top of screen
    right: "20px",                       // 20px from right edge of screen
    zIndex: "999999",                    // Very high z-index to appear above everything
    padding: "10px 15px",                // Comfortable padding for readability
    fontSize: "14px",                    // Readable font size
    fontWeight: "bold",                  // Bold text for emphasis
    border: "none",                      // Clean look without borders
    borderRadius: "6px",                 // Rounded corners for modern appearance
    backgroundColor: enabled ? "#28a745" : "#dc3545",  // Green for ON, red for OFF
    color: "#fff",                       // White text for contrast
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",          // Shadow for depth and prominence
    transition: "opacity 0.3s ease",     // Smooth fade transition
    opacity: fromOtherTab ? "0.9" : "1", // Slightly less opaque for synced notifications
  });
  
  // Add notification to page
  document.body.appendChild(notification);
  
  // Auto-remove notification after specified duration with fade effect
  setTimeout(() => {
    notification.style.opacity = "0";    // Start fade out
    setTimeout(() => {
      // Remove from DOM after fade completes (safe removal check)
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);  // Wait for fade transition to complete
  }, duration);   // Show for specified duration before starting fade
}
