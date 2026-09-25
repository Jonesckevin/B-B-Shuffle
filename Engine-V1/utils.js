// VERSION
// B&B - Engine.Utils.1.0
//

/**
 * Utility Functions for B&B Shuffle Engine-V1
 */

// ==================== DOM UTILITIES ====================

/**
 * Toggle element visibility
 * @param {string} elementId - ID of element to toggle
 */
function toggleElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = element.style.display === "block" ? "none" : "block";
    }
}

/**
 * Get element by ID with error handling
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
function getElement(id) {
    return document.getElementById(id);
}

/**
 * Set element HTML content safely
 * @param {string} elementId - Element ID
 * @param {string} content - HTML content
 */
function setElementContent(elementId, content) {
    const element = getElement(elementId);
    if (element) {
        element.innerHTML = content;
    }
}

// ==================== ARRAY UTILITIES ====================

/**
 * Fisher-Yates shuffle algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} - Shuffled array
 */
function shuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ==================== NETWORK UTILITIES ====================

/**
 * Load JSON data from URL using fetch API
 * @param {string} url - URL to fetch from
 * @returns {Promise<Object>} - Parsed JSON data
 */
async function loadJSON(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading JSON:', error);
        throw error;
    }
}

// ==================== STORAGE UTILITIES ====================

/**
 * Save to localStorage with error handling
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 */
function saveToStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }
}

/**
 * Get from localStorage with error handling
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if key not found
 * @returns {*} - Stored value or default
 */
function getFromStorage(key, defaultValue = null) {
    try {
        return localStorage.getItem(key) || defaultValue;
    } catch (error) {
        console.error('Error reading from localStorage:', error);
        return defaultValue;
    }
}

// ==================== PATH UTILITIES ====================

/**
 * Rebase a stored asset path so it resolves from Engine-V1/.
 * Deck JSONs and custom-card records spell repo-root assets from a nested
 * location: "../../shared/..." for card art and card backs, "../data/..." for
 * Custom Card Creator uploads. Engine-V1/ and Engine-V2/ now sit at the same
 * depth, so a "../../" path carries one hop too many and must lose it, while a
 * single "../" path (the uploads) is already correct as-is.
 * @param {string} src - Asset path from a deck or card JSON
 * @returns {string} - Path usable from Engine-V1/
 */
function resolveAsset(src) {
    if (typeof src !== 'string') return src;
    if (src.indexOf('../../') === 0) return src.slice(3);
    return src;
}

// ==================== DICE UTILITIES ====================

/**
 * Roll a dice with given number of sides
 * @param {number} sides - Number of sides (default: 20)
 * @returns {number} - Roll result (1 to sides)
 */
function rollDice(sides = 20) {
    return Math.floor(Math.random() * sides) + 1;
}

/**
 * Check if roll is successful
 * @param {number} roll - Dice roll value
 * @param {number} modifier - Modifier to add
 * @param {number} threshold - Success threshold
 * @returns {Object} - Result object with success status and details
 */
function evaluateRoll(roll, modifier = 0, threshold = 10) {
    const total = roll + modifier;

    if (roll === 20 || roll === 1) {
        return { success: false, critical: true, total, message: 'INJECT!' };
    }

    if (total > threshold) {
        return { success: true, critical: false, total, message: 'SUCCESS' };
    }

    return { success: false, critical: false, total, message: 'FAILURE' };
}

// ==================== DRAG UTILITIES ====================

/**
 * Make an element draggable
 * @param {HTMLElement} element - Element to make draggable
 */
function makeDraggable(element) {
    if (!element) return;

    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = document.getElementById(element.id + "header");

    if (header) {
        header.onmousedown = dragMouseDown;
    } else {
        element.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

/**
 * Initialize all draggable elements
 * @param {Array<string>} elementIds - Array of element IDs to make draggable
 */
function initializeDraggableElements(elementIds) {
    elementIds.forEach(id => {
        const element = getElement(id);
        if (element) {
            makeDraggable(element);
        }
    });
}

// ==================== CARD UTILITIES ====================

/**
 * Create card HTML with lightbox
 * @param {Object} card - Card data object
 * @param {string} cardType - Type of card
 * @param {string} cssClass - CSS class for image
 * @returns {string} - HTML string
 */
function createCardHTML(card, cardType, cssClass) {
    const lightboxId = `${cardType}${card.id}`;
    const details = card.details ? ` data-title='${card.details}'` : '';
    const wrapperClass = cardType === 'procedure' ? 'proc' : cssClass;
    const image = resolveAsset(card.image);

    return `<div class='${wrapperClass}' id='${card.id}'>
    <a href='${image}' data-lightbox='${lightboxId}'${details}>
      <img class='${cssClass}' src='${image}'>
    </a>
  </div>`;
}

/**
 * Create inject card HTML
 * @param {Object} card - Card data object
 * @returns {string} - HTML string
 */
function createInjectHTML(card) {
    const lightboxId = `inject${card.id}`;
    const details = card.details ? ` data-title='${card.details}'` : '';
    const image = resolveAsset(card.image);

    return `<div class='inject'>
    <a href='${image}' data-lightbox='${lightboxId}'${details} onclick='openInjectToggle()'>
      <img src='${image}'>
    </a>
  </div>`;
}

/**
 * Open inject toggle if it's closed
 */
function openInjectToggle() {
    const injectDiv = document.getElementById('injectdiv');
    if (injectDiv && injectDiv.style.display === 'none') {
        injectDiv.style.display = 'block';
    }
}

// Make utilities available globally
window.Utils = {
    toggleElement,
    getElement,
    setElementContent,
    shuffle,
    loadJSON,
    saveToStorage,
    getFromStorage,
    rollDice,
    evaluateRoll,
    makeDraggable,
    initializeDraggableElements,
    resolveAsset,
    createCardHTML,
    createInjectHTML,
    openInjectToggle
};

// Make openInjectToggle globally available for onclick handlers
window.openInjectToggle = openInjectToggle;
