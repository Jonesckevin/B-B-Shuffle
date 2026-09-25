/**
 * B&B Shuffle — Custom Cards library
 * ------------------------------------------------------------------
 * Lists the user-created cards from the "Custom Cards" deck and lets you
 * preview, enable/disable, edit, duplicate, delete and import/export them.
 *
 * Depends on: Utils, CardRenderer, CustomCardIO, CardViewer (all loaded first).
 */

const CustomCardsLibrary = {
    cards: [],
    el: {},

    /* ------------------------------------------------------------------ */

    async init() {
        this.cacheElements();
        this.bindEvents();
        await this.load();
    },

    cacheElements() {
        [
            'cc-cards-grid', 'cc-empty', 'cc-lib-status', 'cc-select-all',
            'cc-export-deck', 'cc-import-deck', 'cc-import-input'
        ].forEach(id => { this.el[id] = Utils.getElement(id); });
    },

    bindEvents() {
        this.el['cc-select-all']?.addEventListener('change', e => this.setAllEnabled(e.target.checked));
        this.el['cc-export-deck']?.addEventListener('click', () => this.exportDeck());
        this.el['cc-import-deck']?.addEventListener('click', () => this.el['cc-import-input']?.click());
        this.el['cc-import-input']?.addEventListener('change', e => {
            const file = e.target.files && e.target.files[0];
            if (file) this.importDeck(file);
            e.target.value = '';
        });
    },

    async load() {
        try {
            this.cards = await CustomCardIO.list();
            this.setStatus(this.cards.length ? `${this.cards.length} card${this.cards.length === 1 ? '' : 's'}` : '');
        } catch (e) {
            this.cards = [];
            this.setStatus('Could not reach the API — ' + e.message, 'err');
        }
        this.render();
    },

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */

    render() {
        const grid = this.el['cc-cards-grid'];
        const empty = this.el['cc-empty'];
        if (!grid || !empty) return;

        grid.innerHTML = '';

        if (!this.cards.length) {
            empty.classList.remove('cc-hidden');
        } else {
            empty.classList.add('cc-hidden');
            this.cards.forEach(card => grid.appendChild(this.buildTile(card)));
        }

        const all = this.el['cc-select-all'];
        if (all) {
            const enabledCount = this.cards.filter(c => c.enabled !== false).length;
            all.checked = this.cards.length > 0 && enabledCount === this.cards.length;
            all.indeterminate = enabledCount > 0 && enabledCount < this.cards.length;
        }
    },

    buildTile(card) {
        const tile = document.createElement('div');
        tile.className = 'cc-card-tile' + (card.enabled === false ? ' is-disabled' : '');

        // Thumbnail
        const frame = document.createElement('div');
        frame.className = 'cc-card-frame';
        frame.title = 'Preview';
        const img = document.createElement('img');
        img.alt = card.name || 'Custom card';
        img.src = Utils.assetPath(card.image || '');
        img.onerror = () => { img.src = Utils.cardPlaceholder('No image'); };
        frame.appendChild(img);
        frame.addEventListener('click', () => this.preview(card));
        tile.appendChild(frame);

        // Name
        const name = document.createElement('div');
        name.className = 'cc-card-name';
        name.textContent = card.name || 'Untitled Card';
        name.title = card.name || '';
        tile.appendChild(name);

        // Meta
        const meta = document.createElement('div');
        meta.className = 'cc-card-meta';
        const idSpan = document.createElement('span');
        idSpan.textContent = card.id || '';
        const typeSpan = document.createElement('span');
        typeSpan.textContent = CardRenderer.TYPE_LABELS[card.type] || card.type || '';
        meta.append(idSpan, typeSpan);
        tile.appendChild(meta);

        // Enable switch
        const switchLabel = document.createElement('label');
        switchLabel.className = 'cc-switch';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = card.enabled !== false;
        checkbox.addEventListener('change', () => this.setEnabled(card, checkbox.checked));
        switchLabel.append(checkbox, document.createTextNode(' In game'));
        tile.appendChild(switchLabel);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'cc-card-actions';
        actions.append(
            this.actionButton('Edit', 'btn-secondary', () => this.edit(card)),
            this.actionButton('Duplicate', 'btn-ghost', () => this.duplicate(card)),
            this.actionButton('Delete', 'btn-ghost', () => this.remove(card))
        );
        tile.appendChild(actions);

        return tile;
    },

    actionButton(label, variant, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn btn-sm ${variant}`;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    },

    /* ------------------------------------------------------------------ */
    /* Actions                                                             */
    /* ------------------------------------------------------------------ */

    preview(card) {
        if (typeof CardViewer === 'undefined') return;
        CardViewer.open(Utils.assetPath(card.image || ''), {
            name: card.name || 'Untitled Card',
            type: card.type || ''
        });
    },

    edit(card) {
        window.location.href = `modules/card-creator/card_creator.html?id=${encodeURIComponent(card.id)}`;
    },

    async setEnabled(card, enabled) {
        try {
            await CustomCardIO.update(card.id, { enabled });
            card.enabled = enabled;
            this.setStatus(`${card.id} ${enabled ? 'enabled' : 'disabled'}`, 'ok');
            this.render();
        } catch (e) {
            this.setStatus(e.message, 'err');
            this.render();
        }
    },

    async setAllEnabled(enabled) {
        if (!this.cards.length) return;
        this.setStatus(enabled ? 'Enabling all…' : 'Disabling all…');
        try {
            for (const card of this.cards) {
                if ((card.enabled !== false) === enabled) continue;
                await CustomCardIO.update(card.id, { enabled });
                card.enabled = enabled;
            }
            this.setStatus(enabled ? 'All cards enabled' : 'All cards disabled', 'ok');
        } catch (e) {
            this.setStatus(e.message, 'err');
        }
        this.render();
    },

    async duplicate(card) {
        this.setStatus(`Duplicating ${card.id}…`);
        try {
            // Re-upload the rendered PNG so the copy owns its own image file
            // (deleting one card must not remove the other's artwork).
            let imagePath = '';
            if (card.image) {
                const res = await fetch(Utils.assetPath(card.image));
                if (res.ok) {
                    const blob = await res.blob();
                    imagePath = await CustomCardIO.uploadImage(await this.blobToDataUrl(blob));
                }
            }
            const copy = await CustomCardIO.create({
                name: (card.name || 'Untitled') + ' copy',
                type: card.type,
                description: card.description || '',
                image: imagePath || '',
                resources: card.resources || [],
                detection: card.detection || [],
                tools: card.tools || [],
                artwork: card.artwork || 'illustration',
                style: card.style || 'app',
                enabled: true
            });
            this.setStatus(`Created ${copy.id}`, 'ok');
            await this.load();
        } catch (e) {
            this.setStatus(e.message, 'err');
        }
    },

    async remove(card) {
        if (!window.confirm(`Delete "${card.name}" (${card.id})? This cannot be undone.`)) return;
        this.setStatus(`Deleting ${card.id}…`);
        try {
            await CustomCardIO.remove(card.id);
            this.setStatus(`${card.id} deleted`, 'ok');
            await this.load();
        } catch (e) {
            this.setStatus(e.message, 'err');
        }
    },

    /* ------------------------------------------------------------------ */
    /* Deck import / export                                                */
    /* ------------------------------------------------------------------ */

    exportDeck() {
        if (!this.cards.length) {
            this.setStatus('Nothing to export', 'err');
            return;
        }
        const deck = {
            title: 'Custom Cards',
            revdate: new Date().toLocaleDateString('en-US'),
            link: '',
            data: this.cards,
            red: '../../shared/decks/cardbacks/v1/init.webp',
            yellow: '../../shared/decks/cardbacks/v1/pivot.webp',
            brown: '../../shared/decks/cardbacks/v1/c2.webp',
            purple: '../../shared/decks/cardbacks/v1/persist.webp',
            grey: '../../shared/decks/cardbacks/v1/inject.webp',
            green: '',
            logo: ''
        };
        Utils.downloadFile(JSON.stringify(deck, null, 2), 'custom-cards.json', 'application/json');
        this.setStatus('Deck exported', 'ok');
    },

    async importDeck(file) {
        this.setStatus('Importing…');
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
            if (!list.length) throw new Error('No cards found in that file');

            let imported = 0;
            for (const raw of list) {
                const payload = {
                    name: raw.name,
                    type: raw.type,
                    description: raw.description || '',
                    // Keep only images this server can serve; drop foreign paths.
                    image: /^\.\.\/data\//.test(String(raw.image || '')) ? raw.image : '',
                    resources: Array.isArray(raw.resources) ? raw.resources : [],
                    detection: raw.detection || [],
                    tools: raw.tools || [],
                    artwork: raw.artwork || 'illustration',
                    style: raw.style || 'app',
                    enabled: raw.enabled !== false
                };
                if (!payload.name || !payload.type) continue;
                await CustomCardIO.create(payload);
                imported += 1;
            }
            this.setStatus(`Imported ${imported} card${imported === 1 ? '' : 's'}`, 'ok');
            await this.load();
        } catch (e) {
            this.setStatus('Import failed: ' + e.message, 'err');
        }
    },

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read image data'));
            reader.readAsDataURL(blob);
        });
    },

    setStatus(message, kind) {
        const el = this.el['cc-lib-status'];
        if (!el) return;
        el.textContent = message || '';
        el.classList.remove('ok', 'err');
        if (kind) el.classList.add(kind);
    }
};

document.addEventListener('DOMContentLoaded', () => CustomCardsLibrary.init());
