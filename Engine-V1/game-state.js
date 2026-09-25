// VERSION
// B&B - Engine.State.1.0
//

/**
 * Centralized game state management
 * Reduces global variable pollution
 */
const GameState = {
    // Card lists
    cardLists: {
        procedures: [],
        injects: [],
        initial: [],
        pivot: [],
        c2: [],
        persist: []
    },

    // Remaining cards (for tracking used cards)
    remaining: {
        procedures: [],
        injects: [],
        randomizedInjects: []
    },

    // Selected cards for custom scenarios
    selected: {
        procedures: [],
        custom: [0, 0, 0, 0] // Track custom scenario selections
    },

    // Current deck information
    deck: {
        name: null,
        cardListPath: null,
        metadata: null
    },

    // Game progress
    game: {
        turnsRemaining: 10,
        strikeCount: 0,
        isGameOver: false
    },

    // Inject cycling state
    injectCycle: {
        currentIndex: 0,
        maxIndex: 1
    },

    /**
     * Initialize or reset game state
     */
    init() {
        this.cardLists = {
            procedures: [],
            injects: [],
            initial: [],
            pivot: [],
            c2: [],
            persist: []
        };

        this.remaining = {
            procedures: [],
            injects: [],
            randomizedInjects: []
        };

        this.selected = {
            procedures: [],
            custom: [0, 0, 0, 0]
        };

        this.game = {
            turnsRemaining: CONFIG.game.initialTurns,
            strikeCount: 0,
            isGameOver: false
        };

        this.injectCycle = {
            currentIndex: 0,
            maxIndex: 1
        };
    },

    /**
     * Get all cards of a specific type
     * @param {string} type - Card type
     * @returns {Array} - Array of cards
     */
    getCards(type) {
        return this.cardLists[type] || [];
    },

    /**
     * Add card to a list
     * @param {string} type - Card type
     * @param {*} card - Card to add
     */
    addCard(type, card) {
        if (this.cardLists[type]) {
            this.cardLists[type].push(card);
        }
    },

    /**
     * Get remaining procedures
     * @returns {Array}
     */
    getRemainingProcedures() {
        if (this.remaining.procedures.length === 0) {
            this.remaining.procedures = [...this.cardLists.procedures];
        }
        return this.remaining.procedures;
    },

    /**
     * Reset remaining procedures
     */
    resetRemainingProcedures() {
        this.remaining.procedures = [...this.cardLists.procedures];
    },

    /**
     * Get randomized injects
     * @returns {Array}
     */
    getRandomizedInjects() {
        return this.remaining.randomizedInjects;
    },

    /**
     * Set randomized injects
     * @param {Array} injects - Shuffled inject array
     */
    setRandomizedInjects(injects) {
        this.remaining.randomizedInjects = injects;
    },

    /**
     * Reset randomized injects
     */
    resetRandomizedInjects() {
        this.remaining.randomizedInjects = Utils.shuffle([...this.cardLists.injects]);
    },

    /**
     * Set current deck
     * @param {string} deckName - Name of the deck
     * @param {string} cardListPath - Path to card list JSON
     */
    setDeck(deckName, cardListPath) {
        this.deck.name = deckName;
        this.deck.cardListPath = cardListPath;
    },

    /**
     * Get current deck path
     * @returns {string}
     */
    getDeckPath() {
        return this.deck.cardListPath;
    },

    /**
     * Set deck metadata
     * @param {Object} metadata - Deck metadata from JSON
     */
    setDeckMetadata(metadata) {
        this.deck.metadata = metadata;
    },

    /**
     * Decrement turns
     */
    decrementTurns() {
        if (this.game.turnsRemaining > 0) {
            this.game.turnsRemaining--;
        }
        if (this.game.turnsRemaining === 0) {
            this.game.isGameOver = true;
        }
    },

    /**
     * Add turn
     */
    addTurn() {
        this.game.turnsRemaining++;
        if (this.game.turnsRemaining > 0) {
            this.game.isGameOver = false;
        }
    },

    /**
     * Add strike
     * @returns {boolean} - True if max strikes reached
     */
    addStrike() {
        this.game.strikeCount++;
        return this.game.strikeCount >= CONFIG.game.maxStrikes;
    },

    /**
     * Reset strikes
     */
    resetStrikes() {
        this.game.strikeCount = 0;
    },

    /**
     * Get current game status
     * @returns {Object}
     */
    getGameStatus() {
        return {
            turns: this.game.turnsRemaining,
            strikes: this.game.strikeCount,
            isGameOver: this.game.isGameOver,
            isWarning: this.game.turnsRemaining <= CONFIG.game.warningTurns,
            isAlert: this.game.turnsRemaining <= CONFIG.game.alertTurns
        };
    }
};

// Initialize state
GameState.init();

// Make state available globally
window.GameState = GameState;
