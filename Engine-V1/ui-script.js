// VERSION
// B&B - Engine.UI.2.0

/**
 * Initialize all draggable UI elements
 */
function initializeDraggableUI() {
  Utils.initializeDraggableElements(CONFIG.draggableIds);
}

// Initialize draggable elements when DOM is ready
document.addEventListener('DOMContentLoaded', initializeDraggableUI);

// ==================== TOGGLE FUNCTIONS ====================
// Using unified toggle utility instead of individual functions

function diceboxtoggle() {
  Utils.toggleElement(CONFIG.elementIds.diceBox);
}

function solutiontoggle() {
  Utils.toggleElement(CONFIG.elementIds.dmSolution);
}

function notestoggle() {
  Utils.toggleElement(CONFIG.elementIds.gmNotes);
}

function injectstoggle() {
  Utils.toggleElement(CONFIG.elementIds.injectDiv);
}

// Make functions globally available for backward compatibility
window.diceboxtoggle = diceboxtoggle;
window.solutiontoggle = solutiontoggle;
window.notestoggle = notestoggle;
window.injectstoggle = injectstoggle;

// ==================== COLLAPSIBLE HEADER ====================
function toggleHeader() {
  const headerContent = document.getElementById('headerContent');
  const toggleIcon = document.getElementById('toggleIcon');

  if (headerContent.classList.contains('collapsed')) {
    headerContent.classList.remove('collapsed');
    toggleIcon.classList.remove('collapsed');
    toggleIcon.textContent = '▼';
    localStorage.setItem('headerCollapsed', 'false');
  } else {
    headerContent.classList.add('collapsed');
    toggleIcon.classList.add('collapsed');
    toggleIcon.textContent = '▶';
    localStorage.setItem('headerCollapsed', 'true');
  }
}

// Initialize header state from localStorage
document.addEventListener('DOMContentLoaded', function () {
  const headerCollapsed = localStorage.getItem('headerCollapsed');
  const headerContent = document.getElementById('headerContent');
  const toggleIcon = document.getElementById('toggleIcon');

  // Start collapsed by default if no preference is set
  if (headerCollapsed === null || headerCollapsed === 'true') {
    headerContent.classList.add('collapsed');
    toggleIcon.classList.add('collapsed');
    toggleIcon.textContent = '▶';
  }
});

window.toggleHeader = toggleHeader;
