/**
 * B&B Shuffle Engine-V2 - GM Console Link
 *
 * The transport between the GM Console and the projected Player page.
 *
 * WHY THIS IS A SEPARATE FILE FROM session-sync.js
 * `SessionSync` already moves `GameState` between same-origin documents, but it
 * is deliberately narrow: its public surface is a single `broadcastScenario()`,
 * every message goes to every document, and it always echoes local state. Worse,
 * it persists to `bb-shuffle-sync-state`, which the popup Scenario Editor shares.
 * A control surface needs the opposite properties - targeted commands, an
 * acknowledgement per command, and the ability to drive state WITHOUT the Player
 * echoing it straight back - so it lives here rather than reshaping the file the
 * Editor depends on.
 *
 * TOPOLOGY
 *   GM Console (authoritative)  --->  gm-command  --->  Player
 *   GM Console                  <---  gm-ack      <---  Player
 *   Player                      --->  gm-state    --->  GM Console (data channel)
 *   Player                      --->  gm-board    --->  GM Console (board channel)
 *
 * `gm-state` carries what `GameState.exportForSync()` knows: turns, strikes,
 * reveals, cooldowns, deck. `gm-board` carries what GameState does NOT know -
 * the control surface's view of the inject queue pointer, the consultant in
 * play, the procedure hand and the active selection. Splitting them matters
 * because the board half has no version counter and must be replayed rather
 * than merged.
 *
 * This module never reads or writes `bb-shuffle-sync-state` and never touches
 * `GameState.sync.version` on its own; the Player's `applyRemote()` decides what
 * a command means, including whether it should move the shared clock.
 *
 * Public surface: `window.GMLink`.
 */
