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

    // Measured off the supplied 680x941 templates and cross-checked against the
    // printed deck cards in shared/decks/*/ (789x1089, same proportions):
    //   title band      y  7.1% - 13.4%   body x 14% - 86.5%   body ends ~90.5%
    //   scenario:  DETECTION rule 35.7%   TOOLS rule 61.5%
    //   procedure: TOOLS rule    36.1%
    //   inject / consultant: NOTES / SPECIALTIES rule 31.7%
    //
    // TYPE SIZE: the printed cards set body copy at 37px line pitch on a 789px
    // card - 4.7% of the width, with ink 3.7% wide. In Teko that is a ~4.0cqw
    // face with 1.15 leading, which is what every `size` below uses. Blocks that
    // would overflow shrink themselves (fitBlocks() / drawBlock()), so a long
    // list or a wordy description still fits instead of clipping.
    //
    // A box may also carry any of:
    //   color        ink override (the consultant's blue effect line, green quote)
    //   weight       font weight (the effect line is bold)
    //   italic       italic text (the quote)
    //   lineHeight   multiple of the font size (default 1.15 on canvas)
    //   columns      split the list into N side-by-side columns, column-major
    //   stripProtocol  print "linkedin.com/in/x" instead of the full https URL
    //   circle       crop the image into a circle (the consultant's portrait)
    //
    // IMAGE PLACEMENT: `placements` holds one variant per artwork position. A
    // variant replaces the shared list box (`tools` / `notes` / `quote`) and
    // supplies the image box, so moving the picture also moves the text it
    // would otherwise sit on top of.
    //   right   image flush right, list in a narrow left column (print default)
    //   left    image flush left, list in a narrow right column
    //   center  list across the top of the panel, image centred below it
    //   wide    list across the top, image edge to edge below it
    //   none    no image, list gets the whole panel

    // The title sits a shade below the band's true centre: Teko carries a deep
    // descender, so optically centring the line box leaves the caps looking high.
    // `weight` is the bold the DOM applies via .card-face .cf-title { font-weight:
    // 600 }; the canvas cannot inherit it, so it is recorded here too.
    var TITLE_BOX = { x: 11, y: 7.5, w: 78, h: 6.4, size: 7.4, align: 'center', lines: 1, weight: 600 };

    // Consultant accents. The green is sampled from the consultant template's
    // band and border; the blue matches the printed "(+3) modifier" effect line.
    var CONSULTANT_GREEN = '#0aa14a';
    var CONSULTANT_BLUE = '#1f74b8';
    // Portrait ring thickness, percent of the face WIDTH (the DOM twin lives in
    // shared/css/base.css as `border-width: 0.9cqw` on .cf-portrait).
    var PORTRAIT_RING = 0.9;
    // Share of a column's width the canvas lets text use - the remainder is the
    // gutter between the consultant's two SPECIALTIES columns.
    var COLUMN_GUTTER = 0.94;

    var BODY = 4.0;      // list / paragraph type (printed cards: 4.7% pitch)
    var LINKS = 3.4;     // the optional resources row under the body

    var BOXES = {
        // initial / pivot / c2 / persist – DETECTION list, then TOOLS beside the
        // uploaded artwork in the lower panel.
        scenario: {
            description: { x: 14, y: 15.2, w: 72.5, h: 19, size: BODY, align: 'left' },
            detection:   { x: 14, y: 36.4, w: 72.5, h: 19.5, size: BODY, align: 'left' },
            resources:   { x: 14, y: 84.0, w: 72.5, h: 7.5, size: LINKS, align: 'left' },
            placements: {
                right:  { tools: { x: 14, y: 62.4, w: 30, h: 27, size: BODY, align: 'left' },
                          artwork: { x: 46, y: 62.2, w: 40.5, h: 28 } },
                left:   { tools: { x: 56.5, y: 62.4, w: 30, h: 27, size: BODY, align: 'left' },
                          artwork: { x: 14, y: 62.2, w: 40.5, h: 28 } },
                center: { tools: { x: 14, y: 62.4, w: 72.5, h: 11, size: BODY, align: 'left' },
                          artwork: { x: 25, y: 73.5, w: 50, h: 16.5 } },
                wide:   { tools: { x: 14, y: 62.4, w: 72.5, h: 11, size: BODY, align: 'left' },
                          artwork: { x: 14, y: 73.5, w: 72.5, h: 16.5, fit: 'cover' } },
                none:   { tools: { x: 14, y: 62.4, w: 72.5, h: 27, size: BODY, align: 'left' } }
            }
        },
        // procedure – TOOLS only, heading higher up the card.
        procedure: {
            description: { x: 14, y: 15.2, w: 72.5, h: 19.5, size: BODY, align: 'left' },
            resources:   { x: 14, y: 84.0, w: 72.5, h: 7.5, size: LINKS, align: 'left' },
            placements: {
                right:  { tools: { x: 14, y: 36.8, w: 30, h: 52, size: BODY, align: 'left' },
                          artwork: { x: 46, y: 36.6, w: 40.5, h: 53.6 } },
                left:   { tools: { x: 56.5, y: 36.8, w: 30, h: 52, size: BODY, align: 'left' },
                          artwork: { x: 14, y: 36.6, w: 40.5, h: 53.6 } },
                center: { tools: { x: 14, y: 36.8, w: 72.5, h: 26, size: BODY, align: 'left' },
                          artwork: { x: 25, y: 63.5, w: 50, h: 26.5 } },
                wide:   { tools: { x: 14, y: 36.8, w: 72.5, h: 26, size: BODY, align: 'left' },
                          artwork: { x: 14, y: 63.5, w: 72.5, h: 26.5, fit: 'cover' } },
                none:   { tools: { x: 14, y: 36.8, w: 72.5, h: 52, size: BODY, align: 'left' } }
            }
        },
        // inject – the NOTES panel, plus the card's GM notes.
        inject: {
            description: { x: 14, y: 15.2, w: 72.5, h: 11, size: BODY, align: 'left' },
            resources:   { x: 14, y: 86.5, w: 72.5, h: 6, size: LINKS, align: 'left' },
            placements: {
                right:  { notes: { x: 14, y: 32.3, w: 44, h: 52, size: BODY, align: 'left' },
                          artwork: { x: 60, y: 34, w: 26.5, h: 48 } },
                left:   { notes: { x: 42, y: 32.3, w: 44.5, h: 52, size: BODY, align: 'left' },
                          artwork: { x: 14, y: 34, w: 26.5, h: 48 } },
                center: { notes: { x: 14, y: 32.3, w: 72.5, h: 25, size: BODY, align: 'left' },
                          artwork: { x: 25, y: 59, w: 50, h: 26 } },
                wide:   { notes: { x: 14, y: 32.3, w: 72.5, h: 25, size: BODY, align: 'left' },
                          artwork: { x: 14, y: 59, w: 72.5, h: 26, fit: 'cover' } },
                none:   { notes: { x: 14, y: 32.3, w: 72.5, h: 52, size: BODY, align: 'left' } }
            }
        },
        // consultant – a bold blue effect line, a two-column SPECIALTIES list,
        // then the consultant's own quote beside a circular portrait, with their
        // website/socials along the bottom edge. The portrait sets only its
        // width: both renderers derive the height from it, so the crop stays a
        // true circle at any face size.
        consultant: {
            description: { x: 14, y: 15.2, w: 72.5, h: 11, size: 4.3, align: 'center', weight: 700, color: CONSULTANT_BLUE },
            specialties: { x: 14, y: 32.3, w: 72.5, h: 16, size: BODY, align: 'left', columns: 2, lineHeight: 1.15 },
            // One row along the bottom edge, like the printed socials: joining the
            // links keeps them on a single line, which is all this strip of the
            // card has room for. Both renderers then shrink the row to fit rather
            // than stacking the links down past the card edge.
            resources:   { x: 14, y: 86, w: 72.5, h: 4.5, size: LINKS, align: 'left', stripProtocol: true, row: true },
            placements: {
                right:  { quote: { x: 14, y: 61, w: 33, h: 18, size: 3.5, align: 'left', italic: true, lineHeight: 1.25, color: CONSULTANT_GREEN },
                          portrait: { x: 50, y: 60, w: 36, circle: true } },
                left:   { quote: { x: 52, y: 61, w: 33, h: 18, size: 3.5, align: 'left', italic: true, lineHeight: 1.25, color: CONSULTANT_GREEN },
                          portrait: { x: 14, y: 60, w: 36, circle: true } },
                center: { quote: { x: 14, y: 55, w: 72.5, h: 11, size: 3.5, align: 'center', italic: true, lineHeight: 1.25, color: CONSULTANT_GREEN },
                          portrait: { x: 35, y: 64, w: 30, circle: true } },
                wide:   { quote: { x: 14, y: 53, w: 72.5, h: 11, size: 3.5, align: 'center', italic: true, lineHeight: 1.25, color: CONSULTANT_GREEN },
                          artwork: { x: 14, y: 66, w: 72.5, h: 23, fit: 'cover' } },
                none:   { quote: { x: 14, y: 60, w: 72.5, h: 22, size: 3.5, align: 'left', italic: true, lineHeight: 1.25, color: CONSULTANT_GREEN } }
            }
        }
    };

    /**
     * Artwork placements, in the order the Creator lists them. `illustration`
     * and `banner` are the names saved before the four-way choice existed and
     * still map onto `right` and `wide`.
     */
    var PLACEMENTS = ['wide', 'center', 'left', 'right', 'none'];
    var PLACEMENT_ALIASES = { illustration: 'right', banner: 'wide', '': 'right' };
    var DEFAULT_PLACEMENT = 'right';

    /** Normalise a stored `artwork` value to one of PLACEMENTS. */
    function placementFor(value) {
        var key = String(value == null ? '' : value).trim().toLowerCase();
        if (PLACEMENT_ALIASES[key]) key = PLACEMENT_ALIASES[key];
        return PLACEMENTS.indexOf(key) >= 0 ? key : DEFAULT_PLACEMENT;
    }

    /**
     * The box set for one card: the layout's shared boxes with the chosen
     * placement's list + image boxes merged over them.
     */
    function boxesFor(layout, artwork) {
        var base = BOXES[layout] || BOXES.procedure;
        var variants = base.placements || {};
        var variant = variants[placementFor(artwork)] || variants[DEFAULT_PLACEMENT] || {};
        var out = {};
        for (var key in base) {
            if (key !== 'placements') out[key] = base[key];
        }
        for (var own in variant) out[own] = variant[own];
        return out;
    }

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

    /**
     * The printable form of a card's links. A consultant prints the short form
     * ("linkedin.com/in/kylehanslovan" rather than the full https URL) so the
     * footer row matches the social handle printed on the deck cards.
     */
    function resourceLines(card, stripProtocol) {
        return (Array.isArray(card.resources) ? card.resources : [])
            .map(function (r) { return (r && (r.url || r.text)) || ''; })
            .filter(Boolean)
            .map(function (value) {
                if (!stripProtocol) return value;
                return String(value)
                    .replace(/^https?:\/\//i, '')
                    .replace(/^www\./i, '')
                    .replace(/\/+$/, '');
            });
    }

    /** Page-relative URL of a template WebP (the file name is repo-relative). */
    function templateSrc(file) {
        return DIR + file;
    }

    /**
     * A `row` box prints its entries on one line, separated by a middle dot -
     * the consultant's website/socials strip. Scenarios and procedures keep one
     * entry per line, because their boxes are tall enough for the list.
     */
    function rowLines(lines, box) {
        if (!box || !box.row || lines.length < 2) return lines;
        return [lines.join(' \u00b7 ')];
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
        if (box.lineHeight) el.style.lineHeight = box.lineHeight;
    }

    /**
     * One styled line of card text.
     * @param {HTMLElement} parent
     * @returns {HTMLElement}
     */
    function textLine(parent, text) {
        var line = document.createElement('div');
        line.className = 'cf-line';
        line.textContent = text;
        parent.appendChild(line);
        return line;
    }

    function textBlock(className, box, lines, color) {
        var el = document.createElement('div');
        el.className = 'cf-block ' + className;
        boxStyle(el, box);
        // Remember the design size so fitBlocks() can shrink from it and always
        // measure against the same starting point.
        if (box.size) el.setAttribute('data-cf-size', box.size);
        var ink = box.color || color;
        if (ink) el.style.color = ink;
        if (box.weight) el.style.fontWeight = box.weight;
        if (box.italic) el.style.fontStyle = 'italic';
        if (box.row) el.classList.add('cf-row');

        var items = lines || [];
        var cols = box.columns || 1;
        if (cols > 1) {
            // Column-major, like a printed list: the first half fills the left
            // column so the eye reads top-to-bottom and then across.
            el.classList.add('cf-columns');
            var per = Math.ceil(items.length / cols);
            for (var c = 0; c < cols; c++) {
                var col = document.createElement('div');
                col.className = 'cf-col';
                items.slice(c * per, (c + 1) * per).forEach(function (text) {
                    textLine(col, text);
                });
                el.appendChild(col);
            }
            return el;
        }

        items.forEach(function (text) { textLine(el, text); });
        return el;
    }

    /** Uploaded artwork in a rectangular panel. `fit: 'cover'` crops it to fill
     *  the box (the Wide placement) instead of letterboxing it - set inline so
     *  the placement cannot be lost to a stale shared stylesheet. */
    function artworkBlock(src, box) {
        var art = document.createElement('div');
        art.className = 'cf-artwork';
        boxStyle(art, box);
        var img = document.createElement('img');
        img.src = artSrc(src);
        img.alt = '';
        if (box.fit === 'cover') {
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.objectFit = 'cover';
        }
        art.appendChild(img);
        return art;
    }

    /**
     * Uploaded artwork cropped into a circle (consultant cards). Only the width
     * comes from the box - the height follows from `aspect-ratio: 1` so the
     * crop stays round however tall the face is, exactly like drawPortrait().
     */
    function portraitBlock(src, box) {
        var wrap = document.createElement('div');
        wrap.className = 'cf-portrait';
        wrap.style.left = box.x + '%';
        wrap.style.top = box.y + '%';
        wrap.style.width = box.w + '%';
        wrap.style.borderColor = CONSULTANT_GREEN;
        var img = document.createElement('img');
        img.src = artSrc(src);
        img.alt = '';
        wrap.appendChild(img);
        return wrap;
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

    /**
     * Shrink any text block that overflows its box.
     *
     * The design sizes in BOXES are the printed decks' sizes, so a card with a
     * long description or a dozen tools needs less. Rather than clip, the block
     * steps its size down from the design size until the content fits - the
     * canvas twin of this is the loop inside drawBlock(), which caps the wrapped
     * line count instead of measuring pixels.
     *
     * Sizes stay in `cqw`, so the result is identical at every face width and
     * survives a resize. Only ever called once the face is connected and laid
     * out - a detached element measures zero.
     */
    function fitBlocks(face) {
        if (!face.isConnected) return;
        var blocks = face.querySelectorAll('.cf-block');
        for (var i = 0; i < blocks.length; i++) {
            var el = blocks[i];
            var base = parseFloat(el.getAttribute('data-cf-size'));
            if (!base) continue;

            var size = base;
            el.style.fontSize = size.toFixed(2) + 'cqw';

            // A row block keeps its entries on one line while that line stays
            // legible. Past ~2.6cqw the row would be too small to read, so it
            // falls back to wrapping and fitting the box height instead of
            // running off the card edge.
            if (el.classList.contains('cf-row')) {
                var row = el.querySelector('.cf-line');
                if (row) {
                    row.style.whiteSpace = 'nowrap';
                    el.style.fontSize = base.toFixed(2) + 'cqw';
                    var avail = el.clientWidth;
                    var need = row.scrollWidth;
                    if (avail && need > avail) {
                        var fitted = base * (avail / need) * 0.99;
                        if (fitted >= 2.6) {
                            el.style.fontSize = fitted.toFixed(2) + 'cqw';
                        } else {
                            row.style.whiteSpace = 'normal';
                            var wrapSize = base;
                            for (var step2 = 0; step2 < 60 && wrapSize > 2.2; step2++) {
                                if (el.scrollHeight <= el.clientHeight + 1) break;
                                wrapSize -= 0.05;
                                el.style.fontSize = wrapSize.toFixed(2) + 'cqw';
                            }
                        }
                    }
                }
                continue;
            }

            // 0.05cqw steps, never below 2.2cqw (the resources row's floor).
            for (var step = 0; step < 60 && size > 2.2; step++) {
                if (el.scrollHeight <= el.clientHeight + 1) break;
                size -= 0.05;
                el.style.fontSize = size.toFixed(2) + 'cqw';
            }
        }
    }

    /**
     * Watch a face: fit the title and shrink overflowing blocks now, and again
     * whenever the face's width changes. One observer for both jobs because a
     * resize invalidates the two together.
     */
    var faceObserver = (typeof ResizeObserver !== 'undefined')
        ? new ResizeObserver(function (entries) {
            entries.forEach(function (entry) {
                fitTitle(entry.target);
                fitBlocks(entry.target);
            });
        })
        : null;

    function observeFace(face) {
        if (faceObserver) faceObserver.observe(face);
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () {
                fitTitle(face);
                fitBlocks(face);
            });
        }
        // The first measurement may run before Teko has loaded, which would fit
        // against a fallback face. Re-fit when the fonts are ready.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                fitTitle(face);
                fitBlocks(face);
            }).catch(function () { /* older browsers */ });
        }
    }

    /* ------------------------------------------------------------------ */
    /* DOM renderer                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Keep an image clear of the resources row.
     *
     * A card may print links along the bottom, and the printed decks shrink the
     * artwork rather than run it under them. Returns a narrowed copy of the box
     * (never mutates the shared table).
     */
    function clearOfLinks(box, linkBox, hasLinks) {
        if (!box || !box.h || box.circle || !hasLinks || !linkBox) return box;
        var limit = linkBox.y - 1.2;
        if (box.y >= limit || box.y + box.h <= limit) return box;
        var out = {};
        for (var key in box) out[key] = box[key];   // keep fit / circle / anything added later
        out.h = limit - box.y;
        return out;
    }

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
        var boxes = boxesFor(tpl.layout, data.artwork);

        var face = document.createElement('div');
        face.className = 'card-face card-face--' + type;

        var links = rowLines(resourceLines(data, boxes.resources && boxes.resources.stripProtocol), boxes.resources);

        // Artwork decides how much room the list gets. A consultant has no
        // artwork panel - its picture is the circular portrait (or the wide
        // banner, when that placement is chosen).
        var imageBox = clearOfLinks(boxes.artwork || boxes.portrait, boxes.resources, links.length > 0);
        var hasArt = !!(imageBox && data.image);

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
            face.appendChild(textBlock('cf-tools', boxes.tools, asList(data.tools), INK));
        }
        if (boxes.notes) {
            face.appendChild(textBlock('cf-notes', boxes.notes, asList(data.notes), INK));
        }
        if (boxes.specialties) {
            face.appendChild(textBlock('cf-specialties', boxes.specialties, asList(data.specialties), INK));
        }
        if (boxes.quote && data.quote) {
            face.appendChild(textBlock('cf-quote', boxes.quote, String(data.quote).split(/\r?\n/), INK));
        }

        // Uploaded artwork sits in the chosen placement - a rectangular panel,
        // or a circle on a consultant.
        if (hasArt) {
            face.appendChild(boxes.portrait && imageBox.circle
                ? portraitBlock(data.image, imageBox)
                : artworkBlock(data.image, imageBox));
        }

        if (boxes.resources && links.length) {
            face.appendChild(textBlock('cf-resources', boxes.resources, links, INK));
        }

        // A true watermark: painted over the artwork and the text, at ~6% so it
        // reads as a texture rather than as copy.
        face.appendChild(watermarkBlock());

        var footer = footerBlock();
        boxStyle(footer, FOOTER_BOX);
        face.appendChild(footer);

        observeFace(face);
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

    /**
     * Canvas twin of the title band.
     *
     * The DOM centres the title's line box inside TITLE_BOX (flex, align-items:
     * center), so the font's ascent/descent box ends up centred on the band.
     * Canvas 'top'/'middle' baselines follow the em square instead, and Teko's
     * metrics (ascent 0.96em + descent 0.48em) put that well above the band
     * centre - the glyphs then sit against the top border. Computing the
     * baseline from the measured metrics reproduces the DOM exactly.
     *
     * The borrowed 0.99 is fitTitle()'s shrink-to-fit factor, so an over-long
     * name is scaled in the PNG just as it is on screen.
     */
    function drawTitle(ctx, box, text, color, W, H) {
        var maxWidth = W * box.w / 100;
        var size = W * (box.size || 3) / 100;
        var weight = box.weight || 400;

        ctx.font = weight + ' ' + size + 'px ' + FONT;
        var width = ctx.measureText(text).width;
        if (width > maxWidth && width > 0) {
            size = size * (maxWidth / width) * 0.99;
            ctx.font = weight + ' ' + size + 'px ' + FONT;
        }

        var metrics = ctx.measureText(text);
        var ascent = metrics.fontBoundingBoxAscent;
        var descent = metrics.fontBoundingBoxDescent;
        if (typeof ascent !== 'number' || typeof descent !== 'number') {
            ascent = size * 0.8;
            descent = size * 0.2;
        }

        ctx.fillStyle = box.color || color || INK;
        ctx.textAlign = box.align === 'center' ? 'center' : 'left';
        ctx.textBaseline = 'alphabetic';
        var x = box.align === 'center' ? W * (box.x + box.w / 2) / 100 : W * box.x / 100;
        var y = H * (box.y + box.h / 2) / 100 + (ascent - descent) / 2;
        ctx.fillText(text, x, y);
    }

    /** Lines available in a box at a given size (canvas pixels). */
    function boxCapacity(box, size, H) {
        var height = H * (box.h || 0) / 100;
        if (!height) return 99;
        return Math.max(1, Math.floor(height / (size * (box.lineHeight || 1.15))));
    }

    function drawBlock(ctx, box, lines, color, W, H) {
        if (!box || !lines || !lines.length) return;

        // A multi-column list draws each column as its own narrower block, so
        // wrapping and alignment stay identical to the single-column case.
        if (box.columns > 1) {
            var per = Math.ceil(lines.length / box.columns);
            var colWidth = box.w / box.columns;
            for (var c = 0; c < box.columns; c++) {
                var chunk = lines.slice(c * per, (c + 1) * per);
                if (!chunk.length) continue;
                drawBlock(ctx, {
                    x: box.x + c * colWidth,
                    y: box.y,
                    w: colWidth * COLUMN_GUTTER,
                    h: box.h,
                    size: box.size,
                    align: box.align,
                    lineHeight: box.lineHeight,
                    weight: box.weight,
                    italic: box.italic,
                    color: box.color
                }, chunk, color, W, H);
            }
            return;
        }

        var maxWidth = W * box.w / 100;
        var size = W * (box.size || 3) / 100;
        var floor = W * 0.022;                 // the 2.2cqw floor in fitBlocks()
        var out = [];

        // A row box is one measured line, shrunk by width - the consultant's
        // socials stay on the bottom edge like the printed card. If one line
        // would have to shrink below ~2.6cqw to fit, fall through to the normal
        // wrap-and-fit path so the links stay readable instead of vanishing.
        if (box.row) {
            var row = lines.join(' \u00b7 ');
            ctx.font = (box.italic ? 'italic ' : '') + (box.weight || 400) + ' ' + size + 'px ' + FONT;
            var rowWidth = ctx.measureText(row).width;
            var rowFits = rowWidth <= maxWidth || rowWidth <= 0;
            var rowSize = rowWidth > 0 ? size * (maxWidth / rowWidth) * 0.99 : size;
            if (rowFits || rowSize >= W * 0.026) {
                if (!rowFits) {
                    size = rowSize;
                    ctx.font = (box.italic ? 'italic ' : '') + (box.weight || 400) + ' ' + size + 'px ' + FONT;
                }
                ctx.fillStyle = box.color || color || INK;
                ctx.textBaseline = 'top';
                ctx.textAlign = box.align === 'center' ? 'center' : 'left';
                var rowX = box.align === 'center' ? W * (box.x + box.w / 2) / 100 : W * box.x / 100;
                ctx.fillText(row, rowX, H * box.y / 100);
                return;
            }
        }

        // Shrink until the wrapped text fits the box - the same rule fitBlocks()
        // applies in the DOM, so the PNG matches what the preview shows.
        for (var attempt = 0; attempt < 24; attempt++) {
            ctx.font = (box.italic ? 'italic ' : '') + (box.weight || 400) + ' ' + size + 'px ' + FONT;
            out = [];
            for (var i = 0; i < lines.length; i++) {
                var wrapped = wrapForCanvas(ctx, lines[i], maxWidth);
                for (var j = 0; j < wrapped.length; j++) out.push(wrapped[j]);
            }
            if (out.length <= boxCapacity(box, size, H) || size <= floor) break;
            size *= 0.94;
        }

        ctx.fillStyle = box.color || color || INK;
        ctx.textBaseline = 'top';
        ctx.textAlign = box.align === 'center' ? 'center' : 'left';

        var x = box.align === 'center' ? W * (box.x + box.w / 2) / 100 : W * box.x / 100;
        var y = H * box.y / 100;
        var lineHeight = size * (box.lineHeight || 1.15);

        out.forEach(function (line, i) {
            ctx.fillText(line, x, y + i * lineHeight);
        });
    }

    /**
     * Canvas twin of portraitBlock(): the artwork cover-cropped into a circle
     * with the template's green ring. The height always follows the width, so
     * the crop is round whatever the image is.
     */
    function drawPortrait(ctx, box, img, W, H) {
        var d = W * box.w / 100;
        var cx = W * box.x / 100 + d / 2;
        var cy = H * box.y / 100 + d / 2;
        var r = d / 2;
        var iw = img.naturalWidth || img.width || 1;
        var ih = img.naturalHeight || img.height || 1;
        var s = Math.max(d / iw, d / ih);
        var dw = iw * s;
        var dh = ih * s;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        var ring = W * PORTRAIT_RING / 100;
        ctx.arc(cx, cy, Math.max(1, r - ring / 2), 0, Math.PI * 2);
        ctx.lineWidth = ring;
        ctx.strokeStyle = CONSULTANT_GREEN;
        ctx.stroke();
        ctx.restore();
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
        var boxes = boxesFor(tpl.layout, data.artwork);
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

        var links = rowLines(resourceLines(data, boxes.resources && boxes.resources.stripProtocol), boxes.resources);
        var imageBox = clearOfLinks(boxes.artwork || boxes.portrait, boxes.resources, links.length > 0);
        var hasArt = !!(imageBox && data.image);

        if (hasArt) {
            try {
                var art = await loadImage(artSrc(data.image));
                if (boxes.portrait && imageBox.circle) {
                    drawPortrait(ctx, imageBox, art, W, H);
                } else {
                    var bx = W * imageBox.x / 100;
                    var by = H * imageBox.y / 100;
                    var bw = W * imageBox.w / 100;
                    var bh = H * (imageBox.h || imageBox.w) / 100;
                    var ratio = imageBox.fit === 'cover' ? Math.max : Math.min;
                    var s = ratio(bw / (art.width || 1), bh / (art.height || 1));
                    var aw = (art.width || 1) * s;
                    var ah = (art.height || 1) * s;
                    // Clip to the box: a cover-crop overhangs it, and the DOM
                    // panel hides that overflow (overflow: hidden).
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(bx, by, bw, bh);
                    ctx.clip();
                    ctx.drawImage(art, bx + (bw - aw) / 2, by + (bh - ah) / 2, aw, ah);
                    ctx.restore();
                }
            } catch (_) { /* artwork is optional */ }
        }

        drawTitle(ctx, TITLE_BOX, String(data.name || 'Untitled Card'), tpl.title, W, H);
        if (data.description && boxes.description) drawBlock(ctx, boxes.description, [String(data.description)], INK, W, H);
        if (boxes.detection) drawBlock(ctx, boxes.detection, asList(data.detection), INK, W, H);
        if (boxes.tools) drawBlock(ctx, boxes.tools, asList(data.tools), INK, W, H);
        if (boxes.notes) drawBlock(ctx, boxes.notes, asList(data.notes), INK, W, H);
        if (boxes.specialties) drawBlock(ctx, boxes.specialties, asList(data.specialties), INK, W, H);
        if (boxes.quote && data.quote) drawBlock(ctx, boxes.quote, String(data.quote).split(/\r?\n/), INK, W, H);
        if (boxes.resources && links.length) drawBlock(ctx, boxes.resources, links, INK, W, H);

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
        PLACEMENTS: PLACEMENTS,
        placementFor: placementFor,
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
