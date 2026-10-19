/**
 * B&B Shuffle - In-browser LLM provider (WebLLM / WebGPU)
 * ------------------------------------------------------------------
 * Runs a small language model entirely in the browser so the Solo AI (PvE)
 * Incident Master and the AI Generator work with NO API key and nothing leaving
 * the device. This is a *provider*: AIClient and ScenarioAI route to it exactly
 * like any keyed provider, and both pages mount the same status/download panel
 * from here (mount()).
 *
 * WHY A CDN import: this repo has no bundler and no ES modules - but a classic
 * script may still call the dynamic `import()`, which is how WebLLM's own docs
 * load it (`https://esm.run/@mlc-ai/web-llm`). Google Fonts is the only other
 * CDN dependency, so this is the house pattern rather than a new one. The ~6 MB
 * engine bundle is only fetched when a model is actually loaded - never on page
 * load, and never just to populate a dropdown.
 *
 * OFFLINE: model weights are downloaded once by the WebLLM runtime and cached in
 * the browser's Cache Storage, and the engine bundle is cached by the browser's
 * HTTP cache. After the first successful load the feature works with no network.
 * The service worker deliberately does not touch cross-origin requests, so it
 * neither breaks nor owns this.
 *
 * Public API (window.WebLLMProvider)
 *   MODELS                       -> [{ id, label, size, tier }] curated list
 *   pickDefault()                -> id, device-aware (small on phones/low RAM)
 *   modelInfo(id)                -> entry from MODELS | null
 *   probe()                      -> Promise<{ok, reason}> (WebGPU preflight)
 *   gpuOk()                      -> boolean (sync, after probe)
 *   adapterInfo()                -> {vendor, architecture, device, label} | null
 *   available()                  -> Promise<{ok, reason}>
 *   catalog()                    -> curated ids, filtered once the engine is loaded
 *   scanCache(force?)            -> Promise<string[]> ids already downloaded
 *   cachedIds()                  -> string[] (sync, after scanCache)
 *   ensure(modelId)              -> Promise<engine> (downloads + loads if needed)
 *   chat(prompt, opts)           -> Promise<string>
 *   chatMessages(messages, opts) -> Promise<string>
 *   interrupt()                  -> stop the generation in flight
 *   eject()                      -> unload the engine (weights stay cached)
 *   deleteModel(id)              -> free the downloaded weights from the cache
 *   hasModelInCache(id)          -> Promise<boolean>
 *   state()                      -> plain snapshot for rendering
 *   subscribe(fn)                -> () => void  (fires on every change)
 *   mount(host, opts)            -> render/refresh the status panel into `host`
 *     opts.getModel()            -> the model the host page has selected
 *     opts.getSelect()           -> the host page's <select> (marked "downloaded")
 */
