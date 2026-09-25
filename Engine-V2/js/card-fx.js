/**
 * B&B Shuffle Engine-V2 — Card FX
 * ============================================================
 * Pointer-tracked holographic card effects: a 3D tilt that follows
 * the cursor plus a blended holo sheen and a click "burst". Inspired
 * by the CSS_Design_10 reference, re-implemented with pure CSS custom
 * properties + Pointer Events (no jQuery, no external assets).
 *
 * Targets any `.flip-card` on the board and the shared CardViewer's
 * `.cv-stage` (fit mode only). Everything is gated behind the
 * `fx-enabled` body class, which is added only when the device has a
 * fine hover pointer AND the user has not requested reduced motion.
 * Effect strength is scaled in CSS by a single `--fx-intensity` knob.
 *
 * Public API (window.CardFX):
 *   isEnabled()        -> boolean
 *   enhance(el)        -> idempotently add the holo/burst overlay layers
 *   refresh()          -> enhance every card currently in the DOM
 *   setEnabled(bool)   -> force on/off (also toggles body.fx-enabled)
 */
(function (global) {
  'use strict';

  var CARD_SELECTOR = '.flip-card, .cv-stage';
  var HOLO_CLASS = 'card-holo';
  var BURST_CLASS = 'fx-burst';
  var ACTIVE_CLASS = 'fx-active';
  var CLICK_CLASS = 'fx-click';
  var STORAGE_KEY = 'bb-card-fx';

  var enabled = false;        // effect actually running (capability AND preference)
  var capabilityOK = false;   // device supports it (fine pointer, motion allowed)
  var enhanced = new WeakSet();
  var rafId = null;
  var pending = null;

  // Tilt / holo tuning (degrees; scaled further by --fx-intensity in CSS).
  var MAX_RX = 8;
  var MAX_RY = 10;

  function mq(query) {
    return global.matchMedia ? global.matchMedia(query) : { matches: false, addEventListener: null };
  }

  function closestCard(node) {
    return node && node.closest ? node.closest(CARD_SELECTOR) : null;
  }

  /** Add the overlay layers to a card exactly once. */
  function enhance(el) {
    if (!el || enhanced.has(el)) return;
    enhanced.add(el);

    if (!el.querySelector(':scope > .' + HOLO_CLASS)) {
      var holo = document.createElement('div');
      holo.className = HOLO_CLASS;
      holo.setAttribute('aria-hidden', 'true');
      el.appendChild(holo);
    }
    if (!el.querySelector(':scope > .' + BURST_CLASS)) {
      var burst = document.createElement('div');
      burst.className = BURST_CLASS;
      burst.setAttribute('aria-hidden', 'true');
      el.appendChild(burst);
    }
  }

  function refresh() {
    if (!enabled) return;
    Array.prototype.forEach.call(document.querySelectorAll(CARD_SELECTOR), enhance);
  }

  function reset(card) {
    if (!card) return;
    card.classList.remove(ACTIVE_CLASS);
    card.style.removeProperty('--fx-rx');
    card.style.removeProperty('--fx-ry');
    card.style.removeProperty('--fx-hx');
    card.style.removeProperty('--fx-hy');
    card.style.removeProperty('--fx-op');
  }

  function flush() {
    rafId = null;
    var p = pending;
    pending = null;
    if (!p) return;

    var card = p.card;
    if (card.classList.contains('cv-zoomed')) {
      reset(card);
      return;
    }

    var r = card.getBoundingClientRect();
    if (!r.width || !r.height) return;

    // Normalised pointer position inside the card (0..1).
    var nx = Math.min(1, Math.max(0, (p.x - r.left) / r.width));
    var ny = Math.min(1, Math.max(0, (p.y - r.top) / r.height));

    // Tilt away from the cursor (cursor near an edge => stronger tilt).
    card.style.setProperty('--fx-rx', ((0.5 - ny) * 2 * MAX_RX).toFixed(2) + 'deg');
    card.style.setProperty('--fx-ry', ((nx - 0.5) * 2 * MAX_RY).toFixed(2) + 'deg');

    // Holo gradient follows the pointer (damped toward the centre).
    card.style.setProperty('--fx-hx', (50 + (nx - 0.5) * 70).toFixed(1) + '%');
    card.style.setProperty('--fx-hy', (50 + (ny - 0.5) * 70).toFixed(1) + '%');

    // Shine reads strongest away from the centre (as in the reference).
    var dist = Math.min(1, Math.abs(nx - 0.5) + Math.abs(ny - 0.5));
    card.style.setProperty('--fx-op', (0.32 + dist * 0.5).toFixed(2));

    card.classList.add(ACTIVE_CLASS);
  }

  function onPointerMove(e) {
    if (!enabled) return;
    var card = closestCard(e.target);
    if (!card) return;
    // The zoomed viewer image is a pan surface, not a holo card: no FX.
    if (card.classList.contains('cv-zoomed')) { reset(card); return; }
    enhance(card);
    pending = { card: card, x: e.clientX, y: e.clientY };
    if (!rafId) rafId = global.requestAnimationFrame(flush);
  }

  function onPointerOut(e) {
    if (!enabled) return;
    var card = closestCard(e.target);
    if (!card) return;
    // Ignore moves between children of the same card.
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    reset(card);
  }

  function onPointerDown(e) {
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    var card = closestCard(e.target);
    if (!card) return;
    // No click burst on the zoomed viewer image (it is being panned).
    if (card.classList.contains('cv-zoomed')) { reset(card); return; }
    enhance(card);

    // Restart the burst if it is already mid-flight.
    card.classList.remove(CLICK_CLASS);
    void card.offsetWidth;
    card.classList.add(CLICK_CLASS);

    var done = function () {
      card.classList.remove(CLICK_CLASS);
      card.removeEventListener('animationend', done);
    };
    card.addEventListener('animationend', done);
    global.setTimeout(done, 900); // fallback if animations are suppressed
  }

  // Zoom toggles land on `click`, after the class flips — clear any lingering
  // hover FX so the zoomed image is completely clean.
  function onDocumentClick(e) {
    if (!enabled) return;
    var card = closestCard(e.target);
    if (card && card.classList.contains('cv-zoomed')) reset(card);
  }

  /* ------------------------------------------------------------------
   * Preference + capability gate
   * The effect only runs when the device has a fine hover pointer and the
   * user has not requested reduced motion; on top of that the "Card FX"
   * header toggle (persisted in localStorage) can switch it off entirely.
   * ------------------------------------------------------------------ */
  function readPref() {
    try { return localStorage.getItem(STORAGE_KEY) !== '0'; }
    catch (e) { return true; }
  }

  function refreshToggleUI() {
    var btn = document.getElementById('card-fx-btn');
    if (!btn) return;
    btn.classList.toggle('on', enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.disabled = !capabilityOK;
    btn.title = !capabilityOK
      ? 'Card FX is unavailable on this device (needs a mouse and motion enabled)'
      : (enabled ? 'Card FX on — holographic tilt on cards. Click to turn off.'
                 : 'Card FX off — static cards. Click to turn on.');
    var state = document.getElementById('card-fx-btn-state');
    if (state) state.textContent = enabled ? 'on' : 'off';
  }

  function applyEnabled() {
    enabled = capabilityOK && readPref();
    if (document.body) document.body.classList.toggle('fx-enabled', enabled);
    if (!enabled) {
      Array.prototype.forEach.call(document.querySelectorAll('.' + ACTIVE_CLASS), function (el) {
        reset(el);
      });
    } else {
      refresh();
    }
    refreshToggleUI();
  }

  /** Toggle the card-effect preference (persisted). */
  function setEnabled(on) {
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); }
    catch (e) { /* storage unavailable — keep in-memory only */ }
    applyEnabled();
    if (typeof Utils !== 'undefined' && Utils.showToast) {
      Utils.showToast(on ? 'Card effects on' : 'Card effects off', 'info');
    }
  }

  var bound = false;
  function init() {
    var reduce = mq('(prefers-reduced-motion: reduce)').matches;
    capabilityOK = mq('(hover: hover) and (pointer: fine)').matches && !reduce;
    applyEnabled();

    if (bound) return;
    bound = true;

    var btn = document.getElementById('card-fx-btn');
    if (btn) btn.addEventListener('click', function () { setEnabled(!readPref()); });

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onDocumentClick, true);

    // Re-evaluate if the environment changes (e.g. reduced-motion toggled).
    var reduceMq = mq('(prefers-reduced-motion: reduce)');
    if (reduceMq.addEventListener) {
      reduceMq.addEventListener('change', init);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.CardFX = {
    isEnabled: function () { return enabled; },
    setEnabled: setEnabled,
    enhance: enhance,
    refresh: refresh
  };
})(window);
