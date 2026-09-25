// VERSION
// B&B - Engine.Builder.2.0

/**
 * Toggle custom builder UI
 */
function customToggle() {
  Utils.toggleElement(CONFIG.elementIds.builder);
}

/**
 * Toggle builder menu boxes
 * @param {string} menuId - ID of menu to toggle
 */
function boxToggle(menuId) {
  CONFIG.menuIds.forEach(id => {
    const element = Utils.getElement(id);
    if (!element) return;

    if (id !== menuId) {
      element.style.display = "none";
    } else {
      element.style.display = element.style.display === "block" ? "none" : "block";
    }
  });
}

/**
 * Modify card HTML for builder display
 * @param {string} cardHTML - Original card HTML
 * @param {string} oldClass - Old CSS class
 * @param {string} newClass - New CSS class
 * @returns {string} - Modified HTML
 */
function modifyCardForBuilder(cardHTML, oldClass, newClass) {
  let modified = cardHTML;

  // Replace CSS class
  modified = modified.split(`'${oldClass}'`).join(`'${newClass}'`);

  // Disable lightbox links - replace the opening <a tag
  // Look for <a href and replace with <a onclick="return false;" href
  modified = modified.split('<a href').join('<a onclick="return false;" href');

  // Disable lightbox data attribute
  modified = modified.split('data-lightbox').join('data-disabled-lightbox');

  return modified;
}

/**
 * Build procedure menu
 */
function buildProcMenu() {
  const remainingProcs = GameState.getRemainingProcedures();

  const procElement = Utils.getElement('proc');
  if (!procElement) return;

  procElement.innerHTML = '';

  remainingProcs.forEach((card, index) => {
    const modifiedCard = modifyCardForBuilder(
      card,
      CONFIG.cssClasses.procImg,
      CONFIG.cssClasses.procImgBuild
    );

    const wrapper = `<div id='proc_${index}' onclick='chooseProcedure(this.id, this);'>${modifiedCard}</div>`;
    procElement.innerHTML += wrapper;
  });
}

/**
 * Build scenario menu for a specific type
 * @param {string} menuType - Menu type (ic, pv, c2, ps)
 */
function buildSceneMenu(menuType) {
  const typeMapping = {
    'ic': 'initial',
    'pv': 'pivot',
    'c2': 'c2',
    'ps': 'persist'
  };

  const cardType = typeMapping[menuType];
  if (!cardType) return;

  const cards = GameState.getCards(cardType);
  const menuElement = Utils.getElement(menuType);

  if (!menuElement) return;

  menuElement.innerHTML = '';

  cards.forEach((card, index) => {
    const modifiedCard = modifyCardForBuilder(
      card,
      CONFIG.cssClasses.scenImg,
      CONFIG.cssClasses.scenImgBuild
    );

    const wrapper = `<div id='${menuType}_${index}' onclick='chooseScenario(this.id, this);'>${modifiedCard}</div>`;
    menuElement.innerHTML += wrapper;
  });
}

/**
 * Build inject menu
 */
function buildInjMenu() {
  const injects = GameState.getCards('injects');
  const menuElement = Utils.getElement('start');

  if (!menuElement) return;

  menuElement.innerHTML = '';

  injects.forEach((card, index) => {
    const modifiedCard = modifyCardForBuilder(card, 'inject', 'inject');
    const wrapper = `<div id='inj_${index}' onclick='chooseInject(this.id, this);'>${modifiedCard}</div>`;
    menuElement.innerHTML += wrapper;
  });
}

/**
 * Restore card HTML for display
 * @param {string} cardHTML - Modified card HTML
 * @param {string} oldClass - Old CSS class
 * @param {string} newClass - New CSS class
 * @returns {string} - Restored HTML
 */
function restoreCardForDisplay(cardHTML, oldClass, newClass) {
  let restored = cardHTML;

  // Restore CSS class
  restored = restored.split(oldClass).join(newClass);

  // Remove the onclick handler we added - restore original <a href pattern
  restored = restored.split('<a onclick="return false;" href').join('<a href');

  // Restore lightbox data attribute
  restored = restored.split('data-disabled-lightbox').join('data-lightbox');

  return restored;
}

/**
 * Choose scenario card
 * @param {string} elementId - Element ID (e.g., "ic_0")
 * @param {HTMLElement} element - DOM element containing card
 */
function chooseScenario(elementId, element) {
  const cardHTML = element.innerHTML;
  const restoredHTML = restoreCardForDisplay(
    cardHTML,
    CONFIG.cssClasses.scenImgBuild,
    CONFIG.cssClasses.scenImg
  );

  const scenarioMapping = {
    'ic': { player: CONFIG.elementIds.scenarioA, dm: CONFIG.elementIds.dmA, index: 0 },
    'pv': { player: CONFIG.elementIds.scenarioB, dm: CONFIG.elementIds.dmB, index: 1 },
    'c2': { player: CONFIG.elementIds.scenarioC, dm: CONFIG.elementIds.dmC, index: 2 },
    'ps': { player: CONFIG.elementIds.scenarioD, dm: CONFIG.elementIds.dmD, index: 3 }
  };

  for (const [prefix, mapping] of Object.entries(scenarioMapping)) {
    if (elementId.includes(prefix)) {
      Utils.setElementContent(mapping.player, restoredHTML);
      Utils.setElementContent(mapping.dm, restoredHTML);
      GameState.selected.custom[mapping.index] = elementId;
      break;
    }
  }

  return false;
}

/**
 * Choose inject card
 * @param {string} elementId - Element ID
 * @param {HTMLElement} element - DOM element containing card
 */
function chooseInject(elementId, element) {
  const index = parseInt(elementId.replace("inj_", ""));
  const injects = [...GameState.getCards('injects')];

  // Remove chosen inject and shuffle remaining
  injects.splice(index, 1);
  const shuffled = Utils.shuffle(injects);
  GameState.setRandomizedInjects(shuffled);

  return false;
}

/**
 * Choose procedure card
 * @param {string} elementId - Element ID
 * @param {HTMLElement} element - DOM element containing card
 */
function chooseProcedure(elementId, element) {
  const cardHTML = element.innerHTML;
  const restoredHTML = restoreCardForDisplay(
    cardHTML,
    CONFIG.cssClasses.procImgBuild,
    CONFIG.cssClasses.procImg
  );

  const index = parseInt(elementId.replace("proc_", ""));
  const remainingProcs = GameState.getRemainingProcedures();

  if (GameState.selected.procedures.length <= CONFIG.game.maxProcedures) {
    GameState.selected.procedures.push(remainingProcs[index]);
    remainingProcs.splice(index, 1);

    Utils.setElementContent(CONFIG.elementIds.output, GameState.selected.procedures.join(''));
    Utils.setElementContent(CONFIG.elementIds.remainder, remainingProcs.join(''));
  }

  if (GameState.selected.procedures.length > CONFIG.game.maxProcedures) {
    GameState.resetRemainingProcedures();
    GameState.selected.procedures = [];

    Utils.setElementContent(CONFIG.elementIds.output, '');
    Utils.setElementContent(CONFIG.elementIds.remainder, GameState.getRemainingProcedures().join(''));
  }

  buildProcMenu();
  return false;
}

// Make functions globally available
window.customtoggle = customToggle;
window.boxtoggle = boxToggle;
window.buildprocmenu = buildProcMenu;
window.buildscenemenu = buildSceneMenu;
window.buildinjmenu = buildInjMenu;
window.choose = chooseScenario;
window.chooseinj = chooseInject;
window.chooseproc = chooseProcedure;
