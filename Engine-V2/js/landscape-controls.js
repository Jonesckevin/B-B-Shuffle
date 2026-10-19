/**
 * B&B Shuffle - landscape control relocation
 *
 * The short mobile shell (width <= 1200px and height <= 700px) has room in its
 * header for the roll and action controls, so they are moved OUT of their own
 * bar and INTO it, which lets the board take the freed row. The test is about
 * available height, not the window's aspect ratio: a wide-but-tall window keeps
 * its own bar, because it has the room for it.
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

    // Relocate for the short shell - the same query as player.css - so the bar
    // and the shell switch together. Taller (or wider) windows keep the bar.
    var MQ = '(max-width: 1200px) and (max-height: 700px)';
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
