// Global variables to manage the hover-to-copy functionality
let hoverEnabled = false;       // Flag to control whether the hover feature is active
let currentCopyText = "";       // The text currently targeted to copy
let lastMouseX = 0;             // Last known mouse X coordinate
let lastMouseY = 0;             // Last known mouse Y coordinate

// Shadow DOM references for the isolated toolbar
let shadowRootHost = null;
let shadowRoot = null;
let currentTarget = null;       // The HTML element currently targeted
let activeRange = null;         // The active range for sentence/word level copying
let hideTimeout = null;         // Timer for delaying hiding of the copy button
let activeTargetRects = [];     // Cached viewport coordinates of current highlighted elements
let activeButtonRect = null;    // Cached viewport coordinates of active copy button
let activeSafeZoneBox = null;   // Bounding box union of targets + copy button + padding
let altKeyPressed = false;      // Track Alt key press state to prevent Windows menu focus blur

// Cached settings synchronized from Chrome storage
let settings = {
  cleanCodeBlocks: true,
  regexMode: 'none',
  customRegexPattern: '',
  regexFallback: true,
  defaultAiPlatform: 'chatgpt'
};

// Bypasses large transparent overlays that block text selection by temporarily disabling pointer-events
function findTextElementUnderPoint(x, y) {
  const elementsToRestore = [];
  let el = document.elementFromPoint(x, y);
  
  // Look up to 5 layers deep
  for (let depth = 0; depth < 5; depth++) {
    if (!el) break;
    
    const tag = el.tagName.toLowerCase();
    
    // Skip if it's the html, body, or our own host element
    if (tag === 'html' || tag === 'body' || tag === 'hover-copier-root') {
      break;
    }
    
    // Check if it's a potential blocking overlay
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const text = el.innerText?.trim() || "";
    const isLarge = rect.width > 150 && rect.height > 150;
    
    if (isLarge && text.length === 0 && style.pointerEvents !== 'none') {
      elementsToRestore.push({ el, originalPointerEvents: el.style.pointerEvents });
      el.style.setProperty('pointer-events', 'none', 'important');
      el = document.elementFromPoint(x, y);
    } else {
      break;
    }
  }
  
  // Restore original pointer-events settings
  elementsToRestore.forEach(item => {
    if (item.originalPointerEvents) {
      item.el.style.pointerEvents = item.originalPointerEvents;
    } else {
      item.el.style.removeProperty('pointer-events');
    }
  });
  
  return el;
}

// Helper to strip line numbers and format code block text
function cleanCodeSnippet(el) {
  const clone = el.cloneNode(true);
  const lineSelectors = [
    '.line-numbers', '.line-number', '.gutter', '.hljs-ln-n', '.lineno',
    '.code-line-num', '.line-num', '.bl-num', '[class*="line-number"]',
    '[class*="lineno"]', '[class*="gutter"]'
  ];
  
  lineSelectors.forEach(selector => {
    try {
      clone.querySelectorAll(selector).forEach(item => item.remove());
    } catch (e) {}
  });
  
  let cleanText = clone.innerText || clone.textContent || "";
  const lines = cleanText.split('\n');
  let numberedLinesCount = 0;
  let nonCodeLinesCount = 0;
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      nonCodeLinesCount++;
      if (/^\d+[\s\.\:\)]/.test(trimmed)) {
        numberedLinesCount++;
      }
    }
  });
  
  if (nonCodeLinesCount > 1 && (numberedLinesCount / nonCodeLinesCount) > 0.75) {
    cleanText = lines.map(line => {
      return line.replace(/^\s*\d+[\s\.\:\)]\s*/, '');
    }).join('\n');
  }
  
  return cleanText.trim();
}

// Determines if element resides in a code block and applies clean code extraction
function getCleanCodeText(el) {
  let current = el;
  let isCode = false;
  
  for (let i = 0; i < 3 && current; i++) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'pre' || tag === 'code' || current.classList.contains('code') || current.classList.contains('syntax')) {
      isCode = true;
      el = current;
      break;
    }
    current = current.parentElement;
  }
  
  if (!isCode) {
    return el.innerText?.trim() || "";
  }
  
  return cleanCodeSnippet(el);
}

// Shows the AI prompt input box and centers it next to the AI button
function showAiPromptBox() {
  if (!shadowRoot) return;
  const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
  const aiBtn = shadowRoot.querySelector('#hover-ai-btn');
  const input = shadowRoot.querySelector('#hover-ai-input');
  if (!promptBox || !aiBtn || !input) return;
  
  const rect = aiBtn.getBoundingClientRect();
  promptBox.style.display = 'flex';
  
  let left = rect.left - 295;
  let top = rect.top;
  
  if (left < 10) {
    left = rect.right + 10;
  }
  
  if (top + 130 > window.innerHeight) {
    top = window.innerHeight - 140;
  }
  
  promptBox.style.left = `${left}px`;
  promptBox.style.top = `${top}px`;
  
  setTimeout(() => {
    input.value = '';
    input.focus();
  }, 50);
}

// Hides the AI prompt input box
function hideAiPromptBox() {
  if (!shadowRoot) return;
  const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
  if (promptBox) promptBox.style.display = 'none';
}

// Extracts a sentence range around the specified text offset inside a text node
function getSentenceRange(textNode, offset) {
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  const text = textNode.textContent;
  
  let start = offset;
  while (start > 0) {
    const char = text[start - 1];
    // Check if character is a sentence ender and followed by whitespace or end of string
    if ((char === '.' || char === '!' || char === '?') && (/\s/.test(text[start]) || start === text.length)) {
      break;
    }
    if (char === '\n' || char === '\r') {
      break;
    }
    start--;
  }
  
  // Skip leading whitespace of the sentence
  while (start < text.length && /\s/.test(text[start])) {
    start++;
  }
  
  let end = offset;
  while (end < text.length) {
    const char = text[end];
    if (char === '.' || char === '!' || char === '?') {
      end++; // Include the punctuation
      break;
    }
    if (char === '\n' || char === '\r') {
      break;
    }
    end++;
  }
  
  if (start >= end) return null;
  
  try {
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    return range;
  } catch (e) {
    return null;
  }
}

