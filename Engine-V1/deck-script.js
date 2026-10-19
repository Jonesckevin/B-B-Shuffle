// VERSION
// B&B - Engine.Deck.3.0

/**
 * Switch decks: swap the card backs, rebuild the card pools and put the board
 * back to a fresh face-down state.
 * @param {string} deckKey - Key of the deck to load
 */
async function updateDeck(deckKey) {
  const deck = CONFIG.decks[deckKey];

  if (!deck) {
    console.error(`Unknown deck: ${deckKey}`);
    return;
  }

  // Remember what is actually on the board: a deck whose JSON cannot be read
  // must not leave the selector and the "Card list" line naming a deck nobody
  // loaded.
  const previousKey = getSelectedDeckKey();

  Utils.saveToStorage("deckKey", deckKey);
  GameState.setDeck(deckKey, deck.path);
  syncDeckSelector(deckKey);

  try {
    // loadDeck() reports an unreadable deck by returning false, not by
    // throwing, so both kinds of failure are checked here.
    if (!(await loadDeck())) throw new Error(`${deck.name} could not be read`);
    await loadCards();
    resetBoard();
  } catch (error) {
    console.error(`Error switching to deck "${deckKey}":`, error);
    await revertToDeck(previousKey, deck.name);
  }
}

/**
 * Put the board back on a deck that does load, after a failed switch, and say
 * which deck was unavailable.
 * @param {string} deckKey - Deck to fall back to
 * @param {string} failedName - Display name of the deck that failed
 */
async function revertToDeck(deckKey, failedName) {
  const key = CONFIG.decks[deckKey] ? deckKey : CONFIG.defaultDeck;
  const deck = CONFIG.decks[key];

  Utils.saveToStorage("deckKey", key);
  GameState.setDeck(key, deck.path);
  syncDeckSelector(key);

  try {
    await loadDeck();
    await loadCards();
    Utils.setElementContent(
      CONFIG.elementIds.version,
      `<strong>Card list:</strong> ${deck.name} &mdash; ${failedName} is not available in this build`
    );
  } catch (error) {
    console.error('Could not fall back to a readable deck either:', error);
  }
}

/**
 * Deck key saved in localStorage, falling back to the configured default
 * @returns {string}
 */
function getSelectedDeckKey() {
  const saved = Utils.getFromStorage("deckKey", CONFIG.defaultDeck);
  return CONFIG.decks[saved] ? saved : CONFIG.defaultDeck;
}

/**
 * True when a path found in a deck JSON is actually servable by this app.
 * Expansion decks from the original site point at their website's artwork
 * folders, which were never bundled here.
 * @param {*} src - Candidate path
 * @returns {boolean}
 */
function isLocalAsset(src) {
  return typeof src === 'string' &&
    (src.indexOf('../') === 0 || src.indexOf('http') === 0);
}

/**
 * Resolve the card back images for a deck. The bundled sets are authoritative;
 * usable paths inside the deck JSON only act as a fallback.
 * @param {string} deckKey - Key of the deck
 * @param {Object} deckData - Deck JSON (optional)
 * @returns {Object} - { red, yellow, brown, purple, grey }
 */
function getCardbacks(deckKey, deckData) {
  const deck = CONFIG.decks[deckKey] || {};
  const set = CONFIG.cardbackSets[deck.cardbacks] || CONFIG.cardbackSets.v1;
  const backs = Object.assign({}, set, deck.cardbackOverrides || {});

  ['red', 'yellow', 'brown', 'purple', 'grey'].forEach(function (colour) {
    if (!backs[colour] && deckData && isLocalAsset(deckData[colour])) {
      backs[colour] = Utils.resolveAsset(deckData[colour]);
    }
  });

  return backs;
}

/**
 * Tick the picker option that matches the loaded deck
 * @param {string} deckKey - Key of the loaded deck
 */
function syncDeckSelector(deckKey) {
  const picker = Utils.getElement(CONFIG.elementIds.deckList);
  if (!picker) return;

  const option = picker.querySelector(`input[name="deck"][value="${deckKey}"]`);
  if (option) option.checked = true;
}

/**
 * Render the deck picker from CONFIG.decks
 */
