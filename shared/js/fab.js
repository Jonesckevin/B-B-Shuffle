/**
 * B&B Shuffle - site navigation floating action button
 *
 * Replaces the per-page footer nav (Home / How to play / Player / Card
 * catalogue) plus the two quick-start entries (Card Creator, Solo AI) with one
 * shared radial menu, so navigation is identical on every page and lives in a
 * single place. Keep it in step with the `.app-legal` footer, which no longer
 * carries links of its own.
 *
 * Self-contained in the same spirit as CardViewer: it builds its own markup, so
 * a page only needs `<script src=".../shared/js/fab.js"></script>`. Link
 * targets are resolved against the repo root, which is derived from this
 * script's own URL, so the one file works from any folder depth. Pass
 * `data-fab-root="../../"` on the script tag to override that if the file is
 * ever loaded some other way.
 *
 * Adapted from the floating-action-btn.html reference: dimmed backdrop and
 * Escape to close. Three deliberate changes: the actions are real links (so the
 * demo's fake "action triggered" toast is gone - navigating IS the feedback),
 * each action keeps its label visible (icons alone are ambiguous), and the
 * hover/focus state lights the pill up in its accent instead of revealing it.
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

    // Destinations carried over from the footer nav this replaces, plus the two
    // quick-start entries. Order is the order they stack upward from the button.
    // Accents mirror the matching portal tiles on the home page.
    var ITEMS = [
        {
            label: 'Home',
            href: 'index.html',
            accent: '#3b82f6',
            icon: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/>'
        },
        {
            label: 'How to play',
            href: 'how-to-play.html',
            accent: '#38bdf8',
            icon: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.4 2.4 0 1 1 3.5 2.1c-.7.4-1.1 1-1.1 1.8v.3"/><line x1="12" y1="16.8" x2="12" y2="16.9"/>'
        },
        {
            label: 'Player',
            href: 'Engine-V2/player.html',
            accent: '#3b82f6',
            icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
        },
        {
            label: 'Catalogue',
            href: 'shared/catalogue.html',
            accent: '#22c55e',
            icon: '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>'
        },
        {
            label: 'Card Creator',
            href: 'Engine-V2/modules/card-creator/card_creator.html',
            accent: '#f59e0b',
            icon: '<path d="M12 3a9 9 0 1 0 0 18h1.4a2.4 2.4 0 0 0 0-4.8H13a2 2 0 0 1 0-4h3.1a4.9 4.9 0 0 0 0-9.2H12z"/><circle cx="7.6" cy="10.4" r="1.1"/><circle cx="10.6" cy="6.6" r="1.1"/><circle cx="15" cy="6.6" r="1.1"/>'
        },
        {
            label: 'Solo AI',
            href: 'Engine-V2/player.html?mode=solo',
            accent: '#22c55e',
            icon: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.5"/><line x1="2" y1="14" x2="4" y2="14"/><line x1="20" y1="14" x2="22" y2="14"/><circle cx="9.5" cy="14" r="1.2"/><circle cx="14.5" cy="14" r="1.2"/>'
        }
    ];

    function buildContainer() {
        var el = document.createElement('div');
        el.className = 'fab-container';
        el.id = 'site-fab';

        // The menu becomes visible in reverse order (nearest first), so the
        // bottom item leads and the column unfolds upward.
        var items = ITEMS.map(function (item, i) {
            var delay = (0.04 + (ITEMS.length - 1 - i) * 0.045).toFixed(3);
            var style = '--fab-delay:' + delay + 's;--fab-accent:' + item.accent;
            var external = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
            var href = /^https?:/i.test(item.href) ? item.href : ROOT + item.href;
            return '<a class="fab-item" href="' + href + '"' +
                ' style="' + style + '"' + external + '>' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"' +
                ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                item.icon + '</svg>' +
                '<span class="fab-item-label">' + item.label + '</span>' +
                '</a>';
        }).join('');

        var html = '<div class="fab-menu" id="site-fab-menu">' + items + '</div>';

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
        backdrop.id = 'site-fab-backdrop';

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