// Extracts a word range around the specified text offset inside a text node
function getWordRange(textNode, offset) {
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  const text = textNode.textContent;
  
  let start = offset;
  while (start > 0 && !/\s/.test(text[start - 1])) {
    start--;
  }
  
  let end = offset;
  while (end < text.length && !/\s/.test(text[end])) {
    end++;
  }
  
  if (start >= end) return null;
  
  try {
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    return range;
  } catch (e) {
    return null;
  }
}

// Creates and shows the toolbar widget and copies elements using Shadow DOM for CSS isolation
function showToolbar() {
  if (shadowRootHost) {
    const container = shadowRoot.querySelector('.toolbar-container');
    if (container) {
      container.classList.remove('slide-out');
      container.classList.add('slide-in');
      const checkbox = shadowRoot.querySelector('#hover-copy-toggle');
      if (checkbox) checkbox.checked = true;
    }
    return;
  }

  shadowRootHost = document.createElement('hover-copier-root');
  shadowRootHost.style.setProperty('position', 'fixed', 'important');
  shadowRootHost.style.setProperty('top', '0', 'important');
  shadowRootHost.style.setProperty('left', '0', 'important');
  shadowRootHost.style.setProperty('width', '100%', 'important');
  shadowRootHost.style.setProperty('height', '100%', 'important');
  shadowRootHost.style.setProperty('z-index', '2147483647', 'important');
  shadowRootHost.style.setProperty('pointer-events', 'none', 'important');
  shadowRootHost.style.setProperty('display', 'block', 'important');

  shadowRoot = shadowRootHost.attachShadow({ mode: 'closed' });

  const styleTag = document.createElement('style');
  styleTag.textContent = `
    .toolbar-container {
      position: fixed;
      top: 12px;
      right: 12px;
      width: 220px;
      height: 38px;
      background-color: #1A1A2E;
      border: 1px solid #2A2A3E;
      border-radius: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, sans-serif;
      user-select: none;
      opacity: 0;
      transform: translateX(120%);
      pointer-events: auto;
      transition: border-color 0.2s ease;
    }
    .toolbar-container.slide-in {
      animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .toolbar-container.slide-out {
      animation: slideOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .toolbar-container:hover {
      border-color: #3A3A5E;
    }
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(120%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    @keyframes slideOut {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(120%);
      }
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toolbar-label {
      color: #E0E0E0;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.3px;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #3A3A4E;
      transition: 0.2s ease;
      border-radius: 20px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: #E0E0E0;
      transition: 0.2s ease;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: #10B981;
    }
    input:checked + .slider:before {
      transform: translateX(16px);
      background-color: #FFFFFF;
    }
    
    /* Copy button styles */
    .copy-btn {
      position: fixed;
      z-index: 2147483647;
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: 50%;
      background-color: #1A1A2E;
      border: 1px solid #2A2A3E;
      color: #E0E0E0;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      transition: border-color 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
      outline: none;
      pointer-events: auto;
    }
    .copy-btn:hover {
      border-color: #10B981;
      color: #FFFFFF;
      transform: scale(1.08);
    }
    .copy-btn svg {
      width: 15px;
      height: 15px;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .copy-btn .icon-success {
      position: absolute;
      opacity: 0;
      transform: scale(0.5);
    }
    .copy-btn.success {
      border-color: #10B981;
      background-color: #122A1E;
    }
    .copy-btn.success .icon-copy {
      opacity: 0;
      transform: scale(0.5);
    }
    .copy-btn.success .icon-success {
      opacity: 1;
      transform: scale(1);
    }

    /* Centered floating badge styling */
    .floating-mode-badge {
      position: fixed;
      z-index: 2147483647;
      font-size: 9px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #FFFFFF;
      pointer-events: none;
      display: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      transition: background-color 0.2s ease, opacity 0.2s ease;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .floating-mode-badge.mode-block {
      background-color: #3A3A4E;
      border: 1px solid #4A4A5E;
    }
    .floating-mode-badge.mode-sentence {
      background-color: #2563EB;
      border: 1px solid #3B82F6;
    }
    .floating-mode-badge.mode-word {
      background-color: #7C3AED;
      border: 1px solid #8B5CF6;
    }
    
    /* Toolbar clock button */
    .history-btn {
      background: none;
      border: none;
      color: #A0A0B0;
      cursor: pointer;
      font-size: 14px;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: color 0.2s ease, background-color 0.2s ease;
    }
    .history-btn:hover {
      color: #10B981;
      background-color: #2A2A3E;
    }
    .history-btn.active {
      color: #10B981;
      background-color: #2A2A3E;
    }
    
    /* History Dropdown Container */
    .history-dropdown {
      position: fixed;
      top: 56px;
      right: 12px;
      width: 220px;
      max-height: 250px;
      background-color: #1A1A2E;
      border: 1px solid #2A2A3E;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      display: none;
      flex-direction: column;
      overflow-y: auto;
      z-index: 2147483647;
      padding: 8px;
      box-sizing: border-box;
      pointer-events: auto;
      font-family: system-ui, -apple-system, sans-serif;
      animation: dropdownSlide 0.2s ease-out forwards;
    }
    @keyframes dropdownSlide {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    /* Scrollbar styling */
    .history-dropdown::-webkit-scrollbar {
      width: 6px;
    }
    .history-dropdown::-webkit-scrollbar-track {
      background: #1A1A2E;
    }
    .history-dropdown::-webkit-scrollbar-thumb {
      background: #3A3A4E;
      border-radius: 3px;
    }
    .history-dropdown::-webkit-scrollbar-thumb:hover {
      background: #4A4A5E;
    }
    
    /* History Dropdown Items */
    .history-item {
      padding: 8px 10px;
      border-radius: 6px;
      background-color: #2A2A3E;
      border: 1px solid transparent;
      color: #E0E0E0;
      font-size: 11px;
      cursor: pointer;
      margin-bottom: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.1s ease;
    }
    .history-item:hover {
      background-color: #32324E;
      border-color: #10B981;
    }
    .history-item:active {
      transform: scale(0.98);
    }
    .history-item.success {
      border-color: #10B981;
      background-color: #122A1E;
      color: #10B981;
    }
    .history-empty {
      color: #808090;
      font-size: 11px;
      text-align: center;
      padding: 16px 0;
      font-style: italic;
    }
    .history-title {
      font-size: 10px;
      font-weight: 700;
      color: #808090;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 8px;
      padding: 0 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .history-clear-btn {
      color: #EF4444;
      cursor: pointer;
      text-transform: uppercase;
      font-size: 9px;
      background: none;
      border: none;
      padding: 0;
      font-weight: 700;
    }
    .history-clear-btn:hover {
      text-decoration: underline;
    }
    
    /* AI Sparkles Button styling */
    .ai-btn {
      position: fixed;
      z-index: 2147483647;
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: 50%;
      background-color: #1A1A2E;
      border: 1px solid #2A2A3E;
      color: #E0E0E0;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      transition: border-color 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
      outline: none;
      pointer-events: auto;
    }
    .ai-btn:hover {
      border-color: #8B5CF6;
      color: #FFFFFF;
      transform: scale(1.08);
    }
    .ai-btn svg {
      width: 15px;
      height: 15px;
    }
    
    /* Floating Prompt Container */
    .prompt-box {
      position: fixed;
      z-index: 2147483647;
      background-color: #1A1A2E;
      border: 1px solid #3A3A5E;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      padding: 12px;
      display: none;
      flex-direction: column;
      gap: 10px;
      width: 280px;
      pointer-events: auto;
      font-family: system-ui, -apple-system, sans-serif;
      animation: promptSlide 0.2s ease-out forwards;
    }
    @keyframes promptSlide {
      from {
        opacity: 0;
        transform: scale(0.95) translateY(5px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    .prompt-input {
      width: 100%;
      background-color: #2A2A3E;
      border: 1px solid #3A3A4E;
      border-radius: 6px;
      color: #E0E0E0;
      padding: 8px 10px;
      font-size: 12px;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.2s ease;
    }
    .prompt-input:focus {
      border-color: #8B5CF6;
    }
    .prompt-chips {
      display: flex;
      gap: 6px;
    }
    .prompt-chip {
      padding: 4px 10px;
      background-color: #222238;
      border: 1px solid #2A2A3E;
      border-radius: 12px;
      color: #A0A0B0;
      font-size: 10px;
      cursor: pointer;
      font-weight: 600;
      transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    }
    .prompt-chip:hover {
      background-color: #2A2A3E;
      color: #FFFFFF;
    }
    .prompt-chip.active {
      background-color: #8B5CF6;
      border-color: #A78BFA;
      color: #FFFFFF;
    }
    .prompt-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
    }
    .prompt-cancel {
      background: none;
      border: none;
      color: #808090;
      font-size: 11px;
      cursor: pointer;
      font-weight: 500;
    }
    .prompt-cancel:hover {
      text-decoration: underline;
    }
    .prompt-submit {
      background-color: #8B5CF6;
      color: #FFFFFF;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    .prompt-submit:hover {
      background-color: #7C3AED;
    }
  `;

  // Highlight container
  const highlightContainer = document.createElement('div');
  highlightContainer.id = 'highlight-container';

  // Toolbar Container
  const container = document.createElement('div');
  container.className = 'toolbar-container slide-in';

  const leftSec = document.createElement('div');
  leftSec.className = 'toolbar-left';

  const histBtn = document.createElement('button');
  histBtn.className = 'history-btn';
  histBtn.id = 'history-toggle-btn';
  histBtn.title = 'View History';
  histBtn.textContent = '🕒';
  histBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHistoryDropdown();
  });

  const label = document.createElement('span');
  label.className = 'toolbar-label';
  label.textContent = 'Hover Copy';

  leftSec.appendChild(histBtn);
  leftSec.appendChild(label);

  const switchLabel = document.createElement('label');
  switchLabel.className = 'switch';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'hover-copy-toggle';
  checkbox.checked = true;

  checkbox.addEventListener('change', () => {
    toggleHoverFeature();
  });

  const slider = document.createElement('span');
  slider.className = 'slider';

  switchLabel.appendChild(checkbox);
  switchLabel.appendChild(slider);
  container.appendChild(leftSec);
  container.appendChild(switchLabel);

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.id = 'hover-copy-btn';
  copyBtn.className = 'copy-btn';
  copyBtn.innerHTML = `
    <svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
    <svg class="icon-success" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleCopyAction();
  });

  // AI Button
  const aiBtn = document.createElement('button');
  aiBtn.id = 'hover-ai-btn';
  aiBtn.className = 'ai-btn';
  aiBtn.title = 'Ask AI (Press A)';
  aiBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9.813 15.904L9 21L8.188 15.904L3 15.094L8.188 14.284L9 9.188L9.813 14.284L15 15.094L9.813 15.904Z"/>
      <path d="M19.071 4.929L18.5 8L17.929 4.929L15 4.357L17.929 3.786L18.5 0.714L19.071 3.786L22 4.357L19.071 4.929Z"/>
    </svg>
  `;
  aiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showAiPromptBox();
  });

  // Floating Prompt Box
  const promptBox = document.createElement('div');
  promptBox.id = 'hover-ai-prompt-box';
  promptBox.className = 'prompt-box';
  
  const promptInput = document.createElement('input');
  promptInput.type = 'text';
  promptInput.className = 'prompt-input';
  promptInput.placeholder = 'Ask AI about this text...';
  promptInput.id = 'hover-ai-input';
  
  const chipsContainer = document.createElement('div');
  chipsContainer.className = 'prompt-chips';
  
  const platforms = [
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com' },
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com' },
    { id: 'claude', name: 'Claude', url: 'https://claude.ai' }
  ];
  
  let selectedPlatform = settings.defaultAiPlatform || 'chatgpt';
  
  platforms.forEach(p => {
    const chip = document.createElement('span');
    chip.className = `prompt-chip ${p.id === selectedPlatform ? 'active' : ''}`;
    chip.textContent = p.name;
    chip.setAttribute('data-platform', p.id);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedPlatform = p.id;
      promptBox.querySelectorAll('.prompt-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      chrome.storage.local.set({ defaultAiPlatform: p.id });
    });
    chipsContainer.appendChild(chip);
  });
  
  const footer = document.createElement('div');
  footer.className = 'prompt-footer';
  
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'prompt-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAiPromptBox();
    hideButton();
  });
  
  const submitBtn = document.createElement('button');
  submitBtn.className = 'prompt-submit';
  submitBtn.textContent = 'Send';
  
  const submitAction = (e) => {
    e.stopPropagation();
    const promptVal = promptInput.value.trim();
    if (!promptVal || !currentCopyText) return;
    
    // Copy format context + user prompt spaced after one line
    const aiClipboardText = `${currentCopyText}\n\n${promptVal}`;
    navigator.clipboard.writeText(aiClipboardText).then(() => {
      const targetPlatform = platforms.find(p => p.id === selectedPlatform);
      const url = targetPlatform ? targetPlatform.url : 'https://chatgpt.com';
      
      chrome.storage.local.set({ pendingAiPrompt: aiClipboardText }, () => {
        submitBtn.textContent = 'Copied & Opening...';
        submitBtn.style.backgroundColor = '#10B981';
        
        setTimeout(() => {
          submitBtn.textContent = 'Send';
          submitBtn.style.backgroundColor = '#8B5CF6';
          hideAiPromptBox();
          hideButton();
        }, 1000);
        
        chrome.runtime.sendMessage({ action: 'openTab', url: url });
      });
    });
  };
  
  submitBtn.addEventListener('click', submitAction);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitAction(e);
    } else if (e.key === 'Escape') {
      hideAiPromptBox();
      hideButton();
    }
  });
  
  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);
  
  promptBox.appendChild(promptInput);
  promptBox.appendChild(chipsContainer);
  promptBox.appendChild(footer);

  // Floating Mode Badge
  const floatingBadge = document.createElement('div');
  floatingBadge.id = 'hover-mode-badge';
  floatingBadge.className = 'floating-mode-badge';

  // History Dropdown panel
  const dropdown = document.createElement('div');
  dropdown.id = 'history-dropdown';
  dropdown.className = 'history-dropdown';

  shadowRoot.appendChild(styleTag);
  shadowRoot.appendChild(highlightContainer);
  shadowRoot.appendChild(container);
  shadowRoot.appendChild(copyBtn);
  shadowRoot.appendChild(aiBtn);
  shadowRoot.appendChild(promptBox);
  shadowRoot.appendChild(floatingBadge);
  shadowRoot.appendChild(dropdown);

  document.body.appendChild(shadowRootHost);
}

