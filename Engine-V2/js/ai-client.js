/**
 * B&B Shuffle — AI Client
 * ------------------------------------------------------------------
 * Small, self-contained wrapper around the app's AI plumbing, used by the
 * Custom Card Creator. Deliberately does NOT touch scenario_ai.js.
 *
 * Key resolution order:
 *   1. The server's shared key  -> GET /api/ai/config + POST /api/ai/chat
 *   2. The user's own key       -> localStorage "bb-ai-settings"
 *      (the same record the AI Generator writes)
 *
 * Public API
 *   AIClient.getSharedConfig()          -> Promise<{configured, provider, model, ...}>
 *   AIClient.getOwnSettings()           -> {provider, model, apiKey, ...}|null
 *   AIClient.resolve()                  -> Promise<{ok, mode, label}>
 *   AIClient.listModels(opts)           -> Promise<{models, source, error?}>
 *   AIClient.chat(prompt)               -> Promise<string>
 *   AIClient.extractJson(text)          -> Object
 *   AIClient.generateCard(fields)       -> Promise<{name, description, detection, tools, details}>
 */

const AIClient = {
    SHARED_CONFIG_ENDPOINT: '/api/ai/config',
    SHARED_CHAT_ENDPOINT: '/api/ai/chat',
    SHARED_MODELS_ENDPOINT: '/api/ai/models',
    OWN_SETTINGS_KEY: 'bb-ai-settings',
    KEY_SOURCE_KEY: 'bb-ai-key-source',
    // A provider that stalls must not leave the UI waiting for ever; a real
    // narration call takes a few seconds, so this is generous.
    REQUEST_TIMEOUT_MS: 30000,

    /**
     * fetch() with a deadline, so an unresponsive provider fails fast enough to
     * fall back to the offline clue tables.
     * @param {string} url
     * @param {Object} [options] - fetch init
     * @param {number} [timeoutMs]
     * @returns {Promise<Response>}
     */
    async fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
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

    // Mirrors the provider table in scenario_ai.js. Each entry carries the chat
    // endpoint, the sibling model-list endpoint, and a curated model list for
    // when the live one is unavailable (offline, CORS, or no key yet).
    PROVIDERS: {
        openai: {
            name: 'OpenAI',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            modelsEndpoint: 'https://api.openai.com/v1/models',
            defaultModel: 'gpt-6-luna',
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
            models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest']
        },
        xai: {
            name: 'xAI (Grok)',
            endpoint: 'https://api.x.ai/v1/chat/completions',
            modelsEndpoint: 'https://api.x.ai/v1/models',
            defaultModel: 'grok-4.7',
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
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
        },
        deepseek: {
            name: 'DeepSeek',
            endpoint: 'https://api.deepseek.com/chat/completions',
            modelsEndpoint: 'https://api.deepseek.com/models',
            // The legacy deepseek-chat / deepseek-reasoner names are retired.
            defaultModel: 'deepseek-flash',
            models: ['deepseek-flash', 'deepseek-v4-pro']
        },
        gemini: {
            name: 'Google Gemini',
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
            // Dated model identifiers may not be available to every key; the
            // alias tracks the current Flash model.
            //
            // Use the Lite alias by default. A free Gemini key
            // gets ~20 requests per day *per model*, and a single solo game spends
            // 12-15 (one call per roll, plus the opening) - so the flagship alias
            // runs dry part-way through a case. Lite's allowance outlasts a full
            // game; anyone who wants the bigger model picks it from the list.
            defaultModel: 'gemini-flash-lite-latest',
            models: [
                'gemini-flash-lite-latest',
                'gemini-flash-latest',
                'gemini-3.8-flash',
                'gemini-3.5-flash-lite',
                'gemini-3.1-flash-lite'
            ]
        },
        // Every local, self-hosted and gateway server is this one entry: Ollama,
        // LM Studio and llama.cpp all speak the OpenAI-compatible API, so they
        // differ only by address. The address is NOT here - it lives in the
        // settings record (`endpoint`), set once in the AI Generator's settings
        // where the field and its examples are, so the Card Creator and the Solo
        // AI inherit it for free.
        custom: {
            name: 'Custom / Local Endpoint',
            endpoint: '',
            modelsEndpoint: '',
            defaultModel: '',
            models: []
        }
    },

    /* ------------------------------------------------------------------ */
    /* Configuration                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * Bring a stored settings record up to date. The one migration: Ollama used
     * to be a provider of its own, and is now the Custom Endpoint aimed at its
     * OpenAI-compatible API - so an old record is rewritten to that shape and an
     * existing setup keeps working without re-entry.
     * @param {Object} record - Any settings record
     * @returns {Object} The record to use (migrated in place)
     */
    migrateSettings(record) {
        if (!record || record.provider !== 'ollama') return record;
        record.provider = 'custom';
        record.endpoint = record.endpoint || 'http://localhost:11434/v1/chat/completions';
        return record;
    },

    /**
     * The user's own AI settings, if any.
     * A custom (local) endpoint needs no key, so its record counts as usable
     * without one.
     */
    getOwnSettings() {
        try {
            const raw = localStorage.getItem(this.OWN_SETTINGS_KEY);
            if (!raw) return null;
            const parsed = this.migrateSettings(JSON.parse(raw));
            if (!parsed) return null;
            return (parsed.apiKey || parsed.provider === 'custom') ? parsed : null;
        } catch (e) {
            return null;
        }
    },

    /**
     * The OpenAI-compatible address of a custom/local endpoint, if configured.
     * Ollama used to be a provider of its own and its default address is kept as
     * the fallback so an existing setting does not have to be re-entered.
     * @param {Object} [record] - Settings record; defaults to the stored one
     * @returns {string} Endpoint URL, or '' when none is known
     */
    customEndpoint(record) {
        const saved = record || this.getOwnSettings() || {};
        if (saved.endpoint) return saved.endpoint;
        return saved.provider === 'ollama' ? 'http://localhost:11434/v1/chat/completions' : '';
    },

    /**
     * Did the user choose their own key over the server's?
     *
     * When no choice has been recorded yet, a stored key counts as the choice:
     * it is what the user just typed, and it saves a pointless round trip to a
     * server that may have no shared key at all.
     * @returns {boolean}
     */
    ownPreferred() {
        try {
            const source = localStorage.getItem(this.KEY_SOURCE_KEY);
            if (source) return source === 'own';
            return !!this.getOwnSettings();
        } catch (e) {
            return false;
        }
    },

    /** Public info about the server-configured shared key. */
    async getSharedConfig() {
        try {
            // Short deadline: this is a probe, not a narration call.
            const res = await this.fetchWithTimeout(this.SHARED_CONFIG_ENDPOINT, { cache: 'no-store' }, 8000);
            if (!res.ok) return { configured: false };
            const data = await res.json();
            return data && data.configured ? data : { configured: false };
        } catch (e) {
            return { configured: false };
        }
    },

    /**
     * Is any AI path usable?
     *
     * The user's explicit key-source choice wins: picking "my own key" must not
     * be silently overridden by a shared key that happens to exist.
     * @returns {Promise<{ok: boolean, mode: 'shared'|'own'|'none', label: string}>}
     */
    async resolve() {
        const own = this.getOwnSettings();
        if (this.ownPreferred() && own) {
            return { ok: true, mode: 'own', label: this.describeOwn(own) };
        }
        const shared = await this.getSharedConfig();
        if (shared.configured) {
            return {
                ok: true,
                mode: 'shared',
                label: `${shared.providerName || shared.provider || 'Server'}${shared.model ? ' · ' + shared.model : ''}`
            };
        }
        if (own) {
            return { ok: true, mode: 'own', label: this.describeOwn(own) };
        }
        return { ok: false, mode: 'none', label: 'Not configured' };
    },

    /** Human label for a set of the user's own settings. */
    describeOwn(own) {
        const provider = this.PROVIDERS[own.provider];
        return `${provider ? provider.name : own.provider}${own.model ? ' · ' + own.model : ''}`;
    },

    /* ------------------------------------------------------------------ */
    /* Model listing                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * List the models the given target can actually use.
     *
     * Never throws: a provider that cannot be reached (offline, CORS, or a
     * service that exposes no model list) falls back to the curated names, so
     * the dropdown is never empty.
     * @param {Object} [opts]
     * @param {'shared'|'own'} [opts.source] - Which key path to list
     * @param {string} [opts.provider] - Provider key (own source)
     * @param {string} [opts.apiKey] - Key held in the form, not yet saved
     * @returns {Promise<{models: string[], source: 'server'|'provider'|'curated', error?: string}>}
     */
    async listModels(opts = {}) {
        const source = (opts.source === 'shared') ? 'shared' : 'own';

        if (source === 'shared') {
            try {
                const res = await this.fetchWithTimeout(this.SHARED_MODELS_ENDPOINT, { cache: 'no-store' }, 15000);
                if (!res.ok) throw new Error(`the server returned ${res.status}`);
                const models = this.normalizeModels(await res.json());
                return models.length
                    ? { models, source: 'server' }
                    : { models: [], source: 'server', error: 'the server key has no models listed' };
            } catch (error) {
                return { models: [], source: 'server', error: error.message || 'request failed' };
            }
        }

        const raw = opts.provider || (this.getOwnSettings() || {}).provider || 'openai';
        const provider = raw === 'ollama' ? 'custom' : raw;
        const apiKey = opts.apiKey || '';
        const cfg = this.PROVIDERS[provider];
        if (!cfg) return { models: [], source: 'curated', error: 'unknown provider: ' + provider };

        const curated = this.normalizeModels(cfg.models);

        // A custom endpoint (Ollama, LM Studio, llama.cpp or a gateway) is
        // keyless: ask it directly and fall back to nothing else.
        if (provider === 'custom') {
            const endpoint = opts.endpoint || this.customEndpoint(this.getOwnSettings());
            if (!endpoint) return { models: curated, source: 'curated', error: 'no custom endpoint configured' };
            const url = endpoint.replace(/\/chat\/completions\/?$/, '/models');
            const headers = { Accept: 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            try {
                const res = await this.fetchWithTimeout(url, { headers, cache: 'no-store' }, 8000);
                if (!res.ok) throw new Error(`the endpoint returned ${res.status}`);
                const models = this.normalizeModels(await res.json());
                return models.length ? { models, source: 'provider' } : { models: curated, source: 'curated' };
            } catch (error) {
                return { models: curated, source: 'curated', error: 'the custom endpoint is not reachable' };
            }
        }

        if (!apiKey || !cfg.modelsEndpoint) return { models: curated, source: 'curated' };

        const headers = { Accept: 'application/json' };
        if (provider === 'anthropic') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
        } else {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        try {
            const res = await this.fetchWithTimeout(cfg.modelsEndpoint, { headers, cache: 'no-store' }, 15000);
            if (!res.ok) {
                let message = `the provider returned ${res.status}`;
                try {
                    const err = await res.json();
                    const detail = err.error?.message || err.error || err.message;
                    if (detail) message = typeof detail === 'string' ? detail : JSON.stringify(detail);
                } catch (e) { /* non-JSON error body */ }
                throw new Error(message);
            }
            const models = this.normalizeModels(await res.json());
            return models.length
                ? { models, source: 'provider' }
                : { models: curated, source: 'curated', error: 'the provider listed no models' };
        } catch (error) {
            return { models: curated, source: 'curated', error: error.message || 'request failed' };
        }
    },

    /**
     * Flatten the provider list shapes into clean, deduplicated model ids.
     * Gemini's OpenAI-compatible list returns ids as "models/gemini-…".
     * @param {Object|Array} input - Raw provider response
     * @returns {string[]} Sorted model ids
     */
    normalizeModels(input) {
        let items = [];
        if (Array.isArray(input)) items = input;
        else if (Array.isArray(input?.models)) items = input.models;
        else if (Array.isArray(input?.data)) items = input.data;
        else if (Array.isArray(input?.data?.data)) items = input.data.data;

        const seen = new Set();
        const out = [];
        items.forEach(item => {
            if (!item) return;
            const raw = typeof item === 'string' ? item : (item.id || item.name || item.model || item.model_name || '');
            const id = String(raw).trim().replace(/^models\//, '');
            if (!id || seen.has(id)) return;
            seen.add(id);
            out.push(id);
        });
        return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },

    /* ------------------------------------------------------------------ */
    /* Chat                                                                */
    /* ------------------------------------------------------------------ */

    /**
     * Send a single-turn prompt and return the model's text.
     * @param {string} prompt
     * @returns {Promise<string>}
     */
    async chat(prompt) {
        const own = this.getOwnSettings();
        if (this.ownPreferred() && own) {
            return await this.chatDirect(prompt, own);
        }
        const shared = await this.getSharedConfig();
        if (shared.configured) {
            return await this.chatViaServer(prompt, shared);
        }
        if (own) {
            return await this.chatDirect(prompt, own);
        }
        throw new Error('No AI key configured. Set one in the AI Generator, or ask your host to add a shared key.');
    },

    /** Server-proxied call using the operator's shared key. */
    async chatViaServer(prompt, shared) {
        const body = {
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            maxTokens: 1600
        };
        if (shared.model) body.model = shared.model;

        const res = await this.fetchWithTimeout(this.SHARED_CHAT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, this.REQUEST_TIMEOUT_MS);

        if (!res.ok) {
            let message = `AI request failed (${res.status})`;
            try {
                const err = await res.json();
                message = err.error || err.message || message;
            } catch (e) { /* non-JSON error body */ }
            throw new Error(message);
        }

        const data = await res.json();
        return data.content || '';
    },

    /** Direct call with the user's own key. */
    async chatDirect(prompt, settings) {
        if (settings) this.migrateSettings(settings);
        const provider = this.PROVIDERS[settings.provider];
        if (!provider) throw new Error('Unknown AI provider: ' + settings.provider);

        const model = settings.model || provider.defaultModel;
        const temperature = typeof settings.temperature === 'number' ? settings.temperature : 0.7;
        const maxTokens = settings.maxTokens || 1600;

        // A custom / local endpoint: OpenAI-compatible, addressed by the settings
        // record, and keyless unless the user supplied a key. Covers Ollama,
        // LM Studio, llama.cpp and hosted gateways alike.
        if (settings.provider === 'custom') {
            const endpoint = settings.endpoint || this.customEndpoint(settings);
            if (!endpoint) throw new Error('No custom endpoint configured — set it in the AI Generator settings.');
            if (!model) throw new Error('No model name configured for the custom endpoint.');

            const headers = { 'Content-Type': 'application/json' };
            if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

            const res = await this.fetchWithTimeout(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature,
                    max_tokens: maxTokens
                })
            }, this.REQUEST_TIMEOUT_MS);

            if (!res.ok) {
                throw new Error(`The endpoint rejected the request (${res.status}) — is the server running and the model loaded?`);
            }
            const data = await res.json();
            return data.choices?.[0]?.message?.content || data.response || '';
        }

        if (settings.provider === 'anthropic') {
            const res = await this.fetchWithTimeout(provider.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': settings.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
            }, this.REQUEST_TIMEOUT_MS);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(this.apiError(res.status, err.error?.message));
            }
            const data = await res.json();
            return data.content?.[0]?.text || '';
        }

        const res = await this.fetchWithTimeout(provider.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature,
                max_tokens: maxTokens
            })
        }, this.REQUEST_TIMEOUT_MS);
        if (!res.ok) {
            let detail = '';
            try {
                const err = await res.json();
                // `error` may be a string (Gemini) or an object (OpenAI).
                const value = err.error?.message || err.error || err.message;
                if (value) detail = typeof value === 'string' ? value : JSON.stringify(value);
            } catch (e) { /* non-JSON error body */ }
            throw new Error(this.apiError(res.status, detail));
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || data.response || data.text || '';
    },

    /**
     * Turn a provider error body into something the player can act on.
     *
    * Provide actionable guidance for common quota and model-availability errors:
     *
     *  - 429 is a *quota* wall, not a bad key. Gemini's free tier is per-model
     *    (~20/day), so the fix is a different model - which restores a full
     *    allowance immediately - or billing, not a new key.
     *  - 404 is almost always a model this key cannot reach (dated model names
     *    get retired for new keys even while they stay in the catalogue).
     *
     * @param {number} status - HTTP status
     * @param {string} [detail] - Provider-supplied message, if any
     * @returns {string}
     */
    apiError(status, detail) {
        const base = String(detail || '').trim() || `AI request failed (${status})`;
        if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(base)) {
            return base + ' — this model\'s free daily allowance is used up, which is a quota '
                + 'limit and not a bad key. Free Gemini keys get ~20 requests per day PER MODEL, '
                + 'so picking a different model from the list gives you a fresh allowance straight '
                + 'away (or wait for the daily reset, or enable billing).';
        }
        if (status === 404 || /not found|no longer available|does not exist|unsupported/i.test(base)) {
            return base + ' — that usually means the model is not available to this key. Pick one from the Model list.';
        }
        return base;
    },

    /* ------------------------------------------------------------------ */
    /* Parsing                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Tolerant JSON extraction (mirrors scenario_ai.js:parseResponse()).
     * Handles bare JSON, ```json fenced blocks, and "first {...} found".
     */
    extractJson(text) {
        const raw = String(text || '').trim();
        if (!raw) throw new Error('The AI returned an empty response');

        try {
            return JSON.parse(raw);
        } catch (e) { /* fall through */ }

        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) {
            try {
                return JSON.parse(fenced[1].trim());
            } catch (e) { /* fall through */ }
        }

        const braced = raw.match(/\{[\s\S]*\}/);
        if (braced) {
            try {
                return JSON.parse(braced[0]);
            } catch (e) { /* fall through */ }
        }

        throw new Error('Could not parse the AI response as JSON');
    },

    /* ------------------------------------------------------------------ */
    /* Card generation                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Build the card-generation prompt (literal JSON template style, matching
     * the AI Generator's convention).
     */
    buildCardPrompt(fields = {}) {
        const type = fields.type || 'procedure';
        const isScenario = ['initial', 'pivot', 'c2', 'persist'].includes(type);
        const typeLabel = (CardRenderer.TYPE_LABELS[type] || type);

        const lines = [
            'You are a cybersecurity tabletop exercise designer creating ONE card for the Backdoors & Breaches incident-response card game.',
            '',
            '## Card Type',
            `${typeLabel} (internal type: ${type})`
        ];

        if (fields.theme) lines.push('', '## Theme', String(fields.theme));
        if (fields.difficulty) lines.push('', '## Difficulty', `${fields.difficulty} of 5`);
        if (fields.context) lines.push('', '## Additional Context', String(fields.context));

        lines.push('', '## Output Format', 'Respond with ONLY this JSON object:');
        if (isScenario) {
            lines.push(
                '{',
                '  "name": "Short punchy card title (2-4 words, Title Case)",',
                '  "description": "1-3 sentences describing how attackers achieved this stage.",',
                '  "detection": ["3 to 6 defender procedure names that would detect this"],',
                '  "details": []',
                '}'
            );
        } else if (type === 'procedure') {
            lines.push(
                '{',
                '  "name": "Short punchy card title (2-4 words, Title Case)",',
                '  "description": "1-3 sentences describing what the defenders do with this procedure.",',
                '  "tools": ["3 to 6 concrete tool or data-source names"],',
                '  "details": []',
                '}'
            );
        } else {
            lines.push(
                '{',
                '  "name": "Short punchy card title (2-4 words, Title Case)",',
                '  "description": "1-3 sentences describing the inject event and its impact.",',
                '  "details": []',
                '}'
            );
        }

        lines.push(
            '',
            '## Rules',
            '- Keep the name under 28 characters.',
            '- Write in plain language a mixed-ability table can follow.',
            '- Detection/Tools entries must be short (2-5 words each).',
            '- "details" is an optional array of { "text": "...", "url": "https://..." } — use [] when unsure.',
            '- Respond ONLY with the JSON object, no commentary.'
        );

        return lines.join('\n');
    },

    /**
     * Generate the text fields of a card. Never generates artwork.
     * @param {Object} fields - { type, theme, difficulty, context }
     * @returns {Promise<{name, description, detection, tools, details}>}
     */
    async generateCard(fields = {}) {
        const prompt = this.buildCardPrompt(fields);
        const text = await this.chat(prompt);
        const data = this.extractJson(text);

        const asList = value => {
            if (!value) return [];
            if (Array.isArray(value)) {
                return value
                    .map(v => (v && typeof v === 'object' ? (v.text || v.url || '') : v))
                    .map(v => String(v).trim())
                    .filter(Boolean);
            }
            return String(value).split('\n').map(v => v.trim()).filter(Boolean);
        };

        const details = Array.isArray(data.details)
            ? data.details
                .map(d => (d && typeof d === 'object' ? { text: d.text || d.url || '', url: d.url || '' } : { text: String(d), url: '' }))
                .filter(d => d.text || d.url)
            : [];

        return {
            name: String(data.name || '').trim(),
            description: String(data.description || '').trim(),
            detection: asList(data.detection),
            tools: asList(data.tools),
            details
        };
    }
};

window.AIClient = AIClient;
