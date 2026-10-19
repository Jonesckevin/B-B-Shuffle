/**
 * B&B Shuffle – live card face composer
 * ---------------------------------------------------------------------------
 * Composes a card face at DISPLAY time from a WebP template plus live text,
 * instead of rasterising the whole face into one stored PNG. The text is real
 * DOM, so it stays crisp at any size and can be selected/searched.
 *
 * A "template card" is any card carrying a `template` key (the Custom Card
 * Creator sets it to the card's type). Shipped deck cards have no `template`
 * and keep using their own art through <img>, so the two models coexist.
 *
 * Layout is expressed in PERCENT of the template image, so it does not depend
 * on the template's pixel size, and type is sized in `cqw` (container width
 * units) so the whole face scales from its own width – one definition serves
 * the Creator preview, a 40px print thumbnail and the projected board.
 *
 * Self-contained in the same spirit as shared/js/fab.js: the repo path comes
 * from this script's own `src`, so the file works from any page depth.
 *
 * Public surface: window.CardFace = {
 *   TYPES, DIR, TEMPLATES, templateFor(type), isTemplateCard(card),
 *   build(card) -> HTMLElement,
 *   apply(host, card) -> boolean          (replaces host's content)
 *   toPngDataUrl(card, opts) -> Promise   (Download PNG only; nothing stored)
 * }
 */
