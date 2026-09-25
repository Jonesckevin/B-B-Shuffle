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
 *   AIClient.isConfigured()             -> Promise<boolean>
 *   AIClient.chat(prompt, opts)         -> Promise<string>
 *   AIClient.extractJson(text)          -> Object
 *   AIClient.generateCard(fields)       -> Promise<{name, description, detection, tools, details}>
 */

const AIClient = {
    SHARED_CONFIG_ENDPOINT: '/api/ai/config',
    SHARED_CHAT_ENDPOINT: '/api/ai/chat',
    OWN_SETTINGS_KEY: 'bb-ai-settings',

    // Mirrors the provider table in scenario_ai.js (chat endpoints only — the
    // creator never needs model listing).
    PROVIDERS: {
        openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini' },
        anthropic: { name: 'Anthropic', endpoint: 'https://api.anthropic.com/v1/messages', defaultModel: 'claude-3-5-sonnet-20241022' },
        mistral: { name: 'Mistral', endpoint: 'https://api.mistral.ai/v1/chat/completions', defaultModel: 'mistral-small-latest' },
        xai: { name: 'xAI (Grok)', endpoint: 'https://api.x.ai/v1/chat/completions', defaultModel: 'grok-3-mini' },
        perplexity: { name: 'Perplexity', endpoint: 'https://api.perplexity.ai/chat/completions', defaultModel: 'sonar' },
        groq: { name: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', defaultModel: 'llama-3.3-70b-versatile' },
        deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', defaultModel: 'deepseek-chat' },
        gemini: { name: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', defaultModel: 'gemini-2.0-flash' },
        ollama: { name: 'Ollama', endpoint: 'http://localhost:11434/api/generate', defaultModel: 'llama3' }
    },

    /* ------------------------------------------------------------------ */
    /* Configuration                                                       */
    /* ------------------------------------------------------------------ */

    /** The user's own AI settings (written by the AI Generator), if any. */
    getOwnSettings() {
        try {
            const raw = localStorage.getItem(this.OWN_SETTINGS_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return (parsed && parsed.apiKey) ? parsed : null;
        } catch (e) {
            return null;
        }
    },

    /** Public info about the server-configured shared key. */
    async getSharedConfig() {
        try {
            const res = await fetch(this.SHARED_CONFIG_ENDPOINT, { cache: 'no-store' });
            if (!res.ok) return { configured: false };
            const data = await res.json();
            return data && data.configured ? data : { configured: false };
        } catch (e) {
            return { configured: false };
        }
    },

    /**
     * Is any AI path usable?
     * @returns {Promise<{ok: boolean, mode: 'shared'|'own'|'none', label: string}>}
     */
    async resolve() {
        const shared = await this.getSharedConfig();
        if (shared.configured) {
            return {
                ok: true,
                mode: 'shared',
                label: `${shared.providerName || shared.provider || 'Server'}${shared.model ? ' · ' + shared.model : ''}`
            };
        }
        const own = this.getOwnSettings();
        if (own) {
            const provider = this.PROVIDERS[own.provider];
            return {
                ok: true,
                mode: 'own',
                label: `${provider ? provider.name : own.provider}${own.model ? ' · ' + own.model : ''}`
            };
        }
        return { ok: false, mode: 'none', label: 'Not configured' };
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
        const shared = await this.getSharedConfig();
        if (shared.configured) {
            return await this.chatViaServer(prompt, shared);
        }
        const own = this.getOwnSettings();
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

        const res = await fetch(this.SHARED_CHAT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

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
        const provider = this.PROVIDERS[settings.provider];
        if (!provider) throw new Error('Unknown AI provider: ' + settings.provider);

        const model = settings.model || provider.defaultModel;
        const temperature = typeof settings.temperature === 'number' ? settings.temperature : 0.7;
        const maxTokens = settings.maxTokens || 1600;

        if (settings.provider === 'ollama') {
            const res = await fetch(provider.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt, stream: false })
            });
            if (!res.ok) throw new Error('Ollama request failed — is Ollama running?');
            const data = await res.json();
            return data.response || '';
        }

        if (settings.provider === 'anthropic') {
            const res = await fetch(provider.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': settings.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || `AI request failed (${res.status})`);
            }
            const data = await res.json();
            return data.content?.[0]?.text || '';
        }

        const res = await fetch(provider.endpoint, {
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
        });
        if (!res.ok) {
            let message = `AI request failed (${res.status})`;
            try {
                const err = await res.json();
                message = err.error?.message || err.message || message;
            } catch (e) { /* non-JSON error body */ }
            throw new Error(message);
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || data.response || data.text || '';
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
