// VERSION
// B&B - Engine.Config.2.0
//

const CONFIG = {
    // Deck configuration. Key -> { name, path, cardbacks, expansion?, cardbackOverrides? }
    //   name              label shown in the deck picker
    //   path              carddb JSON, relative to Engine-V1/
    //   cardbacks         key into cardbackSets below
    //   cardbackOverrides optional per-deck back overrides (e.g. the ICS/OT C2 card)
    //   expansion         bundled expansion deck (listed, but stand-alone here)
    decks: {
        'core': {
            name: 'Core',
            path: '../shared/decks/core/carddb.json',
            cardbacks: 'v1'
        },
        'core31': {
            name: 'Core 3.1',
            path: '../shared/decks/core31/carddb.json',
            cardbacks: 'v1'
        },
        'core-v31-expansion': {
            name: 'Core 3.1 + Expansion',
            path: '../shared/decks/core-v31-expansion/carddb.json',
            cardbacks: 'v1'
        },
        'green-expansion-v2': {
            name: 'Green Expansion v2',
            path: '../shared/decks/green-expansion-v2/carddb.json',
            cardbacks: 'v1',
            expansion: true
        },
        'expansion1': {
            name: 'Expansion 1',
            path: '../shared/decks/expansion1/carddb.json',
            cardbacks: 'v1',
            expansion: true
        },
        'ics-ot': {
            name: 'ICS/OT',
            path: '../shared/decks/ics-ot/carddb.json',
            cardbacks: 'v2',
            cardbackOverrides: {
                brown: '../shared/decks/cardbacks/v2/exfil.webp'
            }
        },
        'core-v1': {
            name: 'Core v1',
            path: '../shared/decks/core-v1/carddb.json',
            cardbacks: 'v1'
        },
        'core-v3': {
            name: 'Core v3',
            path: '../shared/decks/core-v3/carddb.json',
            cardbacks: 'v1'
        },
        'core-v22': {
            name: 'Core v2.2',
            path: '../shared/decks/core-v22/carddb.json',
            cardbacks: 'v1'
        },
        'core-spanish': {
            name: 'Core Spanish 1.0',
            path: '../shared/decks/core-spanish/carddb.json',
            cardbacks: 'v1'
        },
        'cloud-security': {
            name: 'Cloud Security',
            path: '../shared/decks/cloud-security/carddb.json',
            cardbacks: 'v1'
        },
        'datadog': {
            name: 'DataDog',
            path: '../shared/decks/datadog/carddb.json',
            cardbacks: 'v1'
        },
        'huntress': {
            name: 'Huntress',
            path: '../shared/decks/huntress/carddb.json',
            cardbacks: 'v1'
        },
        'red-canary': {
            name: 'Red Canary',
            path: '../shared/decks/red-canary/carddb.json',
            cardbacks: 'v1'
        },
        'densecure': {
            name: 'DenSecure',
            path: '../shared/decks/densecure/carddb.json',
            cardbacks: 'v1'
        },
        'trimarc': {
            name: 'Trimarc',
            path: '../shared/decks/trimarc/carddb.json',
            cardbacks: 'v1'
        },
        'electrical-co-op': {
            name: 'Electrical Co-Op',
            path: '../shared/decks/electrical-co-op/carddb.json',
            cardbacks: 'v1'
        },
        'mega-deck': {
            name: 'The MEGA Deck',
            path: '../shared/decks/mega-deck/carddb.json',
            cardbacks: 'v1'
        },
        // User-created cards from the Custom Card Creator (Engine-V2). Lives
        // under data/, which is the only volume-mounted directory.
        'custom': {
            name: 'Custom Cards',
            path: '../data/custom-decks/custom-cards.json',
            cardbacks: 'v1',
            expansion: true
        }
    },

    // Deck loaded when nothing has been chosen yet
    defaultDeck: 'core',

    // Cardback image sets.
    // Deck JSON files carry their own red/yellow/... paths, but the expansion
    // decks point at artwork folders from the original website that do not
    // exist in this project, so backs are resolved from these sets instead.
    cardbackSets: {
        v1: {
            red: '../shared/decks/cardbacks/v1/init.webp',
            yellow: '../shared/decks/cardbacks/v1/pivot.webp',
            brown: '../shared/decks/cardbacks/v1/c2.webp',
            purple: '../shared/decks/cardbacks/v1/persist.webp',
            grey: '../shared/decks/cardbacks/v1/inject.webp'
        },
        v2: {
            red: '../shared/decks/cardbacks/v2/initial.webp',
            yellow: '../shared/decks/cardbacks/v2/pivot.webp',
            brown: '../shared/decks/cardbacks/v2/c2.webp',
            purple: '../shared/decks/cardbacks/v2/persist.webp',
            grey: '../shared/decks/cardbacks/v2/inject.webp'
        }
    },

    // Card types
    cardTypes: {
        PROCEDURE: 'procedure',
        INJECT: 'inject',
        INITIAL: 'initial',
        PIVOT: 'pivot',
        C2: 'c2',
        PERSIST: 'persist'
    },

    // Game settings
    game: {
        initialTurns: 10,
        maxStrikes: 3,
        successThreshold: 10,
        bonusModifier: 3,
        criticalRoll: 20,
        criticalFail: 1,
        warningTurns: 2,
        alertTurns: 1,
        maxProcedures: 4
    },

    // Element IDs for easier reference
    elementIds: {
        // Card containers
        scenarioA: 'a',
        scenarioB: 'b',
        scenarioC: 'c',
        scenarioD: 'd',
        injectE: 'e',

        // DM solution containers
        dmA: 'dma',
        dmB: 'dmb',
        dmC: 'dmc',
        dmD: 'dmd',

        // Card fronts
        initA: 'inita',
        initB: 'initb',
        initC: 'initc',
        initD: 'initd',

        // UI elements
        version: 'version',
        date: 'date',
        copyright: 'copyright',

        // Menus and builders
        builder: 'builder',
        deckList: 'deck-list',

        // Procedure outputs
        output: 'output',
        remainder: 'remainder',

        // Inject boxes
        injectDiv: 'injectdiv',

        // Game progress
        diceBox: 'dicebox',
        dice: 'dice',
        d20: 'd20',
        message: 'message',
        fails: 'fails',
        turn: 'turn',
        turnMessage: 'turn_message',

        // DM controls
        dmSolution: 'dm_solution',
        dmScenario: 'dm_scenario',

        // Notes
        gmNotes: 'gmnotes'
    },

    // Menu IDs
    menuIds: ['ic', 'pv', 'c2', 'ps', 'proc', 'start'],

    // Draggable element IDs
    draggableIds: [
        'injectdiv',
        'mydiv',
        'dicebox',
        'gmnotes',
        'counter1',
        'counter2',
        'counter3',
        'hold1',
        'hold2',
        'hold3'
    ],

    // CSS classes
    cssClasses: {
        procImg: 'procimg',
        procImgBuild: 'procimgbuild',
        scenImg: 'scenimg',
        scenImgBuild: 'scenimgbuild',
        inject: 'inject',
        fail: 'fail',
        success: 'success'
    }
};

// Make config available globally
window.CONFIG = CONFIG;