// Triggers slide-out animation on toolbar and removes it from DOM after animation completes
function hideToolbar() {
  if (!shadowRootHost || !shadowRoot) return;
  const container = shadowRoot.querySelector('.toolbar-container');
  if (container) {
    container.classList.remove('slide-in');
    container.classList.add('slide-out');
    const checkbox = shadowRoot.querySelector('#hover-copy-toggle');
    if (checkbox) checkbox.checked = false;
    
    const onAnimationEnd = (e) => {
      if (e.animationName === 'slideOut') {
        container.removeEventListener('animationend', onAnimationEnd);
        if (!hoverEnabled && shadowRootHost && shadowRootHost.parentNode) {
          shadowRootHost.parentNode.removeChild(shadowRootHost);
          shadowRootHost = null;
          shadowRoot = null;
        }
      }
    };
    container.addEventListener('animationend', onAnimationEnd);
  }
}

// Orchestrates showing or hiding the toolbar based on state
function updateToolbarUI(enabled) {
  if (enabled) {
    if (shadowRootHost && shadowRoot) {
      const container = shadowRoot.querySelector('.toolbar-container');
      if (container) {
        container.classList.remove('slide-out');
        container.classList.add('slide-in');
        const checkbox = shadowRoot.querySelector('#hover-copy-toggle');
        if (checkbox) checkbox.checked = true;
      }
    } else {
      showToolbar();
    }
  } else {
    hideToolbar();
  }
}

