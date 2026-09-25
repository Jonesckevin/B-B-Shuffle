/**
 * CardViewer — shared, full-screen card preview overlay.
 *
 * Lets a user click any B&B card and see it large enough to read, on any page
 * that includes this script:
 *   - Engine-V2 Player   (flip + big preview)
 *   - Engine-V2 Scenario Editor / admin
 *   - shared Card Catalogue
 *
 * Usage:
 *   CardViewer.open(src, { name, type, action: { label, onClick } });
 *   CardViewer.open(src, { name, type, sections: [{ label, html }] });
 *   CardViewer.close();
 *   CardViewer.isOpen();
 *
 * Interaction:
 *   - Optional `sections` render as tabs under the image (Details | Info);
 *     a single section shows without the tab bar.
 *   - Click the card image (or the "Zoom" pill) to toggle Fit <-> 1:1 (scroll to pan).
 *   - Esc, the X button, or clicking the dimmed backdrop closes the viewer.
 * Styles live in shared/css/base.css (.cv-*).
 */
(function (global) {
  'use strict';

  let rootEl = null;
  let stageEl = null;
  let imgEl = null;
  let nameEl = null;
  let typeEl = null;
  let zoomBtn = null;
  let hintEl = null;
  let actionBtn = null;
  let tabsEl = null;
  let panelsEl = null;

  let isOpen = false;
  let prevOverflow = '';
  let drag = null;            // active pan gesture while zoomed
  let suppressClick = false;  // swallow the click that ends a pan

  // DELIBERATE DUPLICATE of Utils.CARD_TYPE_LABELS (Engine-V2/js/utils.js).
  // This file must stay dependency-free: on Engine-V2/custom-cards.html it is
  // loaded BEFORE utils.js, so `Utils` does not exist yet. Keep in sync by hand.
  const TYPE_LABELS = {
    initial: 'Initial Compromise',
    pivot: 'Pivot & Escalate',
    c2: 'C2 / Exfiltration',
    persist: 'Persistence',
    procedure: 'Procedure',
    inject: 'Inject',
    consultant: 'Consultant'
  };

  function build() {
    rootEl = document.createElement('div');
    rootEl.className = 'cv-backdrop';
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-modal', 'true');
    rootEl.setAttribute('aria-label', 'Card preview');
    rootEl.hidden = true;
    rootEl.innerHTML =
      '<button type="button" class="cv-close" title="Close (Esc)" aria-label="Close">' +
      '  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
      '  </svg>' +
      '</button>' +
      '<div class="cv-stage" title="Click the card to toggle zoom">' +
      '  <img class="cv-img" alt="Card preview">' +
      '</div>' +
      '<div class="cv-meta">' +
      '  <span class="cv-name"></span>' +
      '  <span class="cv-type" hidden></span>' +
      '  <button type="button" class="cv-action" hidden></button>' +
      '  <button type="button" class="cv-zoom" title="Toggle Fit / actual size">Zoom</button>' +
      '  <span class="cv-hint"></span>' +
      '</div>' +
      '<div class="cv-tabs" hidden></div>' +
      '<div class="cv-panels" hidden></div>';
    document.body.appendChild(rootEl);

    stageEl = rootEl.querySelector('.cv-stage');
    imgEl = rootEl.querySelector('.cv-img');
    nameEl = rootEl.querySelector('.cv-name');
    typeEl = rootEl.querySelector('.cv-type');
    zoomBtn = rootEl.querySelector('.cv-zoom');
    hintEl = rootEl.querySelector('.cv-hint');
    actionBtn = rootEl.querySelector('.cv-action');
    tabsEl = rootEl.querySelector('.cv-tabs');
    panelsEl = rootEl.querySelector('.cv-panels');

    rootEl.querySelector('.cv-close').addEventListener('click', close);
    rootEl.addEventListener('click', (e) => {
      if (e.target === rootEl) close();
    });
    imgEl.addEventListener('click', () => {
      // Ignore the click that ends a pan gesture.
      if (suppressClick) { suppressClick = false; return; }
      toggleZoom();
    });
    zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleZoom(); });

    // Drag to pan while zoomed (mouse + touch via pointer events).
    stageEl.addEventListener('pointerdown', (e) => {
      if (!stageEl.classList.contains('cv-zoomed')) return;
      suppressClick = false;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: stageEl.scrollLeft, st: stageEl.scrollTop };
      try { stageEl.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      imgEl.style.cursor = 'grabbing';
    });
    stageEl.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) suppressClick = true;
      stageEl.scrollLeft = drag.sl - dx;
      stageEl.scrollTop = drag.st - dy;
    });
    const endDrag = () => {
      if (!drag) return;
      try { stageEl.releasePointerCapture(drag.id); } catch (err) { /* noop */ }
      drag = null;
      imgEl.style.cursor = '';
    };
    stageEl.addEventListener('pointerup', endDrag);
    stageEl.addEventListener('pointercancel', endDrag);
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cb = actionBtn._cb;
      actionBtn.hidden = true;
      actionBtn._cb = null;
      close();
      if (typeof cb === 'function') cb();
    });
    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.cv-tab');
      if (btn) selectTab(parseInt(btn.dataset.idx, 10));
    });
    document.addEventListener('keydown', (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    window.addEventListener('resize', () => { if (isOpen) fit(); });
  }

  function typeLabel(type) {
    if (!type) return '';
    return TYPE_LABELS[type] ? TYPE_LABELS[type] : type;
  }

  // DELIBERATE DUPLICATE of Utils.escapeHtml (Engine-V2/js/utils.js) - `Utils`
  // is not available here (see the TYPE_LABELS note above). Same 5 entities.
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /** Render the optional tabbed sections under the image. */
  function renderSections(sections) {
    if (!tabsEl || !panelsEl) return;
    const has = Array.isArray(sections) && sections.length > 0;
    rootEl.classList.toggle('cv-has-details', has);
    if (!has) {
      tabsEl.hidden = true;
      panelsEl.hidden = true;
      tabsEl.innerHTML = '';
      panelsEl.innerHTML = '';
      return;
    }
    tabsEl.innerHTML = sections.map((s, i) =>
      `<button type="button" class="cv-tab${i === 0 ? ' is-active' : ''}" data-idx="${i}">` +
      `${escapeHtml(s.label || ('Tab ' + (i + 1)))}</button>`
    ).join('');
    panelsEl.innerHTML = sections.map((s, i) =>
      `<div class="cv-panel${i === 0 ? ' is-active' : ''}" data-idx="${i}">${s.html || ''}</div>`
    ).join('');
    // A single section needs no tab bar.
    tabsEl.hidden = sections.length < 2;
    panelsEl.hidden = false;
    panelsEl.scrollTop = 0;
  }

  function selectTab(index) {
    if (!tabsEl || !panelsEl) return;
    tabsEl.querySelectorAll('.cv-tab').forEach((b, i) => b.classList.toggle('is-active', i === index));
    panelsEl.querySelectorAll('.cv-panel').forEach((p, i) => {
      const active = i === index;
      p.classList.remove('is-active');
      if (active) {
        void p.offsetWidth;   // restart the panel animation
        p.classList.add('is-active');
      }
    });
    panelsEl.scrollTop = 0;
  }

  function open(src, opts) {
    if (!src) return;
    if (!rootEl) build();
    opts = opts || {};

    isOpen = true;
    imgEl.src = src;
    imgEl.alt = opts.name || 'Card preview';
    nameEl.textContent = opts.name || '';
    const label = typeLabel(opts.type);
    if (label) {
      typeEl.textContent = label;
      typeEl.hidden = false;
    } else {
      typeEl.hidden = true;
    }

    if (opts.action && opts.action.label) {
      actionBtn.textContent = opts.action.label;
      actionBtn._cb = opts.action.onClick || null;
      actionBtn.hidden = false;
    } else {
      actionBtn.hidden = true;
      actionBtn._cb = null;
    }

    hintEl.textContent = 'Click the card to zoom · Esc to close';
    rootEl.hidden = false;
    renderSections(opts.sections);
    fit();

    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  function fit() {
    if (!stageEl) return;
    stageEl.classList.remove('cv-zoomed');
    if (rootEl) rootEl.classList.remove('is-zoomed');
    stageEl.scrollTop = 0;
    stageEl.scrollLeft = 0;
    if (zoomBtn) zoomBtn.textContent = 'Zoom';
    if (hintEl) hintEl.textContent = 'Click the card to zoom · Esc to close';
  }

  function toggleZoom() {
    if (!isOpen || !stageEl) return;
    const zoomed = stageEl.classList.toggle('cv-zoomed');
    if (rootEl) rootEl.classList.toggle('is-zoomed', zoomed);
    zoomBtn.textContent = zoomed ? 'Fit' : 'Zoom';
    hintEl.textContent = zoomed ? 'Scroll or drag to pan · Esc to close' : 'Click the card to zoom · Esc to close';
    if (!zoomed) fit();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    rootEl.hidden = true;
    rootEl.classList.remove('is-zoomed');
    stageEl.classList.remove('cv-zoomed');
    drag = null;
    suppressClick = false;
    imgEl.removeAttribute('src');
    actionBtn.hidden = true;
    actionBtn._cb = null;
    document.body.style.overflow = prevOverflow;
    prevOverflow = '';
  }

  global.CardViewer = {
    open: open,
    close: close,
    toggleZoom: toggleZoom,
    isOpen: function () { return isOpen; }
  };
})(window);
