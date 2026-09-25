/**
 * B&B Shuffle - AI Scenario Generator
 * Uses LLM APIs to generate game scenarios
 */

const ScenarioAI = {
    // State
    cardDatabase: null,
    generatedScenario: null,
    settings: {
        temperature: 0.7,
        maxTokens: 2000
    },
    // Server-provided shared key state (see initSharedKey / fetchSharedConfig).
    shared: {
        available: false,
        configured: false,
        provider: '',
        providerName: '',
        model: '',
        customEndpoint: false
    },

    // Provider configurations. Each entry may also expose a modelsEndpoint so the
    // generator can list the models the supplied API key can actually use.
    providers: {
        openai: {
            name: 'OpenAI',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            modelsEndpoint: 'https://api.openai.com/v1/models',
            models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
        },
        anthropic: {
            name: 'Anthropic',
            endpoint: 'https://api.anthropic.com/v1/messages',
            modelsEndpoint: 'https://api.anthropic.com/v1/models',
            models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307']
        },
        mistral: {
            name: 'Mistral',
            endpoint: 'https://api.mistral.ai/v1/chat/completions',
            modelsEndpoint: 'https://api.mistral.ai/v1/models',
            models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo', 'codestral-latest']
        },
        xai: {
            name: 'xAI (Grok)',
            endpoint: 'https://api.x.ai/v1/chat/completions',
            modelsEndpoint: 'https://api.x.ai/v1/models',
            models: ['grok-3', 'grok-3-mini', 'grok-3-mini-fast', 'grok-2-latest']
        },
        perplexity: {
            name: 'Perplexity',
            endpoint: 'https://api.perplexity.ai/chat/completions',
            modelsEndpoint: 'https://api.perplexity.ai/models',
            models: ['sonar', 'sonar-pro', 'sonar-reasoning']
        },
        groq: {
            name: 'Groq',
            endpoint: 'https://api.groq.com/openai/v1/chat/completions',
            modelsEndpoint: 'https://api.groq.com/openai/v1/models',
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'gemma2-9b-it']
        },
        deepseek: {
            name: 'DeepSeek',
            endpoint: 'https://api.deepseek.com/chat/completions',
            modelsEndpoint: 'https://api.deepseek.com/models',
            models: ['deepseek-chat', 'deepseek-reasoner']
        },
        gemini: {
            name: 'Google Gemini',
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
            models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']
        },
        ollama: {
            name: 'Ollama',
            endpoint: 'http://localhost:11434/api/generate',
            modelsEndpoint: 'http://localhost:11434/api/tags',
            models: ['llama3', 'mistral', 'codellama']
        }
    },

    /**
     * Initialize the generator
     */
    async init() {
        this.loadSettings();
        this.bindEvents();
        await this.initSharedKey();
    },

    /**
     * Load settings from storage
     */
    loadSettings() {
        const saved = Utils.getFromStorage('bb-ai-settings');
        if (saved) {
            this.settings = { ...this.settings, ...saved };

            // Apply saved settings to UI
            if (saved.provider) {
                Utils.getElement('api-provider').value = saved.provider;
                // Populate the model list for the saved provider
                if (this.providers[saved.provider]) this.updateProviderUI(saved.provider);
            }
            if (saved.model) Utils.getElement('api-model').value = saved.model;
            if (saved.apiKey) Utils.getElement('api-key').value = saved.apiKey;
            if (saved.temperature) {
                Utils.getElement('temperature').value = saved.temperature;
                Utils.getElement('temp-value').textContent = saved.temperature;
            }
            if (saved.maxTokens) Utils.getElement('max-tokens').value = saved.maxTokens;

            // A saved full API key (or Ollama) -> list the provider's models.
            this.maybeAutoRefreshModels();
        }
    },

    /**
     * Save settings to storage
     */
    saveSettings() {
        const settings = {
            provider: Utils.getElement('api-provider').value,
            model: Utils.getElement('api-model').value,
            apiKey: Utils.getElement('api-key').value,
            temperature: parseFloat(Utils.getElement('temperature').value),
            maxTokens: parseInt(Utils.getElement('max-tokens').value)
        };

        // In shared-key mode the API key field is hidden; keep the user's last
        // saved "own" key so it is not wiped out by an empty value.
        if (this.keyMode() === 'shared') {
            const prev = Utils.getFromStorage('bb-ai-settings', null, true);
            if (prev && prev.apiKey) settings.apiKey = prev.apiKey;
        }

        if (Utils.getElement('save-settings').checked) {
            Utils.saveToStorage('bb-ai-settings', settings);
        }

        this.settings = settings;
        this.closeSettingsModal();
        // Saved API key (or Ollama) -> refresh the model list from the provider.
        this.maybeAutoRefreshModels();
        Utils.showToast('Settings saved', 'success');
    },

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Provider change
        Utils.getElement('api-provider')?.addEventListener('change', (e) => {
            this.updateProviderUI(e.target.value);
            // Pull the live model list when a full API key is already present.
            this.maybeAutoRefreshModels();
        });

        // API key entry -> once a full API key is provided, list the models the
        // account can actually use so the user can pick from them.
        Utils.getElement('api-key')?.addEventListener('input', Utils.debounce(() => {
            const provider = Utils.getElement('api-provider')?.value || 'openai';
            const key = Utils.getElement('api-key')?.value?.trim() || '';
            if (provider === 'custom') return;
            if (provider === 'ollama' || key.length >= 8) {
                this.refreshModels();
            } else if (!key) {
                // Key removed -> fall back to the curated list for this provider.
                this.populateStaticModels(provider);
                this.setModelHint('Enter your API key to load available models.');
            }
        }, 600));

        // Manual refresh next to the model dropdown (re-queries when a new key is
        // pasted after the auto-load already ran, or the list is stale).
        Utils.getElement('refresh-models-btn')?.addEventListener('click', () => {
            const provider = Utils.getElement('api-provider')?.value || '';
            if (provider === 'custom' && this.keyMode() !== 'shared') {
                Utils.showToast('Custom endpoints do not expose a model list', 'info');
                return;
            }
            this.refreshModels();
        });

        // Key source radios: my own API key vs. the server's shared key.
        Utils.$$('input[name="key-mode"]').forEach(radio => {
            radio.addEventListener('change', () => this.applyKeyMode());
        });

        // Server shared-key owner configuration.
        Utils.getElement('shared-provider')?.addEventListener('change', () => this.toggleSharedCustomEndpoint());
        Utils.getElement('shared-save-btn')?.addEventListener('click', () => this.saveSharedConfig());
        Utils.getElement('shared-clear-btn')?.addEventListener('click', () => this.clearSharedConfig());

        // Generate button
        Utils.getElement('generate-btn')?.addEventListener('click', () => this.generateScenario());

        // Copy button
        Utils.getElement('copy-btn')?.addEventListener('click', () => this.copyToClipboard());

        // Save button
        Utils.getElement('save-btn')?.addEventListener('click', () => this.saveToLibrary());

        // Settings modal
        Utils.getElement('settings-btn')?.addEventListener('click', () => this.openSettingsModal());
        Utils.getElement('settings-modal-close')?.addEventListener('click', () => this.closeSettingsModal());
        Utils.getElement('settings-save-btn')?.addEventListener('click', () => this.saveSettings());
        Utils.getElement('settings-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') this.closeSettingsModal();
        });

        // Temperature slider
        Utils.getElement('temperature')?.addEventListener('input', (e) => {
            Utils.getElement('temp-value').textContent = e.target.value;
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeSettingsModal();
            if (e.ctrlKey && e.key === 'Enter') this.generateScenario();
        });
    },

    /**
     * Update UI based on selected provider
     * @param {string} provider - Provider key
     */
    updateProviderUI(provider) {
        const modelGroup = Utils.getElement('model-group');
        const customEndpointGroup = Utils.getElement('custom-endpoint-group');

        // Show/hide custom endpoint. Custom endpoints have no curated model list;
        // the model dropdown is hidden and a raw endpoint is used instead.
        Utils.toggleElement(customEndpointGroup, provider === 'custom');
        Utils.toggleElement(modelGroup, provider !== 'custom');

        // Restore the provider's curated model list as a starting point. When a
        // full API key is present (or for Ollama) the live list replaces these.
        if (this.providers[provider]) {
            this.populateStaticModels(provider);
            this.setModelHint(
                provider === 'ollama'
                    ? 'Ollama models will be loaded automatically.'
                    : 'Enter your API key to load available models.'
            );
        }
    },

    /**
     * Fill the model dropdown with a provider's curated fallback list.
     * @param {string} provider - Provider key
     */
    populateStaticModels(provider) {
        const modelSelect = Utils.getElement('api-model');
        if (!modelSelect) return;
        const cfg = this.providers[provider];
        modelSelect.innerHTML = '';
        if (!cfg || !Array.isArray(cfg.models)) return;
        cfg.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        });
    },

    /**
     * Update the hint line under the model dropdown.
     * @param {string} text - Hint text
     * @param {string} state - '' | 'ok' | 'error'
     */
    setModelHint(text, state = '') {
        const hint = Utils.getElement('model-hint');
        if (!hint) return;
        hint.textContent = text || '';
        hint.classList.toggle('model-hint-error', state === 'error');
        hint.classList.toggle('model-hint-ok', state === 'ok');
    },

    /**
     * Fetch the live model list when the current provider+key can support it.
     */
    maybeAutoRefreshModels() {
        const provider = Utils.getElement('api-provider')?.value || '';
        const key = Utils.getElement('api-key')?.value?.trim() || '';
        if (provider === 'custom') return;
        if (provider === 'ollama' || key.length >= 8) {
            this.refreshModels();
        } else {
            this.setModelHint('Enter your API key to load available models.');
        }
    },

    /**
     * Query the provider for the models this API key can use and list them in
     * the Model dropdown. Falls back to the curated list on any error.
     */
    async refreshModels() {
        const modelSelect = Utils.getElement('api-model');
        const refreshBtn = Utils.getElement('refresh-models-btn');
        if (!modelSelect || this._loadingModels) return;

        const provider = Utils.getElement('api-provider')?.value || '';
        const apiKey = Utils.getElement('api-key')?.value?.trim() || '';

        // Shared-key mode lists models through the server proxy (no key here).
        if (this.keyMode() === 'shared') {
            this.refreshSharedModels();
            return;
        }

        if (provider === 'custom') return;
        if (provider !== 'ollama' && !apiKey) {
            this.setModelHint('Enter your API key to load available models.', 'error');
            return;
        }

        this._loadingModels = true;
        modelSelect.disabled = true;
        if (refreshBtn) refreshBtn.disabled = true;
        this.setModelHint(provider === 'ollama' ? 'Loading models from Ollama…' : 'Loading available models…');

        try {
            const data = await this.listProviderModels(provider, apiKey);
            const models = this.extractModelIds(data);
            if (!models.length) {
                this.populateStaticModels(provider);
                this.setModelHint('No models were returned by this provider.', 'error');
                return;
            }
            this.populateModelSelect(models);
            this.setModelHint(
                `${models.length} model${models.length === 1 ? '' : 's'} available.`,
                'ok'
            );
        } catch (error) {
            console.warn('Model list unavailable; using curated defaults:', error);
            this.populateStaticModels(provider);
            this.setModelHint('Could not load models: ' + (error.message || 'request failed'), 'error');
        } finally {
            modelSelect.disabled = false;
            if (refreshBtn) refreshBtn.disabled = false;
            this._loadingModels = false;
        }
    },

    /**
     * Call the provider's models endpoint and return the raw response JSON.
     * @param {string} provider - Provider key
     * @param {string} apiKey - API key ('' for Ollama)
     * @returns {Promise<Object>} Provider model-list response body
     */
    async listProviderModels(provider, apiKey) {
        const cfg = this.providers[provider];
        if (!cfg) throw new Error('Unknown provider');

        const headers = { 'Accept': 'application/json' };
        let url = cfg.modelsEndpoint || '';

        if (provider === 'custom') {
            // Best effort: OpenAI-compatible servers expose a sibling /models endpoint.
            const endpoint = Utils.getElement('custom-endpoint')?.value?.trim();
            if (!endpoint) throw new Error('Custom endpoint not configured');
            url = endpoint.replace(/\/chat\/completions\/?$/, '/models');
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (provider === 'ollama') {
            url = url || 'http://localhost:11434/api/tags';
        } else if (provider === 'anthropic') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
        } else {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        if (!url) throw new Error('No model list endpoint for this provider');

        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) {
            let message = `Failed to load models (${response.status})`;
            try {
                const err = await response.json();
                message = err.error?.message || err.message || message;
            } catch (e) { /* non-JSON error body */ }
            throw new Error(message);
        }
        return await response.json();
    },

    /**
     * Pull model ids out of the various provider list shapes.
     * @param {Object|Array} data - Response JSON
     * @returns {string[]} Deduplicated, alphabetised model ids
     */
    extractModelIds(data) {
        let items = [];
        if (Array.isArray(data)) items = data;
        else if (Array.isArray(data?.data)) items = data.data;
        else if (Array.isArray(data?.models)) items = data.models;
        else if (data?.data && Array.isArray(data.data.data)) items = data.data.data;

        const seen = new Set();
        const ids = [];
        items.forEach(item => {
            if (!item) return;
            const id = typeof item === 'string' ? item : (item.id || item.name || item.model || item.model_name || '');
            const clean = String(id).trim();
            if (clean && !seen.has(clean)) {
                seen.add(clean);
                ids.push(clean);
            }
        });
        return ids.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },

    /**
     * Replace the Model dropdown options with a live provider list, keeping the
     * user's current selection when it is still available.
     * @param {string[]} models - Model ids to show
     */
    populateModelSelect(models) {
        const select = Utils.getElement('api-model');
        if (!select) return;
        const previous = select.value;
        select.innerHTML = '';
        models.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = id;
            select.appendChild(opt);
        });
        if (previous && models.includes(previous)) select.value = previous;
        else if (select.options.length) select.selectedIndex = 0;
    },

    // ---- Server-shared key (proxy) support ----

    /** Current key source chosen by the user: 'own' or 'shared'. */
    keyMode() {
        const el = document.querySelector('input[name="key-mode"]:checked');
        return el ? el.value : 'own';
    },

    /** Fetch the server's shared-key config (public info only; the key never leaves the server). */
    async fetchSharedConfig() {
        try {
            const res = await fetch('/api/ai/config', { cache: 'reload' });
            if (!res.ok) throw new Error('unavailable');
            const data = await res.json();
            this.shared = {
                available: true,
                configured: Boolean(data && data.configured),
                provider: (data && data.provider) || '',
                providerName: (data && data.providerName) || '',
                model: (data && data.model) || '',
                customEndpoint: Boolean(data && data.customEndpoint)
            };
        } catch (e) {
            this.shared = { available: false, configured: false, provider: '', providerName: '', model: '', customEndpoint: false };
        }
        return this.shared;
    },

    /** Set up the key-source UI once at startup. */
    async initSharedKey() {
        const sharedRadio = Utils.getElement('key-mode-shared');
        const ownRadio = Utils.getElement('key-mode-own');
        if (!sharedRadio || !ownRadio) return;

        await this.fetchSharedConfig();

        if (!this.shared.available) {
            sharedRadio.disabled = true;
            this.setSharedHint('Shared key requires the app server (API) — not available on this page.', 'error');
            return;
        }

        // Restore the user's last key source when a shared key is configured.
        const stored = Utils.getFromStorage('bb-ai-key-source', 'own');
        const toCheck = this.shared.configured && stored === 'shared' ? 'shared' : 'own';
        (toCheck === 'shared' ? sharedRadio : ownRadio).checked = true;

        this.populateSharedConfigForm();
        this.refreshSharedStatus();
        await this.applyKeyMode();
    },

    /** Prefill owner-config fields from the server (public fields only). */
    populateSharedConfigForm() {
        const providerEl = Utils.getElement('shared-provider');
        if (providerEl && this.shared.provider) providerEl.value = this.shared.provider;
        const modelEl = Utils.getElement('shared-model');
        if (modelEl) modelEl.value = this.shared.model || '';
        const endpointEl = Utils.getElement('shared-custom-endpoint');
        if (endpointEl && this.shared.customEndpoint && this.shared.provider === 'custom') {
            endpointEl.value = '(configured on server)';
        }
        this.toggleSharedCustomEndpoint();
    },

    /** Status text inside the owner-config summary. */
    refreshSharedStatus() {
        const el = Utils.getElement('shared-config-status');
        if (!el) return;
        if (!this.shared.available) el.textContent = '· server not reachable';
        else if (this.shared.configured) el.textContent = `· ${this.shared.providerName || this.shared.provider}`;
        else el.textContent = '· not configured';
    },

    /** Hint line under the key-source radios. */
    setSharedHint(text, tone) {
        const hint = Utils.getElement('shared-state-hint');
        if (!hint) return;
        hint.textContent = text || '';
        hint.classList.toggle('shared-hint-error', tone === 'error');
        hint.classList.toggle('shared-hint-ok', tone === 'ok');
    },

    /** Show/hide the right fields for the selected key source. */
    async applyKeyMode() {
        const shared = this.keyMode() === 'shared';
        Utils.saveToStorage('bb-ai-key-source', shared ? 'shared' : 'own');

        if (!shared) {
            Utils.showElement('provider-group');
            Utils.showElement('api-key-group');
            const provider = Utils.getElement('api-provider')?.value || '';
            this.updateProviderUI(provider); // model/custom-endpoint + static list + hint
            const key = Utils.getElement('api-key')?.value?.trim() || '';
            if (provider === 'ollama' || key.length >= 8) this.refreshModels();
            this.setSharedHint('Shared mode uses a key stored on this server so players don\'t need their own. The key never reaches this browser.');
            return;
        }

        // Shared mode: hide the per-user key fields; keep the Model picker.
        Utils.hideElement('provider-group');
        Utils.hideElement('api-key-group');
        Utils.hideElement('custom-endpoint-group');
        Utils.showElement('model-group');

        if (!this.shared.available) {
            this.setSharedHint('Shared key requires the app server (API) — not available on this page.', 'error');
            return;
        }
        if (!this.shared.configured) {
            this.setSharedHint('No shared key configured yet — open “Shared key on this server” below to add one.', 'error');
            return;
        }

        this.setSharedHint(`Generating with the server's shared key (${this.shared.providerName || this.shared.provider}). No API key needed.`, 'ok');
        await this.refreshSharedModels();
    },

    /** Load the provider's models through the server proxy (shared key). */
    async refreshSharedModels() {
        const select = Utils.getElement('api-model');
        const refreshBtn = Utils.getElement('refresh-models-btn');
        if (!select) return;
        this.setModelHint('Loading models via the server…');
        select.disabled = true;
        if (refreshBtn) refreshBtn.disabled = true;

        let loaded = false;
        try {
            const res = await fetch('/api/ai/models', { cache: 'no-store' });
            if (!res.ok) throw new Error('shared model list failed');
            const data = await res.json();
            const models = this.extractModelIds(data);
            if (models.length) {
                this.populateModelSelect(models);
                this.setModelHint(`${models.length} model${models.length === 1 ? '' : 's'} available (shared key).`, 'ok');
                loaded = true;
            }
        } catch (e) {
            console.warn('Shared model list unavailable:', e);
        }

        if (!loaded) {
            if (this.shared.model) {
                select.innerHTML = '';
                const opt = document.createElement('option');
                opt.value = this.shared.model;
                opt.textContent = this.shared.model;
                select.appendChild(opt);
                this.setModelHint(`Using the server default model (${this.shared.model}).`, 'ok');
            } else {
                this.setModelHint('Could not load models; generation will use the server default.', 'error');
            }
        }

        select.disabled = false;
        if (refreshBtn) refreshBtn.disabled = false;
    },

    /** Toggle the custom-endpoint field inside the owner config. */
    toggleSharedCustomEndpoint() {
        const providerEl = Utils.getElement('shared-provider');
        if (!providerEl) return;
        Utils.toggleElement('shared-custom-endpoint-group', providerEl.value === 'custom');
    },

    /** Save the operator's shared key to the server. */
    async saveSharedConfig() {
        const provider = Utils.getElement('shared-provider')?.value || '';
        const apiKey = Utils.getElement('shared-api-key')?.value?.trim() || '';
        const model = Utils.getElement('shared-model')?.value?.trim() || '';
        const endpoint = Utils.getElement('shared-custom-endpoint')?.value?.trim() || '';

        if (provider === 'custom' && !endpoint) {
            Utils.showToast('Custom provider requires an endpoint URL', 'error');
            return;
        }
        if (provider !== 'custom' && !apiKey) {
            Utils.showToast('Enter the API key to store on the server', 'warning');
            return;
        }

        try {
            const res = await fetch('/api/ai/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, apiKey, model, endpoint })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success === false) {
                throw new Error(data.error || data.message || 'Save failed');
            }
            const keyInput = Utils.getElement('shared-api-key');
            if (keyInput) keyInput.value = '';
            await this.fetchSharedConfig();
            const sharedRadio = Utils.getElement('key-mode-shared');
            if (sharedRadio) sharedRadio.disabled = false;
            this.refreshSharedStatus();
            if (this.keyMode() === 'shared') await this.applyKeyMode();
            Utils.showToast('Shared key saved to the server', 'success');
        } catch (e) {
            Utils.showToast('Could not save shared key: ' + e.message, 'error');
        }
    },

    /** Remove the shared key from the server. */
    async clearSharedConfig() {
        try {
            const res = await fetch('/api/ai/config', { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok && data.success === false) throw new Error(data.error || 'Remove failed');
            await this.fetchSharedConfig();
            const ownRadio = Utils.getElement('key-mode-own');
            if (ownRadio) ownRadio.checked = true;
            const modelEl = Utils.getElement('shared-model');
            if (modelEl) modelEl.value = '';
            this.refreshSharedStatus();
            await this.applyKeyMode();
            Utils.showToast('Shared key removed', 'success');
        } catch (e) {
            Utils.showToast('Could not remove shared key: ' + e.message, 'error');
        }
    },

    /**
     * Resolve a deck key to its root-relative deck folder (e.g. "shared/decks/core") from CONFIG.decks.
     * @param {string} deckKey - Deck identifier
     * @returns {string} Root-relative deck folder ('' when unknown)
     */
    resolveDeckDir(deckKey) {
        const cfg = (typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks[deckKey] : null;
        const path = (cfg && cfg.path) ? cfg.path : '';
        return path.replace(/^\.\.\//, '').replace(/\/carddb\.json$/, '');
    },

    /**
     * Load card database for selected deck
     * @param {string} deckKey - Deck identifier
     */
    async loadCardDatabase(deckKey) {
        try {
            const deckDir = this.resolveDeckDir(deckKey);
            if (!deckDir) {
                throw new Error(`Unknown deck: ${deckKey}`);
            }
            const response = await Utils.loadJson(`../../../${deckDir}/carddb.json`);
            this.cardDatabase = response;
            return response;
        } catch (error) {
            console.error('Failed to load card database:', error);
            throw new Error('Failed to load card database');
        }
    },

    /**
     * Generate a scenario using AI
     */
    async generateScenario() {
        const apiKey = Utils.getElement('api-key')?.value;
        const provider = Utils.getElement('api-provider')?.value;
        const sharedMode = this.keyMode() === 'shared';

        if (sharedMode) {
            if (!this.shared.available) {
                Utils.showToast('Shared key mode requires the app server (API)', 'warning');
                return;
            }
            if (!this.shared.configured) {
                Utils.showToast('No shared key is configured on the server yet', 'warning');
                return;
            }
        } else if (!apiKey && provider !== 'ollama') {
            Utils.showToast('Please enter an API key', 'warning');
            return;
        }

        // Show loading state
        this.showLoading(true);
        this.showStatus('');

        try {
            // Load card database
            const deckKey = Utils.getElement('deck-select')?.value || 'core';
            await this.loadCardDatabase(deckKey);

            // Build prompt
            const prompt = this.buildPrompt();

            // Call API
            const response = await this.callAPI(provider, apiKey, prompt);

            // Parse response
            const scenario = this.parseResponse(response, deckKey);

            // Display result
            this.generatedScenario = scenario;
            this.displayResult(scenario);

            // Enable buttons
            Utils.getElement('copy-btn').disabled = false;
            Utils.getElement('save-btn').disabled = false;

            this.showStatus('Scenario generated successfully!', 'success');
        } catch (error) {
            console.error('Generation failed:', error);
            this.showStatus('Generation failed: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * Build the generation prompt
     * @returns {string} Prompt text
     */
    buildPrompt() {
        const difficulty = Utils.getElement('difficulty-select')?.value || '3';
        const theme = Utils.getElement('theme-select')?.value || 'any';
        const context = Utils.getElement('context-input')?.value || '';

        // Get available cards by type
        const cardsByType = {};
        (this.cardDatabase.data || []).forEach(card => {
            const type = card.type?.toLowerCase();
            if (!cardsByType[type]) cardsByType[type] = [];
            cardsByType[type].push(card.name);
        });

        const prompt = `You are a cybersecurity tabletop exercise designer. Generate a B&B Shuffle scenario.

## Available Cards

Initial Access cards: ${cardsByType.initial?.join(', ') || 'None'}
Pivot cards: ${cardsByType.pivot?.join(', ') || 'None'}
C2 (Command & Control) cards: ${cardsByType.c2?.join(', ') || 'None'}
Persistence cards: ${cardsByType.persist?.join(', ') || 'None'}
${cardsByType.consultant?.length ? `Consultant cards (opt-in expert the players may call): ${cardsByType.consultant.join(', ')}
` : ''}
## Requirements

- Difficulty: ${difficulty}/5
- Theme: ${theme === 'any' ? 'Choose an appropriate theme' : theme}
${context ? `- Additional context: ${context}` : ''}

## Output Format

Respond with a JSON object containing:
{
  "name": "Scenario name",
  "description": "Brief description of the attack scenario",
  "initial": "Exact name of an Initial card from the list",
  "pivot": "Exact name of a Pivot card from the list",
  "c2": "Exact name of a C2 card from the list",
  "persist": "Exact name of a Persistence card from the list",${cardsByType.consultant?.length ? `
  "consultant": "Exact name of a Consultant card from the list, or null when none fits",` : ''}
  "difficulty": ${difficulty},
  "notes": "Facilitator notes explaining the attack chain and how the cards connect"
}

IMPORTANT: 
- Use EXACT card names from the provided lists
- Create a realistic, coherent attack narrative
${cardsByType.consultant?.length ? '- The consultant is optional: name one only when that expert genuinely fits the scenario, otherwise use null\n' : ''}- Notes should help the GM understand the attack flow
- Respond ONLY with the JSON object, no additional text`;

        return prompt;
    },

    /**
     * Call the AI API
     * @param {string} provider - Provider key
     * @param {string} apiKey - API key
     * @param {string} prompt - Prompt text
     * @returns {string} Response text
     */
    async callAPI(provider, apiKey, prompt) {
        // Shared-key mode: the server proxies the request with its stored key.
        if (this.keyMode() === 'shared') {
            return await this.callShared(prompt);
        }

        const config = this.providers[provider];

        if (provider === 'openai') {
            return await this.callOpenAI(apiKey, prompt);
        } else if (provider === 'anthropic') {
            return await this.callAnthropic(apiKey, prompt);
        } else if (provider === 'ollama') {
            return await this.callOllama(prompt);
        } else if (['mistral', 'xai', 'perplexity', 'groq', 'deepseek', 'gemini'].includes(provider)) {
            return await this.callCompatible(provider, apiKey, prompt);
        } else if (provider === 'custom') {
            return await this.callCustom(apiKey, prompt);
        }

        throw new Error('Unknown provider');
    },

    /**
     * Call the AI through the server's shared-key proxy. The API key stays on
     * the server, so players never need to supply their own.
     * @param {string} prompt - Prompt text
     * @returns {Promise<string>} Response text
     */
    async callShared(prompt) {
        let response;
        try {
            response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: Utils.getElement('api-model')?.value || this.shared.model || '',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: this.settings.temperature,
                    maxTokens: this.settings.maxTokens
                })
            });
        } catch (e) {
            throw new Error('Could not reach the AI proxy on the server');
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || data.message || `Proxy request failed (${response.status})`);
        }
        if (!data || typeof data.content !== 'string' || !data.content) {
            throw new Error('Empty response from the AI proxy');
        }
        return data.content;
    },

    /**
     * Call OpenAI API
     */
    async callOpenAI(apiKey, prompt) {
        const model = Utils.getElement('api-model')?.value || 'gpt-4o-mini';

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: this.settings.temperature,
                max_tokens: this.settings.maxTokens
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();
        return data.choices[0].message.content;
    },

    /**
     * Call any OpenAI-compatible chat-completions API (Mistral, xAI/Grok,
     * Perplexity, Groq, DeepSeek, and Gemini's OpenAI-compatible endpoint).
     * @param {string} provider - Provider key from this.providers
     * @param {string} apiKey - API key
     * @param {string} prompt - Prompt text
     * @returns {string} Response text
     */
    async callCompatible(provider, apiKey, prompt) {
        const config = this.providers[provider];
        if (!config || !config.endpoint) throw new Error('Provider not configured');

        const model = Utils.getElement('api-model')?.value || (config.models && config.models[0]);
        const response = await fetch(config.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: this.settings.temperature,
                max_tokens: this.settings.maxTokens
            })
        });

        if (!response.ok) {
            let message = `API request failed (${response.status})`;
            try {
                const err = await response.json();
                message = err.error?.message || err.message || message;
            } catch (e) { /* non-JSON error body */ }
            throw new Error(message);
        }

        const data = await response.json();
        return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
            || data.response
            || data.text
            || '';
    },

    /**
     * Call Anthropic API
     */
    async callAnthropic(apiKey, prompt) {
        const model = Utils.getElement('api-model')?.value || 'claude-3-sonnet-20240229';

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: this.settings.maxTokens
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();
        return data.content[0].text;
    },

    /**
     * Call Ollama API (local)
     */
    async callOllama(prompt) {
        const model = Utils.getElement('api-model')?.value || 'llama3';

        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error('Ollama request failed. Is Ollama running?');
        }

        const data = await response.json();
        return data.response;
    },

    /**
     * Call custom endpoint
     */
    async callCustom(apiKey, prompt) {
        const endpoint = Utils.getElement('custom-endpoint')?.value;
        if (!endpoint) throw new Error('Custom endpoint not configured');

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: prompt }],
                temperature: this.settings.temperature,
                max_tokens: this.settings.maxTokens
            })
        });

        if (!response.ok) {
            throw new Error('Custom API request failed');
        }

        const data = await response.json();
        // Try common response formats
        return data.choices?.[0]?.message?.content ||
               data.content?.[0]?.text ||
               data.response ||
               data.text;
    },

    /**
     * Parse AI response into scenario object
     * @param {string} response - Raw API response
     * @param {string} deckKey - Deck identifier
     * @returns {Object} Scenario object
     */
    parseResponse(response, deckKey) {
        // Extract JSON from response
        let json;
        try {
            // Try direct parse first
            json = JSON.parse(response);
        } catch {
            // Try to extract JSON from markdown code block
            const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                json = JSON.parse(jsonMatch[1]);
            } else {
                // Try to find JSON object in response
                const objectMatch = response.match(/\{[\s\S]*\}/);
                if (objectMatch) {
                    json = JSON.parse(objectMatch[0]);
                } else {
                    throw new Error('Could not parse response as JSON');
                }
            }
        }

        // Find cards in database
        const findCard = (name, type) => {
            const card = (this.cardDatabase.data || []).find(c =>
                c.name?.toLowerCase() === name?.toLowerCase() &&
                c.type?.toLowerCase() === type
            );
            if (!card) {
                console.warn(`Card not found: ${name} (${type})`);
                // Return a placeholder
                return { name, type };
            }
            return card;
        };

        // Build scenario
        const scenario = ScenarioSchema.createEmpty();
        const deckCfg = (typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks[deckKey] : null;

        scenario.deck = {
            key: deckKey,
            name: this.cardDatabase.title || (deckCfg && deckCfg.name) || deckKey,
            path: (deckCfg && deckCfg.path) || ''
        };

        scenario.scenario = {
            initial: findCard(json.initial, 'initial'),
            pivot: findCard(json.pivot, 'pivot'),
            c2: findCard(json.c2, 'c2'),
            persist: findCard(json.persist, 'persist')
        };
        // Card image paths are kept exactly as stored in carddb.json (../../shared/...);
        // renderers resolve them via Utils.assetPath, so no rebasing is done here.

        scenario.metadata = {
            name: json.name || 'AI Generated Scenario',
            description: json.description || '',
            difficulty: parseInt(json.difficulty) || 3,
            tags: ['ai-generated'],
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        };

        scenario.notes = json.notes || '';

        // Optional "Call a Consultant": only when the deck has consultants and
        // the model named one we can actually resolve.
        const consultant = json.consultant
            ? (this.cardDatabase.data || []).find(c =>
                c.name?.toLowerCase() === String(json.consultant).toLowerCase() &&
                c.type?.toLowerCase() === 'consultant')
            : null;
        scenario.consultant = consultant || null;
        if (consultant) scenario.consultants = [consultant];

        return scenario;
    },

    /**
     * Display the generated scenario
     * @param {Object} scenario - Scenario object
     */
    displayResult(scenario) {
        // Hide empty state, show content
        Utils.hideElement('result-empty');
        Utils.showElement('result-content');

        // Update preview
        Utils.getElement('preview-name').textContent = scenario.metadata.name;
        Utils.getElement('preview-description').textContent = scenario.metadata.description || 'No description';
        Utils.getElement('preview-difficulty').textContent = ['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'][scenario.metadata.difficulty - 1] || 'Medium';

        Utils.getElement('preview-initial').textContent = scenario.scenario.initial?.name || '-';
        Utils.getElement('preview-pivot').textContent = scenario.scenario.pivot?.name || '-';
        Utils.getElement('preview-c2').textContent = scenario.scenario.c2?.name || '-';
        Utils.getElement('preview-persist').textContent = scenario.scenario.persist?.name || '-';

        const consultantEl = Utils.getElement('preview-consultant');
        if (consultantEl) {
            consultantEl.textContent = scenario.consultant?.name || (scenario.consultants?.length ? `${scenario.consultants.length} available` : 'None');
        }

        Utils.getElement('preview-notes').textContent = scenario.notes || 'No notes';

        // Update JSON preview
        Utils.getElement('result-json').textContent = JSON.stringify(scenario, null, 2);
    },

    /**
     * Copy generated scenario to clipboard
     */
    async copyToClipboard() {
        if (!this.generatedScenario) return;

        await Utils.copyToClipboard(JSON.stringify(this.generatedScenario, null, 2));
        Utils.showToast('Copied to clipboard', 'success');
    },

    /**
     * Move the generated scenario to the Library editor for final edits.
     * The AI output is staged into the editor via the same bb-loaded-scenario
     * handoff the Library "Load" action uses; nothing is committed to the
     * Library until the user reviews it there and clicks "Save to Library".
     */
    async saveToLibrary() {
        if (!this.generatedScenario) return;

        try {
            Utils.saveToStorage('bb-loaded-scenario', this.generatedScenario);
            Utils.saveToStorage('bb-ai-handoff', {
                source: 'ai-generator',
                at: new Date().toISOString()
            });
            Utils.showToast('Scenario moved to the editor — review, then Save to Library', 'success');
            // The Scenario Editor (Library input form) lives at Engine-V2/admin.html.
            window.location.href = '../../admin.html?loadScenario=true';
        } catch (error) {
            console.error('Failed to hand off scenario to the editor:', error);
            Utils.showToast('Failed to open library editor: ' + error.message, 'error');
        }
    },

    /**
     * Show/hide loading state
     * @param {boolean} show - Whether to show loading
     */
    showLoading(show) {
        Utils.toggleElement('result-loading', show);
        Utils.toggleElement('result-empty', !show && !this.generatedScenario);
        Utils.toggleElement('result-content', !show && this.generatedScenario);
        Utils.getElement('generate-btn').disabled = show;
    },

    /**
     * Show status message
     * @param {string} message - Status message
     * @param {string} type - 'success' or 'error'
     */
    showStatus(message, type = '') {
        const status = Utils.getElement('result-status');
        if (!status) return;

        if (!message) {
            Utils.hideElement(status);
            return;
        }

        status.className = `result-status ${type}`;
        status.querySelector('.status-message').textContent = message;
        Utils.showElement(status);
    },

    /**
     * Open settings modal
     */
    openSettingsModal() {
        Utils.showElement('settings-modal');
    },

    /**
     * Close settings modal
     */
    closeSettingsModal() {
        Utils.hideElement('settings-modal');
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    ScenarioAI.init();
});
