// Global variables
let cipherEnabled = false;
let observer = null;

// Regex that matches currency values and percentages in various formats:
// $1,234.56  ($1,234.56)  -$1,234.56  +$1,234.56  $1.2k  $1.2M  45%  45.5%
// Note: no /g flag here – callers create their own instances to avoid shared lastIndex state.
// Note: optional sign is NOT followed by \s* to avoid consuming the preceding word-separator space.
const SENSITIVE_NUMBER_REGEX = /(?:[-+])?[\$€£¥]\s*[\d,.']+(?:[kKmMbB])?|\([\$€£¥]\s*[\d,.']+(?:[kKmMbB])?\)|\b[\d,.']+(?:[kKmMbB])?\s*%/;

// Helper function to get a unique CSS selector for an element
function getUniqueSelector(element) {
  if (!element) return '';
  if (element.id) return '#' + element.id;
  
  // Try to use classes
  if (element.className) {
    const classes = element.className.split(' ')
      .filter(c => c && !c.includes('cipher'))
      .join('.');
    if (classes) return '.' + classes;
  }
  
  // Fallback to a position-based selector
  let path = '';
  while (element && element.tagName) {
    let selector = element.tagName.toLowerCase();
    let sibling = element;
    let siblingCount = 0;
    
    while (sibling = sibling.previousElementSibling) {
      if (sibling.tagName === element.tagName) {
        siblingCount++;
      }
    }
    
    if (siblingCount > 0) {
      selector += ':nth-of-type(' + (siblingCount + 1) + ')';
    }
    
    path = selector + (path ? ' > ' + path : '');
    
    if (element.parentElement && element.parentElement.tagName) {
      element = element.parentElement;
    } else {
      break;
    }
  }
  
  return path;
}

// Initialize the extension
function initCipher() {
  // Check if this is Monarch Money
  const isMonarchMoney = window.location.hostname.includes('monarchmoney.com');
  
  // Only run on Monarch Money
  if (!isMonarchMoney) {
    return;
  }
  
  // Check initial state from storage
  chrome.storage.local.get('cipherEnabled', (data) => {
    cipherEnabled = data.cipherEnabled || false;
    if (cipherEnabled) {
      startMasking();
    }
  });

  // Listen for messages from popup or background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateCipherState') {
      cipherEnabled = message.enabled;
      
      if (cipherEnabled) {
        startMasking();
      } else {
        stopMasking();
      }
      
      sendResponse({ success: true });
    }
  });
}

// Start the masking process
function startMasking() {
  // First, mask existing content
  maskAllNumbers();
  
  // Specifically target table cells and grid layouts 
  // This helps with financial apps like Monarch Money
  maskTableData();
  
  // Override content display for financial apps
  overrideFinancialAppDisplays();
  
  // Set up observer for new content
  setupObserver();
}

