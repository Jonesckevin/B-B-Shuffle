/**
 * B&B Shuffle - PWA bootstrap (service-worker registration + install prompt)
 *
 * Self-mounting in the same spirit as shared/js/fab.js: the repo root is derived
 * from this script's own src, so the one file works from any page depth, and a
 * page only needs `<script src=".../shared/js/pwa.js"></script>`. A no-op when
 * service workers are unsupported (or the page is on plain http, e.g. a LAN IP).
 *
 * The install button is #pwa-install-btn in the Player's compact header menu; it
 * stays hidden until the browser fires beforeinstallprompt.
 */
(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) return;

    var SCRIPT_RE = /^(.*)\/shared\/js\/pwa\.js(?:\?.*)?$/;
    var self = document.currentScript;

    function rootPrefix() {
        if (self && self.src) {
            var match = SCRIPT_RE.exec(self.src);
            if (match) return match[1] + '/';
        }
        var override = document.querySelector('script[data-pwa-root]');
        return override ? (override.getAttribute('data-pwa-root') || '') : '';
    }

    var ROOT = rootPrefix();

    // Register after load so it never competes with the first paint.
    window.addEventListener('load', function () {
        navigator.serviceWorker
            .register(ROOT + 'sw.js', { updateViaCache: 'none' })
            .catch(function () { /* http origin, private mode, etc. */ });
    });

    // --- install prompt -----------------------------------------------------
    var deferredPrompt = null;
    var installBtn = document.getElementById('pwa-install-btn');

    window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault();
        deferredPrompt = event;
        if (installBtn) installBtn.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        if (installBtn) installBtn.classList.add('hidden');
    });

    if (installBtn) {
        installBtn.addEventListener('click', function () {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            var done = function () {
                deferredPrompt = null;
                installBtn.classList.add('hidden');
            };
            if (deferredPrompt.userChoice && deferredPrompt.userChoice.then) {
                deferredPrompt.userChoice.then(done, done);
            } else {
                done();
            }
        });
    }

    // Public seam (tests / other modules).
    window.PWA = {
        root: ROOT,
        get installAvailable() { return !!deferredPrompt; }
    };
})();
