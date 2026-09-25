/**
 * B&B Shuffle Engine-V2 - Configuration
 * Centralized configuration for the game engine
 */

const CONFIG = {
    // Deck paths (relative to shared)
    //
    // Each deck: { name, path, cardbackPath, cover?, expansion?, expansionPrefix? }.
    // `cover` is the deck's box art in `shared/img/decks/<key>.webp` — shown in
    // the Card Catalogue, the Scenario Editor's loaded-deck panel and the
    // Scenario Library's deck filter. Decks with no box art upstream (core-v1,
    // green-expansion-v2, custom) simply omit it and render without an image.
    decks: {
        core: {
            name: 'Core Deck',
            path: '../shared/decks/core/carddb.json',
            cover: '../shared/img/decks/core.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'core31': {
            name: 'Core 3.1',
            path: '../shared/decks/core31/carddb.json',
            cover: '../shared/img/decks/core31.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'green-expansion-v2': {
            name: 'Green Expansion v2',
            path: '../shared/decks/green-expansion-v2/carddb.json',
            cardbackPath: '../shared/decks/cardbacks/v1/',
            expansion: true,
            expansionPrefix: 'GE-'
        },
        expansion1: {
            name: 'Expansion 1',
            path: '../shared/decks/expansion1/carddb.json',
            cover: '../shared/img/decks/expansion1.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/',
            expansion: true,
            expansionPrefix: 'EX1-'
        },
        'ics-ot': {
            name: 'ICS-OT',
            path: '../shared/decks/ics-ot/carddb.json',
            cover: '../shared/img/decks/ics-ot.webp',
            cardbackPath: '../shared/decks/cardbacks/v2/',
            // The deck's C2 row is printed with its own exfil art (this mirrors
            // Engine-V1's `cardbackOverrides.brown`).
            cardbackOverrides: { c2: '../shared/decks/cardbacks/v2/exfil.webp' }
        },
        'core-v1': {
            name: 'Core v1',
            path: '../shared/decks/core-v1/carddb.json',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'core-v3': {
            name: 'Core v3',
            path: '../shared/decks/core-v3/carddb.json',
            cover: '../shared/img/decks/core-v3.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'core-v22': {
            name: 'Core v2.2',
            path: '../shared/decks/core-v22/carddb.json',
            cover: '../shared/img/decks/core-v22.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'core-spanish': {
            name: 'Core Spanish 1.0',
            path: '../shared/decks/core-spanish/carddb.json',
            cover: '../shared/img/decks/core-spanish.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'cloud-security': {
            name: 'Cloud Security',
            path: '../shared/decks/cloud-security/carddb.json',
            cover: '../shared/img/decks/cloud-security.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        datadog: {
            name: 'DataDog',
            path: '../shared/decks/datadog/carddb.json',
            cover: '../shared/img/decks/datadog.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        huntress: {
            name: 'Huntress',
            path: '../shared/decks/huntress/carddb.json',
            cover: '../shared/img/decks/huntress.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'red-canary': {
            name: 'Red Canary',
            path: '../shared/decks/red-canary/carddb.json',
            cover: '../shared/img/decks/red-canary.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        densecure: {
            name: 'DenSecure',
            path: '../shared/decks/densecure/carddb.json',
            cover: '../shared/img/decks/densecure.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        trimarc: {
            name: 'Trimarc',
            path: '../shared/decks/trimarc/carddb.json',
            cover: '../shared/img/decks/trimarc.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'electrical-co-op': {
            name: 'Electrical Co-Op',
            path: '../shared/decks/electrical-co-op/carddb.json',
            cover: '../shared/img/decks/electrical-co-op.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        'mega-deck': {
            name: 'The MEGA Deck',
            path: '../shared/decks/mega-deck/carddb.json',
            cover: '../shared/img/decks/mega-deck.webp',
            cardbackPath: '../shared/decks/cardbacks/v1/'
        },
        // User-created cards from the Custom Card Creator. Lives under data/
        // (volume-mounted, git-ignored) so it survives container rebuilds, and
        // is offered as an expansion pack in the Scenario Editor.
        custom: {
            name: 'Custom Cards',
            path: '../data/custom-decks/custom-cards.json',
            cardbackPath: '../shared/decks/cardbacks/v1/',
            expansion: true,
            expansionPrefix: 'CC-'
        }
    },

    // Card-back art per generation, keyed by CARD TYPE.
    //
    // A deck names its generation with `cardbackPath` (…/cardbacks/<set>/) — the same
    // split Engine-V1 carries — and the Player looks its backs up here. Engine-V1
    // stores this by card COLOUR (its board labels the rows red/yellow/brown/purple/
    // grey); Engine-V2 works in card TYPES, hence the different key.
    //
    // The 1.0 generation has no Procedure or Consultant back, so those types are
    // null here and Utils.cardbackFor() falls back to the 2.0 art.
    cardbackSets: {
        v1: {
            initial: '../shared/decks/cardbacks/v1/init.webp',
            pivot: '../shared/decks/cardbacks/v1/pivot.webp',
            c2: '../shared/decks/cardbacks/v1/c2.webp',
            persist: '../shared/decks/cardbacks/v1/persist.webp',
            inject: '../shared/decks/cardbacks/v1/inject.webp',
            procedure: null,
            consultant: null
        },
        v2: {
            initial: '../shared/decks/cardbacks/v2/initial.webp',
            pivot: '../shared/decks/cardbacks/v2/pivot.webp',
            c2: '../shared/decks/cardbacks/v2/c2.webp',
            persist: '../shared/decks/cardbacks/v2/persist.webp',
            inject: '../shared/decks/cardbacks/v2/inject.webp',
            procedure: '../shared/decks/cardbacks/v2/procedure.webp',
            consultant: '../shared/decks/cardbacks/v2/consultant.webp'
        }
    },

    // Default deck
    defaultDeck: 'core',

    // Game settings
    game: {
        initialTurns: 10,
        maxStrikes: 3,
        procedureCount: 7,
        enhancedDefault: 3,
        enhancedBonus: 3
    },

    // Storage keys
    storage: {
        preferredDeck: 'bb-shuffle-deck'
    },

    // Sync settings (for admin/player communication)
    sync: {
        storageKey: 'bb-shuffle-sync-state'
    }
};

// Freeze config to prevent accidental modifications
Object.freeze(CONFIG);
Object.freeze(CONFIG.game);
Object.freeze(CONFIG.storage);
Object.freeze(CONFIG.sync);
Object.freeze(CONFIG.cardbackSets);
Object.keys(CONFIG.cardbackSets).forEach(set => Object.freeze(CONFIG.cardbackSets[set]));

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
