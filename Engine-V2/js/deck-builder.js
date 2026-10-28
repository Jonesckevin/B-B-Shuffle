/**
 * B&B Shuffle – Deck Builder
 * ---------------------------------------------------------------------------
 * Assemble a deck card by card from the published catalogue, keep it in this
 * browser, export/import it as JSON and measure how well the chosen procedures
 * cover the chosen scenarios.
 *
 * The catalogue (docs/card-details.json) is the only source that carries the
 * DETECTION list read off every scenario card, and it ships with both the app
 * and the static site - so this page needs no API and works the same in both.
 *
 * Rules (agreed with the project owner):
 *   - at least MIN_PER_TYPE cards of every type except consultant
 *   - at most MAX_TOTAL cards in the deck
 *   - a card is either in the deck or not; clicking a selected card removes it
 *
 * Depends on: Utils, CONFIG (both loaded before this file).
 */

const DeckBuilder = {
    STORAGE_KEY: 'bb-built-deck',
    SCHEMA_VERSION: 1,
    MAX_TOTAL: 50,
    MIN_PER_TYPE: 4,
    PAGE_SIZE: 60,

    TYPES: ['initial', 'pivot', 'c2', 'persist', 'procedure', 'inject', 'consultant'],
    // Consultant is optional - a deck can carry none, or as many as it likes.
    REQUIRED: ['initial', 'pivot', 'c2', 'persist', 'procedure', 'inject'],
    SCENARIO_TYPES: ['initial', 'pivot', 'c2', 'persist'],

    LABELS: {
        initial: 'Initial Compromise',
        pivot: 'Pivot & Escalate',
        c2: 'C2 / Exfiltration',
        persist: 'Persistence',
        procedure: 'Procedure',
        inject: 'Inject',
        consultant: 'Consultant'
    },

    // "All decks" lists reprints once. A card that appears in several sets is
    // shown with the art from the first deck named here, so the pool reads as a
    // catalogue of cards rather than of print runs.
    DECK_PREFERENCE: ['core31', 'core', 'core-v3', 'core-v22', 'core-v1', 'core-spanish', 'mega-deck'],

    // State
    el: {},
    catalog: [],        // [{ deck, deckName, card }]
    decks: [],          // [{ key, name, count }] for the source filter
    entries: [],        // selected cards, same shape as catalog entries
    keys: new Set(),    // entryKey() of every selected card
    cardbacks: {},      // type -> card-back URL ('' / missing = automatic)
    title: 'My Deck',
    filter: { deck: 'all', type: 'all', query: '' },
    shown: 60,
    pending: null,                    // scenario waiting for a detector choice
    procedureIndex: new Map(),        // normalised procedure name -> entries
    _saveTimer: null,

    /* ------------------------------------------------------------------ */
    /* Init                                                               */
    /* ------------------------------------------------------------------ */

    async init() {
        this.cacheElements();
        this.bindEvents();
        this.loadLocal();

        try {
            await this.loadCatalog();
        } catch (e) {
            this.setStatus('Could not load the card catalogue – ' + (e.message || e));
            return;
        }

        this.relinkEntries();
        this.buildProcedureIndex();
        this.buildSourceOptions();
        this.renderTypeFilter();
        this.renderAll();
    },

    cacheElements() {
        [
            'db-source', 'db-search', 'db-type-filter', 'db-pool-count',
            'db-pool', 'db-more', 'db-status',
            'db-title', 'db-ready',
            'db-list-scenario', 'db-list-procedure', 'db-list-inject', 'db-list-consultant',
            'db-count-scenario', 'db-count-procedure', 'db-count-inject', 'db-count-consultant',
            'db-state-scenario', 'db-state-procedure', 'db-state-inject', 'db-state-consultant',
            'db-stats', 'db-backs',
            'db-play', 'db-export', 'db-import', 'db-clear', 'db-import-input',
            'db-detect-modal', 'db-detect-title', 'db-detect-sub', 'db-detect-list',
            'db-detect-status', 'db-detect-confirm', 'db-detect-cancel', 'db-detect-close'
        ].forEach(id => { this.el[id] = Utils.getElement(id); });
    },

    bindEvents() {
        const e = this.el;

        e['db-search']?.addEventListener('input', () => {
            this.filter.query = e['db-search'].value;
            this.shown = this.PAGE_SIZE;
            this.renderPool();
        });

        e['db-source']?.addEventListener('change', () => {
            this.filter.deck = e['db-source'].value;
            this.shown = this.PAGE_SIZE;
            this.renderPool();
        });

        e['db-type-filter']?.addEventListener('click', ev => {
            const chip = ev.target.closest('[data-type]');
            if (!chip) return;
            this.filter.type = chip.dataset.type;
            this.shown = this.PAGE_SIZE;
            this.renderTypeFilter();
            this.renderPool();
        });

        // Pool cards toggle in and out of the deck.
        e['db-pool']?.addEventListener('click', ev => {
            const tile = ev.target.closest('[data-key]');
            if (tile) this.toggle(tile.dataset.key);
        });

        // Remove buttons live in the four deck-rail lists, not in a wrapper.
        ['db-list-scenario', 'db-list-procedure', 'db-list-inject', 'db-list-consultant'].forEach(id => {
            e[id]?.addEventListener('click', ev => {
                const btn = ev.target.closest('[data-remove]');
                if (btn) this.toggle(btn.dataset.remove);
            });
        });

        e['db-more']?.addEventListener('click', () => {
            this.shown += this.PAGE_SIZE;
            this.renderPool();
        });

        e['db-title']?.addEventListener('input', () => {
            this.title = e['db-title'].value;
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.save(), 300);
        });

        e['db-backs']?.addEventListener('click', ev => {
            const opt = ev.target.closest('[data-back-type]');
            if (!opt) return;
            this.setBack(opt.dataset.backType, opt.dataset.url || '');
        });

        e['db-play']?.addEventListener('click', () => this.play());
        e['db-export']?.addEventListener('click', () => this.exportJson());
        e['db-import']?.addEventListener('click', () => e['db-import-input']?.click());
        e['db-import-input']?.addEventListener('change', ev => {
            const file = ev.target.files && ev.target.files[0];
            if (file) this.importFile(file);
            ev.target.value = '';
        });
        e['db-clear']?.addEventListener('click', () => this.clear());

        // Detection picker
        e['db-detect-list']?.addEventListener('change', () => this.updateDetectConfirm());
        e['db-detect-confirm']?.addEventListener('click', () => this.confirmDetect());
        e['db-detect-cancel']?.addEventListener('click', () => this.closeDetectModal());
        e['db-detect-close']?.addEventListener('click', () => this.closeDetectModal());
        e['db-detect-modal']?.addEventListener('click', ev => {
            if (ev.target === e['db-detect-modal']) this.closeDetectModal();
        });
        document.addEventListener('keydown', ev => {
            if (ev.key === 'Escape' && this.pending) this.closeDetectModal();
        });
    },

    /* ------------------------------------------------------------------ */
    /* Catalogue                                                          */
    /* ------------------------------------------------------------------ */

    async loadCatalog() {
        const json = await Utils.loadJson('../docs/card-details.json');
        const decks = Array.isArray(json && json.decks) ? json.decks : [];

        this.catalog = [];
        this.decks = [];

        decks.forEach(deck => {
            const cards = (deck && deck.cards) || {};
            const name = deck.name || deck.deck;
            let count = 0;

            this.TYPES.forEach(type => {
                (cards[type] || []).forEach(card => {
                    if (!card || !card.type) return;
                    // A few catalogue names carry padding whitespace; trim once so
                    // sorting, display and DETECTION matching all agree.
                    card.name = String(card.name || '').trim();
                    this.catalog.push({ deck: deck.deck, deckName: name, card });
                    count++;
                });
            });

            if (count) this.decks.push({ key: deck.deck, name, count });
        });

        this.decks.sort((a, b) => a.name.localeCompare(b.name));
        this.assignKeys();
    },

    /**
     * Give every catalog entry a key that is unique on its own.
     *
     * Card ids repeat inside a deck (mega-deck reuses ids 052-059 for whole
     * blocks of scenario cards), so a "deck:type:id" key marked every card that
     * shared an id as selected - the pool highlighted them but they were never
     * added. The card name disambiguates those, and the occurrence counter
     * disambiguates the few rows that are byte-for-byte duplicates.
     */
    assignKeys() {
        const seen = new Map();
        this.catalog.forEach(entry => {
            const base = this.baseKey(entry);
            const count = (seen.get(base) || 0) + 1;
            seen.set(base, count);
            entry.key = count === 1 ? base : `${base}#${count}`;
        });
    },

    /** Re-attach saved entries to their catalogue record (keeps DETECTION fresh). */
    relinkEntries() {
        if (!this.entries.length || !this.catalog.length) return;
        // Accept the pre-name key format as well, so a deck saved by an older
        // build re-links to its catalogue cards instead of listing duplicates.
        const index = new Map();
        this.catalog.forEach(entry => {
            if (!index.has(this.legacyKey(entry))) index.set(this.legacyKey(entry), entry);
            index.set(this.entryKey(entry), entry);
        });
        this.entries = this.entries.map(entry => index.get(this.entryKey(entry)) || index.get(this.legacyKey(entry)) || entry);
    },

    entryKey(entry) {
        return (entry && entry.key) || this.baseKey(entry);
    },

    /** deck:type:id:name - unique except for exact duplicate rows. */
    baseKey(entry) {
        const card = entry && entry.card;
        return [entry && entry.deck, card && card.type, card && card.id, this.norm(card && card.name)].join(':');
    },

    /** deck:type:id - the format older exports stored in builtWith.refs. */
    legacyKey(entry) {
        const card = entry && entry.card;
        return [entry && entry.deck, card && card.type, card && card.id].join(':');
    },

    ids(type) {
        return this.TYPES.indexOf(type) >= 0 ? this.TYPES.indexOf(type) : 99;
    },

    /* ------------------------------------------------------------------ */
    /* Selection                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Add or remove a card.
     *
     * A scenario card that no selected procedure detects would be dead weight -
     * the board could never reveal it - so it opens the picker instead of going
     * straight in. Once a detecting procedure is in the deck, further copies of
     * that scenario are added directly.
     */
    toggle(key) {
        const index = this.entries.findIndex(entry => this.entryKey(entry) === key);

        if (index >= 0) {
            this.entries.splice(index, 1);
            this.commit();
            return;
        }

        if (this.entries.length >= this.MAX_TOTAL) {
            Utils.showToast(`A deck holds at most ${this.MAX_TOTAL} cards`, 'warning');
            return;
        }

        const entry = this.catalog.find(item => this.entryKey(item) === key);
        if (!entry) return;

        if (this.SCENARIO_TYPES.includes(entry.card.type) && !this.isCovered(entry.card)) {
            this.openDetectModal(entry);
            return;
        }

        this.entries.push(entry);
        this.commit();
    },

    /** Names of the procedures currently in the deck, lower-cased. */
    selectedProcedureNames() {
        const names = new Set();
        this.entries.forEach(entry => {
            if (entry.card.type === 'procedure') names.add(this.norm(entry.card.name));
        });
        return names;
    },

    /** Is at least one of the card's detecting procedures already in the deck? */
    isCovered(card) {
        const names = this.selectedProcedureNames();
        return (card.detection || []).some(name => names.has(this.detectionTarget(name)));
    },

    /** Selected scenarios that none of the selected procedures detects. */
    uncoveredScenarios() {
        const names = this.selectedProcedureNames();
        return this.entries.filter(entry => {
            if (!this.SCENARIO_TYPES.includes(entry.card.type)) return false;
            const detection = entry.card.detection || [];
            if (!detection.length) return false;
            return !detection.some(name => names.has(this.detectionTarget(name)));
        });
    },

    setBack(type, url) {
        if (!this.TYPES.includes(type)) return;
        if (url) this.cardbacks[type] = url;
        else delete this.cardbacks[type];
        this.commit();
        this.renderBacks();
    },

    clear() {
        if (!this.entries.length) return;
        const ok = window.confirm('Start a new deck? The saved deck in this browser will be replaced.');
        if (!ok) return;
        this.entries = [];
        this.title = 'My Deck';
        this.cardbacks = {};
        if (this.el['db-title']) this.el['db-title'].value = this.title;
        this.commit();
        this.renderBacks();
        Utils.showToast('Deck cleared', 'info');
    },

    /** Persist + repaint everything that depends on the selection. */
    commit() {
        this.save();
        this.renderSections();
        this.renderSummaries();
        this.renderStats();
        this.syncPoolSelection();
    },

    /* ------------------------------------------------------------------ */
    /* Counts, rules                                                      */
    /* ------------------------------------------------------------------ */

    counts() {
        const counts = {};
        this.TYPES.forEach(type => { counts[type] = 0; });
        this.entries.forEach(entry => {
            const type = entry.card.type;
            if (counts[type] === undefined) counts[type] = 0;
            counts[type] += 1;
        });
        return counts;
    },

    /** Everything that is wrong with the current deck, in plain words. */
    errors() {
        const counts = this.counts();
        const errors = [];

        this.REQUIRED.forEach(type => {
            const have = counts[type] || 0;
            if (have < this.MIN_PER_TYPE) {
                errors.push(`${this.label(type)}: ${have} of ${this.MIN_PER_TYPE} minimum`);
            }
        });

        if (this.entries.length > this.MAX_TOTAL) {
            errors.push(`${this.entries.length} cards – the limit is ${this.MAX_TOTAL}`);
        }

        const uncovered = this.uncoveredScenarios().length;
        if (uncovered) {
            errors.push(`${uncovered} scenario${uncovered === 1 ? '' : 's'} with no detecting procedure`);
        }

        return errors;
    },

    /** The minimum a game needs: one of each scenario slot and a procedure hand. */
    playableErrors() {
        const counts = this.counts();
        const missing = ['initial', 'pivot', 'c2', 'persist', 'procedure'].filter(type => !counts[type]);
        return missing.length ? [`The board needs at least one ${missing.map(t => this.label(t)).join(', ')}`] : [];
    },

    label(type) {
        return (Utils.CARD_TYPE_LABELS && Utils.CARD_TYPE_LABELS[type]) || this.LABELS[type] || type;
    },

    /* ------------------------------------------------------------------ */
    /* Rendering: filters                                                 */
    /* ------------------------------------------------------------------ */

    buildSourceOptions() {
        const select = this.el['db-source'];
        if (!select) return;
        const options = ['<option value="all">All decks</option>'];
        this.decks.forEach(deck => {
            options.push(`<option value="${this.esc(deck.key)}">${this.esc(deck.name)} (${deck.count})</option>`);
        });
        select.innerHTML = options.join('');
        select.value = this.filter.deck;
    },

    renderTypeFilter() {
        const host = this.el['db-type-filter'];
        if (!host) return;
        const counts = this.counts();
        const chips = [`<button type="button" class="db-chip${this.filter.type === 'all' ? ' is-active' : ''}" data-type="all">All</button>`];

        this.TYPES.forEach(type => {
            const active = this.filter.type === type ? ' is-active' : '';
            chips.push(
                `<button type="button" class="db-chip${active}" data-type="${type}" ` +
                `style="--chip-accent:var(--color-${type})">` +
                `<span class="db-dot"></span>${this.esc(this.label(type))}` +
                (counts[type] ? ` <strong>${counts[type]}</strong>` : '') +
                `</button>`
            );
        });

        host.innerHTML = chips.join('');
    },

    /* ------------------------------------------------------------------ */
    /* Rendering: card pool                                               */
    /* ------------------------------------------------------------------ */

    poolEntries() {
        const query = this.filter.query.trim().toLowerCase();

        const matched = this.catalog.filter(entry => {
            if (this.filter.deck !== 'all' && entry.deck !== this.filter.deck) return false;
            if (this.filter.type !== 'all' && entry.card.type !== this.filter.type) return false;
            if (!query) return true;
            const haystack = `${entry.card.name} ${(entry.card.tools || []).join(' ')}`.toLowerCase();
            return haystack.includes(query);
        });

        // One tile per card when browsing every deck, resolved in preference
        // order so a reprint does not show up three times.
        const unique = [];
        if (this.filter.deck !== 'all') {
            unique.push(...matched);
        } else {
            const rank = key => {
                const index = this.DECK_PREFERENCE.indexOf(key);
                return index >= 0 ? index : this.DECK_PREFERENCE.length;
            };
            const seen = new Set();
            matched
                .slice()
                .sort((a, b) => rank(a.deck) - rank(b.deck))
                .forEach(entry => {
                    const key = `${entry.card.type}|${this.norm(entry.card.name)}`;
                    if (seen.has(key)) return;
                    seen.add(key);
                    unique.push(entry);
                });
        }

        return unique.sort((a, b) => {
            const byType = this.ids(a.card.type) - this.ids(b.card.type);
            return byType || String(a.card.name).localeCompare(String(b.card.name));
        });
    },

    renderPool() {
        const host = this.el['db-pool'];
        if (!host) return;

        const entries = this.poolEntries();
        const slice = entries.slice(0, this.shown);

        host.innerHTML = slice.length
            ? slice.map(entry => this.cardTile(entry)).join('')
            : '<p class="db-empty">No cards match those filters.</p>';

        if (this.el['db-pool-count']) {
            this.el['db-pool-count'].textContent =
                `${entries.length} card${entries.length === 1 ? '' : 's'}`;
        }

        this.el['db-more']?.classList.toggle('hidden', entries.length <= this.shown);
        this.syncPoolSelection();
    },

    cardTile(entry) {
        const key = this.entryKey(entry);
        const card = entry.card;
        const inDeck = this.keys.has(key) ? ' is-in' : '';

        return `<button type="button" class="db-card${inDeck}" data-key="${this.esc(key)}" title="${this.esc(card.name || '')}">` +
            `<span class="db-card-art"><img loading="lazy" decoding="async" src="${this.esc(this.imageSrc(card))}" alt=""></span>` +
            `<span class="db-card-name">${this.esc(card.name || 'Untitled')}</span>` +
            `<span class="db-card-meta">${this.esc(entry.deckName)} · ${this.esc(card.id || '')}</span>` +
            `<span class="db-card-tick" aria-hidden="true">&#10003;</span>` +
            `</button>`;
    },

    /** Repaint just the "already in the deck" ticks, without rebuilding the grid. */
    syncPoolSelection() {
        this.keys = new Set(this.entries.map(entry => this.entryKey(entry)));
        this.el['db-pool']?.querySelectorAll('[data-key]').forEach(tile => {
            tile.classList.toggle('is-in', this.keys.has(tile.dataset.key));
        });
    },

    /* ------------------------------------------------------------------ */
    /* Rendering: deck rail                                               */
    /* ------------------------------------------------------------------ */

    renderAll() {
        if (this.el['db-title']) this.el['db-title'].value = this.title;
        this.renderPool();
        this.renderSections();
        this.renderSummaries();
        this.renderStats();
        this.renderBacks();
    },

    /** One card row in the deck rail. */
    deckRow(entry) {
        const key = this.esc(this.entryKey(entry));
        const name = this.esc(entry.card.name || 'Untitled');
        return `<div class="db-row">` +
            `<span class="db-row-name" title="${name}">${name}</span>` +
            `<span class="db-row-deck">${this.esc(entry.deckName || '')}</span>` +
            `<button type="button" class="db-row-remove" data-remove="${key}" title="Remove" aria-label="Remove ${name}">&times;</button>` +
            `</div>`;
    },

    /** Cards of one type, alphabetical. */
    sorted(type) {
        return this.entries
            .filter(entry => entry.card.type === type)
            .sort((a, b) => String(a.card.name).localeCompare(String(b.card.name)));
    },

    /**
     * Repaint the deck rail.
     *
     * Scenario is grouped into its four categories so a deck reads the way a
     * printed one does; every other type is one flat list. Each section is a
     * <details>, so the rail stays short until the user opens what they care
     * about.
     */
    renderSections() {
        this.keys = new Set(this.entries.map(entry => this.entryKey(entry)));

        const scenarioHost = this.el['db-list-scenario'];
        if (scenarioHost) {
            scenarioHost.innerHTML = this.SCENARIO_TYPES.map(type => {
                const items = this.sorted(type);
                const ok = items.length >= this.MIN_PER_TYPE;
                return `<div class="db-cat">` +
                    `<div class="db-cat-head" style="--chip-accent:var(--color-${type})">` +
                    `<span class="db-dot"></span>` +
                    `<span class="db-cat-name">${this.esc(this.label(type))}</span>` +
                    `<span class="db-cat-count ${ok ? 'is-ok' : 'is-short'}">${items.length}/${this.MIN_PER_TYPE}</span>` +
                    `</div>` +
                    (items.length ? items.map(entry => this.deckRow(entry)).join('') : '<p class="db-cat-empty">None yet</p>') +
                    `</div>`;
            }).join('');
        }

        ['procedure', 'inject', 'consultant'].forEach(type => {
            const host = this.el['db-list-' + type];
            if (!host) return;
            const items = this.sorted(type);
            host.innerHTML = items.length
                ? items.map(entry => this.deckRow(entry)).join('')
                : '<p class="db-cat-empty">None yet</p>';
        });
    },

    /** Section headers: counts, shortfall state and the readiness badge. */
    renderSummaries() {
        const counts = this.counts();
        const setCount = (id, value) => { const el = this.el[id]; if (el) el.textContent = value; };
        const setState = (id, ok, label) => {
            const el = this.el[id];
            if (!el) return;
            el.textContent = ok ? '\u2713' : label;
            el.classList.toggle('is-ok', !!ok);
        };

        const scenarioTotal = this.SCENARIO_TYPES.reduce((sum, type) => sum + (counts[type] || 0), 0);
        const shortScenarios = this.SCENARIO_TYPES.filter(type => (counts[type] || 0) < this.MIN_PER_TYPE).length;
        setCount('db-count-scenario', `${scenarioTotal}`);
        setState('db-state-scenario', shortScenarios === 0, `${shortScenarios} short`);

        ['procedure', 'inject'].forEach(type => {
            const have = counts[type] || 0;
            setCount('db-count-' + type, `${have}/${this.MIN_PER_TYPE}`);
            setState('db-state-' + type, have >= this.MIN_PER_TYPE, `needs ${this.MIN_PER_TYPE - have}`);
        });

        const consultants = counts.consultant || 0;
        setCount('db-count-consultant', `${consultants}`);
        setState('db-state-consultant', consultants > 0, '');

        const total = this.entries.length;
        const badge = this.el['db-ready'];
        if (!badge) return;

        const errors = this.errors();
        const ready = errors.length === 0;
        badge.className = 'db-ready ' + (ready ? 'is-ready' : 'is-short');
        badge.textContent = ready
            ? `Ready to play – ${total}/${this.MAX_TOTAL} cards`
            : `${errors.length} requirement${errors.length === 1 ? '' : 's'} outstanding`;
        badge.title = errors.concat(`Deck total: ${total}/${this.MAX_TOTAL}`).join('\n');
    },

    /* ------------------------------------------------------------------ */
    /* Statistics                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Which selected procedures can detect each selected scenario.
     *
     * Scenario cards carry the DETECTION list printed on the card face (the
     * catalogue compiles it from docs/card-detection.json). A procedure counts
     * only when it is in this deck, so the numbers describe the deck being
     * built rather than the whole game.
     */
    detectionRows() {
        const procedures = this.entries.filter(entry => entry.card.type === 'procedure');
        const procedureNames = new Map(procedures.map(entry => [this.norm(entry.card.name), entry.card.name]));
        const scenarios = this.entries.filter(entry => this.SCENARIO_TYPES.includes(entry.card.type));

        const rows = scenarios.map(entry => {
            const detection = Array.isArray(entry.card.detection) ? entry.card.detection : [];
            const hits = detection.filter(name => procedureNames.has(this.norm(name)));
            return {
                name: entry.card.name,
                type: entry.card.type,
                deck: entry.deckName,
                hits: hits.length,
                total: procedureNames.size,
                covered: hits.length > 0
            };
        }).sort((a, b) => (a.hits - b.hits) || String(a.name).localeCompare(String(b.name)));

        const detectors = procedures.map(entry => {
            const name = this.norm(entry.card.name);
            const covers = scenarios.filter(scenario =>
                (scenario.card.detection || []).some(detected => this.norm(detected) === name)
            ).length;
            return { name: entry.card.name, covers };
        }).filter(row => row.covers > 0).sort((a, b) => b.covers - a.covers).slice(0, 3);

        return { rows, detectors, procedureTotal: procedureNames.size, scenarioTotal: scenarios.length };
    },

    renderStats() {
        const host = this.el['db-stats'];
        if (!host) return;

        const { rows, detectors, procedureTotal, scenarioTotal } = this.detectionRows();
        const blocks = [];

        if (!scenarioTotal) {
            blocks.push('<p class="db-stat-summary">Add scenario cards to measure detection coverage.</p>');
        } else if (!procedureTotal) {
            blocks.push('<p class="db-stat-summary">Add procedures to see which ones detect these scenarios.</p>');
        } else {
            const covered = rows.filter(row => row.covered).length;
            const sum = rows.reduce((acc, row) => acc + row.hits, 0);
            const average = (sum / rows.length).toFixed(1);

            blocks.push(
                '<div class="db-stat-block">' +
                '<h3 class="db-stat-title">Detection coverage</h3>' +
                `<p class="db-stat-summary">${covered} of ${rows.length} scenarios are detected by at least one of your ` +
                `${procedureTotal} procedures · average ${average} of ${procedureTotal}.</p>` +
                '<div class="db-coverage">' +
                rows.map(row => {
                    const pct = procedureTotal ? Math.round((row.hits / procedureTotal) * 100) : 0;
                    return `<div class="db-cover-row${row.covered ? '' : ' is-none'}" title="${this.esc(row.hits + ' of ' + row.total + ' procedures')}">` +
                        `<span class="db-cover-name">${this.esc(row.name)} <span class="db-tag-type">${this.esc(this.label(row.type))}</span></span>` +
                        `<span class="db-cover-value">${row.hits}/${row.total}</span>` +
                        `<span class="db-cover-bar"><span class="db-cover-fill" style="width:${pct}%"></span></span>` +
                        `</div>`;
                }).join('') +
                '</div></div>'
            );
        }

        if (detectors.length) {
            blocks.push(
                '<div class="db-stat-block">' +
                '<h3 class="db-stat-title">Best detectors</h3>' +
                '<div class="db-coverage">' +
                detectors.map(row =>
                    `<div class="db-cover-row">` +
                    `<span class="db-cover-name">${this.esc(row.name)}</span>` +
                    `<span class="db-cover-value">${row.covers}/${scenarioTotal}</span>` +
                    `</div>`
                ).join('') +
                '</div></div>'
            );
        }

        blocks.push(
            '<div class="db-stat-block">' +
            '<h3 class="db-stat-title">Card mix</h3>' +
            `<p class="db-stat-summary">${this.entries.length} cards · ` +
            this.SCENARIO_TYPES
                .map(type => `${this.counts()[type] || 0} ${this.label(type).split(' ')[0].toLowerCase()}`)
                .join(' · ') +
            ` · ${this.entries.filter(entry => entry.card.type === 'procedure').length} procedures · ` +
            `${this.entries.filter(entry => entry.card.type === 'inject').length} injects · ` +
            `${this.entries.filter(entry => entry.card.type === 'consultant').length} consultants.</p>` +
            '</div>'
        );

        host.innerHTML = blocks.join('');
    },

    norm(value) {
        return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    },

    /* ------------------------------------------------------------------ */
    /* Detection picker                                                   */
    /* ------------------------------------------------------------------ */

    /** Normalised procedure name -> catalogue entries, in deck-preference order. */
    buildProcedureIndex() {
        const rank = key => {
            const index = this.DECK_PREFERENCE.indexOf(key);
            return index >= 0 ? index : this.DECK_PREFERENCE.length;
        };

        this.procedureIndex = new Map();
        this.catalog
            .filter(entry => entry.card.type === 'procedure')
            .slice()
            .sort((a, b) => rank(a.deck) - rank(b.deck))
            .forEach(entry => {
                const key = this.norm(entry.card.name);
                if (!this.procedureIndex.has(key)) this.procedureIndex.set(key, []);
                this.procedureIndex.get(key).push(entry);
            });

        // Scenario DETECTION text is printed shorthand, so record which procedure
        // each phrase actually resolves to. Coverage checks follow these aliases,
        // otherwise picking the fuller card name leaves the scenario "uncovered".
        this.detectionAliases = new Map();
        this.catalog.forEach(item => {
            if (!this.SCENARIO_TYPES.includes(item.card.type)) return;
            (item.card.detection || []).forEach(name => {
                const key = this.norm(name);
                if (!key || this.detectionAliases.has(key)) return;
                const exact = this.procedureIndex.get(key) || [];
                const resolved = exact[0] || this.fuzzyProcedures(name)[0];
                if (resolved) this.detectionAliases.set(key, this.norm(resolved.card.name));
            });
        });
    },

    /** The procedure a DETECTION phrase stands for, as a normalised name. */
    detectionTarget(name) {
        const key = this.norm(name);
        return (this.detectionAliases && this.detectionAliases.get(key)) || key;
    },

    /**
     * The scenario's DETECTION list resolved against the catalogue.
     *
     * Cards print shorthand for some procedures - "NetFlow, Zeek/Bro, RITA
     * Analysis" is the card "NetFlow,Zeek/Bro,Real Intelligence Threat Analytics
     * (RITA) Analysis" - so an exact name match is tried first and a word-level
     * containment match second.
     * @returns {Array<{label: string, entry: Object|null, inDeck: boolean, fuzzy: boolean}>}
     */
    detectOptions(card) {
        const seen = new Set();
        const options = [];

        (card.detection || []).forEach(name => {
            const key = this.norm(name);
            if (!key || seen.has(key)) return;
            seen.add(key);

            const exact = this.procedureIndex.get(key) || [];
            const entries = exact.length ? exact : this.fuzzyProcedures(name);

            options.push({
                label: String(name).trim(),
                entry: entries[0] || null,
                inDeck: entries.some(entry => this.keys.has(this.entryKey(entry))),
                fuzzy: !exact.length && entries.length > 0
            });
        });

        return options;
    },

    /** Meaningful words of a card or detection phrase. */
    tokens(value) {
        const glue = ['and', 'the', 'of', 'with', 'for', 'to', 'a', 'an'];
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(' ')
            .filter(token => token.length > 1 && glue.indexOf(token) === -1);
    },

    /**
     * Procedures whose name is the same phrase in a fuller (or shorter) form.
     * The shorter name must have at least two words and be fully contained in
     * the longer one, and the most specific candidate wins.
     */
    fuzzyProcedures(name) {
        const wanted = this.tokens(name);
        if (wanted.length < 2) return [];

        const matches = [];
        this.catalog.forEach(entry => {
            if (entry.card.type !== 'procedure') return;

            const have = this.tokens(entry.card.name);
            if (!have.length) return;

            const contained = wanted.every(token => have.indexOf(token) !== -1);
            const reverse = have.length >= 2 && have.every(token => wanted.indexOf(token) !== -1);
            if (!contained && !reverse) return;

            matches.push({ entry, size: have.length });
        });

        return matches.sort((a, b) => a.size - b.size).map(match => match.entry);
    },

    openDetectModal(entry) {
        const modal = this.el['db-detect-modal'];
        const host = this.el['db-detect-list'];
        if (!modal || !host) return;

        this.pending = entry;
        const options = this.detectOptions(entry.card);
        const usable = options.filter(option => option.entry && !option.inDeck);
        const cards = options.filter(option => option.entry).length;

        if (this.el['db-detect-title']) this.el['db-detect-title'].textContent = entry.card.name || 'Scenario';
        if (this.el['db-detect-sub']) {
            const notes = options.length - cards;
            this.el['db-detect-sub'].textContent =
                `${this.label(entry.card.type)} · ${cards} procedure card${cards === 1 ? '' : 's'} detected` +
                (notes ? `, ${notes} printed note${notes === 1 ? '' : 's'}` : '');
        }

        host.innerHTML = options.length
            ? options.map(option => {
                if (!option.entry) {
                    return `<label class="db-detect-opt is-missing" title="Printed on the card, but no procedure card matches it">` +
                        `<input type="checkbox" disabled>` +
                        `<span></span>` +
                        `<span class="db-detect-name">${this.esc(option.label)}</span>` +
                        `<span class="db-detect-tag">note, no card</span>` +
                        `</label>`;
                }
                const key = this.esc(this.entryKey(option.entry));
                const tag = option.inDeck
                    ? 'in deck'
                    : (option.fuzzy ? '\u2248 ' : '') + this.esc(option.entry.deckName || '');
                return `<label class="db-detect-opt${option.inDeck ? ' is-in' : ''}" title="Adds ${this.esc(option.entry.card.name)}">` +
                    `<input type="checkbox" value="${key}"${option.inDeck ? ' checked disabled' : ''}>` +
                    `<img src="${this.esc(this.imageSrc(option.entry.card))}" alt="" loading="lazy" decoding="async">` +
                    `<span class="db-detect-name">${this.esc(option.label)}</span>` +
                    `<span class="db-detect-tag">${tag}</span>` +
                    `</label>`;
            }).join('')
            : '<p class="db-cat-empty">This card has no recorded detection list.</p>';

        const confirm = this.el['db-detect-confirm'];
        if (confirm) {
            confirm.disabled = usable.length > 0;   // nothing picked yet
            confirm.textContent = usable.length ? 'Add scenario + procedures' : 'Add without a detector';
        }
        if (this.el['db-detect-status']) {
            this.el['db-detect-status'].textContent = usable.length
                ? 'Pick at least one procedure.'
                : 'This card names no procedure card in its DETECTION list.';
        }

        modal.hidden = false;
        document.body.classList.add('db-modal-open');

        const first = host.querySelector('input:not([disabled])');
        if (first) setTimeout(() => first.focus(), 30);
    },

    updateDetectConfirm() {
        const host = this.el['db-detect-list'];
        const confirm = this.el['db-detect-confirm'];
        const status = this.el['db-detect-status'];
        if (!host || !confirm) return;

        const picks = host.querySelectorAll('input:checked:not([disabled])').length;
        const usable = host.querySelectorAll('input:not([disabled])').length;

        confirm.disabled = usable > 0 && picks === 0;
        confirm.textContent = picks
            ? `Add scenario + ${picks} procedure${picks === 1 ? '' : 's'}`
            : (usable ? 'Add scenario + procedures' : 'Add without a detector');

        if (status) {
            status.textContent = usable
                ? (picks ? `${picks} selected` : 'Pick at least one procedure.')
                : 'This card names no procedure card in its DETECTION list.';
        }
    },

    closeDetectModal() {
        const modal = this.el['db-detect-modal'];
        if (modal) modal.hidden = true;
        document.body.classList.remove('db-modal-open');
        this.pending = null;
    },

    confirmDetect() {
        const entry = this.pending;
        const host = this.el['db-detect-list'];
        if (!entry || !host) return;

        const keys = [...host.querySelectorAll('input:checked:not([disabled])')].map(input => input.value);
        const usable = host.querySelectorAll('input:not([disabled])').length;
        if (usable > 0 && !keys.length) {
            if (this.el['db-detect-status']) this.el['db-detect-status'].textContent = 'Pick at least one procedure first.';
            return;
        }

        const additions = [entry];
        keys.forEach(key => {
            const match = this.catalog.find(item => this.entryKey(item) === key);
            if (match) additions.push(match);
        });

        const skipped = [];
        additions.forEach(item => {
            if (this.entries.some(existing => this.entryKey(existing) === this.entryKey(item))) return;
            if (this.entries.length >= this.MAX_TOTAL) {
                skipped.push(item.card.name);
                return;
            }
            this.entries.push(item);
        });

        this.closeDetectModal();
        this.commit();

        if (skipped.length) {
            Utils.showToast(`Deck is full – ${skipped.length} card${skipped.length === 1 ? '' : 's'} not added`, 'warning');
        }
    },

    /* ------------------------------------------------------------------ */
    /* Card backs                                                         */
    /* ------------------------------------------------------------------ */

    renderBacks() {
        const host = this.el['db-backs'];
        if (!host) return;

        const sets = (typeof CONFIG !== 'undefined' && CONFIG.cardbackSets) || {};

        host.innerHTML = this.TYPES.map(type => {
            const chosen = this.cardbacks[type] || '';
            const options = [
                `<button type="button" class="db-back-opt is-auto${chosen ? '' : ' is-active'}" ` +
                `data-back-type="${type}" data-url="" title="Automatic (follows the deck)">Auto</button>`
            ];

            ['v1', 'v2'].forEach(set => {
                const url = sets[set] && sets[set][type];
                if (!url) return;
                const active = chosen === url ? ' is-active' : '';
                options.push(
                    `<button type="button" class="db-back-opt${active}" data-back-type="${type}" ` +
                    `data-url="${this.esc(url)}" title="${set.toUpperCase()} back">` +
                    `<img src="${this.esc(url)}" alt="" loading="lazy" decoding="async">` +
                    `</button>`
                );
            });

            return `<div class="db-back-row">` +
                `<span class="db-back-label">${this.esc(this.label(type))}</span>` +
                `<span class="db-back-options">${options.join('')}</span>` +
                `</div>`;
        }).join('');
    },

    /* ------------------------------------------------------------------ */
    /* Persistence                                                        */
    /* ------------------------------------------------------------------ */

    save() {
        const payload = {
            version: this.SCHEMA_VERSION,
            title: this.title,
            updatedAt: new Date().toISOString(),
            cardbacks: { ...this.cardbacks },
            cards: this.entries.map(entry => ({ deck: entry.deck, deckName: entry.deckName, card: entry.card }))
        };

        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
            return true;
        } catch (e) {
            Utils.showToast('Could not save the deck in this browser (storage is full)', 'error');
            return false;
        }
    },

    loadLocal() {
        let raw = null;
        try {
            raw = localStorage.getItem(this.STORAGE_KEY);
        } catch (e) {
            return;
        }
        if (!raw) return;

        try {
            const data = JSON.parse(raw);
            this.title = String(data.title || 'My Deck');
            this.cardbacks = (data.cardbacks && typeof data.cardbacks === 'object') ? { ...data.cardbacks } : {};
            this.entries = (Array.isArray(data.cards) ? data.cards : [])
                .filter(entry => entry && entry.card && entry.card.type)
                .map(entry => ({
                    deck: entry.deck || '',
                    deckName: entry.deckName || entry.deck || '',
                    card: entry.card
                }));
        } catch (e) {
            // A corrupt entry is not worth crashing the page for - start clean.
            this.entries = [];
        }
    },

    /* ------------------------------------------------------------------ */
    /* Import / export                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * A `carddb.json`-shaped deck, so the export can also be dropped into
     * shared/decks/<name>/ as a real deck. The colour keys carry the card backs
     * (Engine-V1 reads them); `cardbacks` adds Procedure and Consultant, which
     * the colour scheme has no slot for.
     */
    toCarddb() {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const backs = this.cardbacks;

        return {
            title: this.title || 'Custom Deck',
            revdate: `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}`,
            link: '',
            data: this.entries.map(entry => this.cardOut(entry.card)),
            red: backs.initial || '',
            yellow: backs.pivot || '',
            brown: backs.c2 || '',
            purple: backs.persist || '',
            grey: backs.inject || '',
            green: '',
            logo: '',
            cardbacks: { ...backs },
            builtWith: {
                app: 'B&B Shuffle Deck Builder',
                version: this.SCHEMA_VERSION,
                updatedAt: now.toISOString(),
                // Exact catalogue references so a round-trip keeps the deck art
                // and the DETECTION lists; plain carddb files fall back to a
                // name/id match on import.
                refs: this.entries.map(entry => this.entryKey(entry))
            }
        };
    },

    cardOut(card) {
        const out = {
            id: card.id || '',
            name: card.name || 'Untitled',
            type: card.type
        };
        // Deck art is published relative to shared/; a carddb.json addresses it
        // from an app page ("../../shared/..."), so normalise every stored form
        // before writing it out.
        if (card.image) {
            const image = String(card.image);
            out.image = /^(https?:|data:|blob:)/i.test(image)
                ? image
                : '../../shared/' + image.replace(/^(?:\.\.\/)+/, '').replace(/^shared\//, '');
        }
        if (card.description) out.description = card.description;
        if (Array.isArray(card.details) && card.details.length) out.details = this.detailsHtml(card.details);
        else if (typeof card.details === 'string' && card.details) out.details = card.details;
        if (Array.isArray(card.tools) && card.tools.length) out.tools = card.tools.slice();
        if (Array.isArray(card.detection) && card.detection.length) out.detection = card.detection.slice();
        if (card.notes) out.notes = card.notes;
        if (Array.isArray(card.specialties) && card.specialties.length) out.specialties = card.specialties.slice();
        if (card.quote) out.quote = card.quote;
        if (card.cost) out.cost = card.cost;
        return out;
    },

    detailsHtml(details) {
        return details.map(item => {
            const text = this.esc(item.text || item.url || '');
            const url = item.url ? this.esc(item.url) : '';
            return url ? `<li><a target="_blank" href="${url}">${text}</a></li>` : `<li>${text}</li>`;
        }).join('');
    },

    exportJson() {
        if (!this.entries.length) {
            Utils.showToast('The deck is empty', 'error');
            return;
        }
        const slug = String(this.title || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
        Utils.downloadFile(JSON.stringify(this.toCarddb(), null, 2), `bb-deck-${slug}.json`);
        Utils.showToast('Deck exported', 'success');
    },

    async importFile(file) {
        let data;
        try {
            data = JSON.parse(await file.text());
        } catch (e) {
            Utils.showToast('That file is not valid JSON', 'error');
            return;
        }
        this.applyImport(data);
    },

    applyImport(data) {
        if (!data || typeof data !== 'object') {
            Utils.showToast('That file has no deck in it', 'error');
            return;
        }

        const cards = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
        if (!cards.length) {
            Utils.showToast('That file has no cards in it', 'error');
            return;
        }

        const byKey = new Map();
        this.catalog.forEach(entry => {
            // Older exports reference deck:type:id; keep those resolvable.
            if (!byKey.has(this.legacyKey(entry))) byKey.set(this.legacyKey(entry), entry);
            byKey.set(this.entryKey(entry), entry);
        });
        const imported = [];
        const refs = (data.builtWith && Array.isArray(data.builtWith.refs)) ? data.builtWith.refs : null;

        if (refs) {
            refs.forEach(ref => {
                const hit = byKey.get(ref);
                if (hit && !imported.includes(hit)) imported.push(hit);
            });
        }

        // Then match the payload's own card list: covers a file from another
        // install, a hand-written carddb, and the refs an older export wrote as
        // deck:type:id - those are ambiguous when a deck reuses an id, so the
        // name pass recovers whatever a ref could not identify.
        cards.forEach(card => {
            const type = String(card && card.type || '').toLowerCase();
            if (!this.TYPES.includes(type)) return;
            if (imported.some(entry => entry.card.type === type && entry.card.name === card.name)) return;

            const match = this.catalog.find(entry => entry.card.type === type && entry.card.name === card.name)
                || this.catalog.find(entry => entry.card.type === type && entry.card.id === card.id);

            if (match) {
                if (!imported.includes(match)) imported.push(match);
                return;
            }

            imported.push({
                deck: 'imported',
                deckName: 'Imported',
                card: { ...card, type }
            });
        });

        if (!imported.length) {
            Utils.showToast('No cards from that file are in the catalogue', 'error');
            return;
        }

        this.entries = imported.slice(0, this.MAX_TOTAL);
        this.title = String(data.title || 'Imported Deck');
        this.cardbacks = this.cardbacksFrom(data);
        if (this.el['db-title']) this.el['db-title'].value = this.title;

        this.commit();
        this.renderBacks();
        this.renderTypeFilter();
        Utils.showToast(`Imported ${this.entries.length} cards`, 'success');
    },

    /** Read the backs from our own key, or from a carddb's colour keys. */
    cardbacksFrom(data) {
        if (data.cardbacks && typeof data.cardbacks === 'object') return { ...data.cardbacks };

        const map = { red: 'initial', yellow: 'pivot', brown: 'c2', purple: 'persist', grey: 'inject' };
        const backs = {};
        Object.keys(map).forEach(colour => {
            if (data[colour]) backs[map[colour]] = data[colour];
        });
        return backs;
    },

    /* ------------------------------------------------------------------ */
    /* Play                                                               */
    /* ------------------------------------------------------------------ */

    play() {
        const blocking = this.playableErrors();
        if (blocking.length) {
            Utils.showToast(blocking[0], 'error');
            return;
        }

        const errors = this.errors();
        if (errors.length) {
            Utils.showToast('Dealing what you have – ' + errors.join('; '), 'warning');
        }

        if (!this.save()) return;
        window.location.href = 'player.html?deck=built';
    },

    /* ------------------------------------------------------------------ */
    /* Helpers                                                            */
    /* ------------------------------------------------------------------ */

    imageSrc(card) {
        const image = card && card.image;
        if (!image) {
            return (Utils.cardPlaceholder && Utils.cardPlaceholder('No image')) || '';
        }
        if (/^(https?:|data:|blob:)/i.test(image)) return image;

        // Catalogue art is relative to shared/; imported cards may carry
        // "../shared/..." instead. Reduce both to the shared-relative form.
        const rel = String(image).replace(/^(?:\.\.\/)+/, '').replace(/^shared\//, '');
        return Utils.assetPath('shared/' + rel);
    },

    esc(value) {
        if (Utils.escapeHtml) return Utils.escapeHtml(String(value == null ? '' : value));
        return String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    },

    setStatus(message) {
        if (this.el['db-status']) this.el['db-status'].textContent = message || '';
    }
};

document.addEventListener('DOMContentLoaded', () => DeckBuilder.init());
