/**
 * B&B Shuffle - Scenario Library Controller
 * Handles the scenario library UI and interactions
 */

const ScenarioLibrary = {
    // State
    scenarios: [],
    filteredScenarios: [],
    selectedScenario: null,
    currentView: 'grid',
    editingTags: [],

    /**
     * Initialize the library
     */
    async init() {
        this.bindEvents();
        await this.loadScenarios();
        this.render();
    },

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Search
        const searchInput = Utils.getElement('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce(() => {
                this.filterScenarios();
            }, 300));
        }

        // Filters
        const deckFilter = Utils.getElement('deck-filter');
        const difficultyFilter = Utils.getElement('difficulty-filter');
        if (deckFilter) deckFilter.addEventListener('change', () => this.filterScenarios());
        if (difficultyFilter) difficultyFilter.addEventListener('change', () => this.filterScenarios());

        // Box art beside the deck filter, for the deck that is selected (comes
        // from CONFIG.decks[].cover — shared/img/decks/<key>.webp). "All Decks"
        // and the few decks with no art upstream show no image.
        const deckCover = Utils.getElement('deck-filter-cover');
        const updateDeckCover = () => {
            if (!deckCover) return;
            const key = deckFilter?.value || '';
            const cfg = (key && typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks[key] : null;
            if (cfg && cfg.cover) {
                if (deckCover.getAttribute('src') !== cfg.cover) deckCover.setAttribute('src', cfg.cover);
                deckCover.alt = (cfg.name || key) + ' box art';
                Utils.showElement(deckCover);
            } else {
                deckCover.removeAttribute('src');
                Utils.hideElement(deckCover);
            }
        };
        if (deckFilter) deckFilter.addEventListener('change', updateDeckCover);
        updateDeckCover();

        // View toggle
        Utils.$$('.view-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setView(btn.dataset.view));
        });

        // Import buttons
        const importBtn = Utils.getElement('import-btn');
        const emptyImportBtn = Utils.getElement('empty-import-btn');
        const fileInput = Utils.getElement('file-input');

        if (importBtn) importBtn.addEventListener('click', () => fileInput?.click());
        if (emptyImportBtn) emptyImportBtn.addEventListener('click', () => fileInput?.click());
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileImport(e));

        // Drag and drop
        const dropzone = Utils.getElement('dropzone');
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            Utils.showElement(dropzone);
        });
        document.addEventListener('dragleave', (e) => {
            if (!e.relatedTarget) Utils.hideElement(dropzone);
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            Utils.hideElement(dropzone);
            this.handleFileDrop(e);
        });

        // Action bar buttons
        Utils.getElement('play-btn')?.addEventListener('click', () => this.playSelectedScenario());
        Utils.getElement('load-btn')?.addEventListener('click', () => this.loadSelectedScenario());
        Utils.getElement('edit-btn')?.addEventListener('click', () => this.openEditModal());
        Utils.getElement('export-btn')?.addEventListener('click', () => this.exportSelectedScenario());
        Utils.getElement('delete-btn')?.addEventListener('click', () => this.openDeleteModal());

        // Edit modal
        Utils.getElement('edit-modal-close')?.addEventListener('click', () => this.closeEditModal());
        Utils.getElement('edit-cancel-btn')?.addEventListener('click', () => this.closeEditModal());
        Utils.getElement('edit-save-btn')?.addEventListener('click', () => this.saveEditChanges());
        Utils.getElement('edit-modal-backdrop')?.addEventListener('click', (e) => {
            if (e.target.id === 'edit-modal-backdrop') this.closeEditModal();
        });

        // Tags input
        const tagsInput = Utils.$('#edit-tags-input input');
        if (tagsInput) {
            tagsInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addTag(tagsInput.value.trim());
                    tagsInput.value = '';
                }
            });
        }

        // Delete modal
        Utils.getElement('delete-modal-close')?.addEventListener('click', () => this.closeDeleteModal());
        Utils.getElement('delete-cancel-btn')?.addEventListener('click', () => this.closeDeleteModal());
        Utils.getElement('delete-confirm-btn')?.addEventListener('click', () => this.deleteSelectedScenario());
        Utils.getElement('delete-modal-backdrop')?.addEventListener('click', (e) => {
            if (e.target.id === 'delete-modal-backdrop') this.closeDeleteModal();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeEditModal();
                this.closeDeleteModal();
                this.deselectScenario();
            }
        });
    },

    /**
     * Load scenarios from server
     */
    async loadScenarios() {
        try {
            this.scenarios = await ScenarioIO.listFromServer();
            this.filterScenarios();
        } catch (error) {
            console.error('Failed to load scenarios:', error);
            // Try loading from localStorage as fallback
            this.scenarios = Utils.getFromStorage('bb-scenarios', [], true);
            this.filterScenarios();
        }
    },

    /**
     * Filter scenarios based on search and filters
     */
    filterScenarios() {
        const search = Utils.getElement('search-input')?.value.toLowerCase() || '';
        const deckFilter = Utils.getElement('deck-filter')?.value || '';
        const difficultyFilter = Utils.getElement('difficulty-filter')?.value || '';

        this.filteredScenarios = this.scenarios.filter(scenario => {
            // Search filter
            const matchesSearch = !search ||
                scenario.metadata?.name?.toLowerCase().includes(search) ||
                scenario.metadata?.description?.toLowerCase().includes(search) ||
                scenario.metadata?.author?.toLowerCase().includes(search) ||
                scenario.metadata?.tags?.some(t => t.toLowerCase().includes(search));

            // Deck filter
            const matchesDeck = !deckFilter || scenario.deck?.key === deckFilter;

            // Difficulty filter
            const matchesDifficulty = !difficultyFilter ||
                scenario.metadata?.difficulty === parseInt(difficultyFilter);

            return matchesSearch && matchesDeck && matchesDifficulty;
        });

        this.render();
    },

    /**
     * Set view mode
     * @param {string} view - 'grid' or 'list'
     */
    setView(view) {
        this.currentView = view;

        // Update toggle buttons
        Utils.$$('.view-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });

        // Toggle containers
        Utils.toggleElement('scenario-grid', view === 'grid');
        Utils.toggleElement('scenario-list', view === 'list');

        this.render();
    },

    /**
     * Render scenarios
     */
    render() {
        const grid = Utils.getElement('scenario-grid');
        const list = Utils.getElement('scenario-list');
        const empty = Utils.getElement('empty-state');
        const countBadge = Utils.getElement('scenario-count');

        // Update count
        if (countBadge) {
            countBadge.textContent = `${this.filteredScenarios.length} scenario${this.filteredScenarios.length !== 1 ? 's' : ''}`;
        }

        // Show empty state if no scenarios
        if (this.filteredScenarios.length === 0) {
            Utils.hideElement(grid);
            Utils.hideElement(list);
            Utils.showElement(empty);
            return;
        }

        Utils.hideElement(empty);

        if (this.currentView === 'grid') {
            Utils.showElement(grid);
            Utils.hideElement(list);
            grid.innerHTML = this.filteredScenarios.map(s => this.renderGridCard(s)).join('');
        } else {
            Utils.hideElement(grid);
            Utils.showElement(list);
            list.innerHTML = this.filteredScenarios.map(s => this.renderListItem(s)).join('');
        }

        // Bind click events to scenario items
        Utils.$$('[data-scenario-id]').forEach(el => {
            el.addEventListener('click', () => this.selectScenario(el.dataset.scenarioId));
        });
    },

    /**
     * Render grid card
     * @param {Object} scenario - Scenario data
     * @returns {string} HTML string
     */
    renderGridCard(scenario) {
        const isSelected = this.selectedScenario?.id === scenario.id;
        const difficulty = scenario.metadata?.difficulty || 3;
        const tags = scenario.metadata?.tags || [];

        return `
            <div class="scenario-card ${isSelected ? 'selected' : ''}" data-scenario-id="${scenario.id}">
                <div class="scenario-card-preview">
                    ${this.renderMiniCards(scenario)}
                </div>
                <div class="scenario-card-body">
                    <div class="scenario-card-title">
                        ${Utils.escapeHtml(scenario.metadata?.name || 'Untitled')}
                    </div>
                    <div class="scenario-card-meta">
                        <span class="scenario-card-meta-item">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="7" width="20" height="14" rx="2" />
                                <path d="M16 7V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v3" />
                            </svg>
                            ${Utils.escapeHtml(scenario.deck?.name || 'Unknown Deck')}
                        </span>
                        ${scenario.metadata?.author ? `
                        <span class="scenario-card-meta-item">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                            ${Utils.escapeHtml(scenario.metadata.author)}
                        </span>
                        ` : ''}
                    </div>
                    <div class="scenario-card-meta">
                        <span class="scenario-card-meta-item">
                            ${this.renderDifficulty(difficulty)}
                        </span>
                        <span class="scenario-card-meta-item">
                            ${Utils.formatRelativeTime(scenario.metadata?.modifiedAt || scenario.metadata?.createdAt)}
                        </span>
                    </div>
                    ${scenario.metadata?.description ? `
                    <div class="scenario-card-description">
                        ${Utils.escapeHtml(scenario.metadata.description)}
                    </div>
                    ` : ''}
                    ${this.renderConsultants(scenario)}
                    ${tags.length > 0 ? `
                    <div class="scenario-card-tags">
                        ${tags.slice(0, 3).map(tag => `<span class="scenario-tag">${Utils.escapeHtml(tag)}</span>`).join('')}
                        ${tags.length > 3 ? `<span class="scenario-tag">+${tags.length - 3}</span>` : ''}
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    /**
     * Render list item
     * @param {Object} scenario - Scenario data
     * @returns {string} HTML string
     */
    renderListItem(scenario) {
        const isSelected = this.selectedScenario?.id === scenario.id;
        const difficulty = scenario.metadata?.difficulty || 3;

        return `
            <div class="scenario-list-item ${isSelected ? 'selected' : ''}" data-scenario-id="${scenario.id}">
                <div class="scenario-list-preview">
                    ${this.renderMiniCards(scenario)}
                </div>
                <div class="scenario-list-content">
                    <div class="scenario-list-title">
                        ${Utils.escapeHtml(scenario.metadata?.name || 'Untitled')}
                        ${this.renderDifficulty(difficulty)}
                    </div>
                    <div class="scenario-list-meta">
                        <span>${Utils.escapeHtml(scenario.deck?.name || 'Unknown Deck')}</span>
                        ${scenario.metadata?.author ? `<span>by ${Utils.escapeHtml(scenario.metadata.author)}</span>` : ''}
                        <span>${Utils.formatRelativeTime(scenario.metadata?.modifiedAt || scenario.metadata?.createdAt)}</span>
                    </div>
                    ${this.renderConsultants(scenario)}
                </div>
            </div>
        `;
    },

    /**
     * Render mini card previews
     * @param {Object} scenario - Scenario data
     * @returns {string} HTML string
     */
    renderMiniCards(scenario) {
        const types = ['initial', 'pivot', 'c2', 'persist'];
        return types.map(type => {
            const card = scenario.scenario?.[type];
            if (card?.image) {
                return `<div class="mini-card"><img src="${Utils.assetPath(card.image)}" alt="${card.name || type}" onerror="Utils.onImgError(event)"></div>`;
            }
            return `<div class="mini-card" style="background: var(--color-${type})"></div>`;
        }).join('');
    },

    /**
     * Render the "Call a Consultant" line for a scenario: the consultant in
     * play (or the pool size) plus a couple of the other available names.
     * Returns '' for scenarios that define no consultants.
     * @param {Object} scenario - Scenario data
     * @returns {string} HTML string
     */
    renderConsultants(scenario) {
        const selected = scenario?.consultant || null;
        const pool = Array.isArray(scenario?.consultants) ? scenario.consultants : [];
        if (!selected && !pool.length) return '';

        const icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`;
        const label = selected
            ? `Consultant: ${Utils.escapeHtml(selected.name || 'Unknown')}`
            : `${pool.length} consultant${pool.length === 1 ? '' : 's'} available`;
        const others = pool
            .filter(c => !selected || String(c.id) !== String(selected.id))
            .slice(0, 2)
            .map(c => `<span class="scenario-tag consultant-tag">${Utils.escapeHtml(c.name || 'Consultant')}</span>`)
            .join('');

        return `
            <div class="scenario-card-tags consultant-tags">
                <span class="consultant-chip${selected ? ' lead' : ''}">${icon}${label}</span>
                ${others}
            </div>
        `;
    },

    /**
     * Render difficulty indicator
     * @param {number} level - Difficulty level 1-5
     * @returns {string} HTML string
     */
    renderDifficulty(level) {
        const dots = [];
        for (let i = 1; i <= 5; i++) {
            const filled = i <= level;
            const high = level >= 4 && filled;
            dots.push(`<span class="difficulty-dot ${filled ? 'filled' : ''} ${high ? 'high' : ''}"></span>`);
        }
        return `<span class="difficulty-rating">${dots.join('')}</span>`;
    },

    /**
     * Select a scenario
     * @param {string} id - Scenario UUID
     */
    selectScenario(id) {
        const scenario = this.scenarios.find(s => s.id === id);

        if (this.selectedScenario?.id === id) {
            // Deselect if clicking same item
            this.deselectScenario();
            return;
        }

        this.selectedScenario = scenario;

        // Update UI
        Utils.$$('[data-scenario-id]').forEach(el => {
            el.classList.toggle('selected', el.dataset.scenarioId === id);
        });

        // Show action bar
        const actionBar = Utils.getElement('action-bar');
        const selectedName = Utils.getElement('selected-name');
        if (actionBar) actionBar.classList.add('visible');
        if (selectedName) selectedName.textContent = scenario?.metadata?.name || 'Untitled';
    },

    /**
     * Deselect current scenario
     */
    deselectScenario() {
        this.selectedScenario = null;

        Utils.$$('[data-scenario-id]').forEach(el => {
            el.classList.remove('selected');
        });

        const actionBar = Utils.getElement('action-bar');
        if (actionBar) actionBar.classList.remove('visible');
    },

    /**
     * Load selected scenario into game
     */
    loadSelectedScenario() {
        if (!this.selectedScenario) return;

        // Store in localStorage for the game to pick up
        Utils.saveToStorage('bb-loaded-scenario', this.selectedScenario);

        // Redirect to admin page
        window.location.href = 'admin.html?loadScenario=true';
    },

    /**
     * Play the selected scenario on the Player board
     */
    playSelectedScenario() {
        if (!this.selectedScenario) return;

        // Store for the player + broadcast to an already-open Player, then open it.
        Utils.saveToStorage('bb-current-scenario', this.selectedScenario);
        if (window.SessionSync && typeof window.SessionSync.broadcastScenario === 'function') {
            window.SessionSync.broadcastScenario(this.selectedScenario);
        }
        window.location.href = 'player.html';
    },

    /**
     * Export selected scenario to file
     */
    exportSelectedScenario() {
        if (!this.selectedScenario) return;
        ScenarioIO.exportToFile(this.selectedScenario);
        Utils.showToast('Scenario exported successfully', 'success');
    },

    /**
     * Open edit modal
     */
    openEditModal() {
        if (!this.selectedScenario) return;

        const scenario = this.selectedScenario;

        // Populate form
        Utils.getElement('edit-name').value = scenario.metadata?.name || '';
        Utils.getElement('edit-author').value = scenario.metadata?.author || '';
        Utils.getElement('edit-description').value = scenario.metadata?.description || '';
        Utils.getElement('edit-difficulty').value = scenario.metadata?.difficulty || 3;
        Utils.getElement('edit-duration').value = scenario.metadata?.estimatedDuration || '';

        // Populate tags
        this.editingTags = [...(scenario.metadata?.tags || [])];
        this.renderEditTags();

        // Show modal
        Utils.showElement('edit-modal-backdrop');
    },

    /**
     * Close edit modal
     */
    closeEditModal() {
        Utils.hideElement('edit-modal-backdrop');
        this.editingTags = [];
    },

    /**
     * Add tag to editing tags
     * @param {string} tag - Tag to add
     */
    addTag(tag) {
        if (tag && !this.editingTags.includes(tag)) {
            this.editingTags.push(tag);
            this.renderEditTags();
        }
    },

    /**
     * Remove tag from editing tags
     * @param {number} index - Index to remove
     */
    removeTag(index) {
        this.editingTags.splice(index, 1);
        this.renderEditTags();
    },

    /**
     * Render tags in edit modal
     */
    renderEditTags() {
        const container = Utils.getElement('edit-tags-input');
        const input = Utils.$('#edit-tags-input input');

        // Remove existing tag elements
        Utils.$$('#edit-tags-input .tag').forEach(el => el.remove());

        // Add tags before input
        this.editingTags.forEach((tag, index) => {
            const tagEl = Utils.createElement('span', { className: 'tag' }, [
                tag,
                Utils.createElement('button', {
                    type: 'button',
                    onClick: () => this.removeTag(index)
                }, '×')
            ]);
            container.insertBefore(tagEl, input);
        });
    },

    /**
     * Save edit changes
     */
    async saveEditChanges() {
        if (!this.selectedScenario) return;

        const updatedScenario = {
            ...this.selectedScenario,
            metadata: {
                ...this.selectedScenario.metadata,
                name: Utils.getElement('edit-name').value || 'Untitled',
                author: Utils.getElement('edit-author').value || '',
                description: Utils.getElement('edit-description').value || '',
                difficulty: parseInt(Utils.getElement('edit-difficulty').value) || 3,
                estimatedDuration: Utils.getElement('edit-duration').value || '',
                tags: [...this.editingTags],
                modifiedAt: new Date().toISOString()
            }
        };

        try {
            await ScenarioIO.updateOnServer(this.selectedScenario.id, updatedScenario);

            // Update local state
            const index = this.scenarios.findIndex(s => s.id === this.selectedScenario.id);
            if (index > -1) {
                this.scenarios[index] = updatedScenario;
            }
            this.selectedScenario = updatedScenario;

            this.closeEditModal();
            this.filterScenarios();
            Utils.showToast('Scenario updated successfully', 'success');
        } catch (error) {
            console.error('Failed to update scenario:', error);
            Utils.showToast('Failed to update scenario', 'error');
        }
    },

    /**
     * Open delete confirmation modal
     */
    openDeleteModal() {
        if (!this.selectedScenario) return;

        Utils.getElement('delete-scenario-name').textContent =
            this.selectedScenario.metadata?.name || 'Untitled';

        Utils.showElement('delete-modal-backdrop');
    },

    /**
     * Close delete modal
     */
    closeDeleteModal() {
        Utils.hideElement('delete-modal-backdrop');
    },

    /**
     * Delete selected scenario
     */
    async deleteSelectedScenario() {
        if (!this.selectedScenario) return;

        try {
            await ScenarioIO.deleteFromServer(this.selectedScenario.id);

            // Remove from local state
            this.scenarios = this.scenarios.filter(s => s.id !== this.selectedScenario.id);
            this.deselectScenario();
            this.closeDeleteModal();
            this.filterScenarios();

            Utils.showToast('Scenario deleted', 'success');
        } catch (error) {
            console.error('Failed to delete scenario:', error);
            Utils.showToast('Failed to delete scenario', 'error');
        }
    },

    /**
     * Handle file import from input
     * @param {Event} e - Change event
     */
    async handleFileImport(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        await this.importFile(file);
        e.target.value = ''; // Reset input
    },

    /**
     * Handle file drop
     * @param {DragEvent} e - Drop event
     */
    async handleFileDrop(e) {
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;

        await this.importFile(file);
    },

    /**
     * Import a scenario file
     * @param {File} file - File to import
     */
    async importFile(file) {
        try {
            const scenario = await ScenarioIO.importFromFile(file);

            // Save to server
            const saved = await ScenarioIO.saveToServer(scenario);

            // Add to local state
            this.scenarios.push(saved);
            this.filterScenarios();

            Utils.showToast('Scenario imported successfully', 'success');
        } catch (error) {
            console.error('Failed to import scenario:', error);
            Utils.showToast(`Import failed: ${error.message}`, 'error');
        }
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    ScenarioLibrary.init();
});
