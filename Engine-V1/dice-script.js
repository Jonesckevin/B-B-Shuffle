// VERSION
// B&B - Engine.Dice.2.0

/**
 * Roll dice with modifier and update game state
 * @param {number} modifier - Modifier to add to roll
 */
function rollDice(modifier = 0) {
  const roll = Utils.rollDice(20);
  const result = Utils.evaluateRoll(roll, modifier, CONFIG.game.successThreshold);

  // Display roll result
  displayRollResult(roll, modifier);

  // Update game state based on result
  GameState.decrementTurns();

  if (result.critical) {
    // Critical roll (1 or 20) - inject!
    displayMessage(result.message, CONFIG.cssClasses.inject);
    GameState.resetStrikes();
    clearFailDisplay();
  } else if (result.success) {
    // Success
    displayMessage(result.message, CONFIG.cssClasses.success);
    GameState.resetStrikes();
    clearFailDisplay();
  } else {
    // Failure
    const maxStrikesReached = GameState.addStrike();
    const status = GameState.getGameStatus();

    displayMessage(result.message, CONFIG.cssClasses.fail);
    displayStrikes(status.strikes);

    if (maxStrikesReached) {
      displayMessage('FAILURE - INJECT!', CONFIG.cssClasses.fail);
    }
  }

  // Update turn display
  updateTurnDisplay();
}

/**
 * Roll a simple D20 (no game state changes)
 */
function rollD20() {
  const roll = Utils.rollDice(20);
  Utils.setElementContent(
    CONFIG.elementIds.d20,
    `ROLL VALUE: <br><div class='big_num'>${roll}</div>`
  );
}

/**
 * Display roll result
 * @param {number} roll - Dice roll value
 * @param {number} modifier - Modifier applied
 */
function displayRollResult(roll, modifier) {
  const content = `ROLL VALUE: <br><div class='big_num'>${roll}(+${modifier})</div>`;
  Utils.setElementContent(CONFIG.elementIds.dice, content);
}

/**
 * Display message with appropriate styling
 * @param {string} message - Message to display
 * @param {string} cssClass - CSS class for styling
 */
function displayMessage(message, cssClass) {
  Utils.setElementContent(
    CONFIG.elementIds.message,
    `<div class='${cssClass}'>${message}.</div>`
  );
}

/**
 * Display current strike count
 * @param {number} strikes - Number of strikes
 */
function displayStrikes(strikes) {
  Utils.setElementContent(CONFIG.elementIds.fails, `STRIKE: ${strikes}`);
}

/**
 * Clear strike/fail display
 */
function clearFailDisplay() {
  Utils.setElementContent(CONFIG.elementIds.fails, '');
}

/**
 * Update turn display with warnings
 */
function updateTurnDisplay() {
  const status = GameState.getGameStatus();

  Utils.setElementContent(CONFIG.elementIds.turn, status.turns.toString());

  if (status.isGameOver) {
    handleGameOver();
  } else if (status.isAlert) {
    Utils.setElementContent(CONFIG.elementIds.turnMessage, 'RED ALERT');
  } else if (status.isWarning) {
    Utils.setElementContent(CONFIG.elementIds.turnMessage, 'WARNING');
  } else {
    Utils.setElementContent(CONFIG.elementIds.turnMessage, '');
  }
}

/**
 * Handle game over state
 */
function handleGameOver() {
  // Clear action buttons
  Utils.setElementContent('button', '');
  Utils.setElementContent('button2', '');
  Utils.setElementContent('button4', '');

  // Show game over message
  const gameOverHTML = `
    <br> GAME OVER! <br> 
    <button onClick='window.location.href=window.location.href'>Refresh Page</button>
  `;
  Utils.setElementContent(CONFIG.elementIds.turnMessage, gameOverHTML);
  clearFailDisplay();
}

/**
 * Add an extra turn
 */
function addTurn() {
  GameState.addTurn();
  const status = GameState.getGameStatus();

  // Clear temporary displays
  Utils.setElementContent(CONFIG.elementIds.dice, '');
  Utils.setElementContent(CONFIG.elementIds.message, 'TURN ADDED');
  clearFailDisplay();

  // Update turn display
  updateTurnDisplay();

  // Restore buttons if game was over
  if (status.turns > 0 && !status.isGameOver) {
    restoreActionButtons();
  }
}

/**
 * Remove a turn
 */
function removeTurn() {
  GameState.decrementTurns();
  updateTurnDisplay();
}

/**
 * Restore action buttons
 */
function restoreActionButtons() {
  Utils.setElementContent(
    'button',
    "<input type='button' onclick='rollDice(0)' value='Roll Dice'/>"
  );
  Utils.setElementContent(
    'button2',
    `<input type='button' onclick='rollDice(${CONFIG.game.bonusModifier})' value='Roll Dice (+${CONFIG.game.bonusModifier})'/>`
  );
}

// Make functions globally available
window.roll_dice = rollDice;
window.roll_d20 = rollD20;
window.addturn = addTurn;
window.removeturn = removeTurn;
