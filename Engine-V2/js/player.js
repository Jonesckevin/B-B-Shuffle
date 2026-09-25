/**
 * B&B Shuffle - Player Controller
 * Handles the player game interface
 */

// Human-readable card type labels (used by the CardViewer "Info" tab).
// Canonical definition lives in Utils; this alias keeps existing call sites.
const CARD_TYPE_LABELS = Utils.CARD_TYPE_LABELS;

const PlayerController = {
    // State
    scenario: null,
    revealed: {
        initial: false,
        pivot: false,
        c2: false,
        persist: false,
        inject: false,
        consultant: false
    },
    activeProcIndex: -1,
    injectQueue: [],
    activeInjectIndex: 0,
    consecutiveFails: 0,
    isRolling: false,
    successTarget: 11,
    loadMenuScenarios: [],
    // "Call a Consultant": consultants[] is the pool available in this game's
    // deck, consultant is the one currently sitting on the board.
    consultants: [],
    consultant: null,

    /**
     * Initialize the player interface
     */
    async init() {
        this.bindEvents();
        await this.loadScenario();
    },

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Scenario Editor (opens admin as a popup window, or an in-page overlay fallback)
        Utils.getElement('gm-mode-btn')?.addEventListener('click', () => Utils.openGM());

        // Card flips
        Utils.$$('.flip-card').forEach(card => {
            card.addEventListener('click', () => this.flipCard(card));
        });

        // Right-click a card to flip it back face-down. Delegated so the
        // dynamically rendered procedure / inject cards are covered too.
        document.addEventListener('contextmenu', (e) => {
            if (!(e.target instanceof Element) || e.target.closest('.proc-arm')) return;
            const card = e.target.closest('.flip-card');
            if (!card || !card.closest('.player-main')) return;
            e.preventDefault();
            this.unflipCard(card);
        });

        // Game controls
        Utils.getElement('roll-dice-btn')?.addEventListener('click', () => this.rollDice());
        Utils.getElement('add-strike-btn')?.addEventListener('click', () => this.addStrike());
        Utils.getElement('use-turn-btn')?.addEventListener('click', () => this.useTurn());

        // Inject manual draw
        Utils.getElement('draw-inject-btn')?.addEventListener('click', () => this.advanceInject('manual'));

        // Call a Consultant (rail button + the consultant card itself)
        Utils.getElement('call-consultant-btn')?.addEventListener('click', () => this.openConsultantPicker());
        Utils.getElement('consultant-close-btn')?.addEventListener('click', () => this.closeConsultantPicker());
        Utils.getElement('consultant-cancel-btn')?.addEventListener('click', () => this.closeConsultantPicker());
        Utils.getElement('consultant-clear-btn')?.addEventListener('click', () => this.setConsultant(null));
        Utils.getElement('consultant-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'consultant-modal') this.closeConsultantPicker();
        });
        Utils.getElement('consultant-grid')?.addEventListener('click', (e) => {
            const viewBtn = e.target.closest('.cons-view-btn');
            if (viewBtn) {
                e.stopPropagation();
                this.previewConsultant(this.consultants[parseInt(viewBtn.dataset.index, 10)]);
                return;
            }
            const opt = e.target.closest('.consultant-option');
            if (!opt) return;
            this.chooseConsultant(this.consultants[parseInt(opt.dataset.index, 10)]);
        });

        // Card viewing (flip + big readable preview) is handled by the shared CardViewer
        // overlay (shared/js/card-viewer.js) - see flipCard()/openLightbox() below.

        // Game over
        Utils.getElement('gameover-restart-btn')?.addEventListener('click', () => this.restartGame());

        // Quick Start + Load (header controls)
        Utils.getElement('quick-start-btn')?.addEventListener('click', () => this.openQuickStart());
        Utils.getElement('load-scenario-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleLoadMenu();
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#load-wrap')) this.closeLoadMenu();
        });
        Utils.getElement('load-menu')?.addEventListener('click', (e) => {
            const item = e.target.closest('.load-item');
            if (!item) return;
            const scenario = this.loadMenuScenarios[parseInt(item.dataset.loadIndex, 10)];
            if (scenario) this.startScenario(scenario);
        });

        // Quick Start modal
        Utils.getElement('quickstart-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'quickstart-modal') this.closeQuickStart();
        });
        Utils.getElement('qs-close-btn')?.addEventListener('click', () => this.closeQuickStart());
        Utils.getElement('qs-cancel-btn')?.addEventListener('click', () => this.closeQuickStart());
        Utils.getElement('qs-start-btn')?.addEventListener('click', () => this.startQuickStart());

        // Reveal / hide all scenario cards (GM quick view)
        Utils.getElement('reveal-cards-btn')?.addEventListener('click', () => this.toggleRevealScenario());

        // Reveal / hide all procedure cards (GM quick view of the hand)
        Utils.getElement('reveal-procedures-btn')?.addEventListener('click', () => this.toggleRevealProcedures());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeLoadMenu();
                this.closeQuickStart();
                this.closeLightbox();
                this.closeConsultantPicker();
                if (typeof DiceFX !== 'undefined' && DiceFX.close) DiceFX.close();
            }
            if (e.key === 'r' || e.key === 'R') {
                this.rollDice();
            }
        });

        // Subscribe to game state changes
        GameState.subscribe((change) => this.onGameStateChange(change));
    },

    /**
     * Open the Quick Start deck picker
     */
    openQuickStart() {
        this.populateQuickStartDecks();
        Utils.showElement('quickstart-modal');
    },

    /**
     * Close the Quick Start deck picker
     */
    closeQuickStart() {
        Utils.hideElement('quickstart-modal');
    },

    /**
     * Fill the Quick Start deck <select> with non-expansion decks
     */
    populateQuickStartDecks() {
        const select = Utils.getElement('qs-deck-select');
        if (!select) return;
        const decks = (typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks : {};
        const baseKeys = Object.keys(decks).filter(k => !decks[k].expansion);
        if (!select.dataset.built) {
            select.innerHTML = baseKeys.map(k =>
                `<option value="${k}">${Utils.escapeHtml(decks[k].name || k)}</option>`
            ).join('');
            select.dataset.built = '1';
        }
        const stored = Utils.getFromStorage((CONFIG.storage && CONFIG.storage.preferredDeck) ? CONFIG.storage.preferredDeck : 'bb-shuffle-deck', '');
        const fallback = (CONFIG.defaultDeck && baseKeys.indexOf(CONFIG.defaultDeck) !== -1) ? CONFIG.defaultDeck : baseKeys[0];
        select.value = (stored && baseKeys.indexOf(stored) !== -1) ? stored : fallback;
    },

    /**
     * Run Quick Start: build a random scenario from the chosen deck
     */
    async startQuickStart() {
        const select = Utils.getElement('qs-deck-select');
        const btn = Utils.getElement('qs-start-btn');
        const deckKey = select && select.value;
        if (!deckKey || !btn) return;

        btn.disabled = true;
        btn.textContent = 'Dealing…';
        try {
            const scenario = await this.buildRandomScenario(deckKey);
            if (!scenario) throw new Error('Could not build a scenario from that deck');
            await this.startScenario(scenario);
        } catch (error) {
            console.error('Quick Start failed:', error);
            Utils.showToast(`Quick Start failed: ${error.message || error}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Deal & Start';
        }
    },

    /**
     * Build a random scenario (4 phase cards + procedures + injects) from a deck
     * @param {string} deckKey - Deck key from CONFIG.decks
     * @returns {Promise<Object>} Scenario payload ready for the board
     */
    async buildRandomScenario(deckKey) {
        const cfg = (typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks[deckKey] : null;
        if (!cfg) throw new Error('Unknown deck');

        const json = await Utils.loadJson(cfg.path);
        const data = Array.isArray(json && json.data) ? json.data : [];
        // The four scenario slots come from the canonical list; procedures and
        // injects are always in play (consultants are resolved separately by
        // ensureConsultantsFromDeck).
        const lists = {};
        [...Utils.SCENARIO_TYPES, 'procedure', 'inject'].forEach(type => { lists[type] = []; });
        data.forEach(card => {
            const type = (card.type || '').toLowerCase();
            if (lists[type]) lists[type].push({ ...card, image: Utils.assetPath(card.image) });
        });

        const pack = (c, extra) => {
            const o = {
                id: c && c.id, name: c && c.name, type: c && c.type,
                image: c && c.image, description: (c && c.description) || '',
                details: (c && c.details) || ''
            };
            // Card-face text read off the art (tools / notes / specialties / quote / cost)
            ['tools', 'notes', 'specialties', 'quote', 'cost'].forEach(field => {
                if (c && c[field]) o[field] = c[field];
            });
            return extra ? { ...o, ...extra } : o;
        };

        const scenario = {};
        ['initial', 'pivot', 'c2', 'persist'].forEach(type => {
            const card = Utils.randomItem(lists[type] || []);
            if (card) scenario[type] = pack(card);
        });

        const procCount = (CONFIG.game && CONFIG.game.procedureCount) || 7;
        const enhancedCount = (CONFIG.game && CONFIG.game.enhancedDefault) || 3;
        const procedures = [];
        const procPool = [...(lists.procedure || [])];
        for (let i = 0; i < procCount && procPool.length; i++) {
            const idx = Math.floor(Math.random() * procPool.length);
            procedures.push(pack(procPool.splice(idx, 1)[0], { enhanced: i < enhancedCount }));
        }

        const injects = [];
        const injectPool = [...(lists.inject || [])];
        for (let i = 0; i < 3 && injectPool.length; i++) {
            const idx = Math.floor(Math.random() * injectPool.length);
            injects.push(pack(injectPool.splice(idx, 1)[0]));
        }

        const now = new Date().toISOString();
        return {
            id: this.quickStartId(),
            version: '1.0',
            exportDate: now,
            metadata: { name: `Quick Start — ${cfg.name || deckKey}`, author: 'Quick Start', createdAt: now, modifiedAt: now },
            deck: { key: deckKey, name: cfg.name || deckKey, path: cfg.path },
            scenario,
            procedures,
            injects,
            gameConfig: {
                initialTurns: (CONFIG.game && CONFIG.game.initialTurns) || 10,
                maxStrikes: (CONFIG.game && CONFIG.game.maxStrikes) || 3,
                procedureCount: procCount,
                enhancedCount,
                successTarget: 11
            }
        };
    },

    /**
     * Generate a unique id for a quick-start scenario
     * @returns {string}
     */
    quickStartId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'qs-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    },

    /**
     * If the current scenario has no procedure cards set, randomly deal a fresh
     * hand of procedures from the scenario's deck so a saved game that was
     * published without procedures is still playable on the board.
     * @returns {Promise<number>} Number of procedures dealt (0 when none needed)
     */
    async ensureProceduresFromDeck() {
        try {
            const existing = (this.scenario && this.scenario.procedures) || [];
            if (existing.length) return 0;

            const storageKey = (CONFIG.storage && CONFIG.storage.preferredDeck) ? CONFIG.storage.preferredDeck : 'bb-shuffle-deck';
            const deckKey = (this.scenario && this.scenario.deck && this.scenario.deck.key)
                || Utils.getFromStorage(storageKey, '')
                || (CONFIG.defaultDeck || 'core');
            const cfg = (CONFIG.decks && CONFIG.decks[deckKey]) ? CONFIG.decks[deckKey] : null;
            if (!cfg) return 0;

            const json = await Utils.loadJson(cfg.path);
            const data = Array.isArray(json && json.data) ? json.data : [];
            const pool = data
                .filter(c => c && (c.type || '').toLowerCase() === 'procedure')
                .map(c => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                    image: Utils.assetPath(c.image),
                    description: (c && c.description) || '',
                    details: (c && c.details) || '',
                    tools: (c && c.tools) || undefined,
                    cost: (c && c.cost) || undefined
                }));
            if (!pool.length) return 0;

            if (!this.scenario.gameConfig) this.scenario.gameConfig = {};
            const gameConfig = this.scenario.gameConfig;
            const procCount = gameConfig.procedureCount || (CONFIG.game && CONFIG.game.procedureCount) || 7;
            const enhancedCount = gameConfig.enhancedCount ?? (CONFIG.game && CONFIG.game.enhancedDefault) ?? 3;

            const dealt = [];
            const copy = [...pool];
            for (let i = 0; i < procCount && copy.length; i++) {
                const idx = Math.floor(Math.random() * copy.length);
                dealt.push({ ...copy.splice(idx, 1)[0], enhanced: i < enhancedCount });
            }
            if (!dealt.length) return 0;

            this.scenario.procedures = dealt;
            gameConfig.procedureCount = procCount;
            gameConfig.enhancedCount = enhancedCount;
            Utils.saveToStorage('bb-current-scenario', this.scenario);
            return dealt.length;
        } catch (error) {
            console.error('Auto-dealing procedures failed:', error);
            return 0;
        }
    },

    /**
     * Resolve the consultants available for the current game. Uses an explicit
     * scenario.consultants list when the saved scenario carries one (Scenario
     * Editor / Library), otherwise every consultant in the scenario's deck.
     * @returns {Promise<Array>} Consultant card list
     */
    async ensureConsultantsFromDeck() {
        try {
            const saved = (this.scenario && this.scenario.consultants) || [];
            if (saved.length) {
                this.consultants = saved.map(c => ({ ...c, type: 'consultant', image: Utils.assetPath(c.image) }));
                this.consultant = (this.scenario && this.scenario.consultant) || null;
                return this.consultants;
            }

            const storageKey = (CONFIG.storage && CONFIG.storage.preferredDeck) ? CONFIG.storage.preferredDeck : 'bb-shuffle-deck';
            const deckKey = (this.scenario && this.scenario.deck && this.scenario.deck.key)
                || Utils.getFromStorage(storageKey, '')
                || (CONFIG.defaultDeck || 'core');
            const cfg = (CONFIG.decks && CONFIG.decks[deckKey]) ? CONFIG.decks[deckKey] : null;
            if (!cfg) {
                this.consultants = [];
                this.consultant = null;
                return [];
            }

            const json = await Utils.loadJson(cfg.path);
            const data = Array.isArray(json && json.data) ? json.data : [];
            this.consultants = data
                .filter(c => c && (c.type || '').toLowerCase() === 'consultant')
                .map(c => ({
                    id: c.id,
                    name: c.name,
                    type: 'consultant',
                    image: Utils.assetPath(c.image),
                    description: (c && c.description) || '',
                    details: (c && c.details) || '',
                    specialties: (c && c.specialties) || undefined,
                    quote: (c && c.quote) || undefined
                }));
            this.consultant = (this.scenario && this.scenario.consultant) || null;
            return this.consultants;
        } catch (error) {
            console.error('Loading consultants failed:', error);
            this.consultants = [];
            this.consultant = null;
            return [];
        }
    },

    /**
     * Show the selected consultant on the consultant card (or flip it back down
     * when nobody is consulting) and keep the rail button label in sync.
     */
    renderConsultantCard() {
        const card = Utils.getElement('consultant-card');
        const img = Utils.getElement('consultant-card-img');
        const btn = Utils.getElement('call-consultant-btn');
        const active = this.consultant;

        if (img) {
            img.src = (active && active.image) ? Utils.assetPath(active.image) : Utils.cardPlaceholder('Consultant');
            img.alt = (active && active.name) || 'Consultant';
        }
        if (card) card.classList.toggle('flipped', !!active);
        if (btn) {
            btn.textContent = active ? 'Swap' : 'Call';
            btn.title = active
                ? `Consulting: ${active.name || 'Consultant'} — click to swap`
                : 'Call a consultant from this deck';
        }
    },

    /**
     * Open the consultant picker (every consultant in the active deck)
     */
    openConsultantPicker() {
        if (!Utils.getElement('consultant-modal')) return;
        this.renderConsultantPicker();
        Utils.showElement('consultant-modal');
    },

    /**
     * Close the consultant picker
     */
    closeConsultantPicker() {
        Utils.hideElement('consultant-modal');
    },

    /**
     * Fill the consultant picker with portrait tiles, marking the one on the board
     */
    renderConsultantPicker() {
        const grid = Utils.getElement('consultant-grid');
        const hint = Utils.getElement('consultant-modal-hint');
        const clearBtn = Utils.getElement('consultant-clear-btn');
        if (!grid) return;

        const list = this.consultants || [];
        if (hint) {
            hint.textContent = list.length
                ? `Pick a consultant from ${(this.scenario && this.scenario.deck && this.scenario.deck.name) || 'the active deck'}.`
                : 'This deck has no consultant cards.';
        }
        if (clearBtn) clearBtn.classList.toggle('hidden', !this.consultant);

        if (!list.length) {
            grid.innerHTML = '<div class="consultant-empty">No consultant cards in the active deck.<br>Decks with consultants include Huntress, Trimarc, Red Canary and the MEGA Deck.</div>';
            return;
        }

        const activeId = this.consultant ? String(this.consultant.id) : '';
        grid.innerHTML = list.map((card, index) => {
            const selected = activeId && String(card.id) === activeId;
            const name = Utils.escapeHtml(card.name || 'Consultant');
            const src = card.image ? Utils.assetPath(card.image) : Utils.cardPlaceholder('Consultant');
            return `
                <div class="consultant-tile">
                    <button type="button" class="consultant-option${selected ? ' selected' : ''}" data-index="${index}" title="${name}">
                        <span class="cons-tick">✓</span>
                        <img src="${src}" alt="${name}" onerror="Utils.onImgError(event)">
                        <span class="cons-name">${name}</span>
                    </button>
                    <button type="button" class="cons-view-btn" data-index="${index}" title="Preview ${name} larger" aria-label="Preview ${name} larger">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    </button>
                </div>
            `;
        }).join('');
    },

    /**
     * Pick a consultant from the picker. Selecting is a done deal: the modal
     * closes. Re-picking the consultant who is already seated just closes the
     * picker — the selection is already good to go.
     * @param {Object} card - Consultant card from the deck
     */
    chooseConsultant(card) {
        if (!card) return;
        const active = this.consultant;
        if (active && String(active.id) === String(card.id)) {
            this.closeConsultantPicker();
            return;
        }
        this.setConsultant(card);
    },

    /**
     * Open the shared large viewer for a consultant (Details | Info tabs plus a
     * one-click action to seat them when they are not already consulting).
     * The viewer sits above the picker modal, so the picker stays put behind it.
     * @param {Object} card - Consultant card from the deck
     */
    previewConsultant(card) {
        if (!card || typeof CardViewer === 'undefined') return;

        const active = this.consultant;
        const isActive = !!(active && String(active.id) === String(card.id));

        const sections = [];
        const details = this.buildCardDetailsHtml(card);
        if (details) sections.push({ label: 'Details', html: details });
        sections.push({ label: 'Info', html: this.buildCardInfoHtml(card, 'consultant') });

        this.openLightbox(Utils.assetPath(card.image), {
            name: card.name || 'Consultant',
            type: 'consultant',
            sections,
            action: isActive
                ? { label: 'Selected ✓', onClick: () => this.closeConsultantPicker() }
                : { label: 'Consult this card', onClick: () => this.setConsultant(card) }
        });
    },

    /**
     * Put a consultant on the board (pass null to stand them down). The choice
     * is persisted with the current game so it survives a reload.
     * @param {Object|null} card - Consultant card from the deck
     */
    setConsultant(card) {
        this.consultant = card || null;
        if (this.scenario) {
            this.scenario.consultant = this.consultant;
            Utils.saveToStorage('bb-current-scenario', this.scenario);
        }

        this.renderConsultantCard();
        this.closeConsultantPicker();

        Utils.showToast(this.consultant
            ? `Consultant: ${this.consultant.name || 'Unknown'}`
            : 'Consultant stood down', 'info');
    },

    /**
     * Start a scenario on the board (persists to storage, resets the table)
     * @param {Object} scenario - Scenario payload
     * @param {string} message - Optional success toast text
     */
    async startScenario(scenario, message) {
        if (!scenario) return;
        this.scenario = scenario;

        // A saved game with no procedure cards is still playable: deal a fresh
        // hand of procedures from the scenario's deck before showing the board.
        const dealt = await this.ensureProceduresFromDeck();
        await this.ensureConsultantsFromDeck();

        Utils.saveToStorage('bb-current-scenario', scenario);

        if (typeof CardViewer !== 'undefined' && CardViewer.close) {
            try { CardViewer.close(); } catch (e) { /* noop */ }
        }
        Utils.$$('.flip-card').forEach(card => card.classList.remove('flipped'));
        Utils.hideElement('dice-result');
        Utils.hideElement('dice-mod');
        Utils.hideElement('roll-status');
        this.revealed = { initial: false, pivot: false, c2: false, persist: false, inject: false, consultant: false };
        this.activeProcIndex = -1;

        this.closeQuickStart();
        this.closeLoadMenu();
        this.setupGame();

        const name = (scenario.metadata && scenario.metadata.name) || scenario.deck.name || 'Scenario';
        const toast = message || (dealt
            ? `Now playing: ${name} · ${dealt} procedure${dealt === 1 ? '' : 's'} auto-dealt`
            : `Now playing: ${name}`);
        Utils.showToast(toast, 'success');
    },

    /**
     * Toggle the inline Load (Scenario Library) menu
     */
    async toggleLoadMenu() {
        const menu = Utils.getElement('load-menu');
        if (!menu) return;
        if (menu.classList.contains('hidden')) {
            Utils.showElement(menu);
            await this.renderLoadMenu();
        } else {
            this.closeLoadMenu();
        }
    },

    /**
     * Close the inline Load menu
     */
    closeLoadMenu() {
        Utils.hideElement('load-menu');
    },

    /**
     * Populate the Load menu with Scenario Library scenarios from the server,
     * falling back to the legacy localStorage bb-scenarios list when the API is
     * unavailable (e.g. a static-only preview server).
     */
    async renderLoadMenu() {
        const menu = Utils.getElement('load-menu');
        const list = Utils.getElement('load-menu-list');
        if (!menu || !list) return;

        let scenarios = [];
        try {
            if (typeof ScenarioIO !== 'undefined' && typeof ScenarioIO.listFromServer === 'function') {
                scenarios = await ScenarioIO.listFromServer();
            }
        } catch (e) {
            scenarios = [];
        }
        if (!scenarios.length) {
            scenarios = Utils.getFromStorage('bb-scenarios', [], true) || [];
        }
        this.loadMenuScenarios = scenarios;

        if (!scenarios.length) {
            list.innerHTML = `<div class="load-menu-empty">No saved scenarios yet.<br>Build one in the <b>Scenario Editor</b> or grab a file from the <b>Library</b>.</div>`;
            return;
        }

        list.innerHTML = scenarios.map((s, i) => {
            const name = (s && s.metadata && s.metadata.name) || 'Untitled scenario';
            const deck = (s && s.deck && s.deck.name) || '';
            const when = (s && s.metadata)
                ? Utils.formatRelativeTime(s.metadata.modifiedAt || s.metadata.createdAt)
                : '';
            const meta = [deck, when].filter(Boolean).join(' · ');
            return `<button type="button" class="load-item" data-load-index="${i}" role="menuitem">
                <span class="load-item-title">${Utils.escapeHtml(name)}</span>
                ${meta ? `<span class="load-item-meta">${Utils.escapeHtml(meta)}</span>` : ''}
            </button>`;
        }).join('');
    },

    /**
     * Load scenario from storage or URL
     */
    async loadScenario() {
        // Check for scenario in URL params
        const params = Utils.getQueryParams();
        
        if (params.scenarioId) {
            try {
                this.scenario = await ScenarioIO.loadFromServer(params.scenarioId);
            } catch (error) {
                console.error('Failed to load scenario from server:', error);
            }
        }

        // Fall back to localStorage
        if (!this.scenario) {
            this.scenario = Utils.getFromStorage('bb-current-scenario', null, true);
        }

        if (this.scenario) {
            // A saved game that has no procedure cards still gets a playable
            // board by dealing a fresh hand of procedures from its deck.
            const dealt = await this.ensureProceduresFromDeck();
            await this.ensureConsultantsFromDeck();
            this.setupGame();
            if (dealt) {
                const name = (this.scenario.metadata && this.scenario.metadata.name) || this.scenario.deck?.name || 'Scenario';
                Utils.showToast(`${name}: no procedures saved — dealt ${dealt} from the deck`, 'info');
            }
        } else {
            // No game loaded - show empty state and inline-SVG placeholders
            Utils.getElement('scenario-name').textContent = 'No scenario loaded - Visit the Library';
            this.updateScenarioCards();
            this.updateProcedureCards();
            this.updateInjectCard();
            this.consultants = [];
            this.consultant = null;
            this.renderConsultantCard();
            this.syncRevealControl();
        }
    },

    /**
     * Set up game with loaded scenario
     */
    setupGame() {
        // Initialize game state and load scenario data
        GameState.init();
        GameState.fromScenario(this.scenario);

        // Inject queue: scenario.injects (first = starting) or legacy startingInject
        const injects = (this.scenario?.injects && this.scenario.injects.length)
            ? [...this.scenario.injects]
            : (this.scenario?.startingInject ? [this.scenario.startingInject] : []);
        this.injectQueue = injects;
        this.activeInjectIndex = 0;
        this.consecutiveFails = 0;
        this.successTarget = this.scenario?.gameConfig?.successTarget || 11;
        this.activeProcIndex = -1;

        // Update UI
        this.updateDeckBadge();
        this.updateScenarioCards();
        this.updateProcedureCards();
        this.updateInjectCard();
        // Card backs follow the deck (the hand re-rendered above already used it)
        this.applyDeckCardbacks();
        this.updateStats();
        this.updateScenarioInfo();

        // Reset revealed state
        this.revealed = {
            initial: false,
            pivot: false,
            c2: false,
            persist: false,
            inject: false,
            consultant: false
        };
        Utils.hideElement('dice-mod');
        Utils.hideElement('roll-status');
        this.renderConsultantCard();
        this.closeConsultantPicker();
        this.syncRevealControl();
    },

    /**
     * Update deck badge
     */
    updateDeckBadge() {
        const badge = Utils.getElement('deck-badge');
        if (badge && this.scenario?.deck?.name) {
            badge.textContent = this.scenario.deck.name;
        }
    },

    /**
     * Card-back art for the Procedure hand.
     * @returns {string} Page-relative URL
     */
    procedureBackUrl() {
        const deckKey = this.scenario?.deck?.key;
        return Utils.cardbackFor(deckKey, 'procedure') || '../shared/decks/cardbacks/v2/procedure.webp';
    },

    /**
     * Point the board's card backs at the deck in play.
     *
     * The static markup ships the 2.0 art; a deck that names another generation
     * (`CONFIG.decks[].cardbackPath` — resolved by Utils.cardbackFor) gets its own
     * backs for the four scenario slots and the inject rail, and the Procedure hand
     * picks it up when it is rendered. The CONSULTANT back is only swapped when the
     * deck actually has consultant cards: a deck without them (core 3.1, for one)
     * keeps the default rather than advertising a card that cannot be drawn.
     */
    applyDeckCardbacks() {
        const deckKey = this.scenario?.deck?.key;
        if (!deckKey) return;

        const setBack = (cardId, type, alt) => {
            const url = Utils.cardbackFor(deckKey, type);
            const img = Utils.getElement(cardId)?.querySelector('.flip-card-front img');
            if (!img || !url || img.getAttribute('src') === url) return;
            img.src = url;
            if (alt) img.alt = alt;
        };

        setBack('initial-card', 'initial', 'Initial Card Back');
        setBack('pivot-card', 'pivot', 'Pivot Card Back');
        setBack('c2-card', 'c2', 'C2 Card Back');
        setBack('persist-card', 'persist', 'Persist Card Back');
        setBack('inject-card', 'inject', 'Inject Card Back');
        if (this.consultants && this.consultants.length) {
            setBack('consultant-card', 'consultant', 'Consultant Card Back');
        }
    },

    /**
     * Update scenario card images
     */
    updateScenarioCards() {
        ['initial', 'pivot', 'c2', 'persist'].forEach(type => {
            const card = this.scenario?.scenario?.[type];
            const img = Utils.getElement(`${type}-card-img`);
            if (!img) return;
            if (card?.image) {
                img.src = Utils.assetPath(card.image);
                img.alt = card.name || type;
            } else {
                img.src = Utils.cardPlaceholder(type.charAt(0).toUpperCase() + type.slice(1));
                img.alt = 'No card';
            }
        });
    },

    /**
     * Update procedure cards
     */
    updateProcedureCards() {
        const container = Utils.getElement('procedure-cards');
        if (!container) return;

        const procedures = this.scenario?.procedures || [];

        if (procedures.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No procedure cards</p></div>';
            this.setProcedureRevealState(false);
            return;
        }

        container.innerHTML = procedures.map((card, index) => {
            const isActive = this.activeProcIndex === index;
            const chip = card.enhanced
                ? `<button type="button" class="proc-arm${isActive ? ' armed' : ''}" data-index="${index}" title="Enhanced (+3)${isActive ? ' — armed, click to disarm' : ' — click to arm for the next roll'}">${isActive ? '✓ +3' : '✦ +3'}</button>`
                : '';
            return `
                <div class="flip-card${card.enhanced ? ' enhanced' : ''}${isActive ? ' active' : ''}" data-procedure-index="${index}">
                    <div class="flip-card-inner">
                        <div class="flip-card-front">
                            <img src="${this.procedureBackUrl()}" alt="Procedure Card Back">
                        </div>
                        <div class="flip-card-back">
                            <img src="${Utils.assetPath(card.image)}" alt="${Utils.escapeHtml(card.name || 'Procedure')}" onerror="Utils.onImgError(event)">
                        </div>
                    </div>
                    ${chip}
                </div>
            `;
        }).join('');

        // Bind flips (ignore clicks on the arm chip)
        Utils.$$('.procedure-cards .flip-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.proc-arm')) return;
                this.flipCard(card);
            });
        });

        // Bind arm chips
        Utils.$$('.procedure-cards .proc-arm').forEach(btn => {
            btn.addEventListener('click', () => this.toggleEnhancedProc(parseInt(btn.dataset.index)));
        });

        // A fresh render deals the hand back face-down
        this.setProcedureRevealState(false);
    },

    /**
     * Arm / disarm an enhanced procedure (only one active at a time)
     * @param {number} index - Procedure index
     */
    toggleEnhancedProc(index) {
        const procedures = this.scenario?.procedures || [];
        if (index < 0 || index >= procedures.length || !procedures[index].enhanced) return;

        this.activeProcIndex = this.activeProcIndex === index ? -1 : index;
        this.updateProcedureCards();
    },

    /**
     * Current enhanced bonus for a roll (flat +3 while an enhanced card is armed)
     * @returns {number} Bonus to apply
     */
    getEnhancedBonus() {
        const procedures = this.scenario?.procedures || [];
        const active = procedures[this.activeProcIndex];
        return active && active.enhanced ? (CONFIG.game.enhancedBonus || 3) : 0;
    },

    /**
     * Update inject card
     */
    updateInjectCard() {
        const inject = this.injectQueue[this.activeInjectIndex] || null;
        const img = Utils.getElement('inject-card-img');
        const label = Utils.getElement('inject-label');
        const drawBtn = Utils.getElement('draw-inject-btn');

        if (img && inject?.image) {
            img.src = Utils.assetPath(inject.image);
            img.alt = inject.name || 'Inject';
        } else if (img) {
            img.src = Utils.cardPlaceholder('No inject');
            img.alt = 'No inject';
        }

        const remaining = Math.max(0, this.injectQueue.length - this.activeInjectIndex - 1);
        if (label) {
            label.textContent = 'INJECT' + (this.injectQueue.length === 0 ? '' : (remaining > 0 ? ` · ${remaining} next` : ' · LAST'));
        }
        if (drawBtn) drawBtn.disabled = remaining <= 0;
    },

    /**
     * Advance to the next queued inject (triggered by a rule or manually).
     * @param {string} source - 'natural 1' | 'natural 20' | '3 failed rolls' | 'manual'
     * @returns {string|null} Name of the inject drawn (null when none left)
     */
    advanceInject(source) {
        if (this.activeInjectIndex >= this.injectQueue.length - 1) {
            this.showRollStatus('No more injects in the queue', 'fail');
            return null;
        }
        this.activeInjectIndex++;
        this.updateInjectCard();
        const name = this.injectQueue[this.activeInjectIndex]?.name || 'inject';
        Utils.showToast(`Inject: ${name}`, 'warning');
        this.showRollStatus(`INJECT drawn (${name}) — ${source}`, 'warn');
        return name;
    },

    /**
     * Show/hide the small roll-status line under the controls.
     * @param {string} text - Message (empty hides)
     * @param {string} tone - 'ok' | 'fail' | 'warn' | 'info'
     */
    showRollStatus(text, tone) {
        const el = Utils.getElement('roll-status');
        if (!el) return;
        if (!text) {
            Utils.hideElement(el);
            return;
        }
        el.textContent = text;
        el.className = 'hint roll-status roll-status-' + (tone || 'info');
        Utils.showElement(el);
    },

    /**
     * Update game statistics display
     */
    updateStats() {
        // Turns
        Utils.getElement('turns-remaining').textContent = GameState.game.turnsRemaining;

        // Strikes
        const strikeContainer = Utils.getElement('strike-indicators');
        if (strikeContainer) {
            const maxStrikes = GameState.game.maxStrikes || this.scenario?.gameConfig?.maxStrikes || 3;
            const currentStrikes = GameState.game.strikeCount;

            strikeContainer.innerHTML = Array(maxStrikes).fill(0).map((_, i) =>
                `<span class="strike-dot ${i < currentStrikes ? 'active' : ''}"></span>`
            ).join('');
        }
    },

    /**
     * Update scenario info in footer
     */
    updateScenarioInfo() {
        Utils.getElement('scenario-name').textContent =
            this.scenario?.metadata?.name || 'Unknown Scenario';
    },

    /**
     * Flip a card. A single click flips it over AND opens a large, readable
     * preview (shared CardViewer overlay) so card text is easy to read.
     * @param {HTMLElement} card - Card element to flip
     */
    flipCard(card) {
        if (!card) return;

        // The consultant card is a picker trigger, not a reveal: clicking it
        // opens the deck's consultant list instead of flipping/previewing.
        if (this.cardTypeOf(card) === 'consultant') {
            this.openConsultantPicker();
            return;
        }

        if (!card.classList.contains('flipped')) {
            // Flip to show
            card.classList.add('flipped');

            // Track which card was revealed
            const cardId = card.id;
            const type = cardId?.replace('-card', '');
            if (type && this.revealed.hasOwnProperty(type)) {
                this.revealed[type] = true;
            }
        }

        // Always try to show the revealed face large (no-op for placeholder art).
        this.previewCardFace(card);
    },

    /**
     * Flip a single card back face-down (right-click). Mirrors flipCard()'s
     * state tracking and resets the "Reveal all" control once no scenario
     * card is face-up any more.
     * @param {HTMLElement} card - Flip card element
     * @returns {boolean} Whether the card was actually flipped down
     */
    unflipCard(card) {
        if (!card) return false;

        // Right-clicking the consultant card stands the consultant down.
        if (this.cardTypeOf(card) === 'consultant') {
            if (!this.consultant) return false;
            this.setConsultant(null);
            return true;
        }

        if (!card.classList.contains('flipped')) return false;
        card.classList.remove('flipped');

        const type = this.cardTypeOf(card);
        if (type && this.revealed && Object.prototype.hasOwnProperty.call(this.revealed, type)) {
            this.revealed[type] = false;
        }

        // Nothing revealed on the board -> the Reveal-all toggles are the next action.
        if (!document.querySelector('.scenario-row .flip-card.flipped')) {
            this.setRevealState(false);
        }
        if (card.closest('.procedure-cards') && !document.querySelector('.procedure-cards .flip-card.flipped')) {
            this.setProcedureRevealState(false);
        }
        return true;
    },

    /**
     * Open the shared viewer for a card's revealed face (skips inline-SVG placeholders).
     * @param {HTMLElement} card - Flip card element
     */
    previewCardFace(card) {
        if (!card) return;
        const backImg = card.querySelector('.flip-card-back img');
        if (!backImg?.src || backImg.src.startsWith('data:image/svg')) return;

        const type = this.cardTypeOf(card);
        const name = backImg.alt && backImg.alt !== 'Card' ? backImg.alt : '';
        const sections = this.cardSectionsFor(card, type);
        this.openLightbox(backImg.src, { name, type, sections });
    },

    /**
     * Resolve a flip-card element's card type (initial/pivot/c2/persist/procedure/inject).
     * @param {HTMLElement} card - Flip card element
     * @returns {string} Card type key
     */
    cardTypeOf(card) {
        if (!card) return '';
        if (card.closest('.consultant-rail') || card.id === 'consultant-card') return 'consultant';
        const wrapper = card.closest('.card-wrapper');
        if (wrapper && wrapper.dataset.type) return wrapper.dataset.type;
        if (card.closest('.procedure-cards')) return 'procedure';
        if (card.closest('.inject-card-wrapper') || card.id === 'inject-card') return 'inject';
        const idType = (card.id || '').replace('-card', '');
        return Utils.CARD_TYPES.includes(idType) ? idType : '';
    },

    /**
     * Resolve the deck/scenario card object behind a flip-card element.
     * @param {HTMLElement} card - Flip card element
     * @param {string} [type] - Card type (resolved when omitted)
     * @returns {Object|null} Card data ({ id, name, type, description, details, ... })
     */
    resolveCardData(card, type) {
        type = type || this.cardTypeOf(card);
        if (!card || !type) return null;

        if (['initial', 'pivot', 'c2', 'persist'].includes(type)) {
            return this.scenario?.scenario?.[type] || null;
        }
        if (type === 'procedure') {
            const idx = parseInt(card.dataset?.procedureIndex, 10);
            const list = this.scenario?.procedures || [];
            return Number.isInteger(idx) && list[idx] ? list[idx] : null;
        }
        if (type === 'inject') {
            return this.injectQueue?.[this.activeInjectIndex] || null;
        }
        if (type === 'consultant') {
            return this.consultant || null;
        }
        return null;
    },

    /**
     * Build the CardViewer tab sections (Details / Info) for a card.
     * @param {HTMLElement} card - Flip card element
     * @param {string} [type] - Card type (resolved when omitted)
     * @returns {Array<{label: string, html: string}>}
     */
    cardSectionsFor(card, type) {
        type = type || this.cardTypeOf(card);
        const data = this.resolveCardData(card, type);
        const sections = [];

        const details = this.buildCardDetailsHtml(data);
        if (details) sections.push({ label: 'Details', html: details });
        sections.push({ label: 'Info', html: this.buildCardInfoHtml(data, type) });

        return sections;
    },

    /**
     * Details tab: description + the card's resource links (sanitised).
     * @param {Object|null} data - Card data
     * @returns {string} HTML ('' when there is nothing to show)
     */
    buildCardDetailsHtml(data) {
        if (!data) return '';
        const esc = (value) => Utils.escapeHtml(String(value));
        const parts = [];
        const description = (data.description || '').trim();
        if (description) parts.push(`<p>${esc(description)}</p>`);

        // Text printed on the card face alongside the body - see docs/card-details-README.md.
        const notes = String(data.notes || '').trim();
        if (notes) parts.push(`<p class="cv-note"><b>NOTES:</b> ${esc(notes)}</p>`);

        const list = (label, values) => {
            const items = (Array.isArray(values) ? values : [])
                .map(v => String(v || '').trim()).filter(Boolean);
            if (!items.length) return '';
            return `<p class="cv-sub">${label}</p><ul class="cv-detail-list">`
                + items.map(v => `<li>${esc(v)}</li>`).join('') + '</ul>';
        };
        parts.push(list('Tools', data.tools));
        parts.push(list('Specialties', data.specialties));

        const quote = String(data.quote || '').trim();
        if (quote) parts.push(`<blockquote class="cv-quote">${esc(quote)}</blockquote>`);

        const cost = String(data.cost || '').trim();
        if (cost) parts.push(`<dl class="cv-info-list"><dt>Competitive Price</dt><dd>${esc(cost)}</dd></dl>`);

        const details = this.sanitizeDetails(data.details);
        if (details) parts.push(details);

        return parts.join('');
    },

    /**
     * Info tab: name / type / deck / scenario / id (plus the enhanced flag).
     * @param {Object|null} data - Card data
     * @param {string} type - Card type key
     * @returns {string} HTML definition list
     */
    buildCardInfoHtml(data, type) {
        const rows = [];
        const add = (label, value) => {
            if (value === undefined || value === null || value === '') return;
            rows.push(`<dt>${Utils.escapeHtml(label)}</dt><dd>${Utils.escapeHtml(value)}</dd>`);
        };

        add('Name', data?.name);
        add('Type', CARD_TYPE_LABELS[type] || type);
        add('Deck', this.scenario?.deck?.name);
        add('Scenario', this.scenario?.metadata?.name);
        add('Card ID', data?.id);
        if (type === 'procedure') add('Enhanced', data?.enhanced ? 'Yes (+3)' : 'No');

        return rows.length ? `<dl class="cv-info-list">${rows.join('')}</dl>` : '';
    },

    /**
     * Sanitise the deck's `details` HTML (resource links) down to safe
     * <ul><li><a> markup: http(s) hrefs only, no scripts or event handlers.
     * @param {string} html - Raw details markup from carddb.json
     * @returns {string} Safe HTML ('' when empty)
     */
    sanitizeDetails(html) {
        if (!html) return '';
        const template = document.createElement('template');
        template.innerHTML = String(html);

        const liNodes = template.content.querySelectorAll('li');
        const nodes = liNodes.length ? Array.from(liNodes) : Array.from(template.content.childNodes);

        const list = document.createElement('ul');
        list.className = 'cv-detail-list';

        nodes.forEach((node) => {
            const item = document.createElement('li');
            const isAnchor = node.nodeType === 1 && node.matches && node.matches('a[href]');
            const anchors = isAnchor
                ? [node]
                : (node.querySelectorAll ? Array.from(node.querySelectorAll('a[href]')) : []);

            if (anchors.length) {
                anchors.forEach((a) => {
                    const href = (a.getAttribute('href') || '').trim();
                    const text = (a.textContent || '').trim() || href;
                    if (!/^https?:\/\//i.test(href)) {
                        item.appendChild(document.createTextNode(text));
                        return;
                    }
                    const link = document.createElement('a');
                    link.href = href;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = text;
                    item.appendChild(link);
                });
            } else {
                const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                if (text) item.appendChild(document.createTextNode(text));
            }

            if (item.childNodes.length) list.appendChild(item);
        });

        return list.childElementCount ? list.outerHTML : '';
    },

    /**
     * Open the shared card viewer (large readable overlay)
     * @param {string} src - Image source
     * @param {Object} meta - Optional { name, type } for the caption
     */
    openLightbox(src, meta) {
        if (typeof CardViewer !== 'undefined' && CardViewer.open) {
            CardViewer.open(src, meta || {});
        }
    },

    /**
     * Close the shared card viewer
     */
    closeLightbox() {
        if (typeof CardViewer !== 'undefined' && CardViewer.close) {
            CardViewer.close();
        }
    },

    /**
     * Roll the d20.
     * When Dice FX is enabled this opens the big animated d20 modal, tosses the
     * die to the natural roll, then applies and reveals the outcome. When it is
     * off the game rolls instantly into the plain header readout as before.
     */
    async rollDice() {
        if (this.isRolling) return;
        // Never stack rolls while the die modal is up
        if (typeof DiceFX !== 'undefined' && DiceFX.isOpen && DiceFX.isOpen()) return;

        this.isRolling = true;
        const rollBtn = Utils.getElement('roll-dice-btn');
        if (rollBtn) rollBtn.disabled = true;
        try {
            const base = Utils.rollDice(20);
            const bonus = this.getEnhancedBonus();
            const useFx = (typeof DiceFX !== 'undefined') && DiceFX.isEnabled();

            if (useFx) {
                const { settled } = await DiceFX.performRoll(base, { bonus });
                // The game outcome is always resolved exactly once, even if the
                // player closed the modal mid-toss, so a turn is never lost.
                const meta = this.resolveRoll(base, bonus, { headerTumble: false });
                if (settled && meta) DiceFX.reveal(meta);
            } else {
                this.resolveRoll(base, bonus, { headerTumble: true });
            }
        } finally {
            this.isRolling = false;
            if (rollBtn) rollBtn.disabled = false;
        }
    },

    /**
     * Apply a resolved d20 roll to the game: header readout, crit/fail flair,
     * failure-streak / inject progression, the status line and the roll log.
     * @param {number} base - Natural roll (1-20)
     * @param {number} bonus - Enhanced bonus added to the total
     * @param {Object} opts - Options
     * @param {boolean} opts.headerTumble - Play the little header tumble first
     * @returns {Object} Outcome meta (used by the Dice FX modal reveal)
     */
    resolveRoll(base, bonus, opts = {}) {
        const headerTumble = opts.headerTumble !== false;
        const total = base + bonus;
        const target = this.successTarget || 11;
        const isCritFail = base === 1;
        const isCritSuccess = base === 20;
        const isSuccess = total >= target;

        // Update the header readout (behind the modal when Dice FX is on)
        const diceResult = Utils.getElement('dice-result');
        const diceValue = Utils.getElement('dice-value');
        const diceMod = Utils.getElement('dice-mod');
        if (diceResult && diceValue) {
            Utils.showElement(diceResult);
            diceResult.classList.remove('crit', 'fail', 'rolling');
            diceValue.textContent = total;
            if (diceMod) {
                if (bonus > 0) {
                    diceMod.textContent = `natural ${base} +${bonus} enhanced`;
                    Utils.showElement(diceMod);
                } else {
                    Utils.hideElement(diceMod);
                }
            }
            const finish = () => {
                diceResult.classList.remove('rolling');
                diceResult.classList.toggle('crit', isCritSuccess);
                diceResult.classList.toggle('fail', isCritFail);
            };
            if (headerTumble) {
                // The big d20 already tumbled — no need for the mini header tumble
                diceResult.classList.add('rolling');
                setTimeout(finish, 640);
            } else {
                finish();
            }
        }

        // Rule-book outcome classification (single d20, success = total >= target)
        this.consecutiveFails = isSuccess ? 0 : this.consecutiveFails + 1;

        let injected = null;
        if (isCritFail || isCritSuccess) {
            injected = this.advanceInject(isCritSuccess ? 'natural 20' : 'natural 1');
        } else if (this.consecutiveFails >= 3) {
            injected = this.advanceInject('3 failed rolls');
            this.consecutiveFails = 0;
        }

        let message = '';
        if (injected) {
            message = `INJECT drawn (${injected})`;
        } else if (isCritFail) {
            message = 'Natural 1 — critical failure!';
        } else if (isCritSuccess) {
            message = 'Natural 20 — critical success!';
        } else if (this.consecutiveFails > 0) {
            message = `Failure streak ${this.consecutiveFails}/3`;
        } else {
            message = `Success (${total} ≥ ${target})`;
        }

        if (!injected) {
            const tone = isCritFail ? 'fail' : (isCritSuccess ? 'ok' : (this.consecutiveFails > 0 ? 'fail' : 'ok'));
            this.showRollStatus(message, tone);
        }
        // (when an inject is drawn, advanceInject() already wrote its status line)

        GameState.logDiceRoll(total, (isCritFail || isCritSuccess) ? 'crit' : (isSuccess ? 'standard' : 'fail'));

        // Outcome meta for the Dice FX modal reveal (plain rolls ignore it)
        let kind = 'ok';
        if (isCritSuccess) kind = 'crit';
        else if (isCritFail) kind = 'fail';
        else if (injected) kind = 'inject';
        else if (!isSuccess) kind = 'fail';

        return {
            base, bonus, total, target,
            isCritFail, isCritSuccess, isSuccess, injected,
            headline: base,
            kind,
            message
        };
    },

    /**
     * Add a strike
     */
    addStrike() {
        const gameOver = GameState.addStrike();
        this.updateStats();

        if (gameOver) {
            this.showGameOver('lose');
        }
    },

    /**
     * Use a turn
     */
    useTurn() {
        GameState.useTurn();
        this.updateStats();

        if (GameState.game.isGameOver) {
            this.showGameOver('timeout');
        }
    },

    /**
     * Show game over modal
     * @param {string} reason - 'win', 'lose', 'timeout'
     */
    showGameOver(reason) {
        const modal = Utils.getElement('gameover-modal');
        const icon = Utils.getElement('gameover-icon');
        const title = Utils.getElement('gameover-title');
        const message = Utils.getElement('gameover-message');

        if (!modal) return;

        switch (reason) {
            case 'lose':
                icon.innerHTML = '💀';
                title.textContent = 'Game Over';
                message.textContent = 'You have accumulated too many strikes. The attackers win.';
                break;
            case 'timeout':
                icon.innerHTML = '⏰';
                title.textContent = 'Time\'s Up';
                message.textContent = 'You ran out of turns. The scenario has ended.';
                break;
        }

        Utils.showElement(modal);
    },

    /**
     * Restart game
     */
    restartGame() {
        Utils.hideElement('gameover-modal');
        this.setupGame();

        // Reset all cards to unflipped (then re-show an active consultant)
        Utils.$$('.flip-card').forEach(card => {
            card.classList.remove('flipped');
        });
        this.renderConsultantCard();

        // Hide dice result
        Utils.hideElement('dice-result');
    },

    /**
     * Handle game state changes
     * @param {Object} change - Change object
     */
    onGameStateChange(change) {
        if (change === 'turn' || change === 'strike') {
            this.updateStats();
        }
    },

    /**
     * Flip all scenario cards to reveal (true) or back to hidden (false)
     */
    toggleRevealScenario() {
        const btn = Utils.getElement('reveal-cards-btn');
        if (!this.scenario || !btn || btn.disabled) return;
        const show = btn.dataset.state !== 'shown';

        Utils.$$('.scenario-row .card-wrapper').forEach(wrapper => {
            const card = wrapper.querySelector('.flip-card');
            const type = wrapper.dataset.type;
            if (!card) return;
            card.classList.toggle('flipped', show);
            if (type && this.revealed && Object.prototype.hasOwnProperty.call(this.revealed, type)) {
                this.revealed[type] = show;
            }
        });

        this.setRevealState(show);
        Utils.showToast(show ? 'All scenario cards revealed' : 'Scenario cards hidden', 'info');
    },

    /**
     * Update the reveal-all button label / icon / state
     * @param {boolean} show - Whether cards are currently revealed
     */
    setRevealState(show) {
        const btn = Utils.getElement('reveal-cards-btn');
        if (!btn) return;
        const eye = `<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>`;
        const eyeOff = `<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94'/><path d='M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19'/><path d='M14.12 14.12a3 3 0 1 1-4.24-4.24'/><line x1='1' y1='1' x2='23' y2='23'/></svg>`;
        btn.dataset.state = show ? 'shown' : 'hidden';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        btn.title = show ? 'Hide all scenario cards (flip back to card backs)' : 'Reveal all scenario cards for a quick GM look';
        btn.innerHTML = (show ? eyeOff : eye) + '<span>' + (show ? 'Hide all' : 'Reveal all') + '</span>';
    },

    /**
     * Reset the reveal-all controls to hidden and disable them when there is
     * no scenario / no procedure hand to act on.
     */
    syncRevealControl() {
        const btn = Utils.getElement('reveal-cards-btn');
        if (!btn) return;
        const hasGame = !!(this.scenario && this.scenario.scenario);
        btn.disabled = !hasGame;
        this.setRevealState(false);
        this.setProcedureRevealState(false);
    },

    /**
     * Flip the whole procedure hand face-up (true) or back down (false)
     */
    toggleRevealProcedures() {
        const btn = Utils.getElement('reveal-procedures-btn');
        if (!btn || btn.disabled) return;
        const cards = Utils.$$('.procedure-cards .flip-card');
        if (!cards.length) return;

        const show = btn.dataset.state !== 'shown';
        // Flip directly rather than via flipCard() so revealing the hand does
        // not fire a preview overlay per card.
        cards.forEach(card => card.classList.toggle('flipped', show));

        this.setProcedureRevealState(show);
        Utils.showToast(show ? 'Procedure hand revealed' : 'Procedure cards hidden', 'info');
    },

    /**
     * Update the reveal-procedures button label / icon / state
     * @param {boolean} show - Whether the procedure hand is currently revealed
     */
    setProcedureRevealState(show) {
        const btn = Utils.getElement('reveal-procedures-btn');
        if (!btn) return;
        btn.disabled = !document.querySelector('.procedure-cards .flip-card');

        // Two stacked bands = the shape a revealed procedure card takes
        const bands = `<rect x='3' y='3' width='18' height='7' rx='2'/><rect x='3' y='14' width='18' height='7' rx='2'/>`;
        const icon = (hidden) => `<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${bands}${hidden ? `<line x1='2' y1='22' x2='22' y2='2'/>` : ''}</svg>`;

        btn.dataset.state = show ? 'shown' : 'hidden';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        btn.title = show
            ? 'Hide all procedure cards (flip them back to card backs)'
            : 'Reveal all procedure cards for a quick look at the hand';
        btn.innerHTML = icon(show) + '<span>' + (show ? 'Hide procedures' : 'Reveal procedures') + '</span>';
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    PlayerController.init();
});

// Exposed for testing and future live-GM console
window.PlayerController = PlayerController;
