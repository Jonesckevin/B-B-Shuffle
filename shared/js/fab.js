/**
 * B&B Shuffle - site navigation floating action button
 *
 * Replaces the per-page footer nav (Home / Library / Flowchart / AI Generator)
 * with one shared radial menu, so navigation is identical on every page and
 * lives in a single place.
 *
 * Self-contained in the same spirit as CardViewer: it builds its own markup, so
 * a page only needs `<script src=".../shared/js/fab.js"></script>`. Link
 * targets are resolved against the repo root, which is derived from this
 * script's own URL, so the one file works from any folder depth. Pass
 * `data-fab-root="../../"` on the script tag to override that if the file is
 * ever loaded some other way.
 *
 * Adapted from the floating-action-btn.html reference: radial fan, dimmed
 * backdrop, Escape to close. Two deliberate changes: the actions are real
 * links (so the demo's fake "action triggered" toast is gone - navigating IS
 * the feedback), and the cursor-tracked tooltip is now a label anchored to its
 * own button, which also shows on keyboard focus.
 */
(function () {
    'use strict';

    var SCRIPT_RE = /^(.*)\/shared\/js\/fab\.js(?:\?.*)?$/;
    var self = document.currentScript;

    function rootPrefix() {
        if (self && self.src) {
            var match = SCRIPT_RE.exec(self.src);
            if (match) return match[1] + '/';
        }
        var override = document.querySelector('script[data-fab-root]');
        return override ? (override.getAttribute('data-fab-root') || '') : '';
    }

    var ROOT = rootPrefix();

    // Destinations carried over from the footer nav this replaces. Order is the
    // order they fan out, clockwise from the top of the arc.
    var ITEMS = [
        {
            label: 'Home',
            href: 'index.html',
            icon: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/>'
        },
        {
            label: 'Library',
            href: 'Engine-V2/scenario-library.html',
            icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
        },
        {
            label: 'Flowchart',
            href: 'Engine-V2/modules/mermaid/flowchart.html',
            icon: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'
        },
        {
            label: 'AI Generator',
            href: 'Engine-V2/modules/scenario-ai/scenario_ai.html',
            icon: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.5"/><line x1="2" y1="14" x2="4" y2="14"/><line x1="20" y1="14" x2="22" y2="14"/><circle cx="9.5" cy="14" r="1.2"/><circle cx="14.5" cy="14" r="1.2"/>'
        }
    ];

    function buildContainer() {
        var el = document.createElement('div');
        el.className = 'fab-container';
        el.id = 'site-fab';

        var html = ITEMS.map(function (item, i) {
            return '<a class="fab-item fab-item-' + (i + 1) + '" href="' + ROOT + item.href + '">' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"' +
                ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                item.icon + '</svg>' +
                '<span class="fab-item-label">' + item.label + '</span>' +
                '</a>';
        }).join('');

        html += '<button class="fab-main" type="button" aria-expanded="false"' +
            ' aria-controls="site-fab-menu" aria-label="Open site navigation">' +
            '<svg class="fab-icon-plus" viewBox="0 0 24 24" width="22" height="22" fill="none"' +
            ' stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
            '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
            '<svg class="fab-icon-close" viewBox="0 0 24 24" width="20" height="20" fill="none"' +
            ' stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
            '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>';

        el.innerHTML = html;
        return el;
    }

    function init() {
        if (document.getElementById('site-fab')) return;

        var container = buildContainer();
        var backdrop = document.createElement('div');
        backdrop.className = 'fab-backdrop';
        backdrop.id = 'site-fab-menu';

        document.body.appendChild(backdrop);
        document.body.appendChild(container);
        document.body.classList.add('has-fab');

        var main = container.querySelector('.fab-main');
        var isOpen = false;

        function setOpen(next) {
            isOpen = next;
            container.classList.toggle('open', isOpen);
            backdrop.classList.toggle('visible', isOpen);
            main.setAttribute('aria-expanded', String(isOpen));
            main.setAttribute('aria-label', isOpen ? 'Close site navigation' : 'Open site navigation');
        }

        main.addEventListener('click', function () { setOpen(!isOpen); });
        backdrop.addEventListener('click', function () { setOpen(false); });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen) {
                setOpen(false);
                main.focus();
            }
        });

        // Following a link navigates away, so just tidy the open state in case
        // the target is same-page or the navigation is cancelled.
        container.querySelectorAll('.fab-item').forEach(function (item) {
            item.addEventListener('click', function () { setOpen(false); });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
