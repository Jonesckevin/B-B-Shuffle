/**
 * B&B Shuffle - AI Scenario Generator
 * Uses LLM APIs to generate game scenarios
 */

const ScenarioAI = {
    // State
    cardDatabase: null,
    generatedScenario: null,
    // The model's own words from the last call, kept whether or not they parsed.
    // This is what the "Raw response" block renders.
    lastRawResponse: '',
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
    //
    //   models       curated FALLBACK, used when the live list cannot be fetched
    //                (no key yet, offline, CORS). Checked against the provider's
    //                own model catalogue; the live list always wins when reachable.
    //   defaultModel preselected when nothing is saved.
    //   jsonMode     the provider accepts `response_format: {type:'json_object'}`,
    //                which is what actually keeps the reply parseable.
    providers: {
        openai: {
            name: 'OpenAI',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            modelsEndpoint: 'https://api.openai.com/v1/models',
            defaultModel: 'gpt-6-luna',
            jsonMode: true,
            models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-luna', 'gpt-5.6-sol']
        },
        anthropic: {
            name: 'Anthropic',
            endpoint: 'https://api.anthropic.com/v1/messages',
            modelsEndpoint: 'https://api.anthropic.com/v1/models',
            defaultModel: 'claude-sonnet-5-5',
            models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5']
        },
        mistral: {
            name: 'Mistral',
            endpoint: 'https://api.mistral.ai/v1/chat/completions',
            modelsEndpoint: 'https://api.mistral.ai/v1/models',
            defaultModel: 'mistral-large-latest',
            jsonMode: true,
            models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest']
        },
        xai: {
            name: 'xAI (Grok)',
            endpoint: 'https://api.x.ai/v1/chat/completions',
            modelsEndpoint: 'https://api.x.ai/v1/models',
            defaultModel: 'grok-4.7',
            jsonMode: true,
            models: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3', 'grok-4.20-0309-non-reasoning']
        },
        perplexity: {
            name: 'Perplexity',
            endpoint: 'https://api.perplexity.ai/chat/completions',
            modelsEndpoint: 'https://api.perplexity.ai/models',
            defaultModel: 'sonar',
            models: ['sonar', 'sonar-pro']
        },
        groq: {
            name: 'Groq',
            endpoint: 'https://api.groq.com/openai/v1/chat/completions',
            modelsEndpoint: 'https://api.groq.com/openai/v1/models',
            defaultModel: 'llama-3.3-70b-versatile',
            jsonMode: true,
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
        },
        deepseek: {
            name: 'DeepSeek',
            endpoint: 'https://api.deepseek.com/chat/completions',
            modelsEndpoint: 'https://api.deepseek.com/models',
            // The legacy deepseek-chat / deepseek-reasoner names are retired.
            defaultModel: 'deepseek-flash',
            jsonMode: true,
            models: ['deepseek-flash', 'deepseek-v4-pro']
        },
        gemini: {
            name: 'Google Gemini',
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
            // The `-latest` aliases track the current release; a dated name is a
            // trap because a key that cannot reach one gets a bare 404, and the
            // 2.0 family has been shut down. A free key gets ~20 requests/day
            // PER MODEL, so the Lite alias is the default: one generation is one
            // request, and Lite's allowance goes furthest.
            defaultModel: 'gemini-flash-lite-latest',
            jsonMode: true,
            models: ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
        },
        // Local servers are deliberately NOT a provider of their own: Ollama,
        // LM Studio and llama.cpp all speak the OpenAI-compatible API, so they
        // are the Custom Endpoint. See CUSTOM_ENDPOINTS for the addresses people
        // actually run, and updateProviderUI for how that field is described.
    },

    // Ready-made OpenAI-compatible endpoints for the offline options - used for
    // the Custom Endpoint placeholder and hint, so nobody has to remember the
    // `/v1/chat/completions` suffix.
    CUSTOM_ENDPOINTS: [
        { label: 'Ollama', url: 'http://localhost:11434/v1/chat/completions' },
        { label: 'LM Studio', url: 'http://localhost:1234/v1/chat/completions' },
        { label: 'llama.cpp', url: 'http://localhost:8080/v1/chat/completions' }
    ],

    // A provider that stalls must not leave the UI spinning for ever.
    REQUEST_TIMEOUT_MS: 60000,

    /**
     * fetch() with a deadline, so an unresponsive provider fails with a message
     * instead of hanging the Generate button indefinitely.
     * @param {string} url
     * @param {Object} [options] - fetch init
     * @param {number} [timeoutMs]
     * @returns {Promise<Response>}
     */
    async fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new Error(`the provider did not answer within ${Math.round(timeoutMs / 1000)}s`);
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    },

    /**
     * Initialize the generator
     */
    async init() {
        this.loadSettings();
        this.bindEvents();
        // Populate the Model dropdown for the current provider even when nothing
        // is saved, so it never shows the static HTML options rather than the
        // provider's real (curated) list.
        const provider = Utils.getElement('api-provider')?.value || 'openai';
        if (this.providers[provider]) this.updateProviderUI(provider);
        await this.initSharedKey();
    },

    /**
     * Load settings from storage
     */
    loadSettings() {
        // parseJson must be true: the record is stored stringified, and reading it
        // raw made `saved.provider`/`saved.apiKey` undefined - so nothing was ever
        // restored and the saved target looked like it had been forgotten.
        let saved = Utils.getFromStorage('bb-ai-settings', null, true);
        if (saved && typeof saved === 'object') {
            // Ollama used to be a provider of its own; it is now the Custom
            // Endpoint pointed at its OpenAI-compatible API. Migrate a saved
            // record so an existing setup keeps working.
            saved = this.migrateSettings(saved);
            this.settings = { ...this.settings, ...saved };

            // Apply saved settings to UI
            if (saved.provider) {
                Utils.getElement('api-provider').value = saved.provider;
                // Populate the model list for the saved provider
                if (saved.provider === 'custom' || this.providers[saved.provider]) {
                    this.updateProviderUI(saved.provider);
                }
            }
            if (saved.endpoint) Utils.getElement('custom-endpoint').value = saved.endpoint;
            if (saved.model) {
                // A custom endpoint names its model by hand, so it is restored to
                // the free-text field rather than a dropdown it is not in.
                const manual = Utils.getElement('api-model-manual');
                if (saved.provider === 'custom' && manual) manual.value = saved.model;
                else Utils.getElement('api-model').value = saved.model;
            }
            if (saved.apiKey) Utils.getElement('api-key').value = saved.apiKey;
            if (saved.temperature) {
                Utils.getElement('temperature').value = saved.temperature;
                Utils.getElement('temp-value').textContent = saved.temperature;
            }
            if (saved.maxTokens) Utils.getElement('max-tokens').value = saved.maxTokens;

            // A saved full API key (or a local endpoint) -> list its models.
            this.maybeAutoRefreshModels();
        }
    },

    /**
     * Bring an old saved settings record up to date. The only migration so far:
     * `provider: 'ollama'` becomes the Custom Endpoint aimed at Ollama's
     * OpenAI-compatible API, because local servers are no longer a provider of
     * their own.
     * @param {Object} saved - Stored settings record
     * @returns {Object} The record to use
     */
    migrateSettings(saved) {
        if (!saved || saved.provider !== 'ollama') return saved;
        return Object.assign({}, saved, {
            provider: 'custom',
            endpoint: saved.endpoint || 'http://localhost:11434/v1/chat/completions',
            // The old Ollama model names are still valid.
            model: saved.model || 'llama3'
        });
    },

    /**
     * Save settings to storage
     */
    saveSettings() {
        const provider = Utils.getElement('api-provider').value;
        const manualModel = Utils.getElement('api-model-manual')?.value?.trim() || '';
        const settings = {
            provider,
            // A custom endpoint may name its model by hand, and that name is the
            // one that gets sent - so it is the one worth keeping.
            model: (provider === 'custom' && manualModel) ? manualModel : Utils.getElement('api-model').value,
            apiKey: Utils.getElement('api-key').value,
            // The custom endpoint is part of the setup (it is how a local server
            // is addressed), so it is saved and restored with everything else.
            endpoint: provider === 'custom' ? (Utils.getElement('custom-endpoint')?.value || '').trim() : '',
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
        // Saved API key (or a local endpoint) -> refresh the model list.
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

        // Picking a model from a custom endpoint's live list keeps the free-text
        // name in step, so the two controls cannot disagree about what is sent.
        Utils.getElement('api-model')?.addEventListener('change', () => {
            if (Utils.getElement('api-provider')?.value !== 'custom') return;
            const manual = Utils.getElement('api-model-manual');
            const value = Utils.getElement('api-model')?.value || '';
            if (manual && value) manual.value = value;
        });

        // API key entry -> once a full API key is provided, list the models the
        // account can actually use so the user can pick from them.
        Utils.getElement('api-key')?.addEventListener('input', Utils.debounce(() => {
            const provider = Utils.getElement('api-provider')?.value || 'openai';
            const key = Utils.getElement('api-key')?.value?.trim() || '';
            if (provider === 'custom') return;   // local servers need no key
            if (key.length >= 8) {
                this.refreshModels();
            } else if (!key) {
                // Key removed -> fall back to the curated list for this provider.
                this.populateStaticModels(provider);
                this.setModelHint('Enter your API key to load available models.');
            }
        }, 600));

        // Manual refresh next to the model dropdown (re-queries when a new key or
        // a new endpoint is entered after the auto-load already ran, or the list
        // is stale). Custom endpoints included: they expose /v1/models too.
        Utils.getElement('refresh-models-btn')?.addEventListener('click', () => {
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

        // Raw-response copy (the model's own text, kept whatever it parsed to).
        // preventDefault so the button does not also collapse the <details>.
        Utils.getElement('raw-copy-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.copyRawResponse();
        });

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

        // Custom is the offline / self-hosted option (Ollama, LM Studio,
        // llama.cpp...). The Model dropdown stays visible for it, because those
        // servers do expose /v1/models - there is just no curated list to fall
        // back on when the server is not running.
        Utils.toggleElement(customEndpointGroup, provider === 'custom');
        Utils.toggleElement(modelGroup, true);

        if (provider === 'custom') {
            const examples = this.CUSTOM_ENDPOINTS.map(e => `${e.label}: ${e.url}`).join('  ·  ');
            const input = Utils.getElement('custom-endpoint');
            if (input) {
                input.placeholder = this.CUSTOM_ENDPOINTS[0].url;
                input.title = examples;
            }
            // The curated list belongs to the hosted providers. A local server's
            // models are not known yet, and leaving another provider's name in
            // the dropdown would send it to the wrong server - so the dropdown
            // starts empty and the free-text name is offered alongside it.
            const modelSelect = Utils.getElement('api-model');
            if (modelSelect) modelSelect.innerHTML = '';
            Utils.showElement('api-model-manual');
            this.setModelHint('Any OpenAI-compatible server. ' + examples);
            return;
        }

        Utils.hideElement('api-model-manual');

        if (this.providers[provider]) {
            this.populateStaticModels(provider);
            this.setModelHint('Enter your API key to load available models.');
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
        // No curated list (custom endpoints) - leave the dropdown as it is rather
        // than emptying it.
        if (!cfg || !Array.isArray(cfg.models)) return;
        const previous = modelSelect.value;
        modelSelect.innerHTML = '';
        cfg.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        });
        // Keep the current pick when it is still offered, else the saved choice
        // for this provider, else the curated default.
        const saved = (this.settings && this.settings.provider === provider && this.settings.model) || '';
        const want = [previous, saved, cfg.defaultModel].find(v => v && cfg.models.includes(v));
        if (want) modelSelect.value = want;
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
        // A custom (local) endpoint needs no key: try it as soon as it is set.
        if (provider === 'custom') {
            if (Utils.getElement('custom-endpoint')?.value?.trim()) this.refreshModels();
            return;
        }
        if (key.length >= 8) {
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

        if (provider !== 'custom' && !apiKey) {
            this.setModelHint('Enter your API key to load available models.', 'error');
            return;
        }
        if (provider === 'custom' && !Utils.getElement('custom-endpoint')?.value?.trim()) {
            this.setModelHint('Enter the server address, e.g. ' + this.CUSTOM_ENDPOINTS[0].url, 'error');
            return;
        }

        this._loadingModels = true;
        modelSelect.disabled = true;
        if (refreshBtn) refreshBtn.disabled = true;
        this.setModelHint('Loading available models…');

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
     * @param {string} apiKey - API key ('' for a keyless local endpoint)
     * @returns {Promise<Object>} Provider model-list response body
     */
    async listProviderModels(provider, apiKey) {
        // A custom endpoint is deliberately not in the provider table - its
        // address is a field, not a constant - so it is allowed to have no entry.
        const cfg = this.providers[provider];
        if (!cfg && provider !== 'custom') throw new Error('Unknown provider');

        const headers = { 'Accept': 'application/json' };
        let url = (cfg && cfg.modelsEndpoint) || '';

        if (provider === 'custom') {
            // OpenAI-compatible servers (Ollama, LM Studio, llama.cpp) expose a
            // sibling /models endpoint. No key unless the user supplied one.
            const endpoint = Utils.getElement('custom-endpoint')?.value?.trim();
            if (!endpoint) throw new Error('Custom endpoint not configured');
            url = endpoint.replace(/\/chat\/completions\/?$/, '/models');
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (provider === 'anthropic') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
        } else {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        if (!url) throw new Error('No model list endpoint for this provider');

        // With a deadline: a local server that accepts the connection and then
        // never answers must not leave the dropdown disabled for ever.
        const response = await this.fetchWithTimeout(url, { method: 'GET', headers }, 15000);
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

        // A custom endpoint's list is a convenience: keep the free-text name in
        // step so what is actually sent is visible.
        if (Utils.getElement('api-provider')?.value === 'custom') {
            const manual = Utils.getElement('api-model-manual');
            if (manual && !manual.value.trim()) manual.value = select.value || '';
        }
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
            // A custom (local) endpoint needs no key, so try it either way.
            if (provider === 'custom' || key.length >= 8) this.refreshModels();
            this.setSharedHint('Shared mode uses a key stored on this server so players don\'t need their own. The key never reaches this browser.');
            return;
        }

        // Shared mode: hide the per-user key fields; keep the Model picker.
        Utils.hideElement('provider-group');
        Utils.hideElement('api-key-group');
        Utils.hideElement('custom-endpoint-group');
        Utils.hideElement('api-model-manual');
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
        } else if (provider === 'custom') {
            if (!Utils.getElement('custom-endpoint')?.value?.trim()) {
                Utils.showToast('Enter the server address for the custom endpoint', 'warning');
                return;
            }
        } else if (!apiKey) {
            Utils.showToast('Please enter an API key', 'warning');
            return;
        }

        // Show loading state
        this.showLoading(true);
        this.showStatus('');
        // Clear the previous reply so a stale raw block is never mistaken for this one.
        this.lastRawResponse = '';
        this.renderRawResponse();

        try {
            // Load card database
            const deckKey = Utils.getElement('deck-select')?.value || 'core';
            await this.loadCardDatabase(deckKey);

            // Build the messages and call the API
            const messages = this.buildMessages();
            const response = await this.callAPI(provider, apiKey, messages);

            // Keep the model's own words, parseable or not - it is the only way
            // for the user to see what came back when the JSON is broken.
            this.lastRawResponse = response;
            this.renderRawResponse();

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
            // A parse failure still shows the reply; point the user at it.
            const hint = (this.lastRawResponse && /JSON/i.test(error.message || ''))
                ? ' — the model\'s raw reply is shown below.'
                : '';
            this.showStatus('Generation failed: ' + error.message + hint, 'error');
            this.renderRawResponse();
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * The JSON contract, in one place so the prompt and the parser cannot drift.
     * @param {boolean} hasConsultant - Whether the deck has consultant cards
     * @returns {string} A literal example of the expected object
     */
    scenarioJsonShape(hasConsultant) {
        return [
            '{',
            '  "name": "string - scenario name",',
            '  "description": "string - 1-2 sentence scenario description",',
            '  "initial": "string - EXACT name of one Initial card from the list",',
            '  "pivot": "string - EXACT name of one Pivot card from the list",',
            '  "c2": "string - EXACT name of one C2 card from the list",',
            '  "persist": "string - EXACT name of one Persistence card from the list",',
            hasConsultant
                ? '  "consultant": "string - EXACT name of one Consultant card from the list, or null",'
                : '',
            '  "difficulty": 3,',
            '  "notes": "string - facilitator notes explaining the attack chain"',
            '}'
        ].filter(Boolean).join('\n');
    },

    /** Whether the loaded deck has consultant cards. */
    hasConsultants() {
        return (this.cardDatabase?.data || []).some(c => c.type?.toLowerCase() === 'consultant');
    },

    /**
     * The system message: the role and the hard rules that keep the reply
     * parseable. Sent as a real system role wherever the provider supports it,
     * rather than folded into the user turn, because an instruction the model can
     * treat as standing policy is followed far more reliably.
     * @returns {string}
     */
    buildSystemPrompt() {
        return [
            'You are a cybersecurity tabletop exercise designer. You build scenarios for',
            'B&B Shuffle, a Backdoors & Breaches companion game.',
            '',
            'You MUST reply with a single JSON object and nothing else.',
            'Rules for the reply, in order of importance:',
            '1. The whole reply is one JSON object. No prose before or after it.',
            '2. Do not wrap it in markdown code fences and do not add comments.',
            '3. Use double quotes for every key and string - never single quotes.',
            '4. No trailing commas after the last item of an object or array.',
            '5. Use exactly these keys and no others:',
            this.scenarioJsonShape(this.hasConsultants()),
            '6. Every card name must be copied EXACTLY from the lists in the user message.',
            ''
        ].join('\n');
    },

    /**
     * Build the user prompt (the deck's cards + the settings).
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

        return `Design one B&B Shuffle scenario from the following cards.

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
- Use EXACT card names from the lists above.
- Build a realistic, coherent attack chain through initial -> pivot -> c2 -> persist.
${cardsByType.consultant?.length ? '- The consultant is optional: name one only when that expert genuinely fits the scenario, otherwise use null.\n' : ''}- "notes" must explain the attack flow so a GM can run it.`;
    },

    /**
     * The full message list (system + user) for the chat APIs.
     * @returns {Array<{role: string, content: string}>}
     */
    buildMessages() {
        return [
            { role: 'system', content: this.buildSystemPrompt() },
            { role: 'user', content: this.buildPrompt() }
        ];
    },

    /**
     * Call the AI API.
     * @param {string} provider - Provider key
     * @param {string} apiKey - API key
     * @param {Array<{role:string,content:string}>} messages - Chat messages
     * @returns {Promise<string>} Response text
     */
    async callAPI(provider, apiKey, messages) {
        // Shared-key mode: the server proxies the request with its stored key.
        if (this.keyMode() === 'shared') {
            return await this.callShared(messages);
        }

        if (provider === 'openai') {
            return await this.callOpenAI(apiKey, messages);
        } else if (provider === 'anthropic') {
            return await this.callAnthropic(apiKey, messages);
        } else if (['mistral', 'xai', 'perplexity', 'groq', 'deepseek', 'gemini'].includes(provider)) {
            return await this.callCompatible(provider, apiKey, messages);
        } else if (provider === 'custom') {
            return await this.callCustom(apiKey, messages);
        }

        throw new Error('Unknown provider');
    },

    /** The model to send: the dropdown's value, else the provider's default. */
    modelFor(provider) {
        // A custom endpoint may serve a model its /v1/models does not list (or
        // may not expose a list at all), so a hand-typed name wins when present.
        if (provider === 'custom') {
            const typed = Utils.getElement('api-model-manual')?.value?.trim();
            if (typed) return typed;
        }
        const chosen = Utils.getElement('api-model')?.value?.trim();
        if (chosen) return chosen;
        const cfg = this.providers[provider];
        return (cfg && cfg.defaultModel) || (cfg && cfg.models && cfg.models[0]) || '';
    },

    /** Pull the assistant text out of whichever response shape came back. */
    readContent(data) {
        if (!data) return '';
        return data.choices?.[0]?.message?.content
            || (Array.isArray(data.content) ? (data.content[0]?.text || '') : '')
            || data.response
            || data.text
            || '';
    },

    /**
     * Read an error body for a human-readable message. The body is NOT
     * guaranteed to be JSON, so a failed parse must never mask the real status -
     * that is what used to surface a raw "Unexpected token" instead of "401".
     * @param {Response} response
     * @returns {Promise<string>}
     */
    async errorDetail(response) {
        let text = '';
        try {
            text = await response.text();
        } catch (e) {
            return '';
        }
        if (!text) return '';
        try {
            const body = JSON.parse(text);
            const value = body?.error?.message || body?.error || body?.message;
            if (value) return typeof value === 'string' ? value : JSON.stringify(value);
        } catch (e) { /* not JSON - fall through to the raw text */ }
        return text.slice(0, 300).trim();
    },

    /**
     * Turn a failed response into an actionable error.
     * @param {Response} response
     * @param {string} [fallback]
     * @returns {Promise<Error>}
     */
    async apiFailure(response, fallback) {
        const detail = await this.errorDetail(response);
        const status = response.status;
        let message = detail || fallback || `API request failed (${status})`;
        if (!/\(\d{3}\)\s*$/.test(message)) message += ` (${status})`;
        if (status === 401 || status === 403) {
            message += ' — the key was rejected. Check it is complete and belongs to the selected provider.';
        } else if (status === 429) {
            message += ' — this model\'s free daily allowance is used up. Pick a different model from the list for a fresh allowance, or wait for the reset.';
        } else if (status === 404) {
            message += ' — that usually means the model is not available to this key. Pick one from the Model list.';
        }
        return new Error(message);
    },

    /**
     * POST an OpenAI-compatible chat request. Attaches
     * `response_format: {type:'json_object'}` when the provider supports it, and
     * retries once WITHOUT the field when the model rejects it with a 400 (some
     * providers answer 400 to an unknown parameter).
     * @param {string} endpoint
     * @param {Object} headers
     * @param {Object} payload
     * @param {boolean} supportsJsonMode
     * @returns {Promise<Response>}
     */
    async postChat(endpoint, headers, payload, supportsJsonMode) {
        const send = (body) => this.fetchWithTimeout(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        }, this.REQUEST_TIMEOUT_MS);

        let response = await send(payload);
        if (!response.ok && response.status === 400 && supportsJsonMode && payload.response_format) {
            const detail = await this.errorDetail(response);
            if (/response_format|json_object|unknown|unsupported|invalid.*param/i.test(detail) || !detail) {
                const without = Object.assign({}, payload);
                delete without.response_format;
                response = await send(without);
            }
        }
        return response;
    },

    /**
     * Call the AI through the server's shared-key proxy. The API key stays on
     * the server, so players never need to supply their own.
     * @param {Array<{role:string,content:string}>} messages - Chat messages
     * @returns {Promise<string>} Response text
     */
    async callShared(messages) {
        const provider = this.shared.provider;
        const cfg = provider ? this.providers[provider] : null;

        let response;
        try {
            response = await this.fetchWithTimeout('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: Utils.getElement('api-model')?.value || this.shared.model || '',
                    messages,
                    temperature: this.settings.temperature,
                    maxTokens: this.settings.maxTokens,
                    // Ask for JSON when the server's provider supports it; the
                    // proxy forwards this straight through to the upstream call.
                    responseFormat: cfg && cfg.jsonMode ? { type: 'json_object' } : undefined
                })
            }, this.REQUEST_TIMEOUT_MS);
        } catch (e) {
            throw new Error('Could not reach the AI proxy on the server: ' + (e.message || 'request failed'));
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
    async callOpenAI(apiKey, messages) {
        const cfg = this.providers.openai;
        const payload = {
            model: this.modelFor('openai'),
            messages,
            temperature: this.settings.temperature,
            max_tokens: this.settings.maxTokens
        };
        if (cfg.jsonMode) payload.response_format = { type: 'json_object' };

        const response = await this.postChat(cfg.endpoint, {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        }, payload, cfg.jsonMode);

        if (!response.ok) throw await this.apiFailure(response, 'API request failed');
        return this.readContent(await response.json());
    },

    /**
     * Call any OpenAI-compatible chat-completions API (Mistral, xAI/Grok,
     * Perplexity, Groq, DeepSeek, and Gemini's OpenAI-compatible endpoint).
     * @param {string} provider - Provider key from this.providers
     * @param {string} apiKey - API key
     * @param {Array<{role:string,content:string}>} messages - Chat messages
     * @returns {string} Response text
     */
    async callCompatible(provider, apiKey, messages) {
        const config = this.providers[provider];
        if (!config || !config.endpoint) throw new Error('Provider not configured');

        const payload = {
            model: this.modelFor(provider),
            messages,
            temperature: this.settings.temperature,
            max_tokens: this.settings.maxTokens
        };
        if (config.jsonMode) payload.response_format = { type: 'json_object' };

        const response = await this.postChat(config.endpoint, {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        }, payload, config.jsonMode);

        if (!response.ok) throw await this.apiFailure(response, 'API request failed');
        return this.readContent(await response.json());
    },

    /**
     * Call Anthropic API. Anthropic has no system role in the request body, so
     * the system message is sent as the top-level `system` field.
     */
    async callAnthropic(apiKey, messages) {
        const payload = {
            model: this.modelFor('anthropic'),
            system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
            messages: messages.filter(m => m.role !== 'system'),
            max_tokens: this.settings.maxTokens
        };

        const response = await this.fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(payload)
        }, this.REQUEST_TIMEOUT_MS);

        if (!response.ok) throw await this.apiFailure(response, 'API request failed');
        const data = await response.json();
        return this.readContent(data);
    },

    /**
     * Call a custom OpenAI-compatible endpoint - the offline / self-hosted path.
     * Covers Ollama, LM Studio and llama.cpp as well as hosted gateways. The key
     * is optional so a local server needs no configuration at all.
     */
    async callCustom(apiKey, messages) {
        const endpoint = Utils.getElement('custom-endpoint')?.value?.trim();
        if (!endpoint) throw new Error('Custom endpoint not configured');

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const payload = {
            model: this.modelFor('custom'),
            messages,
            temperature: this.settings.temperature,
            max_tokens: this.settings.maxTokens
        };

        const response = await this.fetchWithTimeout(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        }, this.REQUEST_TIMEOUT_MS);

        if (!response.ok) throw await this.apiFailure(response, 'Custom API request failed');
        return this.readContent(await response.json());
    },

    /**
     * Best-effort repair of the JSON mistakes models actually make, so a
     * nearly-valid reply still parses. Every step is conservative: it must not
     * turn a valid document into an invalid one.
     * @param {string} text
     * @returns {string}
     */
    repairJson(text) {
        let out = String(text || '');
        // BOM and zero-width characters.
        out = out.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
        // A markdown fence around the whole reply.
        out = out.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '');
        // Comments - never valid JSON, frequently emitted anyway.
        out = out.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        // Smart quotes -> plain quotes.
        out = out.replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019\u201A\u201B]/g, "'");
        // Single-quoted keys/values -> double quotes, but ONLY in a structural
        // position (after { , : [ or before : , } ]). An apostrophe inside a word
        // ("don't") sits between two letters, so it is left alone.
        out = out.replace(/([{,:\[]\s*)'([^'\n]*)'(?=\s*[:,}\]])/g, '$1"$2"');
        // Trailing commas before a closing brace or bracket.
        out = out.replace(/,\s*([}\]])/g, '$1');
        return out.trim();
    },

    /**
     * Extract a JSON object from a model reply: the whole text, else a fenced
     * block, else the first {...} run. Every attempt is individually guarded
     * (the old code let a SyntaxError escape from inside its own catch) and is
     * retried through repairJson().
     * @param {string} text
     * @returns {Object}
     */
    extractJson(text) {
        const raw = String(text || '').trim();
        if (!raw) throw new Error('The AI returned an empty response');

        const candidates = [raw];
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) candidates.push(fenced[1]);
        const braced = raw.match(/\{[\s\S]*\}/);
        if (braced) candidates.push(braced[0]);

        for (const candidate of candidates) {
            for (const attempt of [candidate, this.repairJson(candidate)]) {
                try {
                    const value = JSON.parse(attempt);
                    if (value && typeof value === 'object') return value;
                } catch (e) { /* try the next form */ }
            }
        }
        throw new Error('Could not parse the AI response as JSON');
    },

    /**
     * Parse AI response into scenario object
     * @param {string} response - Raw API response
     * @param {string} deckKey - Deck identifier
     * @returns {Object} Scenario object
     */
    parseResponse(response, deckKey) {
        const json = this.extractJson(response);

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
     * Show or hide the "Raw response" block. The model's text is always kept,
     * parseable or not, so a broken JSON reply can still be read and copied.
     */
    renderRawResponse() {
        const details = Utils.getElement('raw-details');
        const pre = Utils.getElement('result-raw');
        if (!details || !pre) return;

        const text = this.lastRawResponse || '';
        if (!text.trim()) {
            pre.textContent = '';
            Utils.hideElement(details);
            return;
        }
        pre.textContent = text;
        Utils.showElement(details);
        details.open = true;
    },

    /** Copy the raw response to the clipboard. */
    async copyRawResponse() {
        if (!this.lastRawResponse) return;
        await Utils.copyToClipboard(this.lastRawResponse);
        Utils.showToast('Raw response copied', 'success');
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