// Specifically target financial app displays with special handling
function overrideFinancialAppDisplays() {
  // Use CSS to mask numbers in table cells and common financial app elements
  const style = document.createElement('style');
  style.id = 'cipher-finance-style';
  style.textContent = `
    /* Theme-aware mask color via CSS custom properties */
    :root {
      --monarch-mask-dot-color: #333333;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --monarch-mask-dot-color: #cccccc;
      }
    }

    /* Hide actual text content but keep the element dimensions */
    .cipher-masked {
      color: transparent !important;
      position: relative !important;
    }
    
    /* Add masked content overlay */
    .cipher-masked::before {
      content: '•••' !important;
      position: absolute !important;
      left: 0 !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      color: var(--monarch-mask-dot-color, #888) !important;
      background: transparent !important;
      z-index: 10000 !important;
    }
    
    /* Special handling for Monarch Money's fields */
    input[class*="CurrencyInput"],
    input[class*="AmountInput"],
    input[name="budgeted"],
    input.fs-exclude {
      opacity: 0 !important;
    }
    
    /* Target number-flow elements directly (both legacy and current element names) */
    number-flow-react,
    number-flow,
    .fs-mask,
    [data-testid="budget-amount"] {
      color: transparent !important;
    }
    
    /* Overlay dots for number-flow and special mask elements */
    .monarch-special-mask,
    .monarch-digit-mask,
    .monarch-mask-overlay,
    .monarch-cover-mask {
      color: var(--monarch-mask-dot-color, #888) !important;
    }

    /* Strong masking for Monarch Money budget page */
    td[data-testid] span:not(.monarch-mask-overlay):not(.monarch-cover-mask) {
      color: transparent !important;
    }
    
    /* Hide balance numbers completely */
    [class*="balance"] span:not(.monarch-mask-overlay):not(.monarch-cover-mask),
    [class*="spending"] span:not(.monarch-mask-overlay):not(.monarch-cover-mask),
    [class*="value"] span:not(.monarch-mask-overlay):not(.monarch-cover-mask),
    [class*="amount"] span:not(.monarch-mask-overlay):not(.monarch-cover-mask) {
      color: transparent !important;
    }
    
    /* Blanket approach for all table cells */
    td > div > span:not(.monarch-mask-overlay):not(.monarch-cover-mask) {
      color: transparent !important;
    }
  `;
  document.head.appendChild(style);
  
  // Apply masking to all cells with dollar amounts and numbers
  // Use a variety of selectors to target financial app interfaces
  const potentialFinancialElements = document.querySelectorAll(
    // Target elements that likely contain financial data
    '[class*="amount"], [class*="balance"], [class*="budget"], [class*="price"], ' +
    '[class*="cost"], [class*="total"], [class*="value"], [class*="money"], ' +
    '[class*="currency"], [class*="number"], [id*="amount"], [id*="balance"], ' +
    '[id*="budget"], [id*="price"], [id*="cost"], [id*="total"], [id*="value"], ' +
    // Target common table cells in financial tables
    'td, th, [role="cell"], [role="gridcell"], ' + 
    // Target specific cell-like structures 
    '[style*="display: grid"] > div, [style*="display: flex"] > div'
  );
  
  // Specifically target Monarch Money input fields - these need special handling
  const monarchInputs = document.querySelectorAll('input[class*="CurrencyInput"], input[class*="AmountInput"], input[name="budgeted"], input.fs-exclude');
  
  // Target the special animated digit display in Monarch Money
  const specialDigitElements = document.querySelectorAll('.number__inner, [part="digit"], [part="integer"], [part="fraction"]');
  
  // Process animated digit displays
  specialDigitElements.forEach(element => {
    // Check if this element is a number display container
    if (element.classList.contains('number__inner') || element.hasAttribute('part')) {
      // Find the parent container to apply masking
      let container = element;
      while (container && !container.matches('[class*="balance"], [class*="value"], .number, [class*="amount"]') && container !== document.body) {
        container = container.parentElement;
      }
      
      if (container) {
        // Create a mask if it doesn't exist yet
        if (!container.querySelector('.monarch-digit-mask')) {
          const maskContainer = document.createElement('div');
          maskContainer.className = 'monarch-digit-mask';
          maskContainer.textContent = '•••';
          maskContainer.style.position = 'absolute';
          maskContainer.style.left = '0';
          maskContainer.style.top = '0';
          maskContainer.style.width = '100%';
          maskContainer.style.height = '100%';
          maskContainer.style.display = 'flex';
          maskContainer.style.alignItems = 'center';
          maskContainer.style.justifyContent = 'center';
          maskContainer.style.backgroundColor = 'inherit';
          maskContainer.style.zIndex = '10000';
          maskContainer.style.pointerEvents = 'none';
          
          // Make the container relative for positioning
          if (window.getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
          }
          
          // Just set container to have all text transparent - simpler approach
          container.style.cssText += 'color: transparent !important;';
          
          // Also set inner elements to be transparent as a backup
          const allInnerElements = container.querySelectorAll('*');
          allInnerElements.forEach(el => {
            el.style.color = 'transparent';
          });
          
          container.appendChild(maskContainer);
        }
      }
    }
  });
  
  // Process input fields
  monarchInputs.forEach(input => {
    // Create a visible mask for the input
    const inputParent = input.parentElement;
    
    // Only add the mask if we haven't already
    if (!inputParent.querySelector('.monarch-mask-overlay')) {
      // Hide the original input but ensure it's still functional
      input.style.color = 'transparent';
      
      // Create and insert the mask
      const mask = document.createElement('div');
      mask.className = 'monarch-mask-overlay';
      mask.textContent = '•••';
      mask.style.position = 'absolute';
      mask.style.left = '0';
      mask.style.top = '0';
      mask.style.width = '100%';
      mask.style.height = '100%';
      mask.style.display = 'flex';
      mask.style.alignItems = 'center';
      mask.style.justifyContent = 'flex-end';
      mask.style.paddingRight = '8px';
      mask.style.pointerEvents = 'none';
      mask.style.zIndex = '1000';
      mask.style.backgroundColor = 'transparent';
      // Set a specific color to ensure the dots are visible in any theme
      mask.style.color = 'white';
      
      // Make parent relative for absolute positioning
      if (window.getComputedStyle(inputParent).position === 'static') {
        inputParent.style.position = 'relative';
      }
      
      inputParent.appendChild(mask);
    }
  });
  
  potentialFinancialElements.forEach(element => {
    // Check if the element contains a number
    const text = element.textContent.trim();
    const hasNumber = /\d/.test(text);
    
    // Skip already masked or very large text blocks
    if (!hasNumber || text.length > 50) return;
    
    // For input elements, we need to handle them differently
    if (element.tagName === 'INPUT') {
      // Only mask read-only inputs - these are often used for display
      if (element.hasAttribute('readonly') || element.getAttribute('type') === 'text') {
        // Create a wrapper around the input if needed
        if (!element.parentElement.classList.contains('cipher-input-wrapper')) {
          const wrapper = document.createElement('div');
          wrapper.className = 'cipher-input-wrapper';
          wrapper.style.position = 'relative';
          element.parentNode.insertBefore(wrapper, element);
          wrapper.appendChild(element);
        }
        
        // Apply masking overlay
        if (!element.nextElementSibling || !element.nextElementSibling.classList.contains('cipher-input-mask')) {
          const overlay = document.createElement('div');
          overlay.className = 'cipher-input-mask';
          overlay.textContent = '•••';
          overlay.style.position = 'absolute';
          overlay.style.left = '0';
          overlay.style.top = '0';
          overlay.style.width = '100%';
          overlay.style.height = '100%';
          overlay.style.display = 'flex';
          overlay.style.alignItems = 'center';
          overlay.style.padding = '0 8px';
          overlay.style.pointerEvents = 'none';
          overlay.style.zIndex = '1000';
          overlay.style.backgroundColor = 'inherit';
          element.parentNode.insertBefore(overlay, element.nextSibling);
          
          // Hide the actual input text
          element.style.color = 'transparent';
        }
      }
      return;
    }
    
    // Skip other form elements and editable fields
    if (element.tagName === 'TEXTAREA' || 
        element.tagName === 'SELECT' ||
        element.hasAttribute('contenteditable')) {
      return;
    }
    
    // Check if the element might be a financial value (only currency and percentage)
    const isCurrencyValue = 
      /^\s*\$\s*\d/.test(text) || // Starts with $ followed by number
      /^\s*\d+([.,]\d+)*(\.\d+)?\s*%\s*$/.test(text); // Percentage
    
    if (isCurrencyValue) {
      // Mark as masked through classes for styling
      element.classList.add('cipher-masked');
      
      // If Monarch Money is detected, apply additional specific masking
      if (window.location.hostname.includes('monarchmoney')) {
        // Apply more specific selectors for Monarch Money
        if (element.closest('[class*="budget"]') || 
            element.closest('[class*="amount"]')) {
          element.classList.add('cipher-masked');
          element.setAttribute('data-original-text', element.textContent);
        }
      }
    }
  });
}

