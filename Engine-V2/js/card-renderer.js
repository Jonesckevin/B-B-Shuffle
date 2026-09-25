/*B&B Shuffle — Card Renderer*/

const CardRenderer = {
    // 2.5 : 3.5 — the aspect ratio used by every card in the app.
    WIDTH: 750,
    HEIGHT: 1050,

    TYPE_COLORS: {
        initial: '#ef4444',
        pivot: '#f59e0b',
        c2: '#b45309',
        persist: '#8b5cf6',
        procedure: '#10b981',
        inject: '#6b7280',
        consultant: '#ec4899'
    },

    // Sampled from the printed cards (used by the "classic" skin).
    CLASSIC_COLORS: {
        initial: '#b01116',
        pivot: '#ffc31a',
        c2: '#a05f26',
        persist: '#7f3e98',
        procedure: '#00aeef',
        inject: '#6b7280'
    },

    // Re-exported from the canonical Utils maps rather than duplicated: this
    // file already hard-depends on Utils (downloadFile), and utils.js is loaded
    // before card-renderer.js on both pages that include it, so no local
    // fallback copy is kept.
    TYPE_LABELS: Utils.CARD_TYPE_LABELS,

    // Types that carry a DETECTION list (scenario cards) vs a TOOLS list.
    SCENARIO_TYPES: Utils.SCENARIO_TYPES,

    FONT: "Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif",

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    // Alias for the canonical escaper; the name is kept because every call site
    // builds SVG. The 5-entity set is safe in text AND attribute contexts.
    escapeXml(value) {
        return Utils.escapeHtml(value);
    },

    /**
     * Greedy word-wrap using an approximate character width.
     * SVG has no automatic wrapping, so we measure with a heuristic:
     * average glyph width ≈ 0.55 × font-size for the system sans stack.
     */
    wrapText(text, maxWidth, fontSize) {
        const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
        if (!clean) return [];

        const perChar = fontSize * 0.55;
        const maxChars = Math.max(4, Math.floor(maxWidth / perChar));
        const words = clean.split(' ');
        const lines = [];
        let line = '';

        words.forEach(word => {
            // Break pathologically long words so they can't overflow.
            while (word.length > maxChars) {
                if (line) { lines.push(line); line = ''; }
                lines.push(word.slice(0, maxChars));
                word = word.slice(maxChars);
            }
            const candidate = line ? line + ' ' + word : word;
            if (candidate.length <= maxChars) {
                line = candidate;
            } else {
                if (line) lines.push(line);
                line = word;
            }
        });
        if (line) lines.push(line);
        return lines;
    },

    /** Parse #rgb / #rrggbb / rgb(...) into [r,g,b]. */
    _rgb(color) {
        const value = String(color || '').trim();
        const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
        if (rgbMatch) {
            const parts = rgbMatch[1].split(',').map(n => parseFloat(n));
            return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
        }
        let hex = value.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
        const num = parseInt(hex, 16);
        if (isNaN(num)) return [128, 128, 128];
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    },

    /** Perceived luminance 0..1. */
    _luminance(color) {
        const [r, g, b] = this._rgb(color);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    },

    /** Pick a legible foreground for a given background. */
    readableOn(background) {
        return this._luminance(background) > 0.62 ? '#14181f' : '#ffffff';
    },

    /** Blend a colour toward black (amount 0..1). */
    darken(color, amount) {
        const [r, g, b] = this._rgb(color);
        const mix = n => Math.round(n * (1 - amount));
        return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
    },

    /** Blend a colour toward white (amount 0..1). */
    lighten(color, amount) {
        const [r, g, b] = this._rgb(color);
        const mix = n => Math.round(n + (255 - n) * amount);
        return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
    },

    /** Approximate rendered width of a string for a given font size. */
    _textWidth(text, fontSize) {
        return String(text || '').length * fontSize * 0.54;
    },

    /**
     * Shrink a font size until the text fits `maxWidth` within `maxLines`.
     */
    fitText(text, maxWidth, maxLines, startSize, minSize = 20) {
        let size = startSize;
        while (size > minSize) {
            if (this.wrapText(text, maxWidth, size).length <= maxLines) return size;
            size -= 1;
        }
        return minSize;
    },

    /**
     * Generic faceted hexagonal mark — our own artwork (deliberately neither
     * the printed B&B logo nor any third-party mark). Reads as a d20 face.
     */
    facetMark(cx, cy, r, color) {
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 180) * (60 * i - 90);
            corners.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        const light = this.lighten(color, 0.34);
        const dark = this.darken(color, 0.28);

        let facets = '';
        for (let i = 0; i < 6; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % 6];
            facets +=
                `<polygon points="${a[0].toFixed(2)},${a[1].toFixed(2)} ` +
                `${b[0].toFixed(2)},${b[1].toFixed(2)} ${cx},${cy}" ` +
                `fill="${i % 2 ? light : dark}"/>`;
        }

        const outline = corners.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
        return (
            `<polygon points="${outline}" fill="none" stroke="${this.darken(color, 0.15)}" ` +
            `stroke-width="2" stroke-linejoin="round"/>` +
            facets +
            `<polygon points="${outline}" fill="none" stroke="${this.darken(color, 0.15)}" ` +
            `stroke-width="2" stroke-linejoin="round"/>`
        );
    },

    /** Normalise any card-ish object into the shape the renderer expects. */
    normalize(card) {
        const src = card || {};
        const type = this.TYPE_COLORS[src.type] ? src.type : 'procedure';
        const artwork = ['illustration', 'banner', 'none'].includes(src.artwork)
            ? src.artwork
            : (type === 'inject' ? 'none' : 'illustration');

        const toList = value => {
            if (!value) return [];
            if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
            return String(value).split('\n').map(v => v.trim()).filter(Boolean);
        };

        const detailTexts = toList(src.details).map(item => {
            if (item && typeof item === 'object') return item.text || item.url || '';
            // Strip any HTML that may have come from a real deck card.
            return String(item).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }).filter(Boolean);

        return {
            id: src.id || '',
            name: (src.name || 'Untitled Card').toString(),
            type,
            description: (src.description || '').toString(),
            detection: this.SCENARIO_TYPES.includes(type) ? toList(src.detection) : [],
            tools: type === 'procedure' ? toList(src.tools) : [],
            details: detailTexts,
            image: src.image || '',
            artwork,
            style: ['app', 'classic'].includes(src.style) ? src.style : 'app'
        };
    },

    /**
     * Resolve the colour skin for a card.
     * @returns {Object} frame/band/bg/text/heading/rule/idText/border/radius
     */
    resolveSkin(card) {
        const type = card.type;
        const isClassic = card.style === 'classic';

        if (!isClassic) {
            const accent = this.TYPE_COLORS[type];
            return {
                border: 9,
                frame: accent,
                band: accent,
                bandText: this.readableOn(accent),
                bg: '#1b2230',
                panel: '#232c3b',
                panelBorder: '#37425a',
                text: '#e7eaf0',
                muted: '#9aa4b5',
                heading: accent,
                rule: accent,
                idText: '#8b95a6',
                radius: 26
            };
        }

        // Classic (printed-card look). Injects are greyscale in the real deck.
        const isInject = type === 'inject';
        const accent = isInject ? '#9aa3b0' : this.CLASSIC_COLORS[type];
        return {
            border: 14,
            frame: isInject ? '#c3cad4' : accent,
            band: isInject ? '#e8ebef' : accent,
            bandText: isInject ? '#39414d' : this.readableOn(accent),
            bg: '#ffffff',
            panel: '#f1f4f8',
            panelBorder: '#d5dbe4',
            text: '#14181f',
            muted: '#3d4550',
            heading: isInject ? '#68707d' : accent,
            rule: isInject ? '#ccd3dc' : accent,
            idText: '#98a1ad',
            radius: 26
        };
    },

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Build the card SVG.
     * @param {Object} card
     * @param {Object} [opts] - { scale } (scale only affects width/height attrs)
     * @returns {string} SVG markup
     */
    render(card, opts = {}) {
        const c = this.normalize(card);
        const skin = this.resolveSkin(c);

        const W = this.WIDTH;
        const H = this.HEIGHT;
        const B = skin.border;                       // frame thickness
        const R = skin.radius;                       // outer corner radius
        const innerR = Math.max(4, R - B);
        const P = 48;                                // content padding
        const contentW = W - P * 2;
        const headerH = 120;
        const bandTop = B;
        const bodyTop = bandTop + headerH + 34;
        const footerTop = H - 96;
        const hasImage = c.artwork !== 'none' && !!c.image;

        /* ---- Header (centred title) ------------------------------------ */
        const titleText = (c.name || '').toUpperCase();
        const titleMaxW = W - (B + P) * 2;
        const titleSize = this.fitText(titleText, titleMaxW, 2, 58, 26);
        const titleLines = this.wrapText(titleText, titleMaxW, titleSize).slice(0, 2);
        const titleLh = Math.round(titleSize * 1.12);
        const titleBlockH = titleLines.length * titleLh;
        const titleTop = bandTop + (headerH - titleBlockH) / 2;

        /* ---- Artwork band (adaptive) ----------------------------------- */
        // Reserve only a MINIMUM height for the illustration so the body text
        // keeps a large font; the image then takes whatever space is left.
        const wantsArt = hasImage && c.artwork === 'illustration';
        // A banner is a FIXED-height band sitting directly under the header, so
        // the body has to start below it or the text paints over the image.
        const wantsBanner = hasImage && c.artwork === 'banner';
        const MIN_ART_H = 150;
        const MAX_ART_H = 340;
        const ART_GAP = 26;
        const BANNER_H = 200;
        const artW = 430;
        const artX = (W - artW) / 2;
        const artBottom = footerTop - 14;
        const textTop = bodyTop + (wantsBanner ? BANNER_H + ART_GAP : 0);
        const textBottom = wantsArt ? artBottom - MIN_ART_H - ART_GAP : footerTop - 10;

        /* ---- Body: measure, then auto-shrink to fit --------------------- */
        const sections = [];
        if (c.detection.length) sections.push({ title: 'Detection', items: c.detection });
        if (c.tools.length) sections.push({ title: 'Tools', items: c.tools });
        if (c.details.length) sections.push({ title: 'Resources', items: c.details });

        const available = textBottom - textTop;
        let layout = null;
        for (let size = 25; size >= 14; size -= 1) {
            layout = this._measureBody(c, sections, contentW, size);
            if (layout.height <= available) break;
        }

        // Give the illustration everything left below the text, within bounds.
        let artY = 0;
        let artH = 0;
        if (wantsArt) {
            artH = Math.max(MIN_ART_H, Math.min(MAX_ART_H, artBottom - (bodyTop + layout.height + ART_GAP)));
            artY = artBottom - artH;
        }

        const body = this._renderBody(layout, textTop, P, skin, W);

        /* ---- Artwork --------------------------------------------------- */
        const art = [];
        if (hasImage && c.artwork === 'illustration') {
            const clipId = `cc-art-${Math.random().toString(36).slice(2, 9)}`;
            art.push(
                `<defs><clipPath id="${clipId}"><rect x="${artX}" y="${artY}" width="${artW}" height="${artH}" rx="14"/></clipPath></defs>` +
                `<rect x="${artX}" y="${artY}" width="${artW}" height="${artH}" rx="14" fill="${skin.panel}" ` +
                `stroke="${skin.panelBorder}" stroke-width="2"/>` +
                `<image href="${this.escapeXml(c.image)}" x="${artX}" y="${artY}" width="${artW}" height="${artH}" ` +
                `preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
            );
        } else if (hasImage && c.artwork === 'banner') {
            const bh = BANNER_H;
            const clipId = `cc-banner-${Math.random().toString(36).slice(2, 9)}`;
            art.push(
                `<defs><clipPath id="${clipId}"><rect x="${P}" y="${bodyTop}" width="${contentW}" height="${bh}" rx="12"/></clipPath></defs>` +
                `<rect x="${P}" y="${bodyTop}" width="${contentW}" height="${bh}" rx="12" fill="${skin.panel}"/>` +
                `<image href="${this.escapeXml(c.image)}" x="${P}" y="${bodyTop}" width="${contentW}" height="${bh}" ` +
                `preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
            );
        }

        /* ---- Header band (rounded top corners) ------------------------- */
        const bandPath =
            `M ${B} ${bandTop + headerH} L ${B} ${bandTop + innerR} ` +
            `Q ${B} ${bandTop} ${B + innerR} ${bandTop} ` +
            `L ${W - B - innerR} ${bandTop} Q ${W - B} ${bandTop} ${W - B} ${bandTop + innerR} ` +
            `L ${W - B} ${bandTop + headerH} Z`;

        const titleSvg = titleLines.map((line, i) =>
            `<text x="${W / 2}" y="${titleTop + (i + 1) * titleLh - titleSize * 0.28}" ` +
            `font-family="${this.FONT}" font-size="${titleSize}" font-weight="700" letter-spacing="1.2" ` +
            `fill="${skin.bandText}" text-anchor="middle">${this.escapeXml(line)}</text>`
        ).join('');

        /* ---- Footer ---------------------------------------------------- */
        const typeLabel = this.escapeXml((this.TYPE_LABELS[c.type] || c.type).toUpperCase());
        const footer =
            `<text x="${P}" y="${H - 46}" font-family="${this.FONT}" font-size="15" font-weight="600" ` +
            `letter-spacing="1.6" fill="${skin.idText}">${typeLabel}</text>` +
            this.facetMark(W / 2, H - B - 34, 26, skin.frame) +
            (c.id
                ? `<text x="${W - 22}" y="${H - 40}" font-family="${this.FONT}" font-size="15" letter-spacing="1.2" ` +
                  `fill="${skin.idText}" text-anchor="middle" transform="rotate(-90 ${W - 22} ${H - 40})">` +
                  `${this.escapeXml(String(c.id))}</text>`
                : '');

        /* ---- Compose --------------------------------------------------- */
        const scale = opts.scale || 1;
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" ` +
            `viewBox="0 0 ${W} ${H}" role="img" aria-label="${this.escapeXml(c.name)} card">` +
            `<rect x="0" y="0" width="${W}" height="${H}" rx="${R}" fill="${skin.frame}"/>` +
            `<rect x="${B}" y="${B}" width="${W - B * 2}" height="${H - B * 2}" rx="${innerR}" fill="${skin.bg}"/>` +
            `<path d="${bandPath}" fill="${skin.band}"/>` +
            titleSvg +
            art.join('') +
            body +
            footer +
            `</svg>`
        );
    },

    /**
     * Measure the body content for a given font size.
     * @returns {{body:number, list:number, lh:number, listLh:number, desc:string[], sections:Array, height:number}}
     */
    _measureBody(card, sections, contentW, bodySize) {
        const lh = Math.round(bodySize * 1.36);
        const listSize = Math.max(13, bodySize - 1);
        const listLh = Math.round(listSize * 1.32);

        const desc = card.description ? this.wrapText(card.description, contentW, bodySize) : [];
        let height = desc.length * lh;
        if (desc.length) height += 26;

        const measured = sections.map(section => {
            const items = section.items.map(item => this.wrapText('•  ' + item, contentW - 8, listSize));
            const itemsHeight = items.reduce((sum, lines) => sum + lines.length * listLh + 7, 0);
            return { title: section.title, items, itemsHeight };
        });

        measured.forEach(m => { height += 34 + 16 + m.itemsHeight + 24; });

        return { body: bodySize, list: listSize, lh, listLh, desc, sections: measured, height };
    },

    /** Emit the body markup from a measured layout. */
    _renderBody(layout, top, pad, skin, W) {
        const out = [];
        let y = top;
        const font = this.FONT;

        if (layout.desc.length) {
            layout.desc.forEach(line => {
                out.push(
                    `<text x="${pad}" y="${y + layout.body}" font-family="${font}" font-size="${layout.body}" ` +
                    `fill="${skin.text}">${this.escapeXml(line)}</text>`
                );
                y += layout.lh;
            });
            y += 26;
        }

        layout.sections.forEach(section => {
            // Thin rule above the centred heading (as on the printed cards).
            out.push(
                `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" ` +
                `stroke="${skin.rule}" stroke-width="2" stroke-opacity="0.85"/>`
            );
            out.push(
                `<text x="${W / 2}" y="${y + 30}" font-family="${font}" font-size="21" font-weight="700" ` +
                `letter-spacing="2.5" fill="${skin.heading}" text-anchor="middle">` +
                `${this.escapeXml(section.title.toUpperCase())}</text>`
            );
            y += 34 + 16;

            section.items.forEach(lines => {
                lines.forEach((line, i) => {
                    out.push(
                        `<text x="${pad + (i === 0 ? 0 : 20)}" y="${y + layout.list}" font-family="${font}" ` +
                        `font-size="${layout.list}" fill="${skin.text}">${this.escapeXml(line)}</text>`
                    );
                    y += layout.listLh;
                });
                y += 7;
            });
            y += 24;
        });

        return out.join('');
    },

    /** SVG as a data URI (handy for <img src> previews). */
    renderDataUrl(card, opts = {}) {
        const svg = this.render(card, opts);
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    },

    /* ------------------------------------------------------------------ */
    /* Rasterisation / download                                            */
    /* ------------------------------------------------------------------ */

    _loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to rasterise card SVG'));
            img.src = src;
        });
    },

    /**
     * Rasterise the card to a PNG blob.
     * @param {Object} card
     * @param {Object} [opts] - { scale } (default 2 → 1500×2100)
     * @returns {Promise<Blob>}
     */
    async toPngBlob(card, opts = {}) {
        const scale = opts.scale || 2;
        const skin = this.resolveSkin(this.normalize(card));
        // opts is forwarded so the SVG carries width/height = W*scale while its
        // viewBox stays 750x1050 — the browser then rasterises the VECTORS at the
        // final size, making the drawImage below 1:1 rather than an upscale.
        // A data: URI is required: external refs are blocked in secure-static
        // mode and would taint the canvas.
        const img = await this._loadImage(this.renderDataUrl(card, opts));

        const canvas = document.createElement('canvas');
        canvas.width = this.WIDTH * scale;
        canvas.height = this.HEIGHT * scale;
        const ctx = canvas.getContext('2d');
        // Backs the rounded corners, which the SVG leaves transparent.
        ctx.fillStyle = skin.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas produced no PNG data'));
            }, 'image/png');
        });
    },

    /** Rasterise the card to a PNG data URI. */
    async toPngDataUrl(card, opts = {}) {
        const blob = await this.toPngBlob(card, opts);
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read PNG blob'));
            reader.readAsDataURL(blob);
        });
    },

    /** Safe-ish filename stem from a card name. */
    fileStem(card) {
        const c = this.normalize(card);
        const stem = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return stem || 'custom-card';
    },

    downloadSvg(card, opts = {}) {
        const svg = this.render(card, opts);
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        Utils.downloadFile(blob, this.fileStem(card) + '.svg');
    },

    async downloadPng(card, opts = {}) {
        const blob = await this.toPngBlob(card, opts);
        Utils.downloadFile(blob, this.fileStem(card) + '.png');
    }
};

window.CardRenderer = CardRenderer;
