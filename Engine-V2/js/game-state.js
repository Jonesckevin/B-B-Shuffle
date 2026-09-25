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
