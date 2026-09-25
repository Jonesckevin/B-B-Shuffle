// VERSION
// B&B - Engine.CS.2.0

/**
 * Randomize and display scenario cards
 */
function randomizeScenario() {
  const procedures = Utils.shuffle([...GameState.getCards('procedures')]);
  const initial = Utils.shuffle([...GameState.getCards('initial')]);
  const pivot = Utils.shuffle([...GameState.getCards('pivot')]);
  const c2 = Utils.shuffle([...GameState.getCards('c2')]);
  const persist = Utils.shuffle([...GameState.getCards('persist')]);

  // Display procedures (4 selected, rest in remainder)
  Utils.setElementContent(CONFIG.elementIds.output, procedures.slice(0, 4).join(''));
  Utils.setElementContent(CONFIG.elementIds.remainder, procedures.slice(4, 12).join(''));

  // Display scenario cards
  displayScenarioCard(initial[0], CONFIG.elementIds.scenarioA, CONFIG.elementIds.dmA);
  displayScenarioCard(pivot[0], CONFIG.elementIds.scenarioB, CONFIG.elementIds.dmB);
  displayScenarioCard(c2[0], CONFIG.elementIds.scenarioC, CONFIG.elementIds.dmC);
  displayScenarioCard(persist[0], CONFIG.elementIds.scenarioD, CONFIG.elementIds.dmD);
}

/**
 * Display a scenario card in both player and DM views.
 * Expansion decks are not required to carry every scenario category (and the
 * Custom Cards deck may have none at all), so a missing card falls back to an
 * empty player card and the default DM solution text.
 * @param {string} cardHTML - Card HTML string
 * @param {string} playerId - Player view element ID
 * @param {string} dmId - DM view element ID
 */
function displayScenarioCard(cardHTML, playerId, dmId) {
  Utils.setElementContent(playerId, cardHTML || '');
  Utils.setElementContent(dmId, cardHTML || dmDefaults[dmId] || '');
}

/**
 * Cycle through inject cards
 */
function updateInject() {
  const state = GameState.injectCycle;
  const injects = GameState.getRandomizedInjects();

  Utils.setElementContent(
    CONFIG.elementIds.injectE,
    injects.slice(state.currentIndex, state.maxIndex)
  );

  state.currentIndex++;
  state.maxIndex++;

  if (state.maxIndex > injects.length) {
    state.currentIndex = 0;
    state.maxIndex = 1;
  }
}

/**
 * Remove/clear inject display
 */
function removeInject() {
  const deckPath = GameState.getDeckPath();
  if (!deckPath) return;

  Utils.loadJSON(deckPath)
    .then(data => {
      const backs = getCardbacks(GameState.deck.name, data);
      Utils.setElementContent(
        CONFIG.elementIds.injectE,
        `<img style='width:200px;' src='${backs.grey}'>`
      );
    })
    .catch(error => console.error('Error loading grey card:', error));
}

/**
 * Build card lists from JSON data
 * @param {Object} cardData - Card database JSON object
 */
function buildCardLists(cardData) {
  const typeMapping = {
    [CONFIG.cardTypes.PROCEDURE]: {
      list: 'procedures',
      cssClass: CONFIG.cssClasses.procImg
    },
    [CONFIG.cardTypes.INJECT]: {
      list: 'injects',
      cssClass: 'inject'
    },
    [CONFIG.cardTypes.INITIAL]: {
      list: 'initial',
      cssClass: CONFIG.cssClasses.scenImg
    },
    [CONFIG.cardTypes.PIVOT]: {
      list: 'pivot',
      cssClass: CONFIG.cssClasses.scenImg
    },
    [CONFIG.cardTypes.C2]: {
      list: 'c2',
      cssClass: CONFIG.cssClasses.scenImg
    },
    [CONFIG.cardTypes.PERSIST]: {
      list: 'persist',
      cssClass: CONFIG.cssClasses.scenImg
    }
  };

  // Process each card in the data
  cardData.data.forEach(card => {
    const mapping = typeMapping[card.type];
    if (!mapping) return;

    let cardHTML;
    if (card.type === CONFIG.cardTypes.INJECT) {
      cardHTML = Utils.createInjectHTML(card);
    } else {
      cardHTML = Utils.createCardHTML(card, card.type, mapping.cssClass);
    }

    GameState.addCard(mapping.list, cardHTML);
  });

  // Initialize randomized injects
  GameState.resetRandomizedInjects();
}

// Default DM solution text, captured before any scenario is drawn so the board
// can be reset when the deck changes
const dmDefaults = {};

function captureDmDefaults() {
  ['dma', 'dmb', 'dmc', 'dmd'].forEach(function (id) {
    const element = Utils.getElement(id);
    if (element) dmDefaults[id] = element.innerHTML;
  });
}

/**
 * Load the selected deck's cards into the game state.
 * Safe to call again after a deck switch: the pools are reset first so the
 * previous deck's cards cannot leak through.
 * @returns {Promise<Object|null>} - The deck JSON
 */
async function loadCards() {
  const deckPath = GameState.getDeckPath();
  if (!deckPath) {
    console.error('No deck path set');
    return null;
  }

  const cardData = await Utils.loadJSON(deckPath);

  // Reset the pools (this also resets turns/strikes for the new game)
  GameState.init();

  // Store metadata
  GameState.setDeckMetadata(cardData);

  // Update version info
  Utils.setElementContent(
    CONFIG.elementIds.version,
    `<strong>Card list:</strong> ${cardData.title}`
  );
  Utils.setElementContent(
    CONFIG.elementIds.date,
    `<strong>Rev Date:</strong> ${cardData.revdate}`
  );

  // Build card lists
  buildCardLists(cardData);

  return cardData;
}

/**
 * Return the board to a fresh state: no scenario cards, no procedures, no
 * injects, and the default DM solution text.
 */
function resetBoard() {
  // Scenario card faces
  [
    CONFIG.elementIds.scenarioA,
    CONFIG.elementIds.scenarioB,
    CONFIG.elementIds.scenarioC,
    CONFIG.elementIds.scenarioD
  ].forEach(function (id) {
    Utils.setElementContent(id, '');
  });

  // DM solution
  ['dma', 'dmb', 'dmc', 'dmd'].forEach(function (id) {
    Utils.setElementContent(id, dmDefaults[id] || '');
  });

  // Procedures
  Utils.setElementContent(CONFIG.elementIds.output, '');
  Utils.setElementContent(CONFIG.elementIds.remainder, '');

  // Inject display
  Utils.setElementContent(CONFIG.elementIds.injectE, '');

  // Flip the scenario cards face down again (flipBack re-binds the flip handler)
  if (typeof flipBack === 'function') {
    flipBack();
  }
}

/**
 * Initialize card system
 */
async function initializeCards() {
  try {
    captureDmDefaults();

    // Load the deck's card backs, then its card data
    await loadDeck();
    await loadCards();
  } catch (error) {
    console.error('Error initializing cards:', error);
  }
}

// Initialize on document ready
document.addEventListener('DOMContentLoaded', initializeCards);

// Legacy function names for backward compatibility
window.rando = randomizeScenario;
window.update_ins = updateInject;
window.rem_ins = removeInject;
window.loadCards = loadCards;
window.resetBoard = resetBoard;