(function (global) {
    'use strict';

    const CDN_URL = 'https://esm.run/@mlc-ai/web-llm';

    // The curated tiers. Keep 360M first and 1.7B second: pickDefault() relies on
    // that order for the mobile/desktop split.
    //
    //   size  approximate one-time download, in GB, shown to the user
    //   tier  'small' | 'balanced' | 'large' | 'xlarge' - a hint, not a hard rule
    //
    // Ids are WebLLM's own prebuilt names. catalog() filters this list against the
    // engine's catalogue once it is loaded, so one that a release has retired is
    // dropped from the pickers instead of failing at download time.
    const MODELS = [
        { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', label: 'SmolLM2 360M – smallest & fastest', size: 0.4, tier: 'small' },
        { id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', label: 'SmolLM2 1.7B – balanced (recommended)', size: 1.0, tier: 'balanced' },
        { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B – tiny all-rounder', size: 0.4, tier: 'small' },
        { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B – small, good instruction following', size: 0.7, tier: 'small' },
        { id: 'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC', label: 'TinyLlama 1.1B – small chat model', size: 0.7, tier: 'small' },
        { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B – balanced', size: 1.0, tier: 'balanced' },
        { id: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 2B – careful, well-spoken', size: 1.4, tier: 'balanced' },
        { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 3B – sharper', size: 1.9, tier: 'large' },
        { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B – sharper', size: 2.0, tier: 'large' },
        { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi 3.5 mini – reasoning-focused', size: 2.1, tier: 'large' },
        { id: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC', label: 'Mistral 7B – best quality, needs a strong GPU', size: 3.7, tier: 'xlarge' },
        { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 7B – best quality, needs a strong GPU', size: 4.3, tier: 'xlarge' },
        { id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', label: 'DeepSeek R1 (Qwen 7B) – reasoning, needs a strong GPU', size: 4.4, tier: 'xlarge' }
    ];

    // --------------------------------------------------------------- state
    const state = {
        status: 'idle',        // idle | downloading | ready | error
        supported: null,       // null = not probed yet, true | false
        gpu: null,             // { ok, reason }
        model: '',             // the model currently loaded
        loadingModel: '',      // the model being downloaded right now
        progress: 0,           // 0..100
        text: '',              // WebLLM's own progress line ("Fetching param cache…")
        error: '',
        engine: null,
        lib: null,             // the loaded @mlc-ai/web-llm namespace
        cached: [],            // ids known to be downloaded into this browser
        cacheScanned: false,   // whether the cache has been enumerated at least once
        adapterPatched: false, // whether requestAdapter has been wrapped
        adapterOriginal: null, // the unwrapped requestAdapter
        gpuAdapter: null       // the adapter the engine is actually using
    };

    let libPromise = null;
    let loadPromise = null;
    let probePromise = null;
    const listeners = new Set();

    // ------------------------------------------------------------- helpers
    function modelInfo(id) {
        return MODELS.find(m => m.id === id) || null;
    }

    function labelFor(id) {
        const info = modelInfo(id);
        return info ? info.label : (id || 'a model');
    }

    function sizeFor(id) {
        const info = modelInfo(id);
        return info ? info.size : 1.0;
    }

    /** Plain snapshot; safe to hand to a renderer. */
    function snapshot() {
        const adapter = (state.gpu && state.gpu.adapter) || null;
        return {
            status: state.status,
            supported: state.supported,
            reason: (state.gpu && state.gpu.reason) || '',
            adapter: adapter,
            adapterLabel: (adapter && adapter.label) || '',
            integrated: !!(state.gpu && state.gpu.integrated),
            model: state.model,
            modelLabel: state.model ? labelFor(state.model) : '',
            loadingModel: state.loadingModel,
            progress: state.progress,
            text: state.text,
            error: state.error,
            ready: state.status === 'ready',
            cached: state.cached.slice(),
            cacheScanned: state.cacheScanned
        };
    }

    function emit() {
        const snap = snapshot();
        listeners.forEach(fn => {
            try { fn(snap); } catch (e) { console.warn('[WebLLM] listener failed:', e); }
        });
    }

    /** Subscribe to state changes. Returns an unsubscribe function. */
    function subscribe(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        try { fn(snapshot()); } catch (e) { /* first paint must not throw */ }
        return () => listeners.delete(fn);
    }

    /** Coarse device tier, used only to pick a sensible default model. */
    function deviceTier() {
        try {
            const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
            const narrow = typeof innerWidth === 'number' && innerWidth <= 768;
            const lowMem = typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4;
            if ((coarse && narrow) || lowMem) return 'mobile';
        } catch (e) { /* treat as desktop */ }
        return 'desktop';
    }

    /** The model to preselect: the small tier on a phone / low-memory device. */
    function pickDefault() {
        return deviceTier() === 'mobile' ? MODELS[0].id : MODELS[1].id;
    }

    // --------------------------------------------------------------- WebGPU

    /**
     * Normalise a WebGPU adapter descriptor.
     *
     * `adapter.info` is the modern (Chrome 121+) synchronous attribute; before
     * that the same data came from `adapter.requestAdapterInfo()`, which could be
     * a promise. Browsers deliberately blank `device`/`description` for privacy,
     * so `vendor` + `architecture` are what we can rely on.
     * @param {GPUAdapter} adapter
     * @returns {Promise<{vendor: string, architecture: string, device: string, description: string, label: string}|null>}
     */
    async function readAdapterInfo(adapter) {
        if (!adapter) return null;
        let info = adapter.info || null;
        if (!info && typeof adapter.requestAdapterInfo === 'function') {
            try {
                const got = adapter.requestAdapterInfo();
                info = (got && typeof got.then === 'function') ? await got : got;
            } catch (e) {
                info = null;
            }
        }
        if (!info) return { vendor: '', architecture: '', device: '', description: '', label: '' };

        const vendor = info.vendor || '';
        const architecture = info.architecture || '';
        const device = info.device || '';
        const description = info.description || '';
        return {
            vendor,
            architecture,
            device,
            description,
            // Something short for the panel; the raw fields go in the tooltip.
            label: [vendor, device || description || architecture].filter(Boolean).join(' · ')
        };
    }

    /**
     * Does this adapter look like the integrated GPU of a laptop?
     *
     * Deliberately conservative: only Intel-not-Arc is called out, because Intel
     * Arc is a discrete part and a wrong "you are on the wrong GPU" hint is worse
     * than no hint at all. Vendor strings are lower-case ASCII from the browser.
     * @param {Object|null} info
     * @returns {boolean}
     */
    function looksIntegrated(info) {
        if (!info) return false;
        const vendor = String(info.vendor || '').toLowerCase();
        const arch = String(info.architecture || '').toLowerCase();
        if (!/intel/.test(vendor)) return false;
        return !/arc|xehpg|xe-hpg|dg2|battlemage/.test(arch);
    }

    /**
     * The raw `requestAdapter` call, captured before any wrapping.
     * @param {Object} [options]
     * @returns {Promise<GPUAdapter|null>}
     */
    function requestAdapter(options) {
        const gpu = (typeof navigator !== 'undefined') ? navigator.gpu : null;
        if (!gpu) return Promise.resolve(null);
        const call = state.adapterOriginal || gpu.requestAdapter;
        return call.call(gpu, options);
    }

    /**
     * Ask for the discrete GPU, and watch what actually comes back.
     *
     * `powerPreference: 'high-performance'` is the only lever the WebGPU API
     * gives a page – there is no adapter enumeration – and **Chrome on Windows
     * currently ignores it** (the runtime warns about crbug.com/369219127), so
     * believing the request is not enough: we record the adapter's own descriptor
     * and report it. Wrapping the platform call also covers the engine's own
     * internal `requestAdapter()`, which is what WebLLM uses to build its device.
     */
    function installAdapterPreference() {
        if (state.adapterPatched) return;
        state.adapterPatched = true;
        try {
            const gpu = (typeof navigator !== 'undefined') ? navigator.gpu : null;
            if (!gpu || typeof gpu.requestAdapter !== 'function') return;

            const original = gpu.requestAdapter;
            state.adapterOriginal = original;

            gpu.requestAdapter = function (options) {
                const opts = Object.assign({}, options || {});
                // Add the hint only when the caller did not state a preference.
                if (!opts.powerPreference) opts.powerPreference = 'high-performance';
                return Promise.resolve(original.call(gpu, opts)).then(adapter => {
                    if (adapter && !state.gpuAdapter) recordAdapter(adapter);
                    return adapter;
                });
            };
        } catch (e) {
            // A frozen/absent platform API must never break the feature.
            state.adapterOriginal = null;
        }
    }

    /** Remember which adapter is in use and re-render the panel. */
    function recordAdapter(adapter) {
        state.gpuAdapter = adapter;
        void readAdapterInfo(adapter).then(info => {
            if (!info) return;
            state.gpu = Object.assign({}, state.gpu, {
                adapter: info,
                integrated: looksIntegrated(info)
            });
            emit();
        });
    }

    /** One-shot WebGPU preflight. Cached; safe to call repeatedly. */
    function probe() {
        if (probePromise) return probePromise;
        probePromise = (async () => {
            if (typeof navigator === 'undefined' || !navigator.gpu) {
                state.supported = false;
                state.gpu = {
                    ok: false,
                    reason: 'This browser has no WebGPU. Use desktop Chrome or Edge 113+, with hardware acceleration enabled.'
                };
                emit();
                return state.gpu;
            }
            try {
                installAdapterPreference();

                // Ask for the discrete GPU first; fall back to the browser's own
                // default if the option itself is rejected.
                let adapter = await requestAdapter({ powerPreference: 'high-performance' });
                if (!adapter) adapter = await requestAdapter();

                if (!adapter) {
                    state.supported = false;
                    state.gpu = {
                        ok: false,
                        reason: 'WebGPU is present but no GPU adapter was found. Enable hardware acceleration, or try a different device.'
                    };
                } else {
                    state.supported = true;
                    const info = await readAdapterInfo(adapter);
                    state.gpuAdapter = adapter;
                    state.gpu = {
                        ok: true,
                        reason: '',
                        adapter: info,
                        integrated: looksIntegrated(info)
                    };
                }
            } catch (error) {
                state.supported = false;
                state.gpu = { ok: false, reason: (error && error.message) || 'WebGPU could not be initialised.' };
            }
            emit();
            return state.gpu;
        })();
        return probePromise;
    }

    function gpuOk() { return state.supported === true; }

    /** The adapter the engine is running on: `{vendor, architecture, device, label}` or null. */
    function adapterInfo() {
        return (state.gpu && state.gpu.adapter) || null;
    }

    /** Can in-browser models run here? */
    async function available() {
        if (state.supported === null) await probe();
        if (state.supported) return { ok: true, reason: '' };
        return { ok: false, reason: (state.gpu && state.gpu.reason) || 'WebGPU is not available on this device.' };
    }

    // --------------------------------------------------------------- engine
    /** Lazy, memoised import of the WebLLM runtime. */
    function loadLib() {
        if (!libPromise) {
            libPromise = import(/* webpackIgnore: true */ CDN_URL)
                .then(lib => { state.lib = lib; return lib; })
                .catch(error => {
                    libPromise = null;
                    const detail = (error && error.message) ? error.message : 'network error';
                    throw new Error('Could not load the in-browser engine (' + detail + '). Check your connection and try again.');
                });
        }
        return libPromise;
    }

    /**
     * The curated ids, filtered against the engine's own model list once it has
     * been loaded. A model that has been retired by a WebLLM release is dropped
     * rather than offered and then failing at download time. Before the engine is
     * loaded this returns the curated list unfiltered (loading ~6 MB just to
     * populate a dropdown is not acceptable).
     */
    function catalog() {
        const fallback = MODELS.map(m => m.id);
        const list = state.lib && state.lib.prebuiltAppConfig && state.lib.prebuiltAppConfig.model_list;
        if (!Array.isArray(list)) return fallback;
        const offered = new Set(list.map(m => m && m.model_id).filter(Boolean));
        const filtered = MODELS.filter(m => offered.has(m.id)).map(m => m.id);
        return filtered.length ? filtered : fallback;
    }

    /** Download (if needed) and load a model. Reuses an engine already loaded. */
    function ensure(modelId) {
        const target = modelId || state.model || pickDefault();

        if (state.engine && state.model === target && state.status === 'ready') {
            return Promise.resolve(state.engine);
        }
        // A load already in flight for the same model is shared, not restarted.
        if (loadPromise && state.loadingModel === target) return loadPromise;

        state.loadingModel = target;
        loadPromise = (async () => {
            const avail = await available();
            if (!avail.ok) throw new Error(avail.reason || 'WebGPU is not available.');

            state.status = 'downloading';
            state.progress = 0;
            state.text = '';
            state.error = '';
            emit();

            try {
                // Wrap requestAdapter before the engine is imported: WebLLM makes
                // its own call, and this is what lets the discrete GPU be asked
                // for there too.
                installAdapterPreference();
                const lib = await loadLib();

                // Refuse a model this build does not carry, with a readable message
                // instead of a low-level failure deep inside the runtime.
                const list = lib.prebuiltAppConfig && lib.prebuiltAppConfig.model_list;
                if (Array.isArray(list) && list.length
                    && !list.some(m => m && m.model_id === target)) {
                    throw new Error(`“${target}” is not offered by this WebLLM build. Pick a different model.`);
                }

                // One engine at a time: free the previous model before loading another.
                if (state.engine) {
                    try { await state.engine.unload(); } catch (e) { /* already gone */ }
                    state.engine = null;
                }

                const engine = await lib.CreateMLCEngine(target, {
                    initProgressCallback: (report) => {
                        const ratio = (report && typeof report.progress === 'number') ? report.progress : 0;
                        state.progress = Math.max(0, Math.min(100, Math.round(ratio * 100)));
                        state.text = (report && report.text) ? String(report.text) : '';
                        emit();
                    }
                });

                state.engine = engine;
                state.model = target;
                state.status = 'ready';
                state.progress = 100;
                state.text = '';
                // A model that loaded successfully is by definition downloaded now.
                if (state.cached.indexOf(target) === -1) state.cached = state.cached.concat(target);
                emit();
                void scanCache(true);
                return engine;
            } catch (error) {
                state.status = 'error';
                state.error = (error && error.message) ? error.message : 'the model failed to load';
                state.engine = null;
                emit();
                throw error;
            } finally {
                loadPromise = null;
                state.loadingModel = '';
            }
        })();

        return loadPromise;
    }

    /**
     * Stream a completion and resolve with the full text. `opts.onToken(delta,
     * full)` is called as tokens arrive, so a caller can render live.
     *
     * `opts.stop` is a list of sequences that end the answer early. It is applied
     * here rather than through the API's `stop` field: watching the stream means
     * a rambling model is cut off at the first paragraph break (and generation is
     * cancelled) instead of writing hundreds more tokens that get thrown away.
     */
    async function chatMessages(messages, opts = {}) {
        const engine = await ensure(opts.model || state.model || pickDefault());

        const params = {
            messages: Array.isArray(messages)
                ? messages
                : [{ role: 'user', content: String(messages == null ? '' : messages) }],
            stream: true,
            temperature: (typeof opts.temperature === 'number') ? opts.temperature : 0.7,
            max_tokens: opts.maxTokens || 1600
        };

        const onToken = (typeof opts.onToken === 'function') ? opts.onToken : null;
        const stops = Array.isArray(opts.stop) ? opts.stop.filter(Boolean) : [];
        const stream = await engine.chat.completions.create(params);

        let out = '';
        for await (const chunk of stream) {
            const choice = chunk && chunk.choices && chunk.choices[0];
            const delta = (choice && choice.delta && choice.delta.content) || '';
            if (!delta) continue;
            out += delta;
            if (onToken) {
                try { onToken(delta, out); } catch (e) { console.warn('[WebLLM] onToken failed:', e); }
            }
            // Do not trip on a leading newline: only a stop sequence reached after
            // the answer has actually started ends the reply.
            if (stops.length && out.replace(/^\s+/, '').length >= 12) {
                const hit = stops
                    .map(s => out.indexOf(s))
                    .filter(i => i !== -1)
                    .sort((a, b) => a - b)[0];
                if (hit !== undefined) {
                    out = out.slice(0, hit);
                    interrupt();
                    if (onToken) { try { onToken('', out); } catch (e) { /* preview only */ } }
                    break;
                }
            }
        }
        return out;
    }

    /** Single-prompt convenience wrapper (what AIClient.chat passes through). */
    function chat(prompt, opts = {}) {
        return chatMessages([{ role: 'user', content: String(prompt == null ? '' : prompt) }], opts);
    }

    /** Stop the generation in flight (the stream then resolves with what it has). */
    function interrupt() {
        try {
            if (state.engine && typeof state.engine.interruptGenerate === 'function') {
                state.engine.interruptGenerate();
            }
        } catch (e) { /* nothing to interrupt */ }
    }

    /** Unload the engine. The downloaded weights stay in the browser cache. */
    async function eject() {
        if (state.engine) {
            try { await state.engine.unload(); } catch (e) { /* already unloaded */ }
        }
        state.engine = null;
        state.model = '';
        state.status = 'idle';
        state.progress = 0;
        state.text = '';
        state.error = '';
        emit();
    }

    /** Free a downloaded model from the browser cache. */
    async function deleteModel(id) {
        const target = id || state.model;
        if (!target) return false;
        try {
            const lib = await loadLib();
            if (typeof lib.deleteModelAllInfoInCache !== 'function') return false;
            if (state.model === target) await eject();
            await lib.deleteModelAllInfoInCache(target, lib.prebuiltAppConfig || undefined);
            state.cached = state.cached.filter(id => id !== target);
            emit();
            return true;
        } catch (error) {
            console.warn('[WebLLM] could not delete the cached model:', error);
            return false;
        }
    }

    /** Is this model already downloaded? (Loads the engine bundle if needed.) */
    async function hasModelInCache(id) {
        const target = id || state.model;
        if (!target) return false;
        try {
            const lib = await loadLib();
            if (typeof lib.hasModelInCache !== 'function') return false;
            return !!(await lib.hasModelInCache(target, lib.prebuiltAppConfig || undefined));
        } catch (e) {
            return false;
        }
    }

    /* ------------------------------------------------------- downloaded cache */

    /**
     * Has the WebLLM runtime stored anything at all? A cheap check that avoids
     * pulling the ~6 MB engine bundle down just to enumerate the downloads: the
     * runtime keeps its own Cache Storage buckets, and their absence means there
     * is nothing to enumerate.
     */
    async function runtimeCacheExists() {
        try {
            if (typeof caches === 'undefined' || typeof caches.keys !== 'function') return false;
            const keys = await caches.keys();
            return keys.some(k => k.indexOf('webllm') === 0);
        } catch (e) {
            return false;
        }
    }

    /**
     * Work out which curated models are already downloaded, so the panel can
     * offer to switch to one without downloading it again.
     * @param {boolean} [force] - Re-enumerate even if already scanned
     * @returns {Promise<string[]>} Downloaded model ids
     */
    async function scanCache(force) {
        if (state.cacheScanned && !force) return state.cached.slice();

        // Nothing cached at all: do not pay for the engine bundle to find that out.
        if (!state.lib && !(await runtimeCacheExists())) {
            state.cached = [];
            state.cacheScanned = true;
            emit();
            return [];
        }
        if (!state.lib) {
            try {
                await loadLib();
            } catch (e) {
                state.cacheScanned = true;
                emit();
                return state.cached.slice();
            }
        }

        const found = [];
        for (const m of MODELS) {
            try {
                if (await hasModelInCache(m.id)) found.push(m.id);
            } catch (e) { /* treat an unreadable entry as absent */ }
        }
        state.cached = found;
        state.cacheScanned = true;
        emit();
        return found.slice();
    }

    /** Ids known to be downloaded (sync; empty until scanCache has run). */
    function cachedIds() {
        return state.cached.slice();
    }

    /** Minimal HTML escape - labels are ours, but never trust a string to markup. */
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ---------------------------------------------------------------- panel
    const PANEL_HTML = [
        '<div class="webllm-panel">',
        '<p class="webllm-lead">Runs entirely in your browser – no API key, and nothing is sent to a server.</p>',
        '<p class="webllm-gpu" data-role="gpu"></p>',
        '<p class="webllm-warning hidden" data-role="warning"></p>',
        '<div class="webllm-actions">',
        '<button type="button" class="btn btn-secondary btn-sm" data-role="download">Download &amp; load model</button>',
        '<button type="button" class="btn btn-ghost btn-sm hidden" data-role="stop">Stop</button>',
        '<button type="button" class="btn btn-ghost btn-sm hidden" data-role="eject">Eject</button>',
        '<button type="button" class="btn btn-ghost btn-sm hidden" data-role="delete" title="Remove the downloaded model from this browser">Delete download</button>',
        '</div>',
        '<div class="webllm-progress hidden" data-role="progresswrap" role="progressbar" aria-valuemin="0" aria-valuemax="100">',
        '<div class="webllm-progress-bar" data-role="bar"></div>',
        '</div>',
        '<p class="webllm-status" data-role="status" role="status"></p>',
        // Which GPU actually answered, and what to do about it when the browser
        // handed us the integrated one.
        '<p class="webllm-note hidden" data-role="gpuhint"></p>',
        // Models already stored in this browser: switching to one is instant and
        // needs no network, which is the whole point of keeping them.
        '<div class="webllm-downloads hidden" data-role="downloads">',
        '<div class="webllm-downloads-head">',
        '<span>Downloaded models</span>',
        '<button type="button" class="btn btn-ghost btn-sm" data-role="rescan" title="Re-check which models are stored in this browser">Rescan</button>',
        '</div>',
        '<div class="webllm-downloads-list" data-role="downloads-list"></div>',
        '<p class="webllm-downloads-empty" data-role="downloads-empty">Nothing downloaded yet – pick a model above and download it once.</p>',
        '</div>',
        '</div>'
    ].join('');

    const instances = new WeakMap();

    function show(el, on) {
        if (el) el.classList.toggle('hidden', !on);
    }

    function resolveModel(inst) {
        try {
            if (inst.options && typeof inst.options.getModel === 'function') {
                const chosen = inst.options.getModel();
                if (chosen) return chosen;
            }
        } catch (e) { /* fall through to the defaults */ }
        return state.model || pickDefault();
    }

    /** The host page's model <select>, if it gave us one. */
    function resolveSelect(inst) {
        try {
            if (inst.options && typeof inst.options.getSelect === 'function') {
                return inst.options.getSelect() || null;
            }
        } catch (e) { /* the host may not have a picker */ }
        return null;
    }

    /**
     * Mark already-downloaded models in the host page's own dropdown, so the
     * picker says what is local instead of only the panel doing so. Rebuilt
     * options are re-marked on the next render.
     */
    function decorateSelect(inst) {
        const select = resolveSelect(inst);
        if (!select || !state.cacheScanned) return;
        const cached = new Set(state.cached);
        Array.prototype.forEach.call(select.options, (opt) => {
            if (!opt.value || !modelInfo(opt.value)) return;
            if (opt.dataset.baseText === undefined) opt.dataset.baseText = opt.textContent;
            const base = opt.dataset.baseText;
            opt.textContent = cached.has(opt.value) ? base + ' · downloaded' : base;
        });
    }

    /**
     * The downloaded-models list: one row per stored model, with an instant
     * Switch for the ones that are not loaded.
     */
    function renderDownloads(inst) {
        const wrap = inst.els.downloads;
        const list = inst.els.downloadsList;
        const empty = inst.els.downloadsEmpty;
        if (!wrap || !list) return;

        const supported = state.supported !== false;
        show(wrap, supported);
        if (!supported) return;

        const cached = state.cached.slice();
        const checking = !state.cacheScanned;
        show(list, cached.length > 0);
        show(empty, cached.length === 0);
        if (empty) {
            // Do not claim "nothing downloaded" before the scan has actually run.
            empty.textContent = checking
                ? 'Checking for models already stored in this browser…'
                : 'Nothing downloaded yet – pick a model above and download it once.';
        }

        // Only rebuild when the set or the loaded model actually changed, so a
        // 40-times-a-second progress callback cannot fight the user's clicks.
        const sig = cached.join('|') + '#' + (state.model || '');
        if (sig === inst.downloadsSig) return;
        inst.downloadsSig = sig;

        list.innerHTML = cached.map(id => {
            const info = modelInfo(id) || { label: id, size: '' };
            const loaded = state.model === id;
            return '<div class="webllm-dl-item">' +
                '<span class="webllm-dl-name">' + esc(info.label) + '</span>' +
                '<span class="webllm-dl-size">' + esc(info.size) + ' GB</span>' +
                (loaded
                    ? '<span class="webllm-dl-badge">Loaded</span>'
                    : '<button type="button" class="btn btn-ghost btn-sm" data-switch="' + esc(id) + '">Switch</button>') +
                '</div>';
        }).join('');
    }

    function statusLine(snap, inst) {
        if (snap.supported === false) return 'In-browser models are unavailable on this device.';
        if (snap.status === 'downloading') {
            const pct = snap.progress ? ' ' + snap.progress + '%' : '';
            return 'Loading ' + labelFor(snap.loadingModel || snap.model) + '…' + pct +
                (snap.text ? ' – ' + snap.text : '');
        }
        if (snap.status === 'ready') return labelFor(snap.model) + ' is loaded and ready.';
        if (snap.status === 'error') return 'Could not load the model: ' + snap.error;
        const want = resolveModel(inst);
        return 'Not loaded yet. Download ' + labelFor(want) + ' (about ' + sizeFor(want) + ' GB) to start.';
    }

    function warningLine(snap, inst) {
        if (snap.supported === false) {
            return snap.reason || 'WebGPU is not available on this device.';
        }
        const want = resolveModel(inst);
        return 'The model downloads once (about ' + sizeFor(want) + ' GB) and is stored in this browser, '
            + 'so it keeps working offline. It runs slower and is less capable than a cloud model.';
    }

    /** Is the page running on Windows? Only used to word the GPU advice. */
    function isWindows() {
        try {
            const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
            return /win/i.test(platform);
        } catch (e) {
            return false;
        }
    }

    /**
     * Advice shown when the integrated GPU answered.
     *
     * There is no adapter enumeration in WebGPU and no way to pick a device, so
     * `powerPreference: 'high-performance'` is the only lever a page has - and
     * Chrome on Windows ignores it (crbug.com/369219127). When `chrome://gpu`
     * lists a second adapter, the card is present and it is the *browser's* own
     * GPU preference that has to change, which is why the hint names the two
     * Windows-level places to set it.
     */
    function gpuHint(snap) {
        if (snap.supported === false || !snap.integrated) return '';
        const base = 'This is the integrated GPU. A page cannot choose another one: WebGPU exposes no adapter '
            + 'list, and Chrome on Windows ignores the "high-performance" request (crbug.com/369219127).';
        if (isWindows()) {
            return base + ' If chrome://gpu lists a second GPU, the card is there – assign the browser to it: '
                + 'Settings → System → Display → Graphics → add your browser → Options → High performance, '
                + 'and NVIDIA Control Panel → Manage 3D settings → Program Settings → the browser → '
                + 'High-performance NVIDIA processor. Chromium also has a Force High Performance GPU flag '
                + '(chrome://flags/#force-high-performance-gpu). Fully close and reopen the browser afterwards.';
        }
        return base + ' Set the browser\'s own GPU preference to high performance and reopen it; '
            + 'chrome://gpu shows which adapter it picked.';
    }

    function renderPanel(inst) {
        const snap = snapshot();
        const el = inst.els;

        const warning = warningLine(snap, inst);
        if (el.warning) {
            el.warning.textContent = warning;
            show(el.warning, !!warning);
        }
        if (el.status) el.status.textContent = statusLine(snap, inst);

        // Which GPU in use - and, when it is the integrated one, how to change it.
        if (el.gpu) {
            const name = snap.adapterLabel;
            el.gpu.textContent = name
                ? 'GPU in use: ' + name
                : (snap.supported === false ? '' : 'GPU in use: not reported by this browser.');
            const info = snap.adapter || {};
            el.gpu.title = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ');
            show(el.gpu, snap.supported !== false);
        }
        const hint = gpuHint(snap);
        if (el.gpuHint) {
            el.gpuHint.textContent = hint;
            show(el.gpuHint, !!hint);
        }

        const busy = snap.status === 'downloading';
        show(el.stop, busy);
        show(el.progressWrap, busy);
        show(el.eject, snap.status === 'ready');
        show(el.delete, snap.status !== 'downloading');
        show(el.download, !busy);

        // A model already in the browser loads without a download, so say so on
        // the button rather than implying the weights are fetched again.
        const want = resolveModel(inst);
        const already = state.cached.indexOf(want) !== -1;
        if (el.download) {
            el.download.disabled = snap.supported === false;
            el.download.textContent = snap.status === 'ready'
                ? 'Reload / change model'
                : (already ? 'Load model (already downloaded)' : 'Download & load model');
        }
        if (el.delete) el.delete.disabled = snap.supported === false;
        if (el.eject) el.eject.disabled = snap.supported === false;

        if (el.bar) el.bar.style.width = Math.max(0, Math.min(100, snap.progress || 0)) + '%';
        if (el.progressWrap) el.progressWrap.setAttribute('aria-valuenow', String(snap.progress || 0));

        decorateSelect(inst);
        renderDownloads(inst);
    }

    function toast(message, type) {
        if (typeof Utils !== 'undefined' && typeof Utils.showToast === 'function') {
            Utils.showToast(message, type || 'info');
        }
    }

    /**
     * Render (or refresh) the panel inside `host`.
     * @param {HTMLElement} host
     * @param {Object} [options]
     * @param {Function} [options.getModel] - returns the model id the user has selected
     * @returns {Object|null} the panel instance
     */
    function mount(host, options = {}) {
        if (!host) return null;

        let inst = instances.get(host);
        if (!inst) {
            host.innerHTML = PANEL_HTML;
            inst = {
                host,
                options,
                unsub: null,
                downloadsSig: '',
                els: {
                    warning: host.querySelector('[data-role="warning"]'),
                    status: host.querySelector('[data-role="status"]'),
                    gpu: host.querySelector('[data-role="gpu"]'),
                    gpuHint: host.querySelector('[data-role="gpuhint"]'),
                    download: host.querySelector('[data-role="download"]'),
                    stop: host.querySelector('[data-role="stop"]'),
                    eject: host.querySelector('[data-role="eject"]'),
                    delete: host.querySelector('[data-role="delete"]'),
                    progressWrap: host.querySelector('[data-role="progresswrap"]'),
                    bar: host.querySelector('[data-role="bar"]'),
                    downloads: host.querySelector('[data-role="downloads"]'),
                    downloadsList: host.querySelector('[data-role="downloads-list"]'),
                    downloadsEmpty: host.querySelector('[data-role="downloads-empty"]'),
                    rescan: host.querySelector('[data-role="rescan"]')
                }
            };

            inst.els.download?.addEventListener('click', () => {
                ensure(resolveModel(inst)).catch(() => { /* the status line reports it */ });
            });
            inst.els.stop?.addEventListener('click', () => interrupt());
            inst.els.eject?.addEventListener('click', () => {
                void eject().then(() => toast('In-browser model unloaded. The download is still cached.', 'info'));
            });
            inst.els.delete?.addEventListener('click', () => {
                const target = resolveModel(inst);
                void deleteModel(target).then(ok => {
                    toast(ok
                        ? 'Downloaded model removed from this browser.'
                        : 'Nothing to remove (or the model cache could not be cleared).',
                        ok ? 'success' : 'warning');
                });
            });
            inst.els.rescan?.addEventListener('click', () => {
                void scanCache(true).then(ids => {
                    toast(ids.length
                        ? ids.length + ' downloaded model' + (ids.length === 1 ? '' : 's') + ' found.'
                        : 'No downloaded models found.', 'info');
                });
            });
            // Switching to an already-downloaded model: no network, no progress bar.
            inst.els.downloadsList?.addEventListener('click', (event) => {
                const button = event.target && event.target.closest ? event.target.closest('[data-switch]') : null;
                if (!button) return;
                const id = button.getAttribute('data-switch');
                const select = resolveSelect(inst);
                if (select && modelInfo(id)) select.value = id;
                ensure(id).then(() => renderPanel(inst)).catch(() => { /* status line reports it */ });
            });

            inst.unsub = subscribe(() => renderPanel(inst));
            void probe().then(() => {
                renderPanel(inst);
                // Only enumerate downloads once the device can actually run them,
                // and never block the first paint on it.
                if (state.supported) void scanCache(false).then(() => renderPanel(inst));
            });
            instances.set(host, inst);
        }

        inst.options = Object.assign({}, inst.options, options);
        renderPanel(inst);
        return inst;
    }

    global.WebLLMProvider = {
        CDN_URL,
        MODELS,
        pickDefault,
        modelInfo,
        deviceTier,
        probe,
        gpuOk,
        available,
        adapterInfo,
        catalog,
        scanCache,
        cachedIds,
        ensure,
        chat,
        chatMessages,
        interrupt,
        eject,
        deleteModel,
        hasModelInCache,
        state: snapshot,
        subscribe,
        mount
    };
})(window);