// Specifically mask content in tables and grid layouts
function maskTableData() {
  // Target table cells (td elements)
  const tableCells = document.querySelectorAll('td');
  tableCells.forEach(cell => {
    // Process each table cell directly
    processTextInElement(cell);
  });
  
  // Target div elements that might be acting as cells in a grid layout
  // (common in modern web apps that use CSS Grid or Flexbox for tables)
  const divCells = document.querySelectorAll('div');
  divCells.forEach(div => {
    // Check if this div might be a grid/table cell
    const style = window.getComputedStyle(div);
    const text = div.textContent.trim();
    
    // If the div contains a number and looks like it could be a cell
    // (short text content, specific display types)
    if (text.length < 20 && /\d/.test(text) && 
        (style.display.includes('flex') || 
         style.display.includes('grid') || 
         style.display.includes('table'))) {
      processTextInElement(div);
    }
  });
}

// Process all text inside an element directly
function processTextInElement(element) {
  if (!element || !shouldProcessNode(element)) return;
  
  // Handle immediate text in this element (not in children)
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const replaced = node.textContent.replace(new RegExp(SENSITIVE_NUMBER_REGEX.source, 'g'), '•••');
      if (replaced !== node.textContent) {
        node.textContent = replaced;
      }
    }
  }
  
  // In case the element has no child text nodes but has direct textContent
  if (element.childNodes.length === 0 && element.textContent.trim() !== '') {
    const replaced = element.textContent.replace(new RegExp(SENSITIVE_NUMBER_REGEX.source, 'g'), '•••');
    if (replaced !== element.textContent) {
      element.textContent = replaced;
    }
  }
}