// Toggles the visibility of the history dropdown and triggers item populating
function toggleHistoryDropdown() {
  if (!shadowRoot) return;
  const dropdown = shadowRoot.querySelector('#history-dropdown');
  const histBtn = shadowRoot.querySelector('#history-toggle-btn');
  if (!dropdown || !histBtn) return;
  
  const isOpen = dropdown.style.display === 'flex';
  
  if (isOpen) {
    dropdown.style.display = 'none';
    histBtn.classList.remove('active');
  } else {
    chrome.storage.local.get("copyHistory", (res) => {
      const history = res.copyHistory || [];
      renderHistoryItems(history);
      dropdown.style.display = 'flex';
      histBtn.classList.add('active');
    });
  }
}

// Renders the list of historically copied entries inside the Shadow DOM dropdown
function renderHistoryItems(history) {
  if (!shadowRoot) return;
  const dropdown = shadowRoot.querySelector('#history-dropdown');
  if (!dropdown) return;
  
  dropdown.innerHTML = '';
  
  const header = document.createElement('div');
  header.className = 'history-title';
  header.innerHTML = `<span>Recent Clips</span>`;
  
  if (history.length > 0) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'history-clear-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.storage.local.set({ copyHistory: [] }, () => {
        renderHistoryItems([]);
      });
    });
    header.appendChild(clearBtn);
  }
  dropdown.appendChild(header);
  
  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No clips recorded yet';
    dropdown.appendChild(empty);
    return;
  }
  
  history.forEach((text) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.textContent = text;
    item.title = text;
    
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        item.classList.add('success');
        item.textContent = 'Copied!';
        setTimeout(() => {
          item.classList.remove('success');
          item.textContent = text;
          dropdown.style.display = 'none';
          const histBtn = shadowRoot.querySelector('#history-toggle-btn');
          if (histBtn) histBtn.classList.remove('active');
        }, 800);
      });
    });
    dropdown.appendChild(item);
  });
}

// Formats elements to standard Markdown layouts
function convertToMarkdown(el, text) {
  if (!el) return text;
  const tag = el.tagName.toLowerCase();
  
  if (tag === 'a') return `[${text}](${el.href})`;
  if (tag === 'h1') return `# ${text}`;
  if (tag === 'h2') return `## ${text}`;
  if (tag === 'h3') return `### ${text}`;
  if (tag === 'h4') return `#### ${text}`;
  if (tag === 'h5') return `##### ${text}`;
  if (tag === 'h6') return `###### ${text}`;
  if (tag === 'strong' || tag === 'b') return `**${text}**`;
  if (tag === 'em' || tag === 'i') return `*${text}*`;
  if (tag === 'code') return `\`${text}\``;
  if (tag === 'pre') return `\`\`\`\n${text}\n\`\`\``;
  
  const link = el.querySelector('a');
  if (link && link.innerText.trim() === text) {
    return `[${text}](${link.href})`;
  }
  
  return text;
}