(function () {
    'use strict';

    var SCRIPT_RE = /^(.*?)\/?js\/card-face\.js(?:\?.*)?$/;
    var selfScript = document.currentScript;

    function scriptPrefix() {
        if (selfScript && selfScript.src) {
            var match = SCRIPT_RE.exec(selfScript.src);
            if (match) return match[1] ? match[1] + '/' : '';
        }
        var override = document.querySelector('script[data-cardface-root]');
        return override ? (override.getAttribute('data-cardface-root') || '') : '';
    }

    // '' from Engine-V2/*.html, '../../' from Engine-V2/modules/<module>/*.html –
    // both resolve the two constants below against the repo root.
    var PREFIX = scriptPrefix();
    var ROOT = PREFIX + '../';
    var DIR = ROOT + 'shared/img/card-templates/';

    var FONT = "'Teko', 'Segoe UI', Arial, sans-serif";

    /* ------------------------------------------------------------------ */
    /* Template table                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * type -> template file, title colour and content layout.
     * The band colour comes from the artwork, so the title colour is fixed per
     * type here (the inject band is light, every other band is dark).
     */
    var TEMPLATES = {
        initial:    { file: 'initial.webp',    title: '#ffffff', layout: 'scenario' },
        pivot:      { file: 'pivot.webp',      title: '#3a2d00', layout: 'scenario' },
        c2:         { file: 'c2.webp',         title: '#ffffff', layout: 'scenario' },
        persist:    { file: 'persist.webp',    title: '#ffffff', layout: 'scenario' },
        procedure:  { file: 'procedure.webp',  title: '#ffffff', layout: 'procedure' },
        inject:     { file: 'inject.webp',     title: '#39414d', layout: 'inject' },
        consultant: { file: 'consultant.webp', title: '#ffffff', layout: 'consultant' }
    };

    var TYPES = Object.keys(TEMPLATES);

    /* ------------------------------------------------------------------ */
    /* Geometry – percent of the template image                            */
    /* ------------------------------------------------------------------ */
    // The printed headings ("DETECTION", "TOOLS", "NOTES", "SPECIALTIES") and
    // their rules are part of the artwork, so only the CONTENT is positioned:
    //   x/y/w/h = percent of the image;  size = percent of the image WIDTH
    //   (rendered as cqw in the DOM and as W*size/100 px on canvas).
    // Measured off the supplied templates. The DOM and canvas renderers share
    // this table so they cannot drift.

    // Measured off the supplied 680x941 templates (temp/measure_templates.py).
    // Every template prints the card at the same place; only the heading sits
    // differently, which is why the layouts differ:
    //   title band      y  7.1% - 13.4%   body x 14% - 86.5%   body ends ~90.5%
    //   scenario:  DETECTION rule 35.7%   TOOLS rule 61.5%
    //   procedure: TOOLS rule    36.1%
    //   inject / consultant: NOTES / SPECIALTIES rule 31.7%
    // The DOM and canvas renderers share this table so they cannot drift.

    // The title sits a shade below the band's true centre: Teko carries a deep
    // descender, so optically centring the line box leaves the caps looking high.
    var TITLE_BOX = { x: 11, y: 7.5, w: 78, h: 6.4, size: 6.4, align: 'center', lines: 1 };

    var BOXES = {
        // initial / pivot / c2 / persist – DETECTION list, then TOOLS beside the
        // uploaded artwork panel.
        scenario: {
            description: { x: 14, y: 15.2, w: 72.5, h: 15, size: 3.3, align: 'left', lines: 5 },
            detection:   { x: 14, y: 36.4, w: 72.5, h: 19.5, size: 3.3, align: 'left', lines: 6 },
            tools:       { x: 14, y: 62.4, w: 22, h: 27, size: 3.3, align: 'left', lines: 10 },
            // Used when the card carries no artwork - the list is then free to
            // use the whole width instead of the narrow column.
            toolsWide:   { x: 14, y: 62.4, w: 72.5, h: 27, size: 3.3, align: 'left', lines: 10 },
            artwork:     { x: 37, y: 62.2, w: 50, h: 28.5 },
            resources:   { x: 14, y: 84.0, w: 72.5, h: 7.5, size: 2.6, align: 'left', lines: 3 }
        },
        // procedure – TOOLS only, heading higher up the card.
        procedure: {
            description: { x: 14, y: 15.2, w: 72.5, h: 16, size: 3.3, align: 'left', lines: 5 },
            tools:       { x: 14, y: 36.8, w: 22, h: 52, size: 3.3, align: 'left', lines: 18 },
            toolsWide:   { x: 14, y: 36.8, w: 72.5, h: 52, size: 3.3, align: 'left', lines: 18 },
            artwork:     { x: 37, y: 36.6, w: 50, h: 53 },
            resources:   { x: 14, y: 84.0, w: 72.5, h: 7.5, size: 2.6, align: 'left', lines: 3 }
        },
        // inject – a full-height NOTES panel (the card's GM notes). No artwork
        // panel on this template.
        inject: {
            description: { x: 14, y: 15.2, w: 72.5, h: 11, size: 3.3, align: 'left', lines: 4 },
            notes:       { x: 14, y: 32.3, w: 72.5, h: 55, size: 3.3, align: 'left', lines: 18 },
            resources:   { x: 14, y: 86.5, w: 72.5, h: 6, size: 2.6, align: 'left', lines: 2 }
        },
        // consultant – SPECIALTIES list. No artwork panel on this template.
        consultant: {
            description: { x: 14, y: 15.2, w: 72.5, h: 11, size: 3.3, align: 'left', lines: 4 },
            specialties: { x: 14, y: 32.3, w: 72.5, h: 52, size: 3.3, align: 'left', lines: 17 },
            resources:   { x: 14, y: 86.5, w: 72.5, h: 6, size: 2.6, align: 'left', lines: 2 }
        }
    };

    var INK = '#14181f';

    /* ------------------------------------------------------------------ */
    /* Signature + watermark                                               */
    /* ------------------------------------------------------------------ */

    // The footer sits in the transparent margin UNDER the printed card - the one
    // strip of a template that no content block claims.
    var FOOTER_BOX = { x: 14, y: 93.3, w: 72.5, h: 5.6, size: 2.1, align: 'center' };
    var SIGNATURE = 'JonesCKevin';
    var SIGNATURE_URL = 'https://github.com/Jonesckevin';
    var WATERMARK = 'Backdoors & Breaches';
    var WATERMARK_OPACITY = 0.04;
    var MUTED = '#6b7280';

    // GitHub mark, 24x24 viewBox. Shared by the on-screen inline SVG and the
    // canvas Path2D so the two renderers cannot drift.
    var GITHUB_PATH = 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

    /**
     * The repeating diagonal watermark. One rotated oversized block of rows is
     * cheaper than tiling a background image, and it keeps the real Teko font -
     * an SVG data-URL tile could not reach it.
     */
    function watermarkBlock() {
        var wm = document.createElement('div');
        wm.className = 'cf-watermark';
        wm.setAttribute('aria-hidden', 'true');
        for (var r = 0; r < 7; r++) {
            var row = document.createElement('div');
            row.className = 'cf-wm-row';
            for (var c = 0; c < 4; c++) {
                var span = document.createElement('span');
                span.textContent = WATERMARK;
                row.appendChild(span);
            }
            wm.appendChild(row);
        }
        return wm;
    }

    /** The GitHub signature link printed in the card's bottom margin. */
    function footerBlock() {
        var a = document.createElement('a');
        a.className = 'cf-footer';
        a.href = SIGNATURE_URL;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = SIGNATURE + ' on GitHub';
        // It sits inside a flip card on the board - do not flip the card.
        a.addEventListener('click', function (e) { e.stopPropagation(); });
        a.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + GITHUB_PATH + '"/></svg>' +
            '<span>' + SIGNATURE + '</span>';
        return a;
    }

    // host element -> card record, for the faces decorate() composed.
    var faceCards = new WeakMap();

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    function templateFor(type) {
        return TEMPLATES[String(type || '').toLowerCase()] || null;
    }

    /** True when the card should be composed from a template instead of its own art. */
    function isTemplateCard(card) {
        return !!(card && card.template);
    }

    function asList(value) {
        if (!value) return [];
        if (Array.isArray(value)) {
            return value.map(function (v) { return String(v == null ? '' : v).trim(); }).filter(Boolean);
        }
        return [String(value).trim()].filter(Boolean);
    }

    function resourceLines(card) {
        return (Array.isArray(card.resources) ? card.resources : [])
            .map(function (r) { return (r && (r.url || r.text)) || ''; })
            .filter(Boolean);
    }

    /** Page-relative URL of a template WebP (the file name is repo-relative). */
    function templateSrc(file) {
        return DIR + file;
    }

    /**
     * Page-relative URL of a card's uploaded artwork.
     *
     * The stored value is repo-relative in one of two shapes - `shared/...`
     * (shipped art) or `../data/uploads/cards/...` (an upload) - so it is
     * rebased against the repo root instead of the template folder. data:/blob:/
     * http(s): values (an unsaved upload) pass straight through.
     */
    function artSrc(path) {
        if (!path) return '';
        if (/^(https?:)?\/\//i.test(path) || path.indexOf('data:') === 0 || path.indexOf('blob:') === 0) return path;
        var idx = path.indexOf('shared/');
        var rel = idx >= 0 ? path.slice(idx) : path.replace(/^(\.\.\/)+/, '');
        return ROOT + rel;
    }

    /** Page-relative URL of a type's template WebP ('' when the type is unknown). */
    function templateUrl(type) {
        var tpl = templateFor(type);
        return tpl ? templateSrc(tpl.file) : '';
    }

    function boxStyle(el, box) {
        el.style.left = box.x + '%';
        el.style.top = box.y + '%';
        el.style.width = box.w + '%';
        if (box.h) el.style.height = box.h + '%';
        if (box.size) el.style.fontSize = box.size + 'cqw';
        if (box.align) el.style.textAlign = box.align;
    }

    function textBlock(className, box, lines, color) {
        var el = document.createElement('div');
        el.className = 'cf-block ' + className;
        boxStyle(el, box);
        if (color) el.style.color = color;
        (lines || []).forEach(function (text) {
            var line = document.createElement('div');
            line.className = 'cf-line';
            line.textContent = text;
            el.appendChild(line);
        });
        return el;
    }

    /**
     * Shrink a title that is wider than the printed band.
     *
     * The size stays expressed in `cqw`, so the fit holds at any face width and
     * survives a resize - an absolute px size would not.
     * @param {HTMLElement} face
     */
    function fitTitle(face) {
        var block = face.querySelector('.cf-title');
        var line = block && block.querySelector('.cf-line');
        if (!block || !line) return;

        block.style.fontSize = TITLE_BOX.size + 'cqw';   // always measure at full size
        var available = block.clientWidth;
        var needed = line.scrollWidth;
        if (!available || !needed || needed <= available) return;

        block.style.fontSize = (TITLE_BOX.size * (available / needed) * 0.99).toFixed(2) + 'cqw';
    }

    var titleObserver = (typeof ResizeObserver !== 'undefined')
        ? new ResizeObserver(function (entries) {
            entries.forEach(function (entry) { fitTitle(entry.target); });
        })
        : null;

    /** Fit the title now and whenever the face is resized. */
    function observeTitle(face) {
        if (!face.querySelector('.cf-title')) return;
        if (titleObserver) titleObserver.observe(face);
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () { fitTitle(face); });
        }
    }

    /* ------------------------------------------------------------------ */
    /* DOM renderer                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Build a card face element.
     * @param {Object} card - { type, name, description, detection[], tools[],
     *                          specialties[], notes, resources[], image, artwork }
     * @returns {HTMLElement}
     */
    function build(card) {
        var data = card || {};
        var type = String(data.type || 'procedure').toLowerCase();
        var tpl = templateFor(type) || TEMPLATES.procedure;
        var boxes = BOXES[tpl.layout];

        var face = document.createElement('div');
        face.className = 'card-face card-face--' + type;

        // Artwork decides whether the TOOLS list gets a narrow column or the
        // whole width.
        var hasArt = !!(boxes.artwork && data.image && data.artwork !== 'none');

        var img = document.createElement('img');
        img.className = 'cf-template';
        img.src = templateSrc(tpl.file);
        img.alt = '';
        img.draggable = false;
        face.appendChild(img);

        face.appendChild(textBlock('cf-title', TITLE_BOX, [(data.name || 'Untitled Card').toString()], tpl.title));

        if (data.description && boxes.description) {
            face.appendChild(textBlock('cf-description', boxes.description, [String(data.description)], INK));
        }
        if (boxes.detection) {
            face.appendChild(textBlock('cf-detection', boxes.detection, asList(data.detection), INK));
        }
        if (boxes.tools) {
            face.appendChild(textBlock('cf-tools', (!hasArt && boxes.toolsWide) || boxes.tools, asList(data.tools), INK));
        }
        if (boxes.notes) {
            face.appendChild(textBlock('cf-notes', boxes.notes, asList(data.notes), INK));
        }
        if (boxes.specialties) {
            face.appendChild(textBlock('cf-specialties', boxes.specialties, asList(data.specialties), INK));
        }

        // Uploaded artwork sits in the lower-right panel (matching the printed cards).
        if (hasArt) {
            var art = document.createElement('div');
            art.className = 'cf-artwork';
            boxStyle(art, boxes.artwork);
            var artImg = document.createElement('img');
            artImg.src = artSrc(data.image);
            artImg.alt = '';
            art.appendChild(artImg);
            face.appendChild(art);
        }

        var links = resourceLines(data);
        if (boxes.resources && links.length) {
            face.appendChild(textBlock('cf-resources', boxes.resources, links, INK));
        }

        // A true watermark: painted over the artwork and the text, at ~6% so it
        // reads as a texture rather than as copy.
        face.appendChild(watermarkBlock());

        var footer = footerBlock();
        boxStyle(footer, FOOTER_BOX);
        face.appendChild(footer);

        observeTitle(face);
        return face;
    }

    /**
     * Replace a host element's content with the composed face. Returns false
     * (and leaves the host alone) when the card has no template.
     */
    function apply(host, card) {
        if (!host || !isTemplateCard(card)) return false;
        host.classList.add('has-card-face');
        host.textContent = '';
        host.appendChild(build(card));
        return true;
    }

    /**
     * Compose a face into a host WITHOUT disturbing its siblings - the grids in
     * the Scenario Editor put buttons inside the same card element. The host's
     * <img> is hidden and the face is inserted in its place. Returns false (and
     * changes nothing) when the card has no template.
     * @param {HTMLElement} host
     * @param {Object} card
     * @returns {boolean}
     */
    function decorate(host, card) {
        if (!host || !isTemplateCard(card)) return false;

        var stale = host.querySelector('.card-face');
        if (stale) stale.remove();

        var face = build(card);
        var img = host.querySelector('img');
        if (img) {
            img.classList.add('is-face');
            img.removeAttribute('src');
            img.after(face);
        } else {
            host.insertBefore(face, host.firstChild);
        }
        host.classList.add('has-card-face');
        // Remember the record so a "view larger" handler can rebuild the face
        // for the shared viewer without re-deriving it from the DOM.
        faceCards.set(host, card);
        return true;
    }

    /** The card last composed into `host`, or null. */
    function cardFor(host) {
        return (host && faceCards.get(host)) || null;
    }

    /* ------------------------------------------------------------------ */
    /* Canvas renderer – Download PNG only; nothing is stored              */
    /* ------------------------------------------------------------------ */

    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('Could not load ' + src)); };
            img.src = src;
        });
    }

    function wrapForCanvas(ctx, text, maxWidth) {
        var words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
        if (!words[0]) return [];
        var lines = [];
        var line = '';
        words.forEach(function (word) {
            var candidate = line ? line + ' ' + word : word;
            if (ctx.measureText(candidate).width <= maxWidth || !line) {
                line = candidate;
            } else {
                lines.push(line);
                line = word;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    function drawBlock(ctx, box, lines, color, W, H) {
        if (!box || !lines || !lines.length) return;
        var size = W * (box.size || 3) / 100;
        ctx.font = size + 'px ' + FONT;
        ctx.fillStyle = color || INK;
        ctx.textBaseline = 'top';
        ctx.textAlign = box.align === 'center' ? 'center' : 'left';

        var maxWidth = W * box.w / 100;
        var x = box.align === 'center' ? W * (box.x + box.w / 2) / 100 : W * box.x / 100;
        var y = H * box.y / 100;
        var lineHeight = size * 1.15;

        var out = [];
        lines.forEach(function (text) {
            wrapForCanvas(ctx, text, maxWidth).forEach(function (l) { out.push(l); });
        });
        out.slice(0, box.lines || 99).forEach(function (line, i) {
            ctx.fillText(line, x, y + i * lineHeight);
        });
    }

    /** Canvas twin of watermarkBlock() - same text, angle and opacity. */
    function drawWatermark(ctx, W, H) {
        ctx.save();
        ctx.globalAlpha = WATERMARK_OPACITY;
        ctx.fillStyle = MUTED;
        ctx.font = (W * 0.030) + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-30 * Math.PI / 180);

        var stepX = W * 0.36;
        var stepY = H * 0.095;
        for (var r = -4; r <= 4; r++) {
            for (var c = -4; c <= 4; c++) {
                ctx.fillText(WATERMARK, c * stepX + (r % 2 ? stepX / 2 : 0), r * stepY);
            }
        }
        ctx.restore();
    }

    /** Canvas twin of footerBlock() - GitHub mark + signature, centred. */
    function drawFooter(ctx, W, H) {
        var size = W * FOOTER_BOX.size / 100;
        var cx = W * (FOOTER_BOX.x + FOOTER_BOX.w / 2) / 100;
        var cy = H * (FOOTER_BOX.y + FOOTER_BOX.h / 2) / 100;

        ctx.save();
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = MUTED;
        ctx.font = size + 'px ' + FONT;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        var textW = ctx.measureText(SIGNATURE).width;
        var mark = size * 1.5;
        var gap = size * 0.5;
        var x = cx - (mark + gap + textW) / 2;

        if (typeof Path2D !== 'undefined') {
            ctx.save();
            ctx.translate(x, cy - mark / 2);
            ctx.scale(mark / 24, mark / 24);
            ctx.fill(new Path2D(GITHUB_PATH));
            ctx.restore();
        }

        ctx.fillText(SIGNATURE, x + mark + gap, cy);
        ctx.restore();
    }

    // Store a second, invisible signature in alpha-channel LSBs. The fixed
    // stride permutes pixels across the face rather than drawing a detectable
    // strip; changing alpha by one level is visually imperceptible.
    var FALG_SIG = String.fromCharCode(
        0o102, 0o102, 0o123, 0o061, 0o146, 0o154, 0o141, 0o147, 0o173,
        0o102, 0o046, 0o102, 0o137, 0o112, 0o157, 0o156, 0o145, 0o163, 0o175
    );

    function greatestCommonDivisor(a, b) {
        while (b) {
            var remainder = a % b;
            a = b;
            b = remainder;
        }
        return a;
    }

    function stampHiddenSignature(ctx, W, H) {
        var bits = [];
        for (var i = 0; i < FALG_SIG.length; i++) {
            var code = FALG_SIG.charCodeAt(i);
            for (var bit = 7; bit >= 0; bit--) bits.push((code >> bit) & 1);
        }

        var total = W * H;
        if (bits.length > total) return;

        var stride = 7919;
        while (greatestCommonDivisor(stride, total) !== 1) stride += 2;
        var start = 3571 % total;
        var image = ctx.getImageData(0, 0, W, H);

        for (var j = 0; j < bits.length; j++) {
            var pixel = (start + j * stride) % total;
            var alpha = pixel * 4 + 3;
            image.data[alpha] = (image.data[alpha] & 0xfe) | bits[j];
        }
        ctx.putImageData(image, 0, 0);
    }

    /**
     * Rasterise the composed face (template + text) to a PNG data URL for the
     * Creator's "Download PNG" action. Nothing is uploaded or persisted.
     */
    async function toPngDataUrl(card, opts) {
        var data = card || {};
        var type = String(data.type || 'procedure').toLowerCase();
        var tpl = templateFor(type) || TEMPLATES.procedure;
        var boxes = BOXES[tpl.layout];
        var scale = (opts && opts.scale) || 1;

        var img = await loadImage(templateSrc(tpl.file));
        var W = Math.round((img.naturalWidth || 750) * scale);
        var H = Math.round((img.naturalHeight || 1050) * scale);

        if (document.fonts && document.fonts.ready) {
            try { await document.fonts.ready; } catch (_) { /* older browsers */ }
        }

        var canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);

        var hasArt = !!(boxes.artwork && data.image && data.artwork !== 'none');

        if (hasArt) {
            try {
                var art = await loadImage(artSrc(data.image));
                var bx = W * boxes.artwork.x / 100;
                var by = H * boxes.artwork.y / 100;
                var bw = W * boxes.artwork.w / 100;
                var bh = H * boxes.artwork.h / 100;
                var s = Math.min(bw / (art.width || 1), bh / (art.height || 1));
                var aw = (art.width || 1) * s;
                var ah = (art.height || 1) * s;
                ctx.drawImage(art, bx + (bw - aw) / 2, by + (bh - ah) / 2, aw, ah);
            } catch (_) { /* artwork is optional */ }
        }

        drawBlock(ctx, TITLE_BOX, [data.name || 'Untitled Card'], tpl.title, W, H);
        if (data.description && boxes.description) drawBlock(ctx, boxes.description, [String(data.description)], INK, W, H);
        if (boxes.detection) drawBlock(ctx, boxes.detection, asList(data.detection), INK, W, H);
        if (boxes.tools) drawBlock(ctx, (!hasArt && boxes.toolsWide) || boxes.tools, asList(data.tools), INK, W, H);
        if (boxes.notes) drawBlock(ctx, boxes.notes, asList(data.notes), INK, W, H);
        if (boxes.specialties) drawBlock(ctx, boxes.specialties, asList(data.specialties), INK, W, H);
        if (boxes.resources) drawBlock(ctx, boxes.resources, resourceLines(data), INK, W, H);

        // Same order as the DOM: template, artwork, text, watermark, footer.
        drawWatermark(ctx, W, H);
        drawFooter(ctx, W, H);
        stampHiddenSignature(ctx, W, H);

        return canvas.toDataURL('image/png');
    }

    window.CardFace = {
        TYPES: TYPES,
        DIR: DIR,
        FONT: FONT,
        TEMPLATES: TEMPLATES,
        templateFor: templateFor,
        templateUrl: templateUrl,
        isTemplateCard: isTemplateCard,
        build: build,
        apply: apply,
        decorate: decorate,
        cardFor: cardFor,
        toPngDataUrl: toPngDataUrl
    };
})();
