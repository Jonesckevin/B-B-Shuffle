/**
 * B&B Shuffle — Procedure card-back picker (Player page)
 *
 * Lets the player choose what is printed on the BACK of their Procedure cards:
 * the shipped blue PROCEDURES art, or any deck's box art from
 * `shared/img/decks/`. Purely cosmetic — a localStorage preference
 * (`bb-theme-procedureBack`) that repaints the hand and touches nothing else.
 * No scenario, deck or game rule is affected, and a board dealt without it
 * looks exactly as it did before.
 *
 * How the art is applied:
 *  - `PlayerController.updateProcedureCards()` is the one funnel that builds the
 *    hand, so it is WRAPPED (the solo-master/print-sheet idiom) and the face-down
 *    `src` is swapped in place afterwards. The hand is deliberately NOT rebuilt:
 *    a rebuild drops the player's flips, and the method is documented as
 *    off-limits unless the hand itself changed.
 *  - With no choice stored, `PlayerController.procedureBackUrl()` decides, so
 *    "reset to default" is whatever the deck in play already asked for — the
 *    default blue Procedure art for every deck shipped today.
 *
 * Self-mounting: a no-op on any page without the theme picker markup.
 */
(function () {
    'use strict';

    var STORE_KEY = 'bb-theme-procedureBack';

    // The shipped Procedures back, used for the "default" tile and as the last
    // resort if the Player has not rendered a board yet.
    var DEFAULT_BACK = '../shared/decks/cardbacks/v2/procedure.webp';
    var DEFAULT_LABEL = 'Procedures (blue)';

    function el(id) { return document.getElementById(id); }

    function storeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function storeSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { console.error('Card-back storage failed', e); }
    }
    function storeDel(key) {
        try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }

    function art(src) {
        return (typeof Utils !== 'undefined' && Utils.assetPath) ? Utils.assetPath(src) : src;
    }
    function esc(str) {
        return (typeof Utils !== 'undefined' && Utils.escapeHtml) ? Utils.escapeHtml(str) : String(str);
    }
    function toast(msg) {
        if (typeof Utils !== 'undefined' && Utils.showToast) Utils.showToast(msg, 'success');
    }

    /**
     * Every back the user may pick: the shipped Procedures art first (id `''`,
     * the default), then each deck's box art in registry order. The list is
     * derived from `CONFIG.decks[].cover` rather than hard-coded, so a deck with
     * no box art upstream (core-v1, green-expansion-v2, custom) simply is not
     * offered and a newly covered deck appears on its own.
     * @returns {Array<{id: string, label: string, src: string}>}
     */
    function choices() {
        var list = [{ id: '', label: DEFAULT_LABEL, src: art(DEFAULT_BACK) }];
        var decks = (typeof CONFIG !== 'undefined' && CONFIG.decks) || null;
        if (!decks) return list;
        Object.keys(decks).forEach(function (key) {
            var deck = decks[key];
            if (!deck || !deck.cover) return;
            list.push({ id: key, label: deck.name || key, src: art(deck.cover) });
        });
        return list;
    }

    /** @returns {{id: string, label: string, src: string}|null} */
    function choiceFor(id) {
        if (!id) return null;
        var found = null;
        choices().forEach(function (candidate) {
            if (candidate.id === id) found = candidate;
        });
        return found;
    }

    function stored() { return storeGet(STORE_KEY) || ''; }

    /**
     * The art the hand should show right now. No choice — or an id the registry
     * no longer carries — falls through to the Player's own answer for the deck
     * in play.
     * @returns {string} page-relative URL
     */
    function targetUrl() {
        var chosen = choiceFor(stored());
        if (chosen) return chosen.src;
        try {
            if (typeof PlayerController !== 'undefined' && PlayerController.procedureBackUrl) {
                return art(PlayerController.procedureBackUrl());
            }
        } catch (e) { /* fall through to the shipped art */ }
        return art(DEFAULT_BACK);
    }

    /** Swap the face-down art on every procedure card already in the DOM. */
    function paint() {
        var url = targetUrl();
        if (!url) return;
        var faces = document.querySelectorAll('.procedure-cards .flip-card-front img');
        Array.prototype.forEach.call(faces, function (node) {
            if (node.getAttribute('src') !== url) node.setAttribute('src', url);
        });
    }

    /** Repaint after every hand render, without rebuilding the hand. */
    function wrapHand() {
        if (typeof PlayerController === 'undefined' || typeof PlayerController.updateProcedureCards !== 'function') return;
        if (PlayerController.updateProcedureCards.__cardbackWrapped) return;
        var original = PlayerController.updateProcedureCards;
        var wrapped = function () {
            var result = original.apply(this, arguments);
            paint();
            return result;
        };
        wrapped.__cardbackWrapped = true;
        PlayerController.updateProcedureCards = wrapped;
    }

    /* ---------------- the Theme modal's group ---------------- */

    /** Keep the preview, the status line and the reset button in step. */
    function renderThemeUI() {
        var chosen = choiceFor(stored());

        var preview = el('theme-cardback-preview');
        if (preview) {
            preview.innerHTML = '<img src="' + esc(chosen ? chosen.src : art(DEFAULT_BACK)) + '" alt="">';
        }

        var status = el('theme-cardback-status');
        if (status) {
            status.textContent = chosen
                ? 'Using the ' + chosen.label + ' box art.'
                : 'Using the default Procedure back.';
        }

        var reset = el('theme-cardback-reset');
        if (reset) reset.disabled = !chosen;            // already the default
    }

    /* ---------------- the gallery modal ---------------- */

    function renderGallery() {
        var box = el('cb-gallery');
        if (!box) return;
        var active = stored();
        box.innerHTML = choices().map(function (candidate) {
            var selected = candidate.id === active;
            return '<button type="button" class="cb-tile' + (selected ? ' is-active' : '') + '"' +
                ' data-cardback="' + esc(candidate.id) + '"' +
                ' aria-pressed="' + (selected ? 'true' : 'false') + '"' +
                ' title="' + esc(candidate.label) + '">' +
                '<span class="cb-thumb"><img src="' + esc(candidate.src) + '" alt="" loading="lazy"></span>' +
                '<span class="cb-name">' + esc(candidate.label) + '</span>' +
                '</button>';
        }).join('');
    }

    /**
     * Apply a choice (`''` restores the default) and repaint the board.
     * @param {string} id - Deck key, or '' for the shipped Procedures art
     */
    function choose(id) {
        var chosen = choiceFor(id);
        if (chosen) storeSet(STORE_KEY, chosen.id);
        else storeDel(STORE_KEY);
        paint();
        renderThemeUI();
        renderGallery();
        toast(chosen ? 'Procedure backs: ' + chosen.label : 'Procedure backs: default');
    }

    /**
     * The gallery REPLACES the Theme modal rather than stacking on it, so only
     * one modal is ever open — which also keeps custom-theme.js's Escape handler
     * from closing the modal underneath.
     */
    function openGallery() {
        renderGallery();
        Utils.hideElement('theme-modal');
        Utils.showElement('cardback-modal');
    }

    function closeGallery() {
        Utils.hideElement('cardback-modal');
        Utils.showElement('theme-modal');
        renderThemeUI();
    }

    function bind() {
        var modal = el('cardback-modal');
        var box = el('cb-gallery');

        el('theme-cardback-choose').addEventListener('click', openGallery);
        el('theme-cardback-reset').addEventListener('click', function () { choose(''); });

        el('cardback-modal-close').addEventListener('click', closeGallery);
        el('cardback-modal-done').addEventListener('click', closeGallery);
        el('cardback-modal-reset').addEventListener('click', function () { choose(''); });

        box.addEventListener('click', function (e) {
            var tile = e.target.closest('[data-cardback]');
            if (tile) choose(tile.dataset.cardback || '');
        });

        // Clicking the dimmed area closes, like every other modal here.
        modal.addEventListener('click', function (e) { if (e.target === this) closeGallery(); });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            // custom-theme.js's own Escape handler is registered first and sees
            // the Theme modal hidden, so it no-ops and this one wins.
            if (!modal.classList.contains('hidden')) closeGallery();
        });
    }

    function init() {
        if (!el('theme-cardback-choose')) return;       // only where the picker is
        // A choice for a deck that is no longer registered is stale: drop it so
        // the status line and the board agree.
        if (stored() && !choiceFor(stored())) storeDel(STORE_KEY);
        wrapHand();
        bind();
        renderThemeUI();
        renderGallery();
        paint();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exposed for tests and for anything that needs to repaint the hand.
    window.CardbackTheme = {
        choices: choices,
        current: stored,
        url: targetUrl,
        set: choose,
        reset: function () { choose(''); },
        refresh: paint,
        storageKey: STORE_KEY
    };
})();