// Formats a selection range, resolving links and wrapper elements to Markdown
function getRangeMarkdown(range, text, currentTargetEl) {
  if (!range) {
    return convertToMarkdown(currentTargetEl, text);
  }
  
  // Check if range is inside an anchor tag
  let container = range.commonAncestorContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    container = container.parentElement;
  }
  const anchor = container.closest('a');
  if (anchor) {
    return `[${text}](${anchor.href})`;
  }
  
  // Check if there is an anchor tag inside the range
  const fragment = range.cloneContents();
  const innerAnchor = fragment.querySelector('a');
  if (innerAnchor && innerAnchor.innerText.trim() === text) {
    return `[${text}](${innerAnchor.href})`;
  }
  
  // Otherwise, use the container element tag for formatting
  return convertToMarkdown(container, text);
}

// Processes the clipboard copy action applying formatting preferences and saving history logs
function handleCopyAction() {
  if (!currentCopyText) return;

  chrome.storage.local.get(["copyFormat", "copyHistory"], (res) => {
    const format = res.copyFormat || "plain";
    let formattedText = currentCopyText;

    if (format === "html") {
      if (activeRange) {
        const div = document.createElement('div');
        div.appendChild(activeRange.cloneContents());
        formattedText = div.innerHTML || currentCopyText;
      } else if (currentTarget) {
        formattedText = currentTarget.outerHTML || currentCopyText;
      }
    } else if (format === "markdown") {
      formattedText = getRangeMarkdown(activeRange, currentCopyText, currentTarget);
    }

    if (format === "source") {
      formattedText = `${currentCopyText}\n\nSource: ${window.location.href}`;
    }

    // Apply Regex pipeline filtration
    let finalText = formattedText;
    if (settings.regexMode !== "none") {
      let pattern = null;
      if (settings.regexMode === "email") {
        pattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      } else if (settings.regexMode === "url") {
        pattern = /https?:\/\/[^\s$.?#].[^\s]*/g;
      } else if (settings.regexMode === "ip") {
        pattern = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
      } else if (settings.regexMode === "uuid") {
        pattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
      } else if (settings.regexMode === "custom" && settings.customRegexPattern) {
        try {
          pattern = new RegExp(settings.customRegexPattern, "g");
        } catch (e) {
          console.error("Invalid custom regex pattern:", e);
        }
      }
      
      if (pattern) {
        const matches = formattedText.match(pattern);
        if (matches && matches.length > 0) {
          finalText = matches.join("\n");
        } else if (!settings.regexFallback) {
          finalText = "";
        }
      }
    }

    navigator.clipboard.writeText(finalText).then(() => {
      if (shadowRoot) {
        const copyBtn = shadowRoot.querySelector('#hover-copy-btn');
        if (copyBtn) {
          copyBtn.classList.add('success');
          setTimeout(() => {
            copyBtn.classList.remove('success');
          }, 1200);
        }
      }

      let history = res.copyHistory || [];
      history = history.filter(item => item !== finalText);
      if (finalText.trim()) {
        history.unshift(finalText);
      }
      if (history.length > 20) {
        history = history.slice(0, 20);
      }
      
      chrome.storage.local.set({ copyHistory: history }, () => {
        if (shadowRoot) {
          const dropdown = shadowRoot.querySelector('#history-dropdown');
          if (dropdown && dropdown.style.display === 'flex') {
            renderHistoryItems(history);
          }
        }
      });
    });
  });
}


// Load all configurations from Chrome storage on initialization
chrome.storage.local.get(
  ["hoverEnabled", "cleanCodeBlocks", "regexMode", "customRegexPattern", "regexFallback", "defaultAiPlatform"],
  (res) => {
    hoverEnabled = res.hoverEnabled ?? false;
    settings.cleanCodeBlocks = res.cleanCodeBlocks ?? true;
    settings.regexMode = res.regexMode ?? 'none';
    settings.customRegexPattern = res.customRegexPattern ?? '';
    settings.regexFallback = res.regexFallback ?? true;
    settings.defaultAiPlatform = res.defaultAiPlatform ?? 'chatgpt';
    console.log('Extension initialized with hoverEnabled:', hoverEnabled, 'settings:', settings);
    updateToolbarUI(hoverEnabled);
  }
);

// Listen for changes to the extension settings (e.g., from popup or options page)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.hoverEnabled) {
    console.log('Storage changed - updating hoverEnabled from', hoverEnabled, 'to', changes.hoverEnabled.newValue);
    hoverEnabled = changes.hoverEnabled.newValue;  // Update local state
    
    if (!hoverEnabled) {
      hideButton();              // Hide button if disabled
    }
    
    updateToolbarUI(hoverEnabled);
  }
  
  // Sync changed keys to local settings cache
  for (const key in changes) {
    if (key in settings) {
      settings[key] = changes[key].newValue;
    }
  }
});

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
  const skipTags = ["button", "input", "textarea", "select", "svg", "img", "a", "hover-copier-root"];
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
 * @param {HTMLElement} el - The starting element to check
 * @returns {HTMLElement|null} - Valid text element or null if none found
 */
function getValidTarget(el) {
  for (let i = 0; i < 2 && el; i++) {
    if (isTextElement(el)) return el;  // Return first valid element found
    el = el.parentElement;             // Move up to parent element
  }
  return null;  // No valid element found
}

// Draws highlight blocks inside the Shadow DOM matching visual client rect coordinates
function drawHighlight(rects, mode) {
  if (!shadowRoot) return;
  const container = shadowRoot.querySelector('#highlight-container');
  if (!container) return;
  
  container.innerHTML = '';
  const isBlock = mode === 'BLOCK';
  
  for (const rect of rects) {
    if (rect.width === 0 || rect.height === 0) continue;
    
    const block = document.createElement('div');
    Object.assign(block.style, {
      position: 'fixed',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      backgroundColor: isBlock ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.12)',
      border: isBlock ? '1.5px dashed rgba(16, 185, 129, 0.4)' : 'none',
      borderBottom: isBlock ? '1.5px dashed rgba(16, 185, 129, 0.4)' : '2px solid #10B981',
      pointerEvents: 'none',
      borderRadius: isBlock ? '4px' : '2px',
      boxSizing: 'border-box'
    });
    container.appendChild(block);
  }
}