// Stop the masking process
function stopMasking() {
  // Disconnect observer if exists
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  
  // Reload page to restore original content
  // This is the simplest way to restore all numbers
  location.reload();
}

// Setup mutation observer to watch for DOM changes
function setupObserver() {
  // Disconnect existing observer if any
  if (observer) {
    observer.disconnect();
  }
  
  // Debounced version of maskAllNumbers to avoid excessive full-page scans
  let debounceTimer = null;
  function debouncedMaskAll() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => maskAllNumbers(), 300);
  }
  
  // Create new observer
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Handle added nodes
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach(node => {
          if (shouldProcessNode(node)) {
            processNode(node);
          }
        });
      }
      
      // Handle character data changes
      if (mutation.type === 'characterData' && 
          shouldProcessNode(mutation.target)) {
        processTextNode(mutation.target);
      }
      
      // Also process the parent element for attribute changes
      // This helps catch changes to elements that might be using custom rendering
      if (mutation.target && mutation.target.parentElement) {
        processNode(mutation.target.parentElement);
      }
    }
    
    // Debounced full-page scan to catch elements missed by targeted processing
    debouncedMaskAll();
  });
  
  // Start observing the document with the configured parameters
  observer.observe(document.body, { 
    childList: true, 
    subtree: true, 
    characterData: true,
    attributes: true,
    attributeFilter: ['textContent', 'innerText', 'innerHTML', 'value', 'aria-label']
  });
  
  // Additional recurring scan to ensure we catch all numbers
  // This helps with SPAs and dynamic content that might evade the observer
  setInterval(maskAllNumbers, 2000);
}

// Get a visible text color from an element (used before making it transparent)
function getVisibleColor(element) {
  const color = window.getComputedStyle(element).color;
  if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
    return color;
  }
  // Walk up the tree to find a parent with a real color
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const parentColor = window.getComputedStyle(parent).color;
    if (parentColor && parentColor !== 'transparent' && parentColor !== 'rgba(0, 0, 0, 0)') {
      return parentColor;
    }
    parent = parent.parentElement;
  }
  // Fall back to a mid-gray that's readable in both light and dark themes
  return 'var(--monarch-mask-dot-color, #888888)';
}

