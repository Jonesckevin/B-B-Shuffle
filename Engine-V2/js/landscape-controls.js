/**
 * B&B Shuffle - landscape control relocation
 *
 * The landscape mobile shell has room in its header for the roll and action
 * controls, so they are moved OUT of their own bar and INTO it, which lets the
 * board take the freed row. The boundary is the shell's own 1200px landscape
 * width, at any height; wider than that the bar is left alone.
 *
 * This is a real DOM move, not a CSS trick: every control keeps its id, so
 * player.js, the GM Console and the reveal controls are unaffected, and the
 * elements are put back in their original order when the viewport stops
 * matching. The layout itself is driven by `body.landscape-controls` (see
 * player.css); if this script never runs the controls simply stay in their bar,
 * so nothing is ever hidden by accident.
 *
 * Self-mounting and a no-op without .controls-bar / #header-controls.
 */
(function () {
    'use strict';

    if (!window.matchMedia) return;

    // Relocate for the whole landscape mobile shell - the same 1200px boundary as
    // the shell in player.css, at any height - so the bar and the shell switch
    // together. Above 1200 the bar keeps its own row.
    var MQ = '(orientation: landscape) and (max-width: 1200px)';
    var mq = window.matchMedia(MQ);

    var bar = document.querySelector('.controls-bar');
    var slot = document.getElementById('header-controls');
    if (!bar || !slot) return;

    // Capture the original children and their order once, so restoring is exact.
    var kids = Array.prototype.slice.call(bar.children);

    function apply(matches) {
        if (matches) {
            kids.forEach(function (el) {
                if (el.parentNode !== slot) slot.appendChild(el);
            });
            document.body.classList.add('landscape-controls');
        } else {
            kids.forEach(function (el) {
                if (el.parentNode !== bar) bar.appendChild(el);
            });
            document.body.classList.remove('landscape-controls');
        }
    }

    apply(mq.matches);

    var onChange = function (event) { apply(event.matches); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
})();