// Adjusts the positions of custom copy button, AI sparkles button, and centered floating mode badge in viewport space
function positionCopyButton(rects, mode) {
  if (!shadowRoot) return;
  const copyBtn = shadowRoot.querySelector('#hover-copy-btn');
  const aiBtn = shadowRoot.querySelector('#hover-ai-btn');
  const modeBadge = shadowRoot.querySelector('#hover-mode-badge');
  if (!copyBtn) return;
  
  let minTop = Infinity;
  let maxRight = -Infinity;
  let minLeft = Infinity;
  let maxBottom = -Infinity;
  
  for (const rect of rects) {
    if (rect.top < minTop) minTop = rect.top;
    if (rect.left < minLeft) minLeft = rect.left;
    if (rect.right > maxRight) maxRight = rect.right;
    if (rect.bottom > maxBottom) maxBottom = rect.bottom;
  }
  
  if (minTop === Infinity) {
    copyBtn.style.display = 'none';
    if (aiBtn) aiBtn.style.display = 'none';
    if (modeBadge) modeBadge.style.display = 'none';
    return;
  }
  
  // Position Copy Button
  copyBtn.style.display = 'flex';
  copyBtn.style.top = `${minTop - 8}px`;
  copyBtn.style.left = `${maxRight + 6}px`;
  
  const btnWidth = 32;
  if (maxRight + 6 + btnWidth > window.innerWidth) {
    copyBtn.style.left = `${maxRight - btnWidth - 6}px`;
  }
  if (minTop - 8 < 0) {
    copyBtn.style.top = `${minTop + 4}px`;
  }

  // Position AI Sparkles Button
  if (aiBtn) {
    aiBtn.style.display = 'flex';
    aiBtn.style.left = copyBtn.style.left;
    const btnTop = parseFloat(copyBtn.style.top);
    if (btnTop + 38 + 32 > window.innerHeight) {
      aiBtn.style.top = `${btnTop - 38}px`;
    } else {
      aiBtn.style.top = `${btnTop + 38}px`;
    }
  }

  // Position Centered Mode Badge
  if (modeBadge) {
    modeBadge.style.display = 'block';
    const centerX = (minLeft + maxRight) / 2;
    modeBadge.style.left = `${centerX}px`;
    modeBadge.style.top = `${minTop - 28}px`;
    modeBadge.style.transform = 'translateX(-50%)';
    
    // Flip to bottom if it overflows top of window
    if (minTop - 28 < 0) {
      modeBadge.style.top = `${maxBottom + 8}px`;
    }
  }
}

// Updates the badge indicating selection mode
function updateModeBadge(mode) {
  if (!shadowRoot) return;
  const badge = shadowRoot.querySelector('#hover-mode-badge');
  if (badge) {
    badge.textContent = mode;
    badge.className = 'floating-mode-badge';
    if (mode === 'BLOCK') {
      badge.classList.add('mode-block');
    } else if (mode === 'SENTENCE') {
      badge.classList.add('mode-sentence');
    } else if (mode === 'WORD') {
      badge.classList.add('mode-word');
    }
  }
}

// Updates the cache of active selection client rects and computes copy button bounding box
function updateActiveRects(rects) {
  activeTargetRects = Array.from(rects).map(r => ({
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom
  }));
  
  if (rects.length > 0) {
    let minTop = Infinity;
    let maxRight = -Infinity;
    let minLeft = Infinity;
    let maxBottom = -Infinity;
    
    for (const rect of rects) {
      if (rect.top < minTop) minTop = rect.top;
      if (rect.left < minLeft) minLeft = rect.left;
      if (rect.right > maxRight) maxRight = rect.right;
      if (rect.bottom > maxBottom) maxBottom = rect.bottom;
    }
    
    let btnLeft = maxRight + 6;
    let btnTop = minTop - 8;
    const btnSize = 32;
    
    if (maxRight + 6 + btnSize > window.innerWidth) {
      btnLeft = maxRight - btnSize - 6;
    }
    if (minTop - 8 < 0) {
      btnTop = minTop + 4;
    }
    
    activeButtonRect = {
      left: btnLeft,
      top: btnTop,
      right: btnLeft + btnSize,
      bottom: btnTop + btnSize
    };
    
    // Union Box Safe Zone: includes target text bounds + button bounds + 10px margin
    activeSafeZoneBox = {
      left: Math.min(minLeft, btnLeft) - 10,
      top: Math.min(minTop, btnTop) - 10,
      right: Math.max(maxRight, btnLeft + btnSize) + 10,
      bottom: Math.max(maxBottom, btnTop + btnSize) + 10
    };
  } else {
    activeButtonRect = null;
    activeSafeZoneBox = null;
  }
}

// Determines if mouse coordinates are inside the active target highlight or button safe zone
function isMouseInSafeZone(x, y) {
  if (!activeSafeZoneBox) return false;
  
  if (
    x >= activeSafeZoneBox.left &&
    x <= activeSafeZoneBox.right &&
    y >= activeSafeZoneBox.top &&
    y <= activeSafeZoneBox.bottom
  ) {
    return true;
  }

  // Include prompt box space in safe zone if active
  if (shadowRoot) {
    const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
    if (promptBox && promptBox.style.display === 'flex') {
      const rect = promptBox.getBoundingClientRect();
      if (
        x >= rect.left - 10 &&
        x <= rect.right + 10 &&
        y >= rect.top - 10 &&
        y <= rect.bottom + 10
      ) {
        return true;
      }
    }
  }

  return false;
}

// Delays hiding the copy button to allow the cursor to bridge any hover gaps
function hideButtonWithDelay() {
  if (shadowRoot) {
    const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
    if (promptBox && promptBox.style.display === 'flex') {
      return; // Do not hide overlays while typing AI prompt
    }
  }

  if (hideTimeout) return;
  hideTimeout = setTimeout(() => {
    hideButton();
    hideTimeout = null;
  }, 400); // 400ms buffer to transition cursor to button
}

// Cancels the scheduled button hiding
function cancelHideDelay() {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
}