// Apply a cover mask overlay to an element
function applyCoverMask(element) {
  if (element.dataset.monarchMasked) return;
  
  // Capture original color BEFORE making element transparent
  const originalColor = getVisibleColor(element);
  
  element.style.color = 'transparent';
  element.dataset.monarchMasked = '1';
  
  const parent = element.parentElement;
  if (!parent) return;
  
  if (!parent.querySelector('.monarch-cover-mask')) {
    if (window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    
    const mask = document.createElement('div');
    mask.className = 'monarch-cover-mask';
    mask.textContent = '•••';
    mask.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${originalColor};
      background: transparent;
      pointer-events: none;
      z-index: 10000;
    `;
    parent.appendChild(mask);
  }
}

// Pattern that matches an aria-label whose *entire value* is a currency or percentage amount.
// This is anchored (^ and $) so it only matches elements whose aria-label exclusively describes
// a financial value, unlike SENSITIVE_NUMBER_REGEX which finds values embedded in longer text.
const ariaLabelCurrencyPattern = /^\s*[-+]?\s*[\$€£¥]\s*[\d,.']+[kKmMbB]?\s*$|^\s*[\d,.']+\s*%\s*$/;

// Process all existing numbers on the page
function maskAllNumbers() {
  // Strategy 1: number-flow custom elements (both legacy and current element names)
  const numberFlowElements = document.querySelectorAll('number-flow-react, number-flow, .fs-mask');
  numberFlowElements.forEach(element => {
    if (element.dataset.monarchMasked) return;
    
    // Capture original color BEFORE making element transparent
    const originalColor = getVisibleColor(element);
    element.style.color = 'transparent';
    element.dataset.monarchMasked = '1';
    
    // Create an overlay with dots if not already present
    const parent = element.parentElement;
    if (parent && !parent.querySelector('.monarch-special-mask')) {
      if (window.getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      
      const mask = document.createElement('div');
      mask.className = 'monarch-special-mask';
      mask.textContent = '•••';
      mask.style.cssText = `
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        color: ${originalColor};
        pointer-events: none;
      `;
      parent.appendChild(mask);
    }
  });

  // Strategy 2: elements whose aria-label describes a currency or percentage value
  document.querySelectorAll('[aria-label]').forEach(element => {
    if (element.dataset.monarchMasked) return;
    const label = element.getAttribute('aria-label');
    if (label && ariaLabelCurrencyPattern.test(label)) {
      applyCoverMask(element);
    }
  });

  // Process all text nodes in the document
  const treeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Skip if node is empty or whitespace only
        if (!node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Skip if parent should be ignored
        if (!shouldProcessNode(node.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  // Collect nodes first to avoid issues with modifying the tree while walking
  const textNodes = [];
  while (treeWalker.nextNode()) {
    textNodes.push(treeWalker.currentNode);
  }
  
  // Process all collected text nodes
  textNodes.forEach(node => {
    processTextNode(node);
  });
}

// Check if a node should be processed
function shouldProcessNode(node) {
  // Skip if node is null or not an element
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return true; // Text nodes should be processed by default
  }
  
  // Skip script, style, and meta tags
  if (['SCRIPT', 'STYLE', 'META', 'NOSCRIPT'].includes(node.tagName)) {
    return false;
  }
  
  // Skip input, textarea, and other editable elements
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
    return false;
  }
  
  // Skip elements with contenteditable attribute
  if (node.hasAttribute('contenteditable') || 
      node.getAttribute('contenteditable') === 'true' ||
      node.getAttribute('contenteditable') === '') {
    return false;
  }
  
  // Check if this element or any parent has contenteditable
  let parent = node.parentElement;
  while (parent) {
    if (parent.hasAttribute('contenteditable') || 
        parent.getAttribute('contenteditable') === 'true' ||
        parent.getAttribute('contenteditable') === '') {
      return false;
    }
    parent = parent.parentElement;
  }
  
  // Skip password fields
  if (node.getAttribute('type') === 'password') {
    return false;
  }
  
  // Skip hidden elements
  if (window.getComputedStyle(node).display === 'none' || 
      window.getComputedStyle(node).visibility === 'hidden') {
    return false;
  }
  
  return true;
}

// Process a DOM node (element or text)
function processNode(node) {
  // If it's a text node, process it directly
  if (node.nodeType === Node.TEXT_NODE) {
    processTextNode(node);
    return;
  }
  
  // If it's an element, process all its text nodes
  const treeWalker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (textNode) => {
        if (!textNode.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        
        if (!shouldProcessNode(textNode.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  // Collect and process all text nodes
  const textNodes = [];
  while (treeWalker.nextNode()) {
    textNodes.push(treeWalker.currentNode);
  }
  
  textNodes.forEach(textNode => {
    processTextNode(textNode);
  });
}

// Process a text node to mask numbers
function processTextNode(node) {
  if (!node || !node.textContent) return;
  
  // Skip if parent element should not be processed
  if (node.parentElement && !shouldProcessNode(node.parentElement)) {
    return;
  }
  
  // Replace only sensitive numbers with the mask
  const replaced = node.textContent.replace(new RegExp(SENSITIVE_NUMBER_REGEX.source, 'g'), '•••');
  if (replaced !== node.textContent) {
    node.textContent = replaced;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCipher);
} else {
  initCipher();
}