(function (global) {
    'use strict';

    const CHANNEL = 'bb-shuffle-sync';
    const ROLE_GM = 'gm';
    const ROLE_PLAYER = 'player';

    // Message types. `gm-state` / `gm-board` are broadcasts; the command/ack pair
    // is the only request/response in the system.
    const MSG_HELLO = 'gm-hello';
    const MSG_WHO = 'gm-who';
    const MSG_ROSTER = 'gm-roster';
    const MSG_COMMAND = 'gm-command';
    const MSG_ACK = 'gm-ack';
    const MSG_STATE = 'gm-state';
    const MSG_BOARD = 'gm-board';
    // Console -> Player: "send me your current board". The only console message
    // that is not a command; it changes nothing on the Player.
    const MSG_PULL = 'gm-pull';
    // Console -> Player: "I am still here". Renews the authority lease without
    // asking for anything back, so it cannot cause a re-render.
    const MSG_ALIVE = 'gm-alive';

    // How long a console waits for a Player to answer `gm-who` before it decides
    // nobody is listening. Long enough to cover a Player that is still booting.
    const DISCOVERY_MS = 1200;
    // Console -> Player heartbeat, so a Player can tell a live console from a
    // tab that was closed while it held authority.
    const HEARTBEAT_MS = 4000;
    // A Player that has not heard from its console in this long drops authority
    // rather than staying frozen with its controls disabled forever.
    const AUTHORITY_TTL_MS = 12000;

    const listeners = {
        command: [],
        board: [],
        snapshot: [],
        roster: [],
        authority: []
    };

    const state = {
        role: null,
        isPlayer: false,
        ready: false,
        channel: null,
        // Console side
        playerId: null,
        discovering: false,
        // Player side
        gmId: null,
        managed: false,
        lastSeenAt: 0,
        heartbeatTimer: null,
        ttlTimer: null,
        // Command bookkeeping
        seq: 0,
        pending: {},
        lastBoardAt: 0
    };

    const selfId = Math.random().toString(36).slice(2);

    function byId(id) {
        return document.getElementById(id);
    }

    /**
     * The Player page is identified by `#gm-mode-btn`.
     *
     * This is the same test `session-sync.js` uses, and it is load-bearing in
     * three places (`handleScenario`, solo's spoiler hiding, and the reveal
     * control's disabled state). That is why the button is HIDDEN rather than
     * removed in every mode, and why this module must not remove it either.
     * @returns {boolean}
     */
    function detectPlayer() {
        return !!byId('gm-mode-btn');
    }

    function emit(name, payload) {
        (listeners[name] || []).forEach(function (fn) {
            try {
                fn(payload);
            } catch (e) {
                console.error('GMLink listener error (' + name + '):', e);
            }
        });
    }

    function post(msg) {
        msg.from = selfId;
        if (!state.channel) return;
        try {
            state.channel.postMessage(msg);
        } catch (e) { /* channel closed */ }
    }

    // ------------------------------------------------------------ console side

    /**
     * Ask the channel whether a Player is listening.
     * @returns {boolean} Whether a Player answered within `DISCOVERY_MS`
     */
    function discover() {
        state.discovering = true;
        post({ type: MSG_WHO });
        return new Promise(function (resolve) {
            global.setTimeout(function () {
                state.discovering = false;
                resolve(!!state.playerId);
            }, DISCOVERY_MS);
        });
    }

    /**
     * Send a command to the Player and resolve with its acknowledgement.
     *
     * Every command is sequenced and acked, because the console must be able to
     * tell "the Player applied this" from "the Player never got it" - the whole
     * point of a control surface is that the GM can trust the projected screen.
     *
     * @param {string} op - Operation name (see PlayerController.applyRemote)
     * @param {Object} [payload] - Operation arguments
     * @param {number} [timeoutMs=3000] - Reject after this long with no ack
     * @returns {Promise<{ok: boolean, reason?: string}>}
     */
    function command(op, payload, timeoutMs) {
        if (!state.playerId) {
            return Promise.reject(new Error('No player is connected.'));
        }
        const seq = ++state.seq;
        const target = state.playerId;
        const envelope = {
            type: MSG_COMMAND,
            to: target,
            seq: seq,
            op: op,
            payload: payload || {}
        };
        return new Promise(function (resolve, reject) {
            const timer = global.setTimeout(function () {
                delete state.pending[seq];
                // The bound Player never answered. It may have been closed or
                // reloaded (a reload gives it a new id), so drop it and look for a
                // live one rather than failing every command until the GM reloads
                // the console by hand.
                if (state.playerId === target) {
                    state.playerId = null;
                    emit('roster', { playerId: null, connected: false });
                    void discover();
                }
                reject(new Error('No response for "' + op + '" - is the Player tab still open?'));
            }, timeoutMs || 3000);

            state.pending[seq] = function (ack) {
                global.clearTimeout(timer);
                delete state.pending[seq];
                if (ack && ack.ok) resolve(ack);
                else reject(new Error((ack && ack.reason) || 'The player refused the command.'));
            };

            post(envelope);
        });
    }

    /** Push an authoritative board descriptor to every Player. */
    function pushBoard(descriptor) {
        post({ type: MSG_BOARD, root: descriptor });
    }

    /**
     * Ask the Player to re-send its board.
     *
     * The console does NOT push its own `GameState` at the Player. It is
     * authoritative about *commands* but not about *state*: the Player owns the
     * live clock, and an earlier revision of this file had the console broadcast
     * a snapshot the Player imported with `force`, which silently reverted a
     * spent turn back to the console's stale copy. State only ever flows
     * Player -> console; the console's only write path is `gm-command`.
     */
    function requestBoard() {
        // ADDRESSED to the bound Player, not broadcast. A broadcast pull made
        // every open Player tab answer, so a console with a second tab around
        // re-rendered whichever board arrived last - a different game's deck,
        // hand and chain. That flapping is what surfaced as the "add card"
        // dropdown offering another deck's procedures.
        if (!state.playerId) return;
        post({ type: MSG_PULL, to: state.playerId });
    }

    /** Resolve the first `gm-who` with a Player, confirming the link. */
    function resolvePlayer(playerId) {
        if (!playerId) return;
        state.playerId = playerId;
        emit('roster', { playerId: playerId, connected: true });
    }

    // ------------------------------------------------------------- player side

    function setManaged(managed) {
        if (state.managed === managed) return;
        state.managed = managed;
        // CSS hook only - the actual control disabling is PlayerController's job,
        // because it knows which elements it owns.
        document.body.classList.toggle('gm-managed', managed);
        emit('authority', { managed: managed, gmId: state.gmId });
        if (typeof PlayerController !== 'undefined' && PlayerController.setRemoteControl) {
            PlayerController.setRemoteControl(managed);
        }
    }

    function touchAuthority(gmId) {
        state.gmId = gmId || state.gmId;
        state.lastSeenAt = Date.now();
        setManaged(true);
    }

    /**
     * Drop authority if the console has gone quiet.
     *
     * Without this, closing the console tab leaves the Player permanently
     * read-only - its own buttons disabled by a GM that no longer exists.
     */
    function reapAuthority() {
        if (!state.managed) return;
        if (Date.now() - state.lastSeenAt < AUTHORITY_TTL_MS) return;
        state.gmId = null;
        setManaged(false);
    }

    function handleCommand(msg) {
        if (state.role !== ROLE_PLAYER) return;
        // Commands are addressed; anything not for us is another tab's traffic.
        if (msg.to && msg.to !== selfId) return;
        touchAuthority(msg.from);

        const controller = (typeof PlayerController !== 'undefined') ? PlayerController : null;
        if (!controller || typeof controller.applyRemote !== 'function') {
            post({ type: MSG_ACK, to: msg.from, seq: msg.seq, ok: false, reason: 'The player is still loading.' });
            return;
        }

        let result;
        try {
            result = controller.applyRemote(msg.op, msg.payload || {});
        } catch (e) {
            post({ type: MSG_ACK, to: msg.from, seq: msg.seq, ok: false, reason: e.message || 'Command failed.' });
            return;
        }

        post({
            type: MSG_ACK,
            to: msg.from,
            seq: msg.seq,
            ok: result !== false,
            reason: (result && result.reason) || null,
            snapshot: (typeof GameState !== 'undefined') ? GameState.exportForSync() : null
        });

        // Echo the board AFTER the command's own repaint has settled.
        //
        // This has to be deferred, not synchronous. A command like `turn.spend`
        // raises a GameState change *during* its own body, and `watchGameState`
        // pushes a board for that - a snapshot taken before `updateStats()` has
        // finished repainting the DOM and, more importantly, before the command
        // handler has applied its own state (a cooldown, a reveal). Sending
        // synchronously here raced those two messages and the console could apply
        // the earlier one last. A macrotask boundary puts this push after both.
        if (typeof controller.exportControlState === 'function') {
            global.setTimeout(pushBoardState, 0);
        }
    }

    function pushBoardState() {
        const controller = (typeof PlayerController !== 'undefined') ? PlayerController : null;
        if (!controller || typeof controller.exportControlState !== 'function') return;
        post({ type: MSG_BOARD, from: selfId, root: controller.exportControlState() });
    }

    function handle(msg) {
        if (!msg || msg.from === selfId) return;

        switch (msg.type) {
            case MSG_WHO:
                if (state.role === ROLE_PLAYER) post({ type: MSG_ROSTER, playerId: selfId });
                break;

            case MSG_ROSTER:
                if (state.role === ROLE_GM) resolvePlayer(msg.playerId);
                break;

            case MSG_COMMAND:
                handleCommand(msg);
                break;

            case MSG_ACK:
                if (state.role === ROLE_GM && state.pending[msg.seq]) {
                    state.pending[msg.seq](msg);
                }
                break;

            case MSG_STATE:
                if (state.role === ROLE_PLAYER && msg.snapshot) {
                    touchAuthority(msg.from);
                    if (typeof GameState !== 'undefined') {
                        GameState.importFromSync(msg.snapshot, true);
                    }
                }
                if (state.role === ROLE_GM && msg.snapshot) {
                    emit('snapshot', msg.snapshot);
                }
                break;

            case MSG_PULL:
                // The console asked for the current board; answer with everything.
                // Same addressing guard as a command: a pull aimed at one Player
                // must not make every other tab volunteer its board.
                if (state.role === ROLE_PLAYER) {
                    if (msg.to && msg.to !== selfId) break;
                    touchAuthority(msg.from);
                    pushBoardState();
                }
                break;

            case MSG_ALIVE:
                // Renew the lease and send nothing back. Replying here would put
                // the console back on a polling loop.
                if (state.role === ROLE_PLAYER) {
                    if (msg.to && msg.to !== selfId) break;
                    touchAuthority(msg.from);
                }
                break;

            case MSG_BOARD:
                // Only from the Player this console is driving. A second Player
                // tab (or a stale one) broadcasting its own board made the
                // console flap between two games, so the hand and the procedure
                // pool could belong to different decks.
                if (state.role === ROLE_GM && msg.root && (!state.playerId || msg.from === state.playerId)) {
                    state.lastBoardAt = Date.now();
                    emit('board', msg.root);
                }
                break;

            default:
                break;
        }
    }

    // -------------------------------------------------------------------- init

    /**
     * Start the link.
     * @param {'gm'|'player'} role - Which end of the link this document is
     */
    function start(role) {
        if (state.ready) return;
        if (typeof BroadcastChannel === 'undefined') return;

        let channel;
        try {
            channel = new BroadcastChannel(CHANNEL);
        } catch (e) {
            return;
        }

        state.role = role;
        state.isPlayer = role === ROLE_PLAYER;
        state.channel = channel;
        channel.onmessage = function (e) { handle(e.data || {}); };
        channel.onmessageerror = function () {};

        if (state.isPlayer) {
            // Ask whoever is out there to claim us. A console that is already
            // open answers immediately; one opened later sends its own `gm-who`.
            global.setTimeout(function () { post({ type: MSG_ROSTER, playerId: selfId }); }, 0);
            state.heartbeatTimer = global.setInterval(reapAuthority, HEARTBEAT_MS);
        } else {
            void discover();
            // KEEP-ALIVE ONLY. This used to call `requestBoard()`, which made the
            // console re-render every few seconds - and a re-render rebuilds the
            // "add a procedure" <select>, so a GM with the dropdown open had it
            // reset under them mid-click. Authority still needs renewing (the
            // Player reaps it after AUTHORITY_TTL_MS), so ping without pulling:
            // boards now arrive only from a real state change, a command echo, or
            // the Refresh button.
            state.heartbeatTimer = global.setInterval(function () {
                if (state.playerId) post({ type: MSG_ALIVE, to: state.playerId });
            }, HEARTBEAT_MS);
        }

        state.ready = true;
    }

    /**
     * Change-track the Player's GameState so the console sees turns, strikes,
     * reveals and cooldowns without polling.
     */
    function watchGameState() {
        if (typeof GameState === 'undefined' || !state.isPlayer) return;
        GameState.subscribe(function () {
            if (!state.channel) return;
            if (typeof PlayerController !== 'undefined' && PlayerController.exportControlState) {
                // Board state already carries the counters; one message keeps the
                // console from having to stitch two payloads together.
                pushBoardState();
            } else {
                post({ type: MSG_STATE, snapshot: GameState.exportForSync() });
            }
        });
    }

    global.GMLink = {
        start: start,
        watchGameState: watchGameState,
        isPlayer: function () { return state.isPlayer; },
        isManaged: function () { return state.managed; },
        gmId: function () { return state.gmId; },
        playerConnected: function () { return !!state.playerId; },
        role: function () { return state.role; },
        command: command,
        pushBoard: pushBoard,
        requestBoard: requestBoard,
        discover: discover,
        onCommand: function (fn) { listeners.command.push(fn); },
        onBoard: function (fn) { listeners.board.push(fn); },
        onSnapshot: function (fn) { listeners.snapshot.push(fn); },
        onRoster: function (fn) { listeners.roster.push(fn); },
        onAuthority: function (fn) { listeners.authority.push(fn); },
        // Test seam: lets a harness drive the state machine without a real peer.
        _emit: emit,
        _detectPlayer: detectPlayer,
        _state: state
    };

    // Self-mount. The Player joins automatically (it is the one being driven);
    // a console opts in by calling `GMLink.start('gm')` from its own script, so
    // this file stays inert on any page that is merely curious about it.
    function autostart() {
        if (detectPlayer()) {
            start(ROLE_PLAYER);
            watchGameState();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autostart);
    } else {
        autostart();
    }
})(typeof window !== 'undefined' ? window : this);