function renderDeckSelector() {
  const container = Utils.getElement(CONFIG.elementIds.deckList);
  if (!container) return;

  const selectedDeck = getSelectedDeckKey();

  container.innerHTML = Object.keys(CONFIG.decks).map(function (key) {
    const deck = CONFIG.decks[key];
    const checked = key === selectedDeck ? ' checked' : '';
    const tag = deck.expansion ? ' <span class="deck-option-tag">expansion</span>' : '';

    return `<label class="deck-option" for="deck-opt-${key}">` +
      `<input type="radio" id="deck-opt-${key}" name="deck" value="${key}"${checked} ` +
      `onchange="updatedeck(this.value);">` +
      `<span>${deck.name}</span>${tag}</label>`;
  }).join('');
}

/**
 * Load deck card backs and metadata
 * @returns {Promise<boolean>} - False when the deck JSON could not be read
 */
async function loadDeck() {
  // Get selected deck from storage or default to first deck
  const selectedDeck = getSelectedDeckKey();
  const deck = CONFIG.decks[selectedDeck];

  if (!deck) {
    console.error(`Deck not found: ${selectedDeck}`);
    return false;
  }

  GameState.setDeck(selectedDeck, deck.path);

  try {
    const deckData = await Utils.loadJSON(deck.path);
    const backs = getCardbacks(selectedDeck, deckData);

    // Update card backs - scenario cards (full size)
    updateCardBack(CONFIG.elementIds.scenarioA, backs.red, 'full');
    updateCardBack(CONFIG.elementIds.scenarioB, backs.yellow, 'full');
    updateCardBack(CONFIG.elementIds.scenarioC, backs.brown, 'full');
    updateCardBack(CONFIG.elementIds.scenarioD, backs.purple, 'full');

    // Update card backs - front of scenario cards
    updateCardBack(CONFIG.elementIds.initA, backs.red);
    updateCardBack(CONFIG.elementIds.initB, backs.yellow);
    updateCardBack(CONFIG.elementIds.initC, backs.brown);
    updateCardBack(CONFIG.elementIds.initD, backs.purple);

    // Update inject card back
    updateCardBack(CONFIG.elementIds.injectE, backs.grey, null, 'width:200px;');

    // Update copyright/logo
    updateCopyright(deckData);
    return true;

  } catch (error) {
    // Report, never swallow: the caller decides what the board should show.
    console.error('Error loading deck:', error);
    return false;
  }
}

/**
 * Update a card back image
 * @param {string} elementId - Element ID to update
 * @param {string} imageSrc - Image source URL
 * @param {string} cssClass - Optional CSS class
 * @param {string} style - Optional inline style
 */
function updateCardBack(elementId, imageSrc, cssClass = null, style = null) {
  const element = Utils.getElement(elementId);
  if (!element) return;

  const classAttr = cssClass ? ` class="${cssClass}"` : '';
  const styleAttr = style ? ` style="${style}"` : '';

  element.innerHTML = `<img${classAttr}${styleAttr} src="${imageSrc}">`;
}

/**
 * Update copyright and sponsor information
 * @param {Object} deckData - Deck data with logo and link
 */
function updateCopyright(deckData) {
  const rawLink = deckData.link || '';
  const link = (isLocalAsset(rawLink) || /^https?:/.test(rawLink))
    ? rawLink
    : 'https://www.blackhillsinfosec.com/projects/backdoorsandbreaches';

  // Only the decks that bundle their own logo have a usable local artwork
  // path; expansion decks point at files from the original website, so their
  // sponsor tile is skipped rather than rendered as a broken background.
  const sponsor = isLocalAsset(deckData.logo)
    ? `<a target='_blank' href='${link}'>
      <div class='sponsor' style='background-image: url(${Utils.resolveAsset(deckData.logo)});'></div>
    </a>`
    : '';

  const logoHTML = `
    <a target='_blank' href='https://www.blackhillsinfosec.com/projects/backdoorsandbreaches'>
      <div id='bb'></div>
    </a>
    <a target='_blank' href='https://www.blackhillsinfosec.com/'>
      <div id='bh'></div>
    </a>
    ${sponsor}
  `;

  Utils.setElementContent(CONFIG.elementIds.copyright, logoHTML);
}

// Build the deck picker as soon as the DOM is ready
// (deck-script.js loads before card-script.js, so this runs first)
document.addEventListener('DOMContentLoaded', renderDeckSelector);

// Make functions globally available
window.updatedeck = updateDeck;
window.loadDeck = loadDeck;
window.getCardbacks = getCardbacks;
window.renderDeckSelector = renderDeckSelector;
