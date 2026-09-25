/**
 * B&B Shuffle — Custom Card Creator
 * ------------------------------------------------------------------
 * Live form -> SVG card preview -> optional save into the "Custom Cards"
 * expansion deck (server-side, via /api/custom-cards).
 *
 * Depends on: Utils, CardRenderer, AIClient, CustomCardIO (all loaded first).
 */

const CardCreator = {
    MAX_ART_DIM: 800,
    // Canonical source: Utils.SCENARIO_TYPES (utils.js loads before this file).
    SCENARIO_TYPES: Utils.SCENARIO_TYPES,

    el: {},
    card: null,
    suggestions: [],
    editingId: null,
    _renderTimer: null,

    /* ------------------------------------------------------------------ */
    /* Init                                                                */
    /* ------------------------------------------------------------------ */

    async init() {
        this.cacheElements();
        this.card = this.blankCard();
        this.bindEvents();
        this.updateTypeFields();
        this.syncForm();
        this.render();

        await this.loadSuggestions();
        await this.updateAiMode();

        // Edit an existing card when opened as ...?id=CC-001
        const id = new URLSearchParams(window.location.search).get('id');
        if (id) await this.loadCard(id);
    },

    cacheElements() {
        const ids = [
            'cc-type', 'cc-id', 'cc-name', 'cc-description',
            'cc-detection-field', 'cc-detection-chips', 'cc-detection-input', 'cc-detection-suggest',
            'cc-tools-field', 'cc-tools-chips', 'cc-tools-input',
            'cc-resources', 'cc-add-resource',
            'cc-drop', 'cc-image-input', 'cc-thumb', 'cc-thumb-img', 'cc-image-clear',
            'cc-artwork-seg', 'cc-style-seg',
            'cc-preview-img', 'cc-save', 'cc-export-svg', 'cc-export-png', 'cc-copy-json',
            'cc-new-btn', 'cc-preview-status', 'cc-form-status',
            'cc-ai', 'cc-ai-mode', 'cc-ai-theme', 'cc-ai-difficulty', 'cc-ai-context',
            'cc-ai-generate', 'cc-ai-status'
        ];
        ids.forEach(id => { this.el[id] = Utils.getElement(id); });
    },

    blankCard() {
        return {
            id: '',
            name: '',
            type: 'procedure',
            description: '',
            detection: [],
            tools: [],
            resources: [],
            image: '',
            artwork: 'illustration',
            style: 'app'
        };
    },

    /* ------------------------------------------------------------------ */
    /* Events                                                              */
    /* ------------------------------------------------------------------ */

    bindEvents() {
        const onInput = () => { this.readForm(); this.scheduleRender(); };

        ['cc-name', 'cc-description', 'cc-id'].forEach(id => {
            this.el[id]?.addEventListener('input', onInput);
        });

        this.el['cc-type']?.addEventListener('change', () => {
            this.readForm();
            this.updateTypeFields();
            this.scheduleRender();
        });

        // Chips: Enter adds, Backspace on empty removes the last one.
        this.bindChipInput('cc-detection-input', 'detection');
        this.bindChipInput('cc-tools-input', 'tools');

        // Resources
        this.el['cc-add-resource']?.addEventListener('click', () => {
            this.card.resources.push({ text: '', url: '' });
            this.renderResources();
        });

        // Artwork placement + style segmented controls
        this.bindSeg('cc-artwork-seg', value => { this.card.artwork = value; this.scheduleRender(); });
        this.bindSeg('cc-style-seg', value => { this.card.style = value; this.scheduleRender(); });

        // Image upload
        this.el['cc-drop']?.addEventListener('click', () => this.el['cc-image-input']?.click());
        this.el['cc-image-input']?.addEventListener('change', e => {
            const file = e.target.files && e.target.files[0];
            if (file) this.setImageFromFile(file);
            e.target.value = '';
        });
        const drop = this.el['cc-drop'];
        if (drop) {
            ['dragenter', 'dragover'].forEach(evt => drop.addEventListener(evt, e => {
                e.preventDefault();
                drop.classList.add('is-drag');
            }));
            ['dragleave', 'drop'].forEach(evt => drop.addEventListener(evt, e => {
                e.preventDefault();
                drop.classList.remove('is-drag');
            }));
            drop.addEventListener('drop', e => {
                const file = e.dataTransfer?.files && e.dataTransfer.files[0];
                if (file) this.setImageFromFile(file);
            });
        }
        this.el['cc-image-clear']?.addEventListener('click', () => {
            this.card.image = '';
            this.updateThumb();
            this.scheduleRender();
        });

        // Preview actions
        this.el['cc-save']?.addEventListener('click', () => this.save());
        this.el['cc-export-svg']?.addEventListener('click', () => {
            this.readForm();
            CardRenderer.downloadSvg(this.card);
            this.setStatus(this.el['cc-preview-status'], 'SVG exported', 'ok');
        });
        this.el['cc-export-png']?.addEventListener('click', () => this.exportPng());
        this.el['cc-copy-json']?.addEventListener('click', () => this.copyJson());
        this.el['cc-new-btn']?.addEventListener('click', () => this.newCard());

        // AI
        this.el['cc-ai-generate']?.addEventListener('click', () => this.generateWithAi());
    },

    bindChipInput(inputId, key) {
        const input = this.el[inputId];
        if (!input) return;
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                this.addChip(key, input.value);
                input.value = '';
                this.hideSuggestions(key);
            } else if (e.key === 'Backspace' && !input.value) {
                this.card[key].pop();
                this.renderChips(key);
                this.scheduleRender();
            }
        });
        input.addEventListener('input', () => this.showSuggestions(key, input.value));
        input.addEventListener('blur', () => setTimeout(() => this.hideSuggestions(key), 150));
    },

    bindSeg(containerId, onChange) {
        const container = this.el[containerId];
        if (!container) return;
        container.addEventListener('change', e => {
            if (e.target.name && e.target.type === 'radio') {
                this.paintSeg(containerId);
                onChange(e.target.value);
            }
        });
    },

    /* ------------------------------------------------------------------ */
    /* Form <-> state                                                      */
    /* ------------------------------------------------------------------ */

    readForm() {
        this.card.type = this.el['cc-type']?.value || this.card.type;
        this.card.id = this.el['cc-id']?.value.trim() || '';
        this.card.name = this.el['cc-name']?.value || '';
        this.card.description = this.el['cc-description']?.value || '';
        this.card.resources = this.readResources();
    },

    syncForm() {
        const c = this.card;
        if (this.el['cc-type']) this.el['cc-type'].value = c.type;
        if (this.el['cc-id']) {
            this.el['cc-id'].value = c.id || '';
            this.el['cc-id'].placeholder = 'auto';
        }
        if (this.el['cc-name']) this.el['cc-name'].value = c.name || '';
        if (this.el['cc-description']) this.el['cc-description'].value = c.description || '';

        const check = (name, value) => {
            const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
            if (input) input.checked = true;
        };
        check('cc-artwork', c.artwork || 'illustration');
        check('cc-style', c.style || 'app');
        this.paintSeg('cc-artwork-seg');
        this.paintSeg('cc-style-seg');

        this.renderChips('detection');
        this.renderChips('tools');
        this.renderResources();
        this.updateThumb();
    },

    paintSeg(containerId) {
        const container = this.el[containerId];
        if (!container) return;
        Utils.$$('label', container).forEach(label => {
            const input = label.querySelector('input');
            label.classList.toggle('is-active', !!(input && input.checked));
        });
    },

    updateTypeFields() {
        const isScenario = this.SCENARIO_TYPES.includes(this.card.type);
        this.el['cc-detection-field']?.classList.toggle('cc-hidden', !isScenario);
        this.el['cc-tools-field']?.classList.toggle('cc-hidden', this.card.type !== 'procedure');
    },

    /* ------------------------------------------------------------------ */
    /* Chips                                                               */
    /* ------------------------------------------------------------------ */

    addChip(key, rawValue) {
        const value = String(rawValue || '').trim();
        if (!value || !Array.isArray(this.card[key])) return;
        if (this.card[key].some(v => v.toLowerCase() === value.toLowerCase())) return;
        this.card[key].push(value);
        this.renderChips(key);
        this.scheduleRender();
    },

    removeChip(key, index) {
        this.card[key].splice(index, 1);
        this.renderChips(key);
        this.scheduleRender();
    },

    renderChips(key) {
        const container = this.el[key === 'detection' ? 'cc-detection-chips' : 'cc-tools-chips'];
        if (!container) return;
        container.innerHTML = '';

        this.card[key].forEach((value, index) => {
            const chip = document.createElement('span');
            chip.className = 'cc-chip';

            const label = document.createElement('span');
            label.textContent = value;
            chip.appendChild(label);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.title = 'Remove';
            remove.addEventListener('click', () => this.removeChip(key, index));
            chip.appendChild(remove);

            container.appendChild(chip);
        });
    },

    /* ------------------------------------------------------------------ */
    /* Autocomplete (scenario DETECTION)                                   */
    /* ------------------------------------------------------------------ */

    async loadSuggestions() {
        const sources = [
            '../../../docs/card-details.json',
            '../../../shared/decks/core31/carddb.json'
        ];
        for (const url of sources) {
            try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) continue;
                const data = await res.json();
                const names = this.collectNames(data);
                if (names.length) {
                    this.suggestions = names;
                    return;
                }
            } catch (e) { /* try the next source */ }
        }
        this.suggestions = [];
    },

    /** Pull procedure-card names out of either supported JSON shape. */
    collectNames(data) {
        const seen = new Map(); // lowercase -> original casing
        const add = value => {
            const name = String(value || '').trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (!seen.has(key)) seen.set(key, name);
        };

        const visitCard = card => {
            if (!card || typeof card !== 'object') return;
            if (card.type === 'procedure') add(card.name);
        };

        // carddb.json shape: { data: [ { name, type } ] }
        if (Array.isArray(data?.data)) data.data.forEach(visitCard);

        // docs/card-details.json shape: { decks: [ { cards: { procedure: [...] } } ] }
        if (Array.isArray(data?.decks)) {
            data.decks.forEach(deck => {
                const procedures = deck?.cards?.procedure;
                if (Array.isArray(procedures)) procedures.forEach(p => add(p?.name));
            });
        }

        return Array.from(seen.values());
    },

    showSuggestions(key, query) {
        if (key !== 'detection') return;
        const box = this.el['cc-detection-suggest'];
        if (!box) return;

        const q = String(query || '').trim().toLowerCase();
        if (q.length < 2) { box.classList.add('cc-hidden'); return; }

        const matches = this.suggestions
            .filter(name => name.toLowerCase().includes(q))
            .slice(0, 8);

        if (!matches.length) { box.classList.add('cc-hidden'); return; }

        box.innerHTML = '';
        matches.forEach(name => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = name;
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                this.addChip('detection', name);
                if (this.el['cc-detection-input']) this.el['cc-detection-input'].value = '';
                box.classList.add('cc-hidden');
            });
            box.appendChild(btn);
        });
        box.classList.remove('cc-hidden');
    },

    hideSuggestions(key) {
        if (key !== 'detection') return;
        this.el['cc-detection-suggest']?.classList.add('cc-hidden');
    },

    /* ------------------------------------------------------------------ */
    /* Resources                                                           */
    /* ------------------------------------------------------------------ */

    readResources() {
        const rows = Array.from(Utils.$$('#cc-resources .cc-res-row'));
        return rows.map(row => {
            const inputs = row.querySelectorAll('input');
            return {
                text: (inputs[0]?.value || '').trim(),
                url: (inputs[1]?.value || '').trim()
            };
        }).filter(r => r.text || r.url);
    },

    renderResources() {
        const container = this.el['cc-resources'];
        if (!container) return;
        container.innerHTML = '';

        this.card.resources.forEach((resource, index) => {
            const row = document.createElement('div');
            row.className = 'cc-res-row';

            const text = document.createElement('input');
            text.type = 'text';
            text.className = 'form-input';
            text.placeholder = 'Label';
            text.value = resource.text || '';
            text.addEventListener('input', () => {
                this.card.resources[index].text = text.value;
            });

            const url = document.createElement('input');
            url.type = 'url';
            url.className = 'form-input';
            url.placeholder = 'https://…';
            url.value = resource.url || '';
            url.addEventListener('input', () => {
                this.card.resources[index].url = url.value;
            });

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn btn-ghost btn-sm';
            remove.textContent = '×';
            remove.title = 'Remove link';
            remove.addEventListener('click', () => {
                this.card.resources.splice(index, 1);
                this.renderResources();
            });

            row.append(text, url, remove);
            container.appendChild(row);
        });
    },

    /* ------------------------------------------------------------------ */
    /* Artwork                                                             */
    /* ------------------------------------------------------------------ */

    async setImageFromFile(file) {
        if (!file.type.startsWith('image/')) {
            this.setStatus(this.el['cc-form-status'], 'That file is not an image', 'err');
            return;
        }
        try {
            this.card.image = await this.readImageFile(file, this.MAX_ART_DIM);
            this.updateThumb();
            this.scheduleRender();
            this.setStatus(this.el['cc-form-status'], '', '');
        } catch (e) {
            this.setStatus(this.el['cc-form-status'], e.message, 'err');
        }
    },

    /** Read + downscale a picked image; keeps alpha for PNG/GIF/WebP. */
    async readImageFile(file, maxDim) {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read that image'));
            reader.readAsDataURL(file);
        });

        const img = await CardRenderer._loadImage(dataUrl);
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.height || 1) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const keepAlpha = /png|gif|webp/i.test(file.type);
        if (!keepAlpha) {
            ctx.fillStyle = '#0d1117';
            ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);

        return keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
    },

    updateThumb() {
        const thumb = this.el['cc-thumb'];
        if (!thumb) return;
        if (this.card.image) {
            if (this.el['cc-thumb-img']) this.el['cc-thumb-img'].src = this.card.image;
            thumb.classList.remove('cc-hidden');
        } else {
            thumb.classList.add('cc-hidden');
        }
    },

    /* ------------------------------------------------------------------ */
    /* Preview                                                             */
    /* ------------------------------------------------------------------ */

    scheduleRender() {
        clearTimeout(this._renderTimer);
        this._renderTimer = setTimeout(() => this.render(), 120);
    },

    render() {
        if (!this.el['cc-preview-img']) return;
        this.el['cc-preview-img'].src = CardRenderer.renderDataUrl(this.card);
        this.updateTypeFields();
    },

    /* ------------------------------------------------------------------ */
    /* AI assist                                                           */
    /* ------------------------------------------------------------------ */

    async updateAiMode() {
        const modeLabel = this.el['cc-ai-mode'];
        const button = this.el['cc-ai-generate'];
        if (!modeLabel || !button) return;

        const resolved = await AIClient.resolve();
        if (resolved.ok) {
            modeLabel.textContent = (resolved.mode === 'shared' ? 'Using the server key · ' : 'Using your key · ') + resolved.label;
            button.disabled = false;
            button.title = '';
        } else {
            modeLabel.textContent = 'No AI key available. Add one in the AI Generator (or ask your host to set a shared key), then reload.';
            button.disabled = true;
            button.title = 'No AI key configured';
        }
    },

    async generateWithAi() {
        const button = this.el['cc-ai-generate'];
        const status = this.el['cc-ai-status'];

        this.readForm();
        button.disabled = true;
        this.setStatus(status, 'Generating…', '');

        try {
            const result = await AIClient.generateCard({
                type: this.card.type,
                theme: this.el['cc-ai-theme']?.value || '',
                difficulty: this.el['cc-ai-difficulty']?.value || '',
                context: this.el['cc-ai-context']?.value || ''
            });

            if (result.name) this.card.name = result.name;
            if (result.description) this.card.description = result.description;

            const isScenario = this.SCENARIO_TYPES.includes(this.card.type);
            if (isScenario && result.detection.length) this.card.detection = result.detection;
            if (this.card.type === 'procedure' && result.tools.length) this.card.tools = result.tools;
            if (result.details.length) {
                this.card.resources = result.details.map(d => ({ text: d.text || d.url || '', url: d.url || '' }));
            }

            this.syncForm();
            this.render();
            this.setStatus(status, 'Fields generated — review and edit before saving.', 'ok');
        } catch (e) {
            this.setStatus(status, e.message, 'err');
        } finally {
            button.disabled = false;
            this.updateAiMode();
        }
    },

    /* ------------------------------------------------------------------ */
    /* Save / export                                                       */
    /* ------------------------------------------------------------------ */

    buildPayload() {
        this.readForm();
        return {
            name: this.card.name.trim(),
            type: this.card.type,
            description: this.card.description.trim(),
            image: this.card.image || '',
            resources: this.card.resources,
            detection: this.card.detection,
            tools: this.card.tools,
            artwork: this.card.artwork,
            style: this.card.style,
            enabled: this.card.enabled !== false
        };
    },

    async save() {
        const status = this.el['cc-preview-status'];
        const payload = this.buildPayload();

        if (!payload.name) {
            this.setStatus(status, 'Give the card a name first.', 'err');
            this.el['cc-name']?.focus();
            return;
        }

        const button = this.el['cc-save'];
        if (button) button.disabled = true;
        this.setStatus(status, 'Saving…', '');

        try {
            const available = await CustomCardIO.available();
            if (!available) throw new Error('The API is not reachable. Run the app via docker (port 8180) or the bundled API server.');

            // Rasterise the rendered face and store the PNG on the server.
            const pngDataUrl = await CardRenderer.toPngDataUrl(this.card, { scale: 2 });
            const imagePath = await CustomCardIO.uploadImage(pngDataUrl);
            if (!imagePath) throw new Error('Could not store the rendered card image');
            payload.image = imagePath;

            const saved = this.editingId
                ? await CustomCardIO.update(this.editingId, payload)
                : await CustomCardIO.create(payload);

            if (!saved) throw new Error('The server rejected the card');

            this.editingId = saved.id;
            this.card.id = saved.id;
            this.card.enabled = saved.enabled !== false;
            if (this.el['cc-id']) this.el['cc-id'].value = saved.id;

            this.setStatus(status, `Saved as ${saved.id}. Enable it under "Custom Cards" in the Scenario Editor.`, 'ok');
            Utils.showToast(`${saved.id} saved to Custom Cards`, 'success');
        } catch (e) {
            this.setStatus(status, e.message, 'err');
            Utils.showToast(e.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    },

    async exportPng() {
        const status = this.el['cc-preview-status'];
        this.readForm();
        try {
            this.setStatus(status, 'Rendering PNG…', '');
            await CardRenderer.downloadPng(this.card, { scale: 2 });
            this.setStatus(status, 'PNG exported (1500 × 2100)', 'ok');
        } catch (e) {
            this.setStatus(status, e.message, 'err');
        }
    },

    async copyJson() {
        const json = JSON.stringify(this.buildPayload(), null, 2);
        const ok = await Utils.copyToClipboard(json);
        this.setStatus(this.el['cc-preview-status'], ok ? 'Card JSON copied' : 'Copy failed', ok ? 'ok' : 'err');
    },

    async loadCard(id) {
        try {
            const card = await CustomCardIO.get(id);
            if (!card) {
                this.setStatus(this.el['cc-preview-status'], `Card ${id} not found`, 'err');
                return;
            }
            this.editingId = card.id;
            this.card = {
                id: card.id,
                name: card.name || '',
                type: card.type || 'procedure',
                description: card.description || '',
                detection: Array.isArray(card.detection) ? card.detection.slice() : [],
                tools: Array.isArray(card.tools) ? card.tools.slice() : [],
                resources: Array.isArray(card.resources) ? card.resources.map(r => ({ text: r.text || '', url: r.url || '' })) : [],
                image: card.image || '',
                artwork: card.artwork || 'illustration',
                style: card.style || 'app',
                enabled: card.enabled !== false
            };
            this.syncForm();
            this.render();
            this.setStatus(this.el['cc-preview-status'], `Editing ${card.id}`, '');
        } catch (e) {
            this.setStatus(this.el['cc-preview-status'], e.message, 'err');
        }
    },

    newCard() {
        this.editingId = null;
        this.card = this.blankCard();
        if (this.el['cc-ai-theme']) this.el['cc-ai-theme'].value = '';
        if (this.el['cc-ai-context']) this.el['cc-ai-context'].value = '';
        this.syncForm();
        this.render();
        this.setStatus(this.el['cc-preview-status'], 'New card started', '');
        this.el['cc-name']?.focus();
    },

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    setStatus(element, message, kind) {
        if (!element) return;
        element.textContent = message || '';
        element.classList.remove('ok', 'err');
        if (kind) element.classList.add(kind);
    }
};

document.addEventListener('DOMContentLoaded', () => CardCreator.init());
