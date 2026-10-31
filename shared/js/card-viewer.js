/**
 * CardViewer – shared, full-screen card preview overlay.
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
 *   CardViewer.open('', { items: [{ src, name, type, sections }, ...], index: 0 });
 *   CardViewer.close();
 *   CardViewer.isOpen();
 *
 * Interaction:
 *   - Optional `sections` render as tabs under the image (Details | Info);
 *     a single section shows without the tab bar.
 *   - `items` turns the viewer into a gallery: side arrows, ArrowLeft /
 *     ArrowRight and a `3 / 12` counter cycle through the list (wrapping at
 *     either end). A single item behaves exactly like the plain form.
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
  let prevBtn = null;
  let nextBtn = null;
  let countEl = null;

  let isOpen = false;
  let prevOverflow = '';
  let drag = null;            // active pan gesture while zoomed
  let suppressClick = false;  // swallow the click that ends a pan
  let items = [];             // gallery items; empty for a single card
  let itemIndex = 0;

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
      '<button type="button" class="cv-nav cv-prev" title="Previous card (left arrow)" aria-label="Previous card" hidden>&#10094;</button>' +
      '<button type="button" class="cv-nav cv-next" title="Next card (right arrow)" aria-label="Next card" hidden>&#10095;</button>' +
      '<div class="cv-meta">' +
      '  <span class="cv-name"></span>' +
      '  <span class="cv-type" hidden></span>' +
      '  <span class="cv-count" hidden></span>' +
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
    prevBtn = rootEl.querySelector('.cv-prev');
    nextBtn = rootEl.querySelector('.cv-next');
    countEl = rootEl.querySelector('.cv-count');

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
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
    document.addEventListener('keydown', (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (items.length < 2) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
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

  /** Hint line, which mentions the arrows only when there is more than one card. */
  function hintText(zoomed) {
    if (zoomed) return 'Scroll or drag to pan · Esc to close';
    return items.length > 1
      ? 'Left/right arrows to browse · Click the card to zoom · Esc to close'
      : 'Click the card to zoom · Esc to close';
  }

  /**
   * Paint one card into the viewer. Everything that differs between two cards
   * lives here, so a gallery step and a direct open take the same path.
   */
  function renderItem(item) {
    item = item || {};

    // A composed card face (Engine-V2/js/card-face.js) can take the stage
    // instead of the <img>. The <img> stays in the DOM - the pan/zoom handlers
    // drive it - but is hidden whenever a face is supplied.
    const stale = stageEl.querySelector('.card-face');
    if (stale) stale.remove();
    const face = typeof item.face === 'function' ? item.face() : item.face;
    if (face) {
      stageEl.appendChild(face);
      imgEl.removeAttribute('src');
    } else {
      imgEl.src = item.src || '';
    }
    imgEl.classList.toggle('is-face', !!face);
    imgEl.alt = item.name || 'Card preview';
    nameEl.textContent = item.name || '';
    const label = typeLabel(item.type);
    if (label) {
      typeEl.textContent = label;
      typeEl.hidden = false;
    } else {
      typeEl.hidden = true;
    }

    if (item.action && item.action.label) {
      actionBtn.textContent = item.action.label;
      actionBtn._cb = item.action.onClick || null;
      actionBtn.hidden = false;
    } else {
      actionBtn.hidden = true;
      actionBtn._cb = null;
    }

    renderSections(item.sections);
  }

  /** Show or hide the gallery arrows and update the `3 / 12` counter. */
  function updateNav() {
    const gallery = items.length > 1;
    if (prevBtn) prevBtn.hidden = !gallery;
    if (nextBtn) nextBtn.hidden = !gallery;
    if (countEl) {
      countEl.hidden = !gallery;
      countEl.textContent = gallery ? (itemIndex + 1) + ' / ' + items.length : '';
    }
    rootEl.classList.toggle('cv-gallery', gallery);
  }

  /** Step through the gallery, wrapping at either end. */
  function go(delta) {
    if (!isOpen || items.length < 2) return;
    itemIndex = (itemIndex + delta + items.length) % items.length;
    renderItem(items[itemIndex]);
    updateNav();
    fit();
  }

  function open(src, opts) {
    opts = opts || {};
    const list = Array.isArray(opts.items) ? opts.items.filter(Boolean) : null;
    if (!list && !src && !opts.face) return;
    if (!rootEl) build();

    const wasOpen = isOpen;
    isOpen = true;

    if (list && list.length) {
      items = list;
      const requested = parseInt(opts.index, 10);
      itemIndex = Math.min(Math.max(isNaN(requested) ? 0 : requested, 0), list.length - 1);
      renderItem(items[itemIndex]);
    } else {
      items = [];
      itemIndex = 0;
      renderItem({
        src: src,
        face: opts.face,
        name: opts.name,
        type: opts.type,
        sections: opts.sections,
        action: opts.action
      });
    }

    updateNav();
    rootEl.hidden = false;
    fit();

    if (!wasOpen) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  }

  function fit() {
    if (!stageEl) return;
    stageEl.classList.remove('cv-zoomed');
    if (rootEl) rootEl.classList.remove('is-zoomed');
    stageEl.scrollTop = 0;
    stageEl.scrollLeft = 0;
    if (zoomBtn) zoomBtn.textContent = 'Zoom';
    if (hintEl) hintEl.textContent = hintText(false);
  }

  function toggleZoom() {
    if (!isOpen || !stageEl) return;
    const zoomed = stageEl.classList.toggle('cv-zoomed');
    if (rootEl) rootEl.classList.toggle('is-zoomed', zoomed);
    zoomBtn.textContent = zoomed ? 'Fit' : 'Zoom';
    hintEl.textContent = hintText(zoomed);
    if (!zoomed) fit();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    items = [];
    itemIndex = 0;
    rootEl.hidden = true;
    rootEl.classList.remove('is-zoomed');
    rootEl.classList.remove('cv-gallery');
    stageEl.classList.remove('cv-zoomed');
    drag = null;
    suppressClick = false;
    imgEl.removeAttribute('src');
    // Drop any composed face so a closed viewer holds no stale markup.
    stageEl.querySelectorAll('.card-face').forEach(el => el.remove());
    actionBtn.hidden = true;
    actionBtn._cb = null;
    if (countEl) countEl.hidden = true;
    document.body.style.overflow = prevOverflow;
    prevOverflow = '';
  }

  global.CardViewer = {
    open: open,
    close: close,
    toggleZoom: toggleZoom,
    next: function () { go(1); },
    prev: function () { go(-1); },
    isOpen: function () { return isOpen; }
  };
})(window);
