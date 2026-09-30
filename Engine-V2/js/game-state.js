/**
 * B&B Shuffle Engine-V2 - Game State Management
 * Enhanced centralized state management with sync support
 */

const GameState = {
    // Selected cards for the current scenario
    selected: {
        procedures: [],
        scenario: {
            initial: null,
            pivot: null,
            c2: null,
            persist: null
        }
    },

    // Current deck information
    deck: {
        key: null,
        name: null,
        path: null,
        metadata: null
    },

    // Game progress
    game: {
        turnsRemaining: 10,
        maxTurns: 10,
        strikeCount: 0,
        maxStrikes: 3,
        isGameOver: false,
        status: 'setup' // setup, active, paused, completed
    },

    // Card reveal states
    revealed: {
        initial: false,
        pivot: false,
        c2: false,
        persist: false
    },

    // Procedure index -> the first turn on which the card is available again.
    // Cooldowns apply regardless of outcome and align with the rendered hand.
    cooldowns: {},

    // Sync state for admin/player communication
    sync: {
        enabled: true,
        lastUpdate: null,
        version: 0
    },

    /**
     * Initialize or reset game state
     * @param {Object} config - Optional config overrides
     */
    init(config = {}) {
        const gameConfig = config.game || CONFIG.game;

        this.selected = {
            procedures: [],
            scenario: {
                initial: null,
                pivot: null,
                c2: null,
                persist: null
            }
        };

        this.game = {
            turnsRemaining: gameConfig.initialTurns || 10,
            maxTurns: gameConfig.initialTurns || 10,
            strikeCount: 0,
            maxStrikes: gameConfig.maxStrikes || 3,
            isGameOver: false,
            status: 'setup'
        };

        this.revealed = {
            initial: false,
            pivot: false,
            c2: false,
            persist: false
        };

        this.cooldowns = {};

        this.sync.version++;
        this.sync.lastUpdate = Date.now();

        this.notifyChange('init');
    },

    /**
     * Use a turn
     * @returns {boolean} Whether turn was used successfully
     */
    useTurn() {
        if (this.game.turnsRemaining > 0 && !this.game.isGameOver) {
            this.game.turnsRemaining--;
            
            if (this.game.turnsRemaining === 0) {
                this.game.isGameOver = true;
                this.game.status = 'completed';
            }
            
            this.sync.version++;
            this.sync.lastUpdate = Date.now();
            this.notifyChange('turn');
            return true;
        }
        return false;
    },

    /* ------------------------------------------------------------------ */
    /* Procedure cooldowns                                                 */
    /* ------------------------------------------------------------------ */

    /**
     * The turn currently in progress, 1-based.
     *
    * Derived from `turnsRemaining` to keep turn state consistent across solo
    * rolls and tabletop turn advances.
     * @returns {number}
     */
    turnNumber() {
        return Math.max(1, (this.game.maxTurns || 0) - this.game.turnsRemaining + 1);
    },

    /**
     * Send a procedure card to the bench after it has been played.
     *
    * Apply the rule-book cooldown regardless of roll outcome.
     * @param {number} index - Procedure index in the hand
     * @param {number} [turns] - Cooldown length; defaults to CONFIG.game.cooldownTurns
     * @param {number} [asOfTurn] - The turn the card was played on. Callers that
     *   spend the turn as part of resolving the roll (Solo AI does) must pass the
     *   turn captured BEFORE that spend, or the card ends up serving an extra turn
     *   here than it does on the tabletop.
     */
    startCooldown(index, turns, asOfTurn) {
        if (!(index >= 0)) return;
        const length = Math.max(1, turns || CONFIG.game.cooldownTurns || 3);
        const fromTurn = asOfTurn || this.turnNumber();
        // Include the play turn so the card remains unavailable for `length`
        // complete turns after it is played.
        this.cooldowns[index] = fromTurn + length + 1;
        this.sync.version++;
        this.sync.lastUpdate = Date.now();
        this.notifyChange('cooldown');
    },

    /**
     * Turns a procedure still has to sit out, for display on its token.
     *
    * Clamp the displayed value to the configured cooldown length; the raw gap
    * includes the turn on which the procedure was played.
     * @param {number} index - Procedure index
     * @returns {number} 0 when the card is usable again
     */
    cooldownRemaining(index) {
        const until = this.cooldowns[index];
        if (!until) return 0;
        const gap = until - this.turnNumber();
        if (gap <= 0) return 0;
        return Math.min(CONFIG.game.cooldownTurns || 3, gap);
    },

    /**
     * Is this procedure barred from being played this turn?
     * @param {number} index - Procedure index
     * @returns {boolean}
     */
    isOnCooldown(index) {
        return this.cooldownRemaining(index) > 0;
    },

    /** Drop every cooldown (a fresh deal). */
    clearCooldowns() {
        this.cooldowns = {};
    },

    /**
     * Add a strike
     * @returns {boolean} Whether game is over after strike
     */
    addStrike() {
        if (!this.game.isGameOver) {
            this.game.strikeCount++;
            
            if (this.game.strikeCount >= this.game.maxStrikes) {
                this.game.isGameOver = true;
                this.game.status = 'completed';
            }
            
            this.sync.version++;
            this.sync.lastUpdate = Date.now();
            this.notifyChange('strike');
            return this.game.isGameOver;
        }
        return true;
    },

    /**
     * Announce a dice roll so other tabs re-sync. The roll itself is owned by
     * the caller; this only bumps the sync version and notifies listeners.
     */
    logDiceRoll() {
        this.sync.version++;
        this.sync.lastUpdate = Date.now();
        this.notifyChange('dice');
    },

    /**
     * Export current state for sync
     * @returns {Object} Serialized state
     */
    exportForSync() {
        return {
            selected: this.selected,
            game: this.game,
            revealed: this.revealed,
            cooldowns: this.cooldowns,
            deck: {
                key: this.deck.key,
                name: this.deck.name
            },
            sync: this.sync
        };
    },

    /**
     * Import state from sync
     * @param {Object} state - State to import
     */
    importFromSync(state) {
        if (state.sync?.version > this.sync.version) {
            this.selected = state.selected || this.selected;
            this.game = state.game || this.game;
            this.revealed = state.revealed || this.revealed;
            this.cooldowns = state.cooldowns || {};
            this.sync = state.sync;
            this.notifyChange('sync');
        }
    },

    /**
     * Load from scenario
     * @param {Object} scenario - Scenario to load
     */
    fromScenario(scenario) {
        if (!scenario) return;

        // Set deck if specified
        if (scenario.deck?.key) {
            // Deck will need to be loaded separately
            this.deck.key = scenario.deck.key;
            this.deck.name = scenario.deck.name || scenario.deck.key;
        }

        // Set scenario cards
        if (scenario.scenario) {
            this.selected.scenario = { ...scenario.scenario };
        }

        // Set procedures
        if (scenario.procedures) {
            this.selected.procedures = [...scenario.procedures];
        }

        // Set game config
        if (scenario.gameConfig) {
            this.game.maxTurns = scenario.gameConfig.initialTurns || 10;
            this.game.turnsRemaining = scenario.gameConfig.initialTurns || 10;
            this.game.maxStrikes = scenario.gameConfig.maxStrikes || 3;
        }

        // Set game state if provided
        if (scenario.gameState) {
            this.game.turnsRemaining = scenario.gameState.turnsRemaining ?? this.game.turnsRemaining;
            this.game.strikeCount = scenario.gameState.strikesUsed ?? 0;
            if (scenario.gameState.cardsRevealed) {
                this.revealed = { ...scenario.gameState.cardsRevealed };
            }
        }

        this.sync.version++;
        this.sync.lastUpdate = Date.now();
        this.notifyChange('load');
    },

    // Change listeners
    _listeners: [],

    /**
     * Subscribe to state changes
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this._listeners.push(callback);
        return () => {
            const index = this._listeners.indexOf(callback);
            if (index > -1) {
                this._listeners.splice(index, 1);
            }
        };
    },

    /**
     * Notify listeners of change
     * @param {string} changeType - Type of change
     */
    notifyChange(changeType) {
        this._listeners.forEach(callback => {
            try {
                callback(changeType, this);
            } catch (e) {
                console.error('Error in state listener:', e);
            }
        });
    }
};

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameState;
}
