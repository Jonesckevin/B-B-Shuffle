/**
 * B&B Shuffle - compact-mode header menu
 *
 * On phone/tablet widths the header actions (.header-right) collapse into a
 * dropdown panel so the board gets the whole screen height. This module owns
 * the open/close behaviour of that panel; the panel itself is the SAME markup
 * as on desktop (the buttons are NOT moved), only re-laid out by CSS - so every
 * existing id-bound control keeps working untouched.
 *
 * Self-mounting and a no-op without #header-menu-btn, in the same spirit as
 * print-sheet.js / solo-master.js / gm-link.js: a page only needs the script tag.
 */
(function () {
    'use strict';

    var btn = document.getElementById('header-menu-btn');
    if (!btn) return;

    var header = btn.closest('.player-header') || document.querySelector('.player-header');
    var panel = document.getElementById('header-menu');
    if (!header || !panel) return;

    function isOpen() {
        return header.classList.contains('menu-open');
    }

    function setOpen(open) {
        header.classList.toggle('menu-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(!isOpen());
    });

    // Outside click closes the menu (the toggle itself is excluded above).
    document.addEventListener('click', function (event) {
        if (isOpen() && !header.contains(event.target)) setOpen(false);
    });

    // Escape closes the menu.
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && isOpen()) setOpen(false);
    });

    // Choosing an action closes the menu, EXCEPT controls that open their own
    // nested UI (the Load dropdown, the install prompt) - closing on those
    // would hide the thing the user just asked for.
    var KEEP_OPEN = { 'load-scenario-btn': 1, 'pwa-install-btn': 1 };
    panel.addEventListener('click', function (event) {
        var action = event.target.closest('.header-action, .rules-btn, .header-legal-link');
        if (!action || KEEP_OPEN[action.id]) return;
        // Defer so the control's own click handler runs before we hide it.
        setTimeout(function () { setOpen(false); }, 0);
    });

    // Leaving compact mode (e.g. rotating to landscape on a large device or
    // resizing the window) must drop the open state so the desktop row is normal.
    window.addEventListener('resize', function () {
        if (isOpen() && !btn.offsetParent) setOpen(false);
    });
})();
