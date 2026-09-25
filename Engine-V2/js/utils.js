/**
 * B&B Shuffle Engine-V2 - Utility Functions
 * Common helper functions for the game engine
 */

const Utils = {
    /**
     * CANONICAL, ORDERED card-type list. The order is user-visible (card
     * viewer tabs, filter chips, the favicon's colour edge) - do not reorder.
     * ------------------------------------------------------------------
     * This is THE single source of truth for Engine-V2: every copy that can
     * reach `Utils` derives from here.
     *
     * Two copies deliberately keep their own list instead:
     *   - `shared/js/card-viewer.js` - must stay dependency-free because it
     *     loads BEFORE `utils.js` on `Engine-V2/custom-cards.html`.
     *   - `shared/catalogue.html` - loads no `utils.js` at all (and uniquely
     *     also knows the `exfil` type).
     */
    CARD_TYPES: ['initial', 'pivot', 'c2', 'persist', 'procedure', 'inject', 'consultant'],

    /** The scenario-card subset of CARD_TYPES (the four board slots). */
    SCENARIO_TYPES: ['initial', 'pivot', 'c2', 'persist'],

    /**
     * CANONICAL type -> human-readable label map. The label TEXT is
     * user-visible and must stay byte-identical across the app.
     * `shared/js/card-viewer.js` + `shared/catalogue.html` keep their own copy
     * for the load-order reasons documented on CARD_TYPES above.
     */
    CARD_TYPE_LABELS: {
        initial: 'Initial Compromise',
        pivot: 'Pivot & Escalate',
        c2: 'C2 / Exfiltration',
        persist: 'Persistence',
        procedure: 'Procedure',
        inject: 'Inject',
        consultant: 'Consultant'
    },

    /**
     * Card-back generation used when a deck names none (or an unknown one) - the
     * 2.0 art, which is also what the Player's static board markup ships and the
     * only generation that has a Procedure and a Consultant back.
     */
    DEFAULT_CARD_BACK_SET: 'v2',

    /**
     * Get element by ID
     * @param {string} id - Element ID
     * @returns {HTMLElement|null}
     */
    getElement(id) {
        return document.getElementById(id);
    },

    /**
     * Query selector with scope
     * @param {string} selector - CSS selector
     * @param {HTMLElement} scope - Optional scope element
     * @returns {HTMLElement|null}
     */
    $(selector, scope = document) {
        return scope.querySelector(selector);
    },

    /**
     * Query selector all with scope
     * @param {string} selector - CSS selector
     * @param {HTMLElement} scope - Optional scope element
     * @returns {NodeList}
     */
    $$(selector, scope = document) {
        return scope.querySelectorAll(selector);
    },

    /**
     * Toggle element visibility
     * @param {string|HTMLElement} element - Element or ID
     * @param {boolean} show - Optional explicit show/hide
     */
    toggleElement(element, show) {
        const el = typeof element === 'string' ? this.getElement(element) : element;
        if (!el) return;

        if (show === undefined) {
            el.classList.toggle('hidden');
        } else {
            el.classList.toggle('hidden', !show);
        }
    },

    /**
     * Show element
     * @param {string|HTMLElement} element - Element or ID
     */
    showElement(element) {
        this.toggleElement(element, true);
    },

    /**
     * Hide element
     * @param {string|HTMLElement} element - Element or ID
     */
    hideElement(element) {
        this.toggleElement(element, false);
    },

    /**
     * Save to localStorage
     * @param {string} key - Storage key
     * @param {*} value - Value to store (will be JSON stringified if object)
     */
    saveToStorage(key, value) {
        try {
            const data = typeof value === 'object' ? JSON.stringify(value) : value;
            localStorage.setItem(key, data);
        } catch (e) {
            console.error('Failed to save to storage:', e);
        }
    },

    /**
     * Get from localStorage
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default if not found
     * @param {boolean} parseJson - Parse as JSON
     * @returns {*}
     */
    getFromStorage(key, defaultValue = null, parseJson = false) {
        try {
            const value = localStorage.getItem(key);
            if (value === null) return defaultValue;
            return parseJson ? JSON.parse(value) : value;
        } catch (e) {
            console.error('Failed to get from storage:', e);
            return defaultValue;
        }
    },

    /**
     * Remove from localStorage
     * @param {string} key - Storage key
     */
    removeFromStorage(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.error('Failed to remove from storage:', e);
        }
    },

    /**
     * Shuffle an array using Fisher-Yates algorithm
     * @param {Array} array - Array to shuffle
     * @returns {Array} New shuffled array
     */
    shuffle(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    },

    /**
     * Get random item from array
     * @param {Array} array - Source array
     * @returns {*} Random item
     */
    randomItem(array) {
        if (!array || array.length === 0) return null;
        return array[Math.floor(Math.random() * array.length)];
    },

    /**
     * Roll a die
     * @param {number} sides - Number of sides (default 20)
     * @returns {number} Roll result
     */
    rollDice(sides = 20) {
        return Math.floor(Math.random() * sides) + 1;
    },

    /**
     * Debounce function
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in ms
     * @returns {Function} Debounced function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Format date/time
     * @param {Date|string|number} date - Date to format
     * @param {Object} options - Intl.DateTimeFormat options
     * @returns {string} Formatted date
     */
    formatDate(date, options = {}) {
        const d = date instanceof Date ? date : new Date(date);
        const defaultOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        return d.toLocaleDateString(undefined, { ...defaultOptions, ...options });
    },

    /**
     * Format relative time
     * @param {Date|string|number} date - Date to format
     * @returns {string} Relative time string
     */
    formatRelativeTime(date) {
        const d = date instanceof Date ? date : new Date(date);
        const now = new Date();
        const diff = now - d;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 7) return this.formatDate(d, { year: 'numeric', month: 'short', day: 'numeric' });
        if (days > 1) return `${days} days ago`;
        if (days === 1) return 'Yesterday';
        if (hours > 1) return `${hours} hours ago`;
        if (hours === 1) return '1 hour ago';
        if (minutes > 1) return `${minutes} minutes ago`;
        if (minutes === 1) return '1 minute ago';
        return 'Just now';
    },

    /**
     * Escape a value for interpolation into HTML TEXT **or ATTRIBUTE**
     * contexts (the callers use it in `title="..."` / `alt="..."`).
     * Pure regex, no DOM round-trip: it escapes `"` and `'` too, and it works
     * before DOMContentLoaded.
     * @param {*} str - Value to escape (null/undefined become '')
     * @returns {string} Escaped string
     */
    escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /**
     * Create element with attributes
     * @param {string} tag - Tag name
     * @param {Object} attrs - Attributes
     * @param {string|HTMLElement|Array} children - Child content
     * @returns {HTMLElement}
     */
    createElement(tag, attrs = {}, children = null) {
        const el = document.createElement(tag);
        
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'className') {
                el.className = value;
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(el.style, value);
            } else if (key.startsWith('on') && typeof value === 'function') {
                el.addEventListener(key.slice(2).toLowerCase(), value);
            } else if (key === 'dataset' && typeof value === 'object') {
                Object.assign(el.dataset, value);
            } else {
                el.setAttribute(key, value);
            }
        }

        if (children) {
            if (Array.isArray(children)) {
                children.forEach(child => {
                    if (typeof child === 'string') {
                        el.appendChild(document.createTextNode(child));
                    } else if (child instanceof HTMLElement) {
                        el.appendChild(child);
                    }
                });
            } else if (typeof children === 'string') {
                el.textContent = children;
            } else if (children instanceof HTMLElement) {
                el.appendChild(children);
            }
        }

        return el;
    },

    /**
     * Load JSON from URL
     * @param {string} url - URL to fetch
     * @returns {Promise<Object>} Parsed JSON
     */
    async loadJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Copy text to clipboard
     * @param {string} text - Text to copy
     * @returns {Promise<boolean>} Success
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            console.error('Failed to copy to clipboard:', e);
            return false;
        }
    },

    /**
     * Download data as file
     * @param {string} data - Data to download
     * @param {string} filename - Filename
     * @param {string} mimeType - MIME type
     */
    downloadFile(data, filename, mimeType = 'application/json') {
        const blob = new Blob([data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    /**
     * Show toast notification (CCAS bottom-center single toast; styled in base.css)
     * @param {string} message - Message to show
     * @param {string} type - Type (success, error, warning, info)
     * @param {number} duration - Duration in ms
     */
    showToast(message, type = 'info', duration = 3200) {
        let toast = this.getElement('bb-toast');
        if (!toast) {
            toast = this.createElement('div', { id: 'bb-toast', className: 'toast' });
            document.body.appendChild(toast);
        }
        const kindMap = { success: 'ok', error: 'error', warning: 'warn', info: 'info' };
        toast.className = 'toast show ' + (kindMap[type] || 'info');
        toast.textContent = message;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { toast.textContent = ''; }, 250);
        }, duration);
    },

    /**
     * Resolve a stored card/deck image path so it works regardless of page depth.
     * Deck DBs store paths relative to shared/decks/<deck>/; all app pages that show
     * card art sit one folder beside `shared`, so we rebase to a single "../shared/...".
     * @param {string} src - Stored image path
     * @returns {string} Page-relative URL
     */
    assetPath(src) {
        if (!src) return '';
        if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
        const idx = src.indexOf('shared/');
        if (idx >= 0) {
            let rel = src.slice(idx);
            // Deck art under shared/decks/ moved from PNG to WebP. Games saved before
            // that change still carry .png paths (bb-current-scenario et al), so
            // upgrade them here. User uploads (data/uploads/cards/) are still PNG and
            // never pass through this branch.
            if (rel.startsWith('shared/decks/')) rel = rel.replace(/\.(png|jpe?g|gif)$/i, '.webp');
            return '../' + rel;
        }
        return src;
    },

    /**
     * Card-back art for a deck's card type.
     *
     * The Player's card backs follow the deck in play: a deck names its card-back
     * generation with `cardbackPath` (…/cardbacks/<set>/) and `CONFIG.cardbackSets`
     * holds the art per generation, keyed by card type. A deck may also override a
     * single type (`cardbackOverrides`, e.g. the ICS/OT deck's C2 back).
     *
     * The 1.0 generation has no Procedure or Consultant back, so those two fall back
     * to the 2.0 set; an unknown/missing deck falls back to the same default the
     * static board markup ships.
     * @param {string} deckKey - CONFIG.decks key (may be falsy)
     * @param {string} type - initial|pivot|c2|persist|procedure|inject|consultant
     * @returns {string} Page-relative URL ('' when there is nothing to resolve)
     */
    cardbackFor(deckKey, type) {
        if (typeof CONFIG === 'undefined' || !CONFIG.cardbackSets) return '';
        const deck = (CONFIG.decks && CONFIG.decks[deckKey]) || {};
        const override = deck.cardbackOverrides && deck.cardbackOverrides[type];
        if (override) return override;

        const path = deck.cardbackPath || '';
        const set = path.includes('/v2/') ? 'v2' : (path.includes('/v1/') ? 'v1' : this.DEFAULT_CARD_BACK_SET);
        const sets = CONFIG.cardbackSets;
        const fallback = sets[this.DEFAULT_CARD_BACK_SET] || {};
        return (sets[set] && sets[set][type]) || fallback[type] || '';
    },

    /**
     * Build an inline-SVG placeholder image (data URI) shown whenever a card
     * slot has no data/image yet (e.g. no game loaded, empty slot, no inject).
     * @param {string} label - Optional short label drawn on the placeholder
     * @returns {string} data:image/svg+xml URI
     */
    cardPlaceholder(label) {
        const text = label || 'No image';
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">' +
            '<rect width="300" height="420" rx="16" fill="#1b2230"/>' +
            '<rect x="8" y="8" width="284" height="404" rx="12" fill="none" stroke="#33405a" stroke-width="3" stroke-dasharray="10 8"/>' +
            '<g fill="none" stroke="#5b6a85" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="112" y="148" width="76" height="58" rx="6"/>' +
            '<circle cx="124" cy="163" r="5" fill="#5b6a85"/>' +
            '<path d="M112 198l20-22 14 14 16-16 26 24"/>' +
            '</g>' +
            '<text x="150" y="254" fill="#8b97ad" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="600" text-anchor="middle">' + text + '</text>' +
            '</svg>';
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    },

    /**
     * Graceful fallback when a card image cannot be loaded (broken/legacy path).
     * Used via inline onerror="Utils.onImgError(event)".
     * @param {Event} ev - The error event
     */
    onImgError(ev) {
        const img = ev && ev.currentTarget;
        if (!img) return;
        img.onerror = null;
        img.src = Utils.cardPlaceholder('Card not found');
    },

    /**
     * Open the Scenario Editor (GM workspace).
     * Desktop + popups allowed -> named popup window (1320x860); re-click focuses it.
     * Popup blocked OR touch device -> in-page full-screen overlay with a same-origin iframe of admin.html.
     * @param {Object} opts - { url }
     */
    openGM(opts = {}) {
        const url = opts.url || 'admin.html';
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        if (!isTouch) {
            const w = window.open(url, 'bb_gm', 'popup=yes,width=1320,height=860,resizable=yes,scrollbars=yes');
            if (w) {
                w.focus();
                return;
            }
        }

        // Fallback: full-screen overlay hosting admin.html in a same-origin iframe
        let overlay = this.getElement('gm-overlay');
        if (!overlay) {
            overlay = this.createElement('div', { id: 'gm-overlay', className: 'gm-overlay hidden' });
            overlay.innerHTML =
                '<div class="gm-overlay-bar">' +
                '<span class="gm-overlay-title">Scenario Editor</span>' +
                '<button type="button" class="btn btn-secondary btn-sm gm-overlay-close">Close</button>' +
                '</div>' +
                '<iframe class="gm-overlay-frame" src="' + url + '" title="Scenario Editor"></iframe>';
            document.body.appendChild(overlay);
        }
        const frame = overlay.querySelector('iframe');
        if (frame && frame.getAttribute('src') !== url) frame.setAttribute('src', url);
        overlay.classList.remove('hidden');
        const closeBtn = overlay.querySelector('.gm-overlay-close');
        if (closeBtn) {
            closeBtn.onclick = () => overlay.classList.add('hidden');
        }
        // Close requests from the admin page (when it runs inside this overlay iframe)
        if (!this._gmOverlayBound) {
            this._gmOverlayBound = true;
            window.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'bb-close-gm') {
                    const ov = this.getElement('gm-overlay');
                    if (ov) ov.classList.add('hidden');
                }
            });
        }
    },

    /**
     * Parse URL query parameters
     * @returns {Object} Parsed parameters
     */
    getQueryParams() {
        const params = {};
        const searchParams = new URLSearchParams(window.location.search);
        for (const [key, value] of searchParams) {
            params[key] = value;
        }
        return params;
    }
};

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
}