// Process details about hovered segments under a point
function processHover(x, y, altKey, shiftKey) {
  if (shadowRoot) {
    const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
    if (promptBox && promptBox.style.display === 'flex') {
      return;
    }
  }

  let mode = 'BLOCK';
  if (altKey) {
    mode = shiftKey ? 'WORD' : 'SENTENCE';
  }
  
  updateModeBadge(mode);
  
  const rawElement = findTextElementUnderPoint(x, y);
  if (!rawElement) {
    hideButtonWithDelay();
    return;
  }
  
  const el = getValidTarget(rawElement);
  if (!el) {
    hideButtonWithDelay();
    return;
  }
  
  let targetText = "";
  let highlightRange = null;
  let targetRects = null;
  activeRange = null; // Reset active range
  
  if (mode === 'BLOCK') {
    targetText = settings.cleanCodeBlocks ? getCleanCodeText(el) : (el.innerText?.trim() || "");
    targetRects = [el.getBoundingClientRect()];
  } else {
    let caretRange = null;
    if (document.caretRangeFromPoint) {
      caretRange = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        caretRange = document.createRange();
        caretRange.setStart(pos.offsetNode, pos.offset);
        caretRange.setEnd(pos.offsetNode, pos.offset);
      }
    }
    
    if (caretRange && caretRange.startContainer) {
      if (mode === 'SENTENCE') {
        highlightRange = getSentenceRange(caretRange.startContainer, caretRange.startOffset);
      } else {
        highlightRange = getWordRange(caretRange.startContainer, caretRange.startOffset);
      }
    }
    
    if (highlightRange) {
      targetText = highlightRange.toString().trim();
      targetRects = highlightRange.getClientRects();
      activeRange = highlightRange;
    }
  }
  
  if (!targetText || targetText.length < 1 || !targetRects || targetRects.length === 0) {
    hideButtonWithDelay();
    return;
  }
  
  // Successful hover target located - cancel any scheduled hide
  cancelHideDelay();
  
  currentTarget = el;
  currentCopyText = targetText;
  drawHighlight(targetRects, mode);
  positionCopyButton(targetRects, mode);
  updateActiveRects(targetRects);
}

// Hides overlay highlights and copy buttons immediately
function hideButton() {
  cancelHideDelay();
  
  // Lock hide mechanism if prompt input currently is visible inside Shadow DOM
  if (shadowRoot) {
    const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
    if (promptBox && promptBox.style.display === 'flex') {
      return;
    }
  }

  currentCopyText = "";
  currentTarget = null;
  activeRange = null;
  activeTargetRects = [];
  activeButtonRect = null;
  activeSafeZoneBox = null;
  if (shadowRoot) {
    const highlightContainer = shadowRoot.querySelector('#highlight-container');
    if (highlightContainer) highlightContainer.innerHTML = '';
    const copyBtn = shadowRoot.querySelector('#hover-copy-btn');
    if (copyBtn) copyBtn.style.display = 'none';
    const aiBtn = shadowRoot.querySelector('#hover-ai-btn');
    if (aiBtn) aiBtn.style.display = 'none';
    const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
    if (promptBox) promptBox.style.display = 'none';
    const modeBadge = shadowRoot.querySelector('#hover-mode-badge');
    if (modeBadge) modeBadge.style.display = 'none';
  }
}

// Main mouse movement handler - tracks cursor position and manages selection processing
document.addEventListener("mousemove", (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  
  if (!hoverEnabled) {
    hideButton();
    return;
  }
  
  // Lock hover state and exit early if the AI prompt box is currently open
  if (shadowRoot) {
    const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
    if (promptBox && promptBox.style.display === 'flex') {
      return;
    }
  }
  
  // High-performance early-exit: lock hover state if mouse is inside the safe zone
  if (currentCopyText && isMouseInSafeZone(e.clientX, e.clientY)) {
    cancelHideDelay();
    return;
  }
  
  processHover(e.clientX, e.clientY, e.altKey, e.shiftKey);
});

// Hide selection overlay immediately when scrolling or window loses focus
document.addEventListener("scroll", hideButton);
window.addEventListener("blur", () => {
  // Prevent Alt-menu bar triggers in Windows from hiding our active highlight
  if (altKeyPressed) return;
  hideButton();
});

