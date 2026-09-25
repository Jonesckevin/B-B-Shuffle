/**
 * B&B Shuffle - Admin Controller
 * Handles the Scenario Editor interface for building scenarios
 */

const AdminController = {
    // State
    deck: null,
    cardLists: {},
    baseCardLists: null,     // cards from the loaded base deck only (per type)
    expansions: {},          // expansion deck key -> { key, name, prefix, enabled, lists }
    selectedSlot: null,
    procedures: [],
    injects: [],
    consultants: [],          // optional "Call a Consultant" pool
    startingConsultantId: null,
    saveTags: [],
    // Metadata staged for the Save-to-Library form after an AI hand-off
    pendingSaveMeta: null,

    /**
     * Initialize the admin interface
     */
    async init() {
        this.setupExpansions();
        this.bindEvents();
        this.checkForLoadedScenario();
    },

    /**
     * Build the expansion-pack registry from CONFIG.decks (entries flagged
     * expansion:true) and render their merge toggles into #expansion-toggles.
     */
    setupExpansions() {
        this.expansions = {};
        const cfgDecks = (typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks : {};
        Object.keys(cfgDecks).forEach(key => {
            const cfg = cfgDecks[key];
            if (cfg && cfg.expansion) {
                this.expansions[key] = {
                    key,
                    name: cfg.name || key,
                    prefix: cfg.expansionPrefix || (key.slice(0, 3).toUpperCase() + '-'),
                    enabled: false,
                    lists: null
                };
            }
        });

        const container = Utils.getElement('expansion-toggles');
        if (!container) return;
        container.innerHTML = Object.values(this.expansions).map(exp => `
            <label class="expansion-label" for="${exp.key}-toggle">
                <input type="checkbox" id="${exp.key}-toggle" class="expansion-checkbox">
                <span class="expansion-text">${Utils.escapeHtml(exp.name)}</span>
            </label>
        `).join('');
    },

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Deck selection
        Utils.getElement('load-deck-btn')?.addEventListener('click', () => this.loadSelectedDeck());
        Utils.getElement('deck-select')?.addEventListener('change', (e) => {
            Utils.getElement('load-deck-btn').disabled = !e.target.value;
        });

        // Expansion pack toggles -> merge expansion cards into the loaded deck's pools
        Object.keys(this.expansions).forEach(key => {
            Utils.getElement(`${key}-toggle`)?.addEventListener('change', (e) => {
                this.toggleExpansion(key, e.target.checked);
            });
        });

        // Enhanced procedure count -> re-sync which drawn cards are enhanced
        Utils.getElement('enhanced-count')?.addEventListener('change', () => {
            const el = Utils.getElement('enhanced-count');
            const max = parseInt(Utils.getElement('procedure-count')?.value) || CONFIG.game.procedureCount;
            if (el) {
                const v = Math.max(0, Math.min(parseInt(el.value) || 0, max));
                el.value = v;
            }
            this.syncEnhancedFlags();
            this.renderProcedures();
        });

        // Scenario slot clicks: empty slot -> open picker to choose; filled card -> big preview.
        Utils.$$('.slot-card').forEach(slot => {
            slot.addEventListener('click', (e) => {
                const type = e.target.closest('.scenario-slot')?.dataset.type;
                if (!type) return;
                if (slot.dataset.card) {
                    this.viewScenarioSlot(type);
                } else {
                    this.openCardPicker(type);
                }
            });
        });

        // Scenario slot "swap" buttons -> open the picker to pick a replacement card.
        Utils.$$('.slot-swap-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = btn.dataset.type;
                if (type) this.openCardPicker(type);
            });
        });

        // Random buttons
        Utils.$$('.slot-random-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.randomizeSlot(btn.dataset.type);
            });
        });

        // Scenario actions
        Utils.getElement('random-all-btn')?.addEventListener('click', () => this.randomizeAll());
        Utils.getElement('clear-all-btn')?.addEventListener('click', () => this.clearAll());

        // Procedure actions
        Utils.getElement('draw-procedure-btn')?.addEventListener('click', () => this.drawProcedure());
        Utils.getElement('shuffle-procedures-btn')?.addEventListener('click', () => this.shuffleProcedures());
        Utils.getElement('clear-procedures-btn')?.addEventListener('click', () => this.clearProcedures());

        // Consultant actions (optional "Call a Consultant" pool)
        Utils.getElement('add-consultant-btn')?.addEventListener('click', () => this.openCardPicker('consultant'));
        Utils.getElement('fill-consultants-btn')?.addEventListener('click', () => this.addAllConsultants());
        Utils.getElement('clear-consultants-btn')?.addEventListener('click', () => this.clearConsultants());

        // Consultant chips: ★ = starting consultant, ✕ = remove, click = preview
        Utils.getElement('consultants-grid')?.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.cons-remove-btn');
            if (removeBtn) {
                e.stopPropagation();
                this.removeConsultant(parseInt(removeBtn.dataset.consultantIndex, 10));
                return;
            }
            const startBtn = e.target.closest('.cons-start-btn');
            if (startBtn) {
                e.stopPropagation();
                this.setStartingConsultant(parseInt(startBtn.dataset.consultantIndex, 10));
                return;
            }
            const chip = e.target.closest('.consultant-card');
            if (!chip) return;
            const card = this.consultants[parseInt(chip.dataset.consultantIndex, 10)];
            if (card && typeof CardViewer !== 'undefined') {
                CardViewer.open(Utils.assetPath(card.image), { name: card.name || '', type: 'consultant' });
            }
        });

        // Per-procedure randomize (swap out a specific procedure card)
        Utils.getElement('procedure-grid')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.proc-random-btn');
            if (!btn) return;
            e.stopPropagation();
            const index = parseInt(btn.dataset.procedureIndex, 10);
            if (!Number.isNaN(index)) this.randomizeProcedure(index);
        });

        // Click-to-view: clicking a procedure card opens the big readable preview
        // (skip clicks that land on the per-card randomize button).
        Utils.getElement('procedure-grid')?.addEventListener('click', (e) => {
            if (e.target.closest('.proc-random-btn')) return;
            const cardEl = e.target.closest('.procedure-card');
            if (cardEl) this.viewCardFromElement(cardEl, 'procedure');
        });

        // Inject actions (pool)
        Utils.getElement('draw-injects-btn')?.addEventListener('click', () => this.drawInjects());
        Utils.getElement('clear-injects-btn')?.addEventListener('click', () => this.clearInjects());
        Utils.getElement('inject-count')?.addEventListener('change', () => this.renderInjects());

        // Click-to-view: clicking an inject card opens the big readable preview.
        Utils.getElement('injects-grid')?.addEventListener('click', (e) => {
            const cardEl = e.target.closest('.inject-card');
            if (cardEl) this.viewCardFromElement(cardEl, 'inject');
        });

        // Card picker
        Utils.getElement('picker-close')?.addEventListener('click', () => this.closeCardPicker());
        Utils.getElement('picker-search-input')?.addEventListener('input', Utils.debounce(() => {
            this.filterPickerCards();
        }, 300));

        // Save scenario
        Utils.getElement('save-scenario-btn')?.addEventListener('click', () => this.openSaveModal());

        // Save modal
        Utils.getElement('save-modal-close')?.addEventListener('click', () => this.closeSaveModal());
        Utils.getElement('save-cancel-btn')?.addEventListener('click', () => this.closeSaveModal());
        Utils.getElement('save-confirm-btn')?.addEventListener('click', () => this.saveScenario());
        Utils.getElement('save-modal-backdrop')?.addEventListener('click', (e) => {
            if (e.target.id === 'save-modal-backdrop') this.closeSaveModal();
        });

        // Tags input
        const tagsInput = Utils.$('#save-tags-input input');
        if (tagsInput) {
            tagsInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addSaveTag(tagsInput.value.trim());
                    tagsInput.value = '';
                }
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // When the shared CardViewer is open it owns the Esc key
                if (typeof CardViewer !== 'undefined' && CardViewer.isOpen && CardViewer.isOpen()) return;
                this.closeCardPicker();
                this.closeSaveModal();
            }
        });
    },

    /**
     * Check if there's a scenario to load from the library or the AI generator.
     * The AI generator hands off its output through the same storage slot and
     * sets bb-ai-handoff so we can prefill the Save (library) form and open it.
     */
    async checkForLoadedScenario() {
        const params = Utils.getQueryParams();
        if (params.loadScenario !== 'true') return;

        const scenario = Utils.getFromStorage('bb-loaded-scenario', null, true);
        if (!scenario) return;
        Utils.removeFromStorage('bb-loaded-scenario');

        const aiHandoff = Utils.getFromStorage('bb-ai-handoff', null, true);
        if (aiHandoff) Utils.removeFromStorage('bb-ai-handoff');

        try {
            await this.loadScenario(scenario, { prefillSave: Boolean(aiHandoff) });

            // AI hand-off: open the Library save form right away with everything
            // filled in so only final edits remain before the actual save.
            if (aiHandoff) {
                const ready = ['initial', 'pivot', 'c2', 'persist'].every(type => {
                    const slot = Utils.getElement(`${type}-slot`);
                    return slot?.dataset.card;
                });
                if (ready) {
                    this.openSaveModal();
                    Utils.showToast('AI scenario loaded — review, then Save to Library', 'success');
                } else {
                    Utils.showToast('AI scenario loaded — please review before saving', 'success');
                }
            }
        } catch (error) {
            console.error('Failed to load handed-off scenario:', error);
            Utils.showToast('Failed to load scenario: ' + error.message, 'error');
        }
    },

    /**
     * Load a scenario into the builder
     * @param {Object} scenario - Scenario data
     */
    async loadScenario(scenario, opts = {}) {
        // A fresh scenario build (manual or AI hand-off) starts without staged metadata.
        this.pendingSaveMeta = null;

        // First load the deck
        if (scenario.deck?.key) {
            const deckSelect = Utils.getElement('deck-select');
            if (deckSelect) {
                deckSelect.value = scenario.deck.key;
                await this.loadSelectedDeck();
            }
        }

        // Populate scenario cards
        ['initial', 'pivot', 'c2', 'persist'].forEach(type => {
            const card = scenario.scenario?.[type];
            if (card) {
                this.setSlotCard(type, card);
            }
        });

        // Populate procedures
        if (scenario.procedures?.length > 0) {
            this.procedures = [...scenario.procedures];
            this.syncEnhancedFlags();
            this.renderProcedures();
        }

        // Populate inject pool (first = starting inject)
        if (scenario.injects?.length) {
            this.injects = [...scenario.injects];
        } else if (scenario.startingInject) {
            this.injects = [scenario.startingInject];
        }
        this.renderInjects();

        // Populate the optional consultant pool ("Call a Consultant").
        // Empty pool = players may call anyone in the deck.
        this.consultants = Array.isArray(scenario.consultants) ? [...scenario.consultants] : [];
        this.startingConsultantId = scenario.consultant?.id || null;
        this.renderConsultants();

        // Populate game config
        if (scenario.gameConfig) {
            Utils.getElement('initial-turns').value = scenario.gameConfig.initialTurns || 10;
            Utils.getElement('max-strikes').value = scenario.gameConfig.maxStrikes || 3;
            Utils.getElement('procedure-count').value = scenario.gameConfig.procedureCount || CONFIG.game.procedureCount;
            Utils.getElement('enhanced-count').value = scenario.gameConfig.enhancedCount ?? CONFIG.game.enhancedDefault;
            Utils.getElement('inject-count').value = scenario.gameConfig.injectCount || 3;
            Utils.getElement('success-target').value = scenario.gameConfig.successTarget || 11;
            this.syncEnhancedFlags();
            this.renderProcedures();
            this.renderInjects();
        }

        // AI hand-off: stage metadata (name/description/difficulty/tags/notes) so
        // the Save-to-Library form opens fully populated for final edits.
        if (opts.prefillSave) this.captureSavePrefill(scenario);

        Utils.showToast('Scenario loaded successfully', 'success');
    },

    /**
     * Stage metadata from a handed-off scenario so the Save-to-Library modal
     * opens pre-filled with the AI output (name, author, description, difficulty,
     * estimated duration, tags and facilitator notes).
     * @param {Object} scenario - Scenario that was loaded into the editor
     */
    captureSavePrefill(scenario) {
        const meta = scenario.metadata || {};
        const notesRaw = scenario.notes;
        const notes = typeof notesRaw === 'string'
            ? notesRaw
            : (notesRaw && typeof notesRaw === 'object' ? (notesRaw.adminNotes || '') : '');
        this.pendingSaveMeta = {
            name: meta.name || '',
            author: meta.author || '',
            description: meta.description || '',
            difficulty: meta.difficulty || 3,
            estimatedDuration: meta.estimatedDuration || '',
            notes,
            tags: Array.isArray(meta.tags) ? [...meta.tags] : []
        };
    },

    /**
     * Apply staged metadata to the Save-to-Library modal fields.
     */
    applySavePrefill() {
        const meta = this.pendingSaveMeta;
        if (!meta) return;

        Utils.getElement('save-name').value = meta.name || '';
        Utils.getElement('save-author').value = meta.author || '';
        Utils.getElement('save-description').value = meta.description || '';
        Utils.getElement('save-difficulty').value = String(meta.difficulty || 3);
        Utils.getElement('save-duration').value = meta.estimatedDuration || '';
        Utils.getElement('save-notes').value = meta.notes || '';
        this.saveTags = Array.isArray(meta.tags) ? [...meta.tags] : [];
        this.renderSaveTags();
    },

    /**
     * Load selected deck
     */
    async loadSelectedDeck() {
        const deckKey = Utils.getElement('deck-select')?.value;
        if (!deckKey) return;

        try {
            const deckConfig = CONFIG.decks[deckKey];
            if (!deckConfig) {
                Utils.showToast(`Unknown deck: ${deckKey}`, 'error');
                return;
            }
            const response = await Utils.loadJson(deckConfig.path);

            this.deck = {
                key: deckKey,
                name: response.title || deckConfig.name || deckKey,
                path: deckConfig.path,
                // Box art, when the deck has one (see CONFIG.decks[].cover /
                // shared/img/decks). Decks with no art upstream leave it undefined.
                cover: deckConfig.cover || ''
            };

            // Organize base deck cards by type (Green Expansion merges separately)
            // One bucket per canonical card type.
            const lists = {};
            Utils.CARD_TYPES.forEach(type => { lists[type] = []; });

            response.data.forEach(card => {
                const type = card.type?.toLowerCase();
                if (lists[type]) {
                    lists[type].push({
                        ...card,
                        image: Utils.assetPath(card.image)
                    });
                }
            });

            this.baseCardLists = lists;

            // Reset all expansion pack toggles for the newly selected base deck.
            // Also drop cached card lists so edits made since the last load are
            // picked up (the Custom Cards deck can change at any time).
            Object.values(this.expansions).forEach(exp => {
                exp.enabled = false;
                exp.lists = null;
            });
            Object.keys(this.expansions).forEach(key => {
                const t = Utils.getElement(`${key}-toggle`);
                if (t) t.checked = false;
            });

            // Rebuild effective pools (base only until expansion is enabled)
            this.refreshPools();

            // Update UI
            Utils.getElement('deck-name').textContent = this.deck.name;
            const deckCover = Utils.getElement('deck-cover');
            if (deckCover) {
                if (this.deck.cover) {
                    deckCover.src = this.deck.cover;
                    deckCover.alt = this.deck.name + ' box art';
                    Utils.showElement(deckCover);
                } else {
                    deckCover.removeAttribute('src');
                    Utils.hideElement(deckCover);
                }
            }
            Utils.showElement('deck-info');
            Utils.showElement('deck-expansion');

            // Enable buttons
            Utils.getElement('draw-procedure-btn').disabled = false;
            Utils.getElement('shuffle-procedures-btn').disabled = false;
            Utils.getElement('draw-injects-btn').disabled = false;
            Utils.getElement('clear-injects-btn').disabled = false;
            Utils.getElement('add-consultant-btn').disabled = false;
            Utils.getElement('fill-consultants-btn').disabled = false;

            Utils.showToast(`Loaded ${this.deck.name}`, 'success');
        } catch (error) {
            console.error('Failed to load deck:', error);
            Utils.showToast('Failed to load deck', 'error');
        }
    },

    /**
     * Open card picker for a slot type
     * @param {string} type - Card type
     */
    openCardPicker(type) {
        if (!this.deck) {
            Utils.showToast('Please load a deck first', 'warning');
            return;
        }

        this.selectedSlot = type;

        // Update picker title
        Utils.getElement('picker-type').textContent = type.charAt(0).toUpperCase() + type.slice(1);

        // Render cards
        this.renderPickerCards();

        // Open picker
        Utils.getElement('card-picker')?.classList.add('open');
    },

    /**
     * Close card picker
     */
    closeCardPicker() {
        Utils.getElement('card-picker')?.classList.remove('open');
        this.selectedSlot = null;
        Utils.getElement('picker-search-input').value = '';
    },

    /**
     * Open the shared big viewer for a card element's image.
     * @param {HTMLElement} el - Element that contains the card <img>
     * @param {string} type - Card type key (initial/pivot/c2/persist/procedure/inject)
     */
    viewCardFromElement(el, type) {
        const img = el && el.querySelector('img');
        if (!img || !img.src || img.src.startsWith('data:image/svg')) return;
        if (typeof CardViewer === 'undefined') return;
        const name = img.alt && img.alt !== 'Card' ? img.alt : '';
        CardViewer.open(img.src, { name, type });
    },

    /**
     * Open the shared big viewer for a scenario slot's placed card.
     * @param {string} type - Scenario card type (initial/pivot/c2/persist)
     */
    viewScenarioSlot(type) {
        const slot = Utils.getElement(`${type}-slot`);
        let card = null;
        try { card = slot?.dataset.card ? JSON.parse(slot.dataset.card) : null; } catch (err) { card = null; }
        if (!card || typeof CardViewer === 'undefined') return;
        CardViewer.open(Utils.assetPath(card.image), { name: card.name || '', type });
    },

    /**
     * Render cards in picker
     */
    renderPickerCards() {
        const container = Utils.getElement('picker-cards');
        if (!container || !this.selectedSlot) return;

        const cards = this.cardLists[this.selectedSlot] || [];
        const search = Utils.getElement('picker-search-input')?.value.toLowerCase() || '';

        const filtered = cards.filter(card =>
            !search ||
            card.name?.toLowerCase().includes(search) ||
            card.description?.toLowerCase().includes(search)
        );

        container.innerHTML = filtered.length === 0
            ? `<span class="slot-placeholder">${this.selectedSlot === 'consultant' ? 'No consultant cards in this deck' : 'No cards match'}</span>`
            : filtered.map(card => `
            <div class="picker-card" data-card-id="${card.id}" title="${Utils.escapeHtml(card.name || '')}">
                <img src="${Utils.assetPath(card.image)}" alt="${Utils.escapeHtml(card.name || 'Card')}" loading="lazy" onerror="Utils.onImgError(event)">
                <button type="button" class="picker-view-btn" data-card-id="${card.id}" title="Preview larger" aria-label="Preview this card larger">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                </button>
            </div>
        `).join('');

        // Consultants collect into a pool instead of filling a single slot.
        const commit = (card) => {
            if (this.selectedSlot === 'consultant') this.addConsultant(card);
            else this.setSlotCard(this.selectedSlot, card);
            this.closeCardPicker();
        };

        // Bind click events
        Utils.$$('.picker-card').forEach(el => {
            el.addEventListener('click', () => {
                const cardId = el.dataset.cardId;
                const card = filtered.find(c => c.id === cardId);
                if (card) commit(card);
            });
        });

        // Bind preview buttons (open the big viewer WITHOUT selecting the card)
        Utils.$$('.picker-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = filtered.find(c => c.id === btn.dataset.cardId);
                if (!card || typeof CardViewer === 'undefined') return;
                CardViewer.open(Utils.assetPath(card.image), {
                    name: card.name || '',
                    type: this.selectedSlot,
                    action: {
                        label: this.selectedSlot === 'consultant' ? 'Add to the pool' : 'Select this card',
                        onClick: () => commit(card)
                    }
                });
            });
        });
    },

    /**
     * Filter picker cards by search
     */
    filterPickerCards() {
        this.renderPickerCards();
    },

    /**
     * Set a card in a slot
     * @param {string} type - Slot type
     * @param {Object} card - Card data
     */
    setSlotCard(type, card) {
        const slot = Utils.getElement(`${type}-slot`);
        if (!slot) return;

        slot.innerHTML = `<img src="${Utils.assetPath(card.image)}" alt="${Utils.escapeHtml(card.name || type)}" onerror="Utils.onImgError(event)">`;
        slot.dataset.cardId = card.id;
        slot.dataset.card = JSON.stringify(card);

        // Mark the slot as filled (click-to-view) and unlock its swap button
        const wrapper = slot.closest('.scenario-slot');
        if (wrapper) {
            wrapper.dataset.filled = 'true';
            const swapBtn = wrapper.querySelector('.slot-swap-btn');
            if (swapBtn) swapBtn.disabled = false;
        }
    },

    /**
     * Randomize a single slot
     * @param {string} type - Slot type
     */
    randomizeSlot(type) {
        if (!this.deck) {
            Utils.showToast('Please load a deck first', 'warning');
            return;
        }

        const cards = this.cardLists[type];
        if (!cards?.length) return;

        const card = Utils.randomItem(cards);
        this.setSlotCard(type, card);
    },

    /**
     * Randomize all scenario slots
     */
    randomizeAll() {
        if (!this.deck) {
            Utils.showToast('Please load a deck first', 'warning');
            return;
        }

        // Randomizing builds a brand-new scenario; drop any handed-off metadata.
        this.pendingSaveMeta = null;

        ['initial', 'pivot', 'c2', 'persist'].forEach(type => {
            this.randomizeSlot(type);
        });

        Utils.showToast('Scenario randomized', 'success');
    },

    /**
     * Clear all slots
     */
    clearAll() {
        // Clearing builds a brand-new scenario; drop any handed-off metadata.
        this.pendingSaveMeta = null;

        ['initial', 'pivot', 'c2', 'persist'].forEach(type => {
            const slot = Utils.getElement(`${type}-slot`);
            if (slot) {
                slot.innerHTML = '<span class="slot-placeholder">Click to select</span>';
                delete slot.dataset.cardId;
                delete slot.dataset.card;

                // Mark the slot as empty and re-lock its swap button
                const wrapper = slot.closest('.scenario-slot');
                if (wrapper) {
                    wrapper.dataset.filled = 'false';
                    const swapBtn = wrapper.querySelector('.slot-swap-btn');
                    if (swapBtn) swapBtn.disabled = true;
                }
            }
        });

        this.procedures = [];
        this.renderProcedures();

        this.injects = [];
        this.renderInjects();

        this.consultants = [];
        this.startingConsultantId = null;
        this.renderConsultants();

        Utils.showToast('Scenario cleared', 'info');
    },

    /**
     * Draw a procedure card
     */
    drawProcedure() {
        if (!this.deck) return;

        const count = parseInt(Utils.getElement('procedure-count')?.value) || CONFIG.game.procedureCount;
        if (this.procedures.length >= count) {
            Utils.showToast('Maximum procedures reached', 'warning');
            return;
        }

        const available = this.cardLists.procedure.filter(
            card => !this.procedures.some(p => p.id === card.id)
        );

        if (available.length === 0) {
            Utils.showToast('No more procedure cards available', 'warning');
            return;
        }

        const card = Utils.randomItem(available);
        this.procedures.push(card);
        this.syncEnhancedFlags();
        this.renderProcedures();
    },

    /**
     * Shuffle procedure order
     */
    shuffleProcedures() {
        this.procedures = Utils.shuffle(this.procedures);
        this.syncEnhancedFlags();
        this.renderProcedures();
        Utils.showToast('Procedures shuffled', 'info');
    },

    /**
     * Clear all drawn procedure cards
     */
    clearProcedures() {
        if (!this.procedures.length) {
            Utils.showToast('No procedure cards to clear', 'info');
            return;
        }
        this.procedures = [];
        this.renderProcedures();
        Utils.showToast('Procedure cards cleared', 'info');
    },

    /**
     * Replace a single procedure with a random, unused procedure from the pool.
     * @param {number} index - Index of the procedure card to swap out
     */
    randomizeProcedure(index) {
        if (!this.deck || index < 0 || index >= this.procedures.length) return;

        const current = this.procedures[index];
        const others = this.procedures.filter((_, i) => i !== index);
        const available = (this.cardLists.procedure || []).filter(card =>
            !others.some(p => p.id === card.id) && card.id !== current.id
        );

        if (available.length === 0) {
            Utils.showToast('No replacement procedure cards available', 'warning');
            return;
        }

        const card = Utils.randomItem(available);
        this.procedures[index] = card;
        this.syncEnhancedFlags();
        this.renderProcedures();
        Utils.showToast(`Replaced "${current.name || 'Procedure'}" with "${card.name}"`, 'info');
    },

    /**
     * Enable/disable an expansion pack's cards in the loaded deck's pools.
     * @param {string} key - Expansion deck key (CONFIG.decks entry flagged expansion:true)
     * @param {boolean} enabled - Whether to include the expansion
     */
    async toggleExpansion(key, enabled) {
        const exp = this.expansions[key];
        if (!exp) return;
        const toggle = Utils.getElement(`${key}-toggle`);
        exp.enabled = !!enabled;

        if (exp.enabled && !this.deck) {
            exp.enabled = false;
            if (toggle) toggle.checked = false;
            return;
        }

        if (exp.enabled && !exp.lists) {
            await this.loadExpansion(key);
            if (!exp.lists) {
                // Expansion failed to load; revert the toggle
                exp.enabled = false;
                if (toggle) toggle.checked = false;
            }
        }

        this.refreshPools();

        if (exp.enabled && exp.lists) {
            Utils.showToast(
                `${exp.name || key} enabled (+${this.poolCountFor(exp.lists)} cards in pools)`,
                'success'
            );
        } else if (!exp.enabled) {
            Utils.showToast(`${exp.name || key} removed from pools`, 'info');
        }
    },

    /**
     * Load an expansion pack's card database once and categorize it by type.
     * Expansion ids are prefixed so they never collide with base-deck ids.
     * @param {string} key - Expansion deck key
     */
    async loadExpansion(key) {
        const exp = this.expansions[key];
        const cfg = (typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks[key] : null;
        if (!cfg || !exp) {
            Utils.showToast(`${key} is not configured`, 'error');
            return;
        }
        try {
            // no-store: expansion decks can change at runtime (the Custom Cards
            // deck is edited in the library), and nginx caches *.json for 5 min.
            const response = await fetch(cfg.path, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Failed to load ${cfg.path}: ${response.status}`);
            }
            const resp = await response.json();
            // One bucket per canonical card type (see Utils.CARD_TYPES).
            const lists = {};
            Utils.CARD_TYPES.forEach(type => { lists[type] = []; });
            const prefix = exp.prefix || '';
            resp.data.forEach(card => {
                const type = card.type?.toLowerCase();
                if (!lists[type]) return;
                // Cards can be disabled from the Custom Cards library.
                if (card.enabled === false) return;
                lists[type].push({
                    ...card,
                    id: `${prefix}${card.id}`,
                    image: Utils.assetPath(card.image)
                });
            });
            exp.lists = lists;
            exp.name = resp.title || cfg.name || key;
        } catch (error) {
            console.error(`Failed to load expansion ${key}:`, error);
            Utils.showToast(`Failed to load ${exp.name || key}`, 'error');
            exp.lists = null;
        }
    },

    /**
     * Rebuild the effective per-type pools from the base deck,
     * merging every enabled expansion pack (deduped by id).
     */
    refreshPools() {
        if (!this.deck || !this.baseCardLists) return;

        const types = [...Utils.CARD_TYPES];
        const lists = {};
        const used = {};
        types.forEach(t => {
            lists[t] = [...(this.baseCardLists[t] || [])];
            lists[t].forEach(c => { if (c && c.id) used[c.id] = 1; });
        });

        Object.values(this.expansions).forEach(exp => {
            if (!(exp.enabled && exp.lists)) return;
            types.forEach(t => {
                (exp.lists[t] || []).forEach(card => {
                    if (!used[card.id]) {
                        lists[t].push(card);
                        used[card.id] = 1;
                    }
                });
            });
        });

        this.cardLists = lists;
        this.updateDeckCount();
    },

    /**
     * Update the deck-info card count label (base vs base + expansions).
     */
    updateDeckCount() {
        const el = Utils.getElement('card-count');
        if (!el || !this.cardLists) return;
        const total = this.totalPoolCount();
        const enabled = Object.values(this.expansions)
            .filter(e => e.enabled && e.lists)
            .map(e => e.name);
        el.textContent = enabled.length
            ? `${total} cards (incl. ${enabled.join(', ')})`
            : `${total} cards`;
    },

    /**
     * Number of cards currently in the effective pools.
     * @returns {number}
     */
    totalPoolCount() {
        return Object.values(this.cardLists || {}).reduce((n, arr) => n + (arr ? arr.length : 0), 0);
    },

    /**
     * Number of cards in a categorized card list.
     * @param {Object} lists - Per-type card arrays
     * @returns {number}
     */
    poolCountFor(lists) {
        return Object.values(lists || {}).reduce((n, arr) => n + (arr ? arr.length : 0), 0);
    },

    /**
     * Get the configured enhanced-procedure count (clamped 0..procedureCount)
     */
    getEnhancedCount() {
        const procCount = parseInt(Utils.getElement('procedure-count')?.value) || CONFIG.game.procedureCount;
        const raw = parseInt(Utils.getElement('enhanced-count')?.value);
        if (Number.isNaN(raw)) return 0;
        return Math.max(0, Math.min(raw, procCount));
    },

    /**
     * Mark the first N procedures (by current display order) as enhanced
     */
    syncEnhancedFlags() {
        const enhancedCount = this.getEnhancedCount();
        this.procedures.forEach((card, index) => {
            card.enhanced = index < enhancedCount;
        });
    },

    /**
     * Render procedure cards
     */
    renderProcedures() {
        const container = Utils.getElement('procedure-grid');
        if (!container) return;

        container.innerHTML = this.procedures.map((card, index) => `
            <div class="procedure-card${card.enhanced ? ' enhanced' : ''}" data-procedure-index="${index}" title="${Utils.escapeHtml(card.name || 'Procedure')}${card.enhanced ? ' — ENHANCED (+3)' : ''}">
                <img src="${Utils.assetPath(card.image)}" alt="${Utils.escapeHtml(card.name || 'Procedure')}" onerror="Utils.onImgError(event)">
                <button type="button" class="proc-random-btn" data-procedure-index="${index}" title="Randomize — swap this procedure" aria-label="Randomize this procedure">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="2" width="20" height="20" rx="2"/>
                        <circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="8" r="1.5"/>
                        <circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="16" r="1.5"/>
                        <circle cx="12" cy="12" r="1.5"/>
                    </svg>
                </button>
                ${card.enhanced ? '<span class="enhanced-badge">✦ +3</span>' : ''}
            </div>
        `).join('');

        // Clear-all is only useful once there is something to clear
        const clearBtn = Utils.getElement('clear-procedures-btn');
        if (clearBtn) clearBtn.disabled = this.procedures.length === 0;
    },

    /**
     * Draw the full inject pool (N unique random inject cards; first = starting inject)
     */
    drawInjects() {
        if (!this.deck) return;

        const count = Math.min(6, Math.max(1, parseInt(Utils.getElement('inject-count')?.value) || 3));
        const available = this.cardLists.inject.filter(card => !this.injects.some(i => i.id === card.id));
        const needed = count - this.injects.length;
        if (needed <= 0) {
            Utils.showToast(`Inject pool full (${count})`, 'warning');
            return;
        }
        if (available.length === 0) {
            Utils.showToast('No more inject cards available', 'warning');
            return;
        }

        for (let i = 0; i < needed && available.length > 0; i++) {
            const card = Utils.randomItem(available);
            this.injects.push(card);
            const at = available.findIndex(c => c.id === card.id);
            if (at > -1) available.splice(at, 1);
        }
        this.renderInjects();
        Utils.showToast('Injects drawn', 'success');
    },

    /**
     * Clear the inject pool
     */
    clearInjects() {
        this.injects = [];
        this.renderInjects();
        Utils.showToast('Injects cleared', 'info');
    },

    /**
     * Render the inject pool (mini cards in queue order; first = starting inject)
     */
    renderInjects() {
        const container = Utils.getElement('injects-grid');
        if (!container) return;

        const count = Math.min(6, Math.max(1, parseInt(Utils.getElement('inject-count')?.value) || 3));
        if (this.injects.length > count) this.injects = this.injects.slice(0, count);

        container.innerHTML = this.injects.length === 0
            ? '<span class="slot-placeholder">Draw to add injects</span>'
            : this.injects.map((card, index) => `
                <div class="inject-card${index === 0 ? ' is-start' : ''}" data-inject-index="${index}" title="${index === 0 ? 'Starting inject — shown when the game starts' : 'Queued inject #' + (index + 1) + ' — fires on a natural 1/20 or 3 failed rolls'}">
                    <img src="${Utils.assetPath(card.image)}" alt="${Utils.escapeHtml(card.name || 'Inject')}" onerror="Utils.onImgError(event)">
                    <span class="inject-order">${index === 0 ? 'START' : '#' + (index + 1)}</span>
                </div>
            `).join('');
    },

    /**
     * Render the optional consultant pool ("Call a Consultant"). The starred
     * entry is the consultant already seated when the game starts.
     */
    renderConsultants() {
        const container = Utils.getElement('consultants-grid');
        if (!container) return;

        container.innerHTML = this.consultants.length === 0
            ? '<span class="slot-placeholder">Optional — leave empty to let players call anyone from the deck</span>'
            : this.consultants.map((card, index) => {
                const isStart = card.id === this.startingConsultantId;
                const name = Utils.escapeHtml(card.name || 'Consultant');
                return `
                <div class="consultant-card${isStart ? ' is-start' : ''}" data-consultant-index="${index}" title="${name}">
                    <img src="${Utils.assetPath(card.image)}" alt="${name}" onerror="Utils.onImgError(event)">
                    <button type="button" class="cons-start-btn" data-consultant-index="${index}" title="${isStart ? 'Starting consultant — click to unseat' : 'Seat this consultant when the game starts'}" aria-label="Toggle starting consultant">★</button>
                    <button type="button" class="cons-remove-btn" data-consultant-index="${index}" title="Remove from the pool" aria-label="Remove consultant">×</button>
                    ${isStart ? '<span class="cons-start-badge">START</span>' : ''}
                </div>`;
            }).join('');

        const clearBtn = Utils.getElement('clear-consultants-btn');
        if (clearBtn) clearBtn.disabled = this.consultants.length === 0;
    },

    /**
     * Add a consultant to the optional pool (from the card picker)
     * @param {Object} card - Consultant card
     */
    addConsultant(card) {
        if (!card) return;
        if (this.consultants.some(c => c.id === card.id)) {
            Utils.showToast(`${card.name || 'Consultant'} is already in the pool`, 'info');
            return;
        }
        this.consultants.push(card);
        // The first one added is seated by default so the pool is never
        // "configured but empty at the start".
        if (!this.startingConsultantId) this.startingConsultantId = card.id;
        this.renderConsultants();
        Utils.showToast(`Consultant added: ${card.name || 'Consultant'}`, 'success');
    },

    /**
     * Remove a consultant from the pool
     * @param {number} index - Pool index
     */
    removeConsultant(index) {
        const [card] = this.consultants.splice(index, 1);
        if (!card) return;
        if (this.startingConsultantId === card.id) {
            this.startingConsultantId = this.consultants[0]?.id || null;
        }
        this.renderConsultants();
    },

    /**
     * Star / unstar a pooled consultant as the starting consultant
     * @param {number} index - Pool index
     */
    setStartingConsultant(index) {
        const card = this.consultants[index];
        if (!card) return;
        this.startingConsultantId = (this.startingConsultantId === card.id) ? null : card.id;
        this.renderConsultants();
    },

    /**
     * Add every consultant in the loaded deck to the pool
     */
    addAllConsultants() {
        if (!this.deck) {
            Utils.showToast('Please load a deck first', 'warning');
            return;
        }
        const pool = this.cardLists.consultant || [];
        if (!pool.length) {
            Utils.showToast('This deck has no consultant cards', 'warning');
            return;
        }

        let added = 0;
        pool.forEach(card => {
            if (!this.consultants.some(c => c.id === card.id)) {
                this.consultants.push(card);
                added++;
            }
        });
        if (added && !this.startingConsultantId) this.startingConsultantId = this.consultants[0].id;
        this.renderConsultants();
        Utils.showToast(
            added ? `Added ${added} consultant${added === 1 ? '' : 's'}` : 'All consultants are already in the pool',
            added ? 'success' : 'info'
        );
    },

    /**
     * Empty the consultant pool
     */
    clearConsultants() {
        this.consultants = [];
        this.startingConsultantId = null;
        this.renderConsultants();
        Utils.showToast('Consultants cleared', 'info');
    },

    /**
     * Open save modal
     */
    openSaveModal() {
        // Check if scenario is complete
        const hasAllCards = ['initial', 'pivot', 'c2', 'persist'].every(type => {
            const slot = Utils.getElement(`${type}-slot`);
            return slot?.dataset.card;
        });

        if (!hasAllCards) {
            Utils.showToast('Please select all scenario cards first', 'warning');
            return;
        }

        this.saveTags = [];
        this.renderSaveTags();

        // Pre-fill from a handed-off (AI) scenario so it only needs final edits.
        this.applySavePrefill();

        Utils.showElement('save-modal-backdrop');
    },

    /**
     * Close save modal
     */
    closeSaveModal() {
        Utils.hideElement('save-modal-backdrop');

        // Clear form
        Utils.getElement('save-name').value = '';
        Utils.getElement('save-author').value = '';
        Utils.getElement('save-description').value = '';
        Utils.getElement('save-difficulty').value = '3';
        Utils.getElement('save-duration').value = '';
        Utils.getElement('save-notes').value = '';
        this.saveTags = [];
    },

    /**
     * Add tag to save tags
     * @param {string} tag - Tag to add
     */
    addSaveTag(tag) {
        if (tag && !this.saveTags.includes(tag)) {
            this.saveTags.push(tag);
            this.renderSaveTags();
        }
    },

    /**
     * Remove tag from save tags
     * @param {number} index - Index to remove
     */
    removeSaveTag(index) {
        this.saveTags.splice(index, 1);
        this.renderSaveTags();
    },

    /**
     * Render save tags
     */
    renderSaveTags() {
        const container = Utils.getElement('save-tags-input');
        const input = Utils.$('#save-tags-input input');

        // Remove existing tag elements
        Utils.$$('#save-tags-input .tag').forEach(el => el.remove());

        // Add tags before input
        this.saveTags.forEach((tag, index) => {
            const tagEl = Utils.createElement('span', { className: 'tag' }, [
                tag,
                Utils.createElement('button', {
                    type: 'button',
                    onClick: () => this.removeSaveTag(index)
                }, '×')
            ]);
            container.insertBefore(tagEl, input);
        });
    },

    /**
     * Save scenario to library
     */
    async saveScenario() {
        const name = Utils.getElement('save-name')?.value?.trim();
        if (!name) {
            Utils.showToast('Please enter a scenario name', 'warning');
            return;
        }

        // Build scenario object
        const scenarioCards = {};
        ['initial', 'pivot', 'c2', 'persist'].forEach(type => {
            const slot = Utils.getElement(`${type}-slot`);
            if (slot?.dataset.card) {
                scenarioCards[type] = JSON.parse(slot.dataset.card);
            }
        });

        const scenario = ScenarioSchema.createEmpty();
        scenario.deck = this.deck;
        scenario.scenario = scenarioCards;
        scenario.procedures = this.procedures;
        scenario.injects = [...this.injects];
        scenario.startingInject = this.injects[0] || null;
        // Optional consultant pool + the one already seated (may be null)
        scenario.consultants = [...this.consultants];
        scenario.consultant = this.consultants.find(c => c.id === this.startingConsultantId) || null;
        scenario.gameConfig = {
            initialTurns: parseInt(Utils.getElement('initial-turns')?.value) || 10,
            maxStrikes: parseInt(Utils.getElement('max-strikes')?.value) || 3,
            procedureCount: parseInt(Utils.getElement('procedure-count')?.value) || CONFIG.game.procedureCount,
            enhancedCount: parseInt(Utils.getElement('enhanced-count')?.value) || 0,
            injectCount: Math.min(6, Math.max(1, parseInt(Utils.getElement('inject-count')?.value) || 3)),
            successTarget: parseInt(Utils.getElement('success-target')?.value) || 11
        };
        scenario.metadata = {
            name,
            author: Utils.getElement('save-author')?.value?.trim() || '',
            description: Utils.getElement('save-description')?.value?.trim() || '',
            difficulty: parseInt(Utils.getElement('save-difficulty')?.value) || 3,
            estimatedDuration: Utils.getElement('save-duration')?.value?.trim() || '',
            tags: [...this.saveTags],
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        };
        scenario.notes = Utils.getElement('save-notes')?.value?.trim() || '';

        try {
            await ScenarioIO.saveToServer(scenario);
            this.closeSaveModal();
            // The hand-off metadata has been committed; future saves start fresh.
            this.pendingSaveMeta = null;
            Utils.showToast('Scenario saved to library', 'success');
            // Push the freshly built scenario to any open Player tab/window (GM -> board).
            if (window.SessionSync && typeof window.SessionSync.broadcastScenario === 'function') {
                window.SessionSync.broadcastScenario(scenario);
            }
        } catch (error) {
            console.error('Failed to save scenario:', error);
            Utils.showToast('Failed to save scenario', 'error');
        }
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    AdminController.init();
});

// Exposed for testing
window.AdminController = AdminController;
