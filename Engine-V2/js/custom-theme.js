/**
 * B&B Shuffle — Browser-only table theme (Player page)
 * Lets the user set a background image and a top-left logo for their session.
 * Everything is stored in localStorage (data-URLs) — nothing is uploaded to the
 * server and nothing is written into scenarios/decks.
 */
(function () {
    'use strict';

    var KEYS = { bg: 'bb-theme-bg', logo: 'bb-theme-logo', show: 'bb-theme-logoShow' };

    // Shipped default for the header logo. Deliberately the same file the page
    // footer already loads, so showing it costs no extra download.
    var DEFAULT_LOGO = '../shared/img/bb-logo-transparent-w.png';

    function el(id) { return document.getElementById(id); }

    function storeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function storeSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { console.error('Theme storage failed', e); }
    }
    function storeDel(key) {
        try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }

    /**
     * Downscale + re-encode a picked image so it stays well under the 5 MB
     * localStorage budget. PNG sources keep alpha; everything else becomes JPEG.
     * @param {File} file - Image file from an <input type="file">
     * @param {number} maxDim - Longest side after downscaling (px)
     * @returns {Promise<string>} data URL
     */
    function fileToDataUrl(file, maxDim) {
        return new Promise(function (resolve, reject) {
            if (!file || !/^image\//.test(file.type)) {
                reject(new Error('Please choose an image file'));
                return;
            }
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('Could not read file')); };
            reader.onload = function (ev) {
                var img = new Image();
                img.onerror = function () { reject(new Error('Not a readable image')); };
                img.onload = function () {
                    var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                    var w = Math.max(1, Math.round(img.width * scale));
                    var h = Math.max(1, Math.round(img.height * scale));
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    // Backgrounds flatten over the app's dark surface; logos keep alpha.
                    var isPng = /image\/(png|gif|webp)/i.test(file.type);
                    if (!isPng) { ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, w, h); }
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85));
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    /* ---------------- apply to the page ---------------- */

    function applyBackground(dataUrl) {
        var body = document.body;
        // Flagged so player.css can drop the card-tray fills and let the image through.
        body.classList.toggle('has-custom-bg', !!dataUrl);
        if (!dataUrl) {
            body.style.backgroundImage = '';
            body.style.backgroundSize = '';
            body.style.backgroundRepeat = '';
            body.style.backgroundPosition = '';
            body.style.backgroundAttachment = '';
            return;
        }
        // A translucent dark layer sits over the image so cards/text stay readable.
        body.style.backgroundImage =
            'linear-gradient(rgba(8,10,15,0.62), rgba(8,10,15,0.62)), url("' + dataUrl + '")';
        body.style.backgroundSize = 'cover';
        body.style.backgroundRepeat = 'no-repeat';
        body.style.backgroundPosition = 'center';
        body.style.backgroundAttachment = 'fixed';
    }

    /**
     * Show or hide the header logo.
     * @param {string|null} customUrl - an uploaded logo, or null to use the default
     * @param {boolean} show - the "Show logo in the header" toggle
     */
    function applyLogo(customUrl, show) {
        var logo = el('custom-logo');
        if (!logo) return;
        if (show === false) { logo.hidden = true; logo.classList.add('hidden'); return; }
        var src = customUrl || DEFAULT_LOGO;
        if (logo.getAttribute('src') !== src) logo.setAttribute('src', src);
        logo.hidden = false;
        logo.classList.remove('hidden');
    }

    function renderPreview(kind) {
        var box = kind === 'bg' ? el('theme-bg-preview') : el('theme-logo-preview');
        if (!box) return;

        if (kind === 'bg') {
            var url = storeGet(KEYS.bg);
            box.innerHTML = url
                ? '<img src="' + url + '" alt="">'
                : '<span class="theme-preview-empty">No background set</span>';
            return;
        }

        // The bundled logo is the baseline, so the preview shows what the
        // header will actually render rather than an empty state.
        if (storeGet(KEYS.show) === '0') {
            box.innerHTML = '<span class="theme-preview-empty">Logo removed</span>';
            return;
        }
        box.innerHTML = '<img src="' + (storeGet(KEYS.logo) || DEFAULT_LOGO) + '" alt="">';
    }

    /* ---------------- persistence + modal ---------------- */

    function pickAndApply(kind) {
        var fileInput = kind === 'bg' ? el('theme-bg-file') : el('theme-logo-file');
        var file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) return;
        var maxDim = kind === 'bg' ? 1920 : 320;
        fileToDataUrl(file, maxDim).then(function (dataUrl) {
            storeSet(kind === 'bg' ? KEYS.bg : KEYS.logo, dataUrl);
            if (kind === 'bg') {
                applyBackground(dataUrl);
            } else {
                // Choosing a logo implies wanting to see it, even if it had
                // previously been removed.
                storeSet(KEYS.show, '1');
                el('theme-logo-toggle').checked = true;
                applyLogo(dataUrl, true);
            }
            renderPreview(kind);
            refreshLogoUI();
            if (fileInput) fileInput.value = '';
        }).catch(function (err) {
            if (typeof Utils !== 'undefined' && Utils.showToast) Utils.showToast(err.message, 'error');
        });
    }

    function clearBackground() {
        storeDel(KEYS.bg);
        applyBackground(null);
        renderPreview('bg');
    }

    /**
     * "Remove logo" - no logo at all. Any upload is discarded, so the only ways
     * back are "Reset to default" or another upload.
     */
    function removeLogo() {
        storeDel(KEYS.logo);
        storeSet(KEYS.show, '0');
        el('theme-logo-toggle').checked = false;
        applyLogo(null, false);
        renderPreview('logo');
        refreshLogoUI();
    }

    /** "Reset to default" - drop any upload and show the bundled logo again. */
    function resetLogo() {
        storeDel(KEYS.logo);
        storeSet(KEYS.show, '1');
        el('theme-logo-toggle').checked = true;
        applyLogo(null, true);
        renderPreview('logo');
        refreshLogoUI();
    }

    /** Keep the status line and the reset button in step with the stored state. */
    function refreshLogoUI() {
        var custom = !!storeGet(KEYS.logo);
        var shown = storeGet(KEYS.show) !== '0';

        var status = el('theme-logo-status');
        if (status) {
            status.textContent = !shown
                ? 'No logo shown in the header.'
                : (custom ? 'Using your uploaded logo.' : 'Using the default logo.');
        }

        var reset = el('theme-logo-reset');
        if (reset) reset.disabled = !custom && shown;   // already the default
    }

    function openModal() { Utils.showElement('theme-modal'); }
    function closeModal() { Utils.hideElement('theme-modal'); }

    function cardViewerOpen() {
        try {
            return typeof CardViewer !== 'undefined' && CardViewer.isOpen && CardViewer.isOpen();
        } catch (e) { return false; }
    }

    function bind() {
        var openBtn = el('theme-custom-btn');
        if (openBtn) openBtn.addEventListener('click', openModal);
        el('theme-modal-close').addEventListener('click', closeModal);
        el('theme-modal-done').addEventListener('click', closeModal);
        el('theme-bg-file').addEventListener('change', function () { pickAndApply('bg'); });
        el('theme-logo-file').addEventListener('change', function () { pickAndApply('logo'); });
        el('theme-bg-remove').addEventListener('click', clearBackground);
        el('theme-logo-remove').addEventListener('click', removeLogo);
        el('theme-logo-reset').addEventListener('click', resetLogo);
        el('theme-logo-toggle').addEventListener('change', function (e) {
            storeSet(KEYS.show, e.target.checked ? '1' : '0');
            applyLogo(storeGet(KEYS.logo), e.target.checked);
            renderPreview('logo');
            refreshLogoUI();
        });
        el('theme-modal').addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !cardViewerOpen() && !el('theme-modal').classList.contains('hidden')) {
                closeModal();
            }
        });
    }

    function init() {
        if (!el('custom-logo')) return; // only on pages that include the theme UI
        var show = storeGet(KEYS.show) !== '0';
        el('theme-logo-toggle').checked = show;
        applyBackground(storeGet(KEYS.bg));
        applyLogo(storeGet(KEYS.logo), show);
        renderPreview('bg');
        renderPreview('logo');
        refreshLogoUI();
        bind();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