// Monitor modifier key changes to update selection granularity in real-time
window.addEventListener("keydown", (e) => {
  // 1. Prevent default menu behaviors for Alt key immediately if extension is active
  if (e.key === 'Alt') {
    altKeyPressed = true;
    if (hoverEnabled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // 2. Switch AI platform using 1, 2, 3 inside prompt box (1 = ChatGPT, 2 = Gemini, 3 = Claude)
  if (shadowRoot) {
    const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
    if (promptBox && promptBox.style.display === 'flex') {
      const isInputFocused = shadowRoot.activeElement && shadowRoot.activeElement.id === 'hover-ai-input';
      const isNumberKey = e.key === '1' || e.key === '2' || e.key === '3';
      
      if (isNumberKey && (!isInputFocused || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        const platformMap = { '1': 'chatgpt', '2': 'gemini', '3': 'claude' };
        const targetId = platformMap[e.key];
        const chip = promptBox.querySelector(`.prompt-chip[data-platform="${targetId}"]`);
        if (chip) {
          chip.click();
        }
        return;
      }
    }
  }

  // 3. Toggle extension ON/OFF with Ctrl+Shift+H (accessible globally, even from input fields)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
    e.preventDefault();
    e.stopPropagation();
    toggleHoverFeature();
    return;
  }

  // 3. Skip hotkeys and modifier granularity tracking if typing in forms/input fields
  const activeElement = document.activeElement;
  const isInInputField = (activeElement && (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.contentEditable === 'true'
  )) || (shadowRoot && shadowRoot.activeElement && (
    shadowRoot.activeElement.tagName === 'INPUT' ||
    shadowRoot.activeElement.tagName === 'TEXTAREA'
  ));
  if (isInInputField) return;

  // 4. Track modifier changes for selection granularity in real-time
  if (e.key === 'Alt' || e.key === 'Shift') {
    if (hoverEnabled) {
      processHover(lastMouseX, lastMouseY, e.altKey, e.shiftKey);
    }
  }

  // 5. Copy active hover content instantly with standard C key
  if (hoverEnabled && (e.key === 'C' || e.key === 'c') && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    handleCopyAction();
    return;
  }

  // 6. Focus prompt box instantly with standard A key
  if (hoverEnabled && (e.key === 'A' || e.key === 'a') && !e.ctrlKey && !e.metaKey) {
    if (shadowRoot) {
      const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
      if (promptBox && promptBox.style.display !== 'flex' && currentCopyText) {
        e.preventDefault();
        e.stopPropagation();
        showAiPromptBox();
        return;
      }
    }
  }

  // 7. OCR active element instantly with standard O key
  if (hoverEnabled && (e.key === 'O' || e.key === 'o') && !e.ctrlKey && !e.metaKey) {
    const rawElement = findTextElementUnderPoint(lastMouseX, lastMouseY);
    if (rawElement) {
      let el = getValidTarget(rawElement);
      if (!el) el = rawElement;
      
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        currentTarget = el;
        isOcrTarget = true;
        const rects = [el.getBoundingClientRect()];
        drawHighlight(rects, 'OCR');
        positionCopyButton(rects, 'OCR');
        updateActiveRects(rects);
        updateModeBadge('OCR');
        triggerOcrCapture();
        return;
      }
    }
  }
}, true);

window.addEventListener("keyup", (e) => {
  if (e.key === 'Alt') {
    altKeyPressed = false;
  }
  
  // Skip modifier release event triggers if typing in forms/input fields
  const activeElement = document.activeElement;
  const isInInputField = (activeElement && (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.contentEditable === 'true'
  )) || (shadowRoot && shadowRoot.activeElement && (
    shadowRoot.activeElement.tagName === 'INPUT' ||
    shadowRoot.activeElement.tagName === 'TEXTAREA'
  ));
  if (isInInputField) return;

  if (e.key === 'Alt' || e.key === 'Shift') {
    if (hoverEnabled) {
      processHover(lastMouseX, lastMouseY, e.altKey, e.shiftKey);
    }
  }
}, true);

// Close history dropdown or prompt box when clicking outside of it on the page
document.addEventListener("click", (e) => {
  if (shadowRoot) {
    const dropdown = shadowRoot.querySelector('#history-dropdown');
    const histBtn = shadowRoot.querySelector('#history-toggle-btn');
    if (dropdown && dropdown.style.display === 'flex') {
      if (e.target !== shadowRootHost) {
        dropdown.style.display = 'none';
        if (histBtn) histBtn.classList.remove('active');
      }
    }

    const promptBox = shadowRoot.querySelector('#hover-ai-prompt-box');
    if (promptBox && promptBox.style.display === 'flex') {
      if (e.target !== shadowRootHost) {
        hideAiPromptBox();
        hideButton();
      }
    }
  }
});

// Toggles the extension state and updates storage
function toggleHoverFeature() {
  hoverEnabled = !hoverEnabled;
  chrome.storage.local.set({ hoverEnabled });
  
  if (!hoverEnabled) {
    hideButton();
  } else {
    const elementUnderMouse = findTextElementUnderPoint(lastMouseX || 0, lastMouseY || 0);
    if (elementUnderMouse) {
      const el = getValidTarget(elementUnderMouse);
      if (el) {
        processHover(lastMouseX, lastMouseY, false, false);
      }
    }
  }
}

// Automatically detects if the page is ChatGPT, Gemini, or Claude and autofills pending prompt
function attemptToFillPrompt() {
  const hostname = window.location.hostname;
  const isChatGPT = hostname.includes('chatgpt.com');
  const isGemini = hostname.includes('gemini.google.com');
  const isClaude = hostname.includes('claude.ai');
  
  if (!isChatGPT && !isGemini && !isClaude) return;
  
  chrome.storage.local.get("pendingAiPrompt", (res) => {
    const prompt = res.pendingAiPrompt;
    if (!prompt) return;
    
    // Clear immediately to prevent double-filling or re-filling on manual page refresh
    chrome.storage.local.remove("pendingAiPrompt");
    
    let attempts = 0;
    const maxAttempts = 30; // 15 seconds max (30 * 500ms)
    
    const interval = setInterval(() => {
      attempts++;
      
      let inputElement = null;
      
      if (isChatGPT) {
        inputElement = document.querySelector('#prompt-textarea') || 
                       document.querySelector('textarea[placeholder*="ChatGPT"]') ||
                       document.querySelector('textarea');
      } else if (isGemini) {
        inputElement = document.querySelector('rich-textarea div[contenteditable="true"]') ||
                       document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                       document.querySelector('div[contenteditable="true"]') ||
                       document.querySelector('textarea');
      } else if (isClaude) {
        inputElement = document.querySelector('div[contenteditable="true"]') ||
                       document.querySelector('.ProseMirror') ||
                       document.querySelector('textarea');
      }
      
      if (inputElement) {
        clearInterval(interval);
        
        // Focus input element
        inputElement.focus();
        
        // Try executing native browser paste command (best compatibility for web framework SPAs)
        let success = false;
        try {
          // Select all existing placeholder content if any
          document.execCommand('selectAll', false, null);
          success = document.execCommand('insertText', false, prompt);
        } catch (e) {
          console.warn("execCommand insertText failed:", e);
        }
        
        // Fallback to manual text injection if execCommand did not take effect
        const currentVal = inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT'
          ? inputElement.value
          : inputElement.innerText;
          
        if (!success || !currentVal || currentVal.trim() !== prompt.trim()) {
          if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
            inputElement.value = prompt;
          } else {
            inputElement.innerText = prompt;
          }
          
          // Trigger change detection events for React/Vue
          ['input', 'change'].forEach(eventName => {
            const event = new Event(eventName, { bubbles: true, cancelable: true });
            inputElement.dispatchEvent(event);
          });
        }
        
        // Trigger generic change detection events anyway to ensure send button state re-evaluates
        ['input', 'change'].forEach(eventName => {
          const event = new Event(eventName, { bubbles: true, cancelable: true });
          inputElement.dispatchEvent(event);
        });
        
        // Move selection cursor to the end of input
        try {
          const range = document.createRange();
          range.selectNodeContents(inputElement);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {}
        
        console.log("Hover Text Copier: Pending AI prompt autofilled successfully.");
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.warn("Hover Text Copier: Input element not found after polling.");
      }
    }, 500);
  });
}

// Run prompt autofill handler immediately on script execution
attemptToFillPrompt();

