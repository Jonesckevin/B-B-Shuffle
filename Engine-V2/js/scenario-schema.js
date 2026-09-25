/**
 * B&B Shuffle - Scenario Schema
 * Defines the versioned schema for scenario import/export
 */

const ScenarioSchema = {
    // Current schema version
    CURRENT_VERSION: '1.0',

    // Version migration map for upgrading older exports
    VERSION_MIGRATIONS: {
        // Each key is a version that can be migrated FROM
        // Value is a function that transforms data to the next version
        // '0.9': (data) => migrateV0_9toV1_0(data),
    },

    /**
     * Full schema definition for version 1.0
     */
    SCHEMA_V1_0: {
        // Identity fields
        id: { type: 'string', required: true, description: 'UUID identifier' },
        version: { type: 'string', required: true, description: 'Schema version' },
        exportDate: { type: 'string', required: true, description: 'ISO 8601 export timestamp' },

        // Deck information
        deck: {
            type: 'object',
            required: true,
            properties: {
                name: { type: 'string', required: true },
                path: { type: 'string', required: false },
                title: { type: 'string', required: false }
            }
        },

        // Scenario cards (the 4 main attack path cards)
        scenario: {
            type: 'object',
            required: true,
            properties: {
                initial: { type: 'card', required: true },
                pivot: { type: 'card', required: true },
                c2: { type: 'card', required: true },
                persist: { type: 'card', required: true }
            }
        },

        // Procedure cards
        procedures: {
            type: 'array',
            required: true,
            items: { type: 'card' },
            minItems: 0,
            maxItems: 10
        },

        // Consultants in play (optional). Empty/absent = every consultant in the
        // scenario's deck is available to call ("Call a Consultant").
        consultants: {
            type: 'array',
            required: false,
            items: { type: 'card' },
            minItems: 0
        },

        // The consultant currently on the board (optional)
        consultant: { type: 'card', required: false },

        // Starting inject card
        startingInject: { type: 'card', required: false },

        // Game configuration
        gameConfig: {
            type: 'object',
            required: true,
            properties: {
                initialTurns: { type: 'number', required: true, default: 10 },
                maxStrikes: { type: 'number', required: true, default: 3 }
            }
        },

        // Game state snapshot (optional, for saving mid-game)
        gameState: {
            type: 'object',
            required: false,
            properties: {
                turnsRemaining: { type: 'number', required: false },
                strikesUsed: { type: 'number', required: false },
                cardsRevealed: {
                    type: 'object',
                    properties: {
                        initial: { type: 'boolean' },
                        pivot: { type: 'boolean' },
                        c2: { type: 'boolean' },
                        persist: { type: 'boolean' }
                    }
                },
                diceHistory: { type: 'array', items: { type: 'object' } },
                injectHistory: { type: 'array', items: { type: 'card' } }
            }
        },

        // Metadata
        metadata: {
            type: 'object',
            required: true,
            properties: {
                name: { type: 'string', required: true, description: 'Display name' },
                author: { type: 'string', required: false, default: '' },
                description: { type: 'string', required: false, default: '' },
                difficulty: { type: 'number', required: false, min: 1, max: 5, default: 3 },
                estimatedDuration: { type: 'string', required: false, default: '' },
                tags: { type: 'array', items: { type: 'string' }, default: [] },
                createdAt: { type: 'string', required: true },
                modifiedAt: { type: 'string', required: true }
            }
        },

        // Notes
        notes: {
            type: 'object',
            required: false,
            properties: {
                adminNotes: { type: 'string', default: '' },
                playerNotes: { type: 'string', default: '' }
            }
        }
    },

    /**
     * Card object schema
     */
    CARD_SCHEMA: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        image: { type: 'string', required: false },
        type: { type: 'string', required: true, enum: ['initial', 'pivot', 'c2', 'persist', 'procedure', 'inject', 'consultant'] },
        details: { type: 'string', required: false }
    },

    /**
     * Create an empty scenario object with defaults
     * @returns {Object} Empty scenario with default values
     */
    createEmpty() {
        const now = new Date().toISOString();
        return {
            id: '', // Will be set by generateUUID
            version: this.CURRENT_VERSION,
            exportDate: now,
            deck: {
                name: '',
                path: '',
                title: ''
            },
            scenario: {
                initial: null,
                pivot: null,
                c2: null,
                persist: null
            },
            procedures: [],
            consultants: [],
            consultant: null,
            startingInject: null,
            gameConfig: {
                initialTurns: 10,
                maxStrikes: 3
            },
            gameState: {
                turnsRemaining: 10,
                strikesUsed: 0,
                cardsRevealed: {
                    initial: false,
                    pivot: false,
                    c2: false,
                    persist: false
                },
                diceHistory: [],
                injectHistory: []
            },
            metadata: {
                name: 'Untitled Scenario',
                author: '',
                description: '',
                difficulty: 3,
                estimatedDuration: '',
                tags: [],
                createdAt: now,
                modifiedAt: now
            },
            notes: {
                adminNotes: '',
                playerNotes: ''
            }
        };
    },

    /**
     * Get required fields for validation
     * @returns {Array} List of required field paths
     */
    getRequiredFields() {
        return [
            'id',
            'version',
            'exportDate',
            'deck.name',
            'scenario.initial',
            'scenario.pivot',
            'scenario.c2',
            'scenario.persist',
            'gameConfig.initialTurns',
            'gameConfig.maxStrikes',
            'metadata.name',
            'metadata.createdAt',
            'metadata.modifiedAt'
        ];
    },

    /**
     * Get the list of valid card types
     * @returns {Array} Valid card type strings
     */
    getCardTypes() {
        return [...Utils.CARD_TYPES];
    }
};

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScenarioSchema;
}
