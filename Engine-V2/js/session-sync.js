/**
 * B&B Shuffle Engine-V2 - Session Sync
 *
 * Lightweight live state sync between same-origin documents (player tab <-> GM popup
 * window / in-page overlay iframe) on top of the shared GameState singleton.
 *
 * Transport: BroadcastChannel (same-origin), with a localStorage 'storage' event
 * fallback. State only ever moves forward via GameState.sync.version
 * (last-write-wins — safe for the single-presenter topology).
 */
(function () {
    'use strict';

    const CHANNEL = 'bb-shuffle-sync';

    function init() {
        if (typeof GameState === 'undefined') return;

        const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
        const hasStorageEvents = 'storage' in window;
        if (!hasBroadcastChannel && !hasStorageEvents) return;

        const senderId = Math.random().toString(36).slice(2);
        const storageKey = (typeof CONFIG !== 'undefined' && CONFIG.sync && CONFIG.sync.storageKey)
            ? CONFIG.sync.storageKey
            : 'bb-shuffle-sync-state';

        let channel = null;
        if (hasBroadcastChannel) {
            try {
                channel = new BroadcastChannel(CHANNEL);
            } catch (e) {
                channel = null;
            }
        }

        function post(msg) {
            msg.sender = senderId;
            if (channel) {
                try { channel.postMessage(msg); } catch (e) { /* noop */ }
            }
        }

        function persist() {
            try {
                const exported = GameState.exportForSync();
                if (exported && exported.sync) {
                    localStorage.setItem(storageKey, JSON.stringify(exported));
                }
            } catch (e) { /* storage full / blocked */ }
        }

        // Broadcast + persist whenever the local GameState changes.
        GameState.subscribe(function () {
            post({ type: 'state', state: GameState.exportForSync() });
            persist();
        });

        function handle(msg) {
            if (!msg || msg.sender === senderId) return; // ignore our own messages
            if (msg.type === 'hello') {
                // A new document joined — share our current snapshot with it.
                post({ type: 'state', state: GameState.exportForSync() });
            } else if (msg.type === 'state' && msg.state) {
                GameState.importFromSync(msg.state);
            } else if (msg.type === 'scenario' && msg.scenario) {
                handleScenario(msg.scenario);
            }
        }

        // The Player page reacts to a scenario pushed from the Scenario Editor / library
        // by persisting it under bb-current-scenario and reloading to set it up.
        function handleScenario(scenario) {
            const isPlayer = !!document.getElementById('gm-mode-btn');
            if (!isPlayer || !scenario || !scenario.scenario) return;
            try {
                localStorage.setItem('bb-current-scenario', JSON.stringify(scenario));
            } catch (e) { /* storage blocked */ return; }
            if (!window.__bbHandoff) {
                window.__bbHandoff = true;
                setTimeout(function () { window.location.reload(); }, 80);
            }
        }

        if (channel) {
            channel.onmessage = (e) => handle(e.data || {});
            channel.onmessageerror = () => {};
        }

        // Fallback transport: storage events from other documents' persist() writes.
        if (hasStorageEvents) {
            window.addEventListener('storage', (e) => {
                if (e.key === storageKey && e.newValue) {
                    try {
                        GameState.importFromSync(JSON.parse(e.newValue));
                    } catch (err) { /* ignore malformed payload */ }
                }
            });
        }

        // Public API: the Scenario Editor / library can push a scenario to the open Player.
        window.SessionSync = {
            broadcastScenario: function (scenario) {
                post({ type: 'scenario', scenario: scenario || null });
                if (scenario) {
                    try { localStorage.setItem('bb-current-scenario', JSON.stringify(scenario)); } catch (e) { /* noop */ }
                }
            }
        };

        // Announce presence so an already-open document shares its state with us.
        window.setTimeout(function () { post({ type: 'hello' }); }, 0);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
