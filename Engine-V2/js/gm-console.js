/**
 * B&B Shuffle Engine-V2 - GM Console
 *
 * The GM's screen: a read-only answer key plus remote control of the projected
 * Player tab. Every mutation goes out as a `GMLink` command so the console is
 * never the source of truth - the Player is. This file renders what came back.
 *
 * THE ONE THING TO UNDERSTAND BEFORE EDITING
 * There are two state channels, because the Player has two kinds of state:
 *
 *   CLOCK  - turns, strikes, reveals, cooldowns. Lives in `GameState`, and the
 *            Player's `exportControlState()` folds it in for convenience.
 *   BOARD  - the dealt chain, its detection text, the procedure hand, the
 *            inject pointer, the seated consultant. Lives on
 *            `PlayerController.scenario` and is NOT in GameState at all.
 *
 * Both arrive in one payload (`gm-board`), so there is exactly one render path:
 * `render(root)`. Nothing here keeps its own copy of game state, which is what
 * makes "Refresh" honest.
 */
(function (global) {
    'use strict';

    const CATALOG_URL = '../docs/card-details.json';
    const MASTER_ART_PREFIX = 'decks/cardbase/v31/';

    const SCENARIO_TYPES = ['initial', 'pivot', 'c2', 'persist'];
    const TYPE_LABELS = { initial: 'Initial', pivot: 'Pivot', c2: 'C2', persist: 'Persist' };

    let catalogPromise = null;
    let catalog = null;

    // The deck's procedure pool for the "add a procedure" select, cached per deck
    // key so switching decks re-reads it and re-rendering does not re-fetch.
    let poolCache = null;
    let poolPromise = null;
    // Signature of the option list currently in the "add a procedure" select, so a
    // re-render can skip rebuilding it (and leave the GM's selection alone).
    let addProcSignature = null;

    // Last board payload from the Player. Kept only so a re-render (a resize, a
    // catalog arriving late) can paint without asking the Player again.
    let root = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        return (global.Utils && Utils.escapeHtml)
            ? Utils.escapeHtml(String(value == null ? '' : value))
            : String(value == null ? '' : value);
    }

    function asset(src) {
        if (!src) return '';
        return (global.Utils && Utils.assetPath) ? Utils.assetPath(src) : src;
    }

    // ===================================================================== //
    // Detection resolution                                                  //
    //                                                                       //
    // A faithful port of `print-sheet.js`'s chain, which is already proven  //
    // across all 846 scenario cards. Detection lives ONLY in                //
    // docs/card-details.json, and matching by image path alone is not       //
    // enough: decks that reprint the v3.1 master art under their own        //
    // filenames never match by art, and renamed cards never match by name.  //
    // ===================================================================== //

    /** Normalise `../../shared/decks/x.webp` to the catalog's `decks/x.webp`. */
    function imageKey(src) {
        const value = String(src || '');
        const idx = value.indexOf('shared/decks/');
        const rel = idx >= 0 ? value.slice(idx + 'shared/'.length) : value.replace(/^(\.\.\/)+/, '');
        return rel.toLowerCase();
    }

    /**
     * Name lookup keys tolerant of how the printed cards drift.
     *   strict - lowercase, non-alphanumerics collapsed
     *   loose  - strict with the joining words dropped
     */
    function nameKeys(name) {
        const strict = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!strict) return [];
        const loose = strict.split(' ').filter(function (word) {
            return word !== 'or' && word !== 'and' && word !== 'the' && word !== 'a';
        }).join(' ');
        return strict === loose ? [strict] : [strict, loose];
    }

    /** Which deck's entry to trust for a shared card name. */
    function crossRank(entry, deckKey) {
        if (entry.deck === deckKey) return 0;
        if (String(entry.image || '').indexOf(MASTER_ART_PREFIX) === 0) return 1;
        return 2;
    }

    function indexCatalog(data) {
        const byDeck = new Map();
        const byImage = new Map();
        const byNameCross = new Map();
        const imageText = new Map();

        function registerName(entry) {
            nameKeys(entry.name).forEach(function (nameKey) {
                const list = byNameCross.get(nameKey) || [];
                list.push(entry);
                byNameCross.set(nameKey, list);
            });
        }

        ((data && data.decks) || []).forEach(function (deck) {
            const deckByName = new Map();
            const deckByImage = new Map();
            const deckTextByImage = new Map();
            const deckTextByName = new Map();

            Object.keys(deck.cards || {}).forEach(function (type) {
                (deck.cards[type] || []).forEach(function (card) {
                    if (!card) return;
                    const key = imageKey(card.image);

                    const text = typeof card.description === 'string' ? card.description.trim() : '';
                    if (text) {
                        if (key && !deckTextByImage.has(key)) deckTextByImage.set(key, text);
                        if (key && !imageText.has(key)) imageText.set(key, text);
                        if (card.name) {
                            const nameKey = String(card.name).toLowerCase();
                            if (!deckTextByName.has(nameKey)) deckTextByName.set(nameKey, text);
                        }
                    }

                    // Absent (never []) when unread; only the four chain types carry it.
                    if (!Array.isArray(card.detection) || !card.detection.length) return;
                    if (key) {
                        if (!deckByImage.has(key)) deckByImage.set(key, card.detection);
                        if (!byImage.has(key)) byImage.set(key, card.detection);
                    }
                    if (card.name) {
                        const name = String(card.name).toLowerCase();
                        if (!deckByName.has(name)) deckByName.set(name, card.detection);
                        registerName({ deck: deck.deck, name: card.name, image: key, detection: card.detection });
                    }
                });
            });

            if (deck.deck) {
                byDeck.set(deck.deck, {
                    byName: deckByName,
                    byImage: deckByImage,
                    textByImage: deckTextByImage,
                    textByName: deckTextByName
                });
            }
        });

        return { byDeck: byDeck, byImage: byImage, byNameCross: byNameCross, imageText: imageText };
    }

    function loadCatalog() {
        if (!catalogPromise) {
            catalogPromise = fetch(CATALOG_URL, { cache: 'force-cache' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    catalog = indexCatalog(data);
                    return catalog;
                })
                .catch(function () {
                    catalog = { byDeck: new Map(), byImage: new Map(), byNameCross: new Map(), imageText: new Map() };
                    return catalog;
                });
        }
        return catalogPromise;
    }

    function deckKey() {
        return ((root && root.deck) || {}).key || '';
    }

    /**
     * The DETECTION list for a scenario card, in resolution order:
     * own -> this deck by art -> this deck by name -> any deck by art ->
     * any deck by name ranked (deck in play > master art > anything).
     * @returns {string[]} procedure names ([] when not recorded)
     */
    function detectionsFor(card) {
        const own = (card && Array.isArray(card.detection)) ? card.detection : null;
        if (own && own.length) {
            return own.map(function (e) { return typeof e === 'string' ? e : (e && e.name) || ''; }).filter(Boolean);
        }
        if (!catalog || !card) return [];

        const key = deckKey();
        const deck = catalog.byDeck.get(key);
        const art = imageKey(card.image);
        const name = String(card.name || '').toLowerCase();

        if (deck) {
            if (art && deck.byImage.has(art)) return deck.byImage.get(art);
            if (deck.byName.has(name)) return deck.byName.get(name);
        }
        if (art && catalog.byImage.has(art)) return catalog.byImage.get(art);

        let best = null;
        let bestRank = 99;
        nameKeys(card.name).forEach(function (nameKey) {
            (catalog.byNameCross.get(nameKey) || []).forEach(function (candidate) {
                const rank = crossRank(candidate, key);
                if (rank < bestRank) { bestRank = rank; best = candidate.detection; }
            });
        });
        return best || [];
    }

    /** The card's printed body text, by art then by name. */
    function cardTextFor(card) {
        if (!card) return '';
        if (typeof card.description === 'string' && card.description.trim()) return card.description.trim();
        if (!catalog) return '';
        const key = deckKey();
        const deck = catalog.byDeck.get(key);
        const art = imageKey(card.image);
        const name = String(card.name || '').toLowerCase();
        if (deck) {
            if (art && deck.textByImage.has(art)) return deck.textByImage.get(art);
            if (deck.textByName.has(name)) return deck.textByName.get(name);
        }
        return (art && catalog.imageText.get(art)) || '';
    }

    // ===================================================================== //
    // Rendering                                                             //
    // ===================================================================== //

    function renderChain() {
        const host = byId('gmc-chain');
        if (!host) return;
        const chain = (root && root.chain) || {};
        const flips = (root && root.flips) || {};

        const any = SCENARIO_TYPES.some(function (t) { return chain[t]; });
        if (!any) {
            host.innerHTML = '<p class="gmc-empty">No scenario is on the board.</p>';
            return;
        }

        host.innerHTML = SCENARIO_TYPES.map(function (type) {
            const card = chain[type];
            if (!card) {
                return '<div class="gmc-chain-card" data-type="' + type + '">' +
                    '<span class="gmc-chain-type">' + esc(TYPE_LABELS[type]) + '</span>' +
                    '<span class="gmc-chain-name">— not dealt —</span>' +
                    '</div>';
            }

            const detection = detectionsFor(card);
            const body = cardTextFor(card);

            const detBlock = detection.length
                ? '<div class="gmc-det"><span class="gmc-det-title">Detection</span>' +
                    '<ul class="gmc-det-list">' +
                    detection.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') +
                    '</ul></div>'
                // The key is absent rather than empty when a card has not been
                // read, so this state is reachable and must say so explicitly
                // rather than render a confusing empty list.
                : '<div class="gmc-det"><span class="gmc-det-title">Detection</span>' +
                    '<span class="gmc-det-missing">Not yet recorded</span></div>';

            return '<div class="gmc-chain-card" data-type="' + type + '" data-revealed="' +
                (flips[type] ? 'true' : 'false') + '">' +
                '<span class="gmc-chain-type">' + esc(TYPE_LABELS[type]) +
                (flips[type] ? ' · face-up' : ' · face-down') + '</span>' +
                '<span class="gmc-chain-name">' + esc(card.name || '—') + '</span>' +
                (card.image ? '<img class="gmc-chain-art" src="' + esc(asset(card.image)) +
                    '" alt="' + esc(card.name || '') + '" loading="lazy">' : '') +
                (body ? '<p class="gmc-chain-body">' + esc(body) + '</p>' : '') +
                detBlock +
                '</div>';
        }).join('');
    }

    function renderSession() {
        const g = (root && root.game) || {};
        const turnEl = byId('gmc-turn');
        const noteEl = byId('gmc-turn-note');
        if (turnEl) {
            turnEl.textContent = (g.turnNumber != null ? g.turnNumber : '—') +
                (g.maxTurns ? ' / ' + g.maxTurns : '');
        }
        if (noteEl) {
            noteEl.textContent = g.turnsRemaining != null ? g.turnsRemaining + ' left' : '';
        }

        const strikeEl = byId('gmc-strikes');
        if (strikeEl) strikeEl.textContent = (g.strikeCount != null ? g.strikeCount : '—') +
            (g.maxStrikes ? ' / ' + g.maxStrikes : '');

        const dots = byId('gmc-strike-dots');
        if (dots) {
            const max = g.maxStrikes || 3;
            const cur = g.strikeCount || 0;
            dots.innerHTML = new Array(max).fill(0).map(function (_, i) {
                return '<span class="gmc-strike-dot' + (i < cur ? ' is-active' : '') + '"></span>';
            }).join('');
        }

        const targetEl = byId('gmc-target');
        if (targetEl) targetEl.textContent = (root && root.successTarget) || '—';

        const deckEl = byId('gmc-deck-name');
        if (deckEl) {
            const info = (root && root.info) || {};
            deckEl.textContent = info.name || ((root && root.deck) || {}).name || 'No scenario loaded';
        }

        // Keep the inputs in step without stomping what the GM is typing.
        const setTurns = byId('gmc-set-turns');
        if (setTurns && document.activeElement !== setTurns) setTurns.value = g.turnsRemaining != null ? g.turnsRemaining : '';
        const setStrikes = byId('gmc-set-strikes');
        if (setStrikes && document.activeElement !== setStrikes) setStrikes.value = g.strikeCount != null ? g.strikeCount : '';
        const setTarget = byId('gmc-set-target');
        if (setTarget && document.activeElement !== setTarget) setTarget.value = (root && root.successTarget) || '';
        if (setStrikes) setStrikes.max = g.maxStrikes || 3;

        // Whether the Player spends a turn as part of a roll/strike. When it does,
        // the GM must NOT also press "Spend turn" or the board loses two turns for
        // one action - so say which mode the table is in.
        const coupleHint = byId('gmc-couple-hint');
        if (coupleHint) {
            coupleHint.textContent = (root && root.turnCoupled)
                ? 'Rolls and strikes spend a turn on their own — do not also press Spend turn.'
                : 'Turns are spent by hand: use Spend turn after the roll.';
        }
    }

    function renderInjects() {
        const host = byId('gmc-injects');
        if (!host) return;
        const injects = (root && root.injects) || [];
        const active = root ? root.activeInjectIndex : 0;

        const note = byId('gmc-inject-note');
        if (note) note.textContent = injects.length ? (active + 1) + ' of ' + injects.length : '';

        if (!injects.length) {
            host.innerHTML = '<li class="gmc-empty">No injects dealt.</li>';
            return;
        }

        host.innerHTML = injects.map(function (card, i) {
            const text = cardTextFor(card);
            return '<li class="' + (i === active ? 'is-current' : '') + '" data-inject-index="' + i + '">' +
                esc(card.name || 'Inject ' + (i + 1)) +
                (i === active ? ' <span class="gmc-chip">current</span>' : '') +
                (text ? '<span class="gmc-inject-text">' + esc(text) + '</span>' : '') +
                '</li>';
        }).join('');
    }

    function renderConsultant() {
        const host = byId('gmc-consultant');
        if (!host) return;
        const list = (root && root.consultants) || [];
        const idx = root ? root.consultantIndex : -1;
        const seated = (idx >= 0 && list[idx]) ? list[idx] : null;

        if (!seated) {
            host.innerHTML = '<p class="gmc-empty">Nobody is consulting.</p>';
            return;
        }

        // The whole effect of a consultant is the one line of blue text under
        // their name, so print it rather than just the name.
        const action = cardTextFor(seated);
        host.innerHTML = '<p class="gmc-consultant-name">' + esc(seated.name || 'Consultant') + '</p>' +
            (action ? '<p class="gmc-consultant-action">' + esc(action) + '</p>' : '');
    }

    function renderHand() {
        const host = byId('gmc-hand');
        if (!host) return;
        const procedures = (root && root.procedures) || [];
        // The Player computes these per card and sends them, so the console never
        // re-derives the cooldown rule and the two screens cannot disagree.
        const remaining = (root && root.cooldownRemaining) || {};
        const active = root ? root.activeProcIndex : -1;

        const note = byId('gmc-hand-note');
        if (note) {
            note.textContent = procedures.length
                ? procedures.length + ' card' + (procedures.length === 1 ? '' : 's') + ' in hand'
                : 'No hand dealt';
        }

        if (!procedures.length) {
            host.innerHTML = '<p class="gmc-empty">No hand dealt.</p>';
        } else {
            host.innerHTML = procedures.map(function (card, i) {
                const left = remaining[i] || 0;
                const cooling = left > 0;
                const classes = ['gmc-hand-card'];
                if (i === active) classes.push('is-active');
                if (cooling) classes.push('is-cooling');

                // The chip reads "cooling N" rather than a bare number: a lone "3"
                // beside the "+3" enhanced chip would be read as a bonus.
                const chip = cooling
                    ? '<span class="gmc-chip is-cooldown" title="On cooldown — ' + left +
                      ' turn' + (left === 1 ? '' : 's') + ' until this procedure can be used again">cooling ' +
                      left + '</span>'
                    : '';

                return '<button type="button" class="' + classes.join(' ') + '" data-proc-index="' + i + '">' +
                    '<span class="gmc-hand-name">' + esc(card.name || 'Procedure ' + (i + 1)) + '</span>' +
                    (card.enhanced ? '<span class="gmc-chip is-enhanced">+3</span>' : '') +
                    chip +
                    '<span class="gmc-hand-remove" data-proc-remove="' + i + '" title="Remove this card">×</span>' +
                    '</button>';
            }).join('');
        }

        renderAddProcedureOptions(procedures);
    }

    /** The "add a procedure" select: the deck's whole procedure pool, minus the hand. */
    function renderAddProcedureOptions(procedures) {
        const select = byId('gmc-add-proc');
        if (!select) return;

        // Identify a card by id AND art. A deck can reuse an id across many cards
        // (mega-deck ships 345 cards under 105 distinct ids), so matching on id
        // alone hides the wrong entries and the Add button resolves the wrong one.
        const cardKey = function (c) {
            return String((c && c.id) != null ? c.id : '') + '|' + String((c && c.image) || '');
        };
        const inHand = {};
        (procedures || []).forEach(function (c) {
            if (!c) return;
            inHand[cardKey(c)] = true;
            // Same physical card can be spelled with a different image prefix, so
            // keep an id-only key as a fallback for decks with unique ids.
            if (c.id != null) inHand['id:' + String(c.id)] = true;
        });

        // Read the pool from its own cache rather than off `catalog`: the catalog
        // object is only populated once the detection fetch resolves, and the
        // select must not depend on that ordering.
        //
        // The pool is ALSO deck-scoped. Rendering whatever `poolCache` happens to
        // hold - without checking it belongs to the deck on the board - is how a
        // core31 game ended up offering core deck procedures to add.
        const key = deckKey();
        const pool = (poolCache && poolCache.key === key) ? poolCache.cards : [];

        if (!pool.length) {
            // Say WHY it is empty rather than showing a lone placeholder, which
            // reads as a broken control. `refreshPool()` (called at the end of
            // every render) kicks the fetch and repaints when it lands.
            addProcSignature = null;   // force a rebuild when the pool arrives
            select.innerHTML = key
                ? '<option value="">Loading procedures…</option>'
                : '<option value="">Load a scenario first</option>';
            select.disabled = true;
            return;
        }

        // Carry the index INTO `pool` alongside each card: that is what the
        // option value has to be, because the id is not unique.
        const available = [];
        pool.forEach(function (card, index) {
            if (!card || inHand[cardKey(card)]) return;
            available.push({ card: card, index: index });
        });

        const signature = key + '#' + available.map(function (e) {
            return e.index + ':' + e.card.name;
        }).join('|');

        // Only touch the DOM when the option list ACTUALLY changed. A board push
        // re-renders the whole console, and rebuilding this <select> discards
        // whatever the GM had opened or chosen - which made the control feel like
        // it was "resetting on its own".
        if (signature === addProcSignature) return;
        addProcSignature = signature;

        const previous = select.value;
        const options = ['<option value="">Add a procedure from the deck…</option>']
            .concat(available.map(function (e) {
                return '<option value="' + e.index + '">' + esc(e.card.name) + '</option>';
            }));
        select.disabled = false;
        select.innerHTML = options.join('');
        if (previous && select.querySelector('option[value="' + previous + '"]')) {
            select.value = previous;
        }
    }

    function renderConsultantPicker() {
        const host = byId('gmc-consultants');
        if (!host) return;
        const list = (root && root.consultants) || [];
        const idx = root ? root.consultantIndex : -1;

        if (!list.length) {
            host.innerHTML = '<p class="gmc-empty">No consultants in this deck.</p>';
            return;
        }

        host.innerHTML = list.map(function (card, i) {
            return '<button type="button" class="gmc-cons-card' + (i === idx ? ' is-active' : '') +
                '" data-cons-index="' + i + '">' +
                esc(card.name || 'Consultant ' + (i + 1)) + '</button>';
        }).join('');
    }

    function renderChainToggles() {
        const host = byId('gmc-chain-toggles');
        if (!host) return;
        const flips = (root && root.flips) || {};
        host.innerHTML = SCENARIO_TYPES.map(function (type) {
            return '<button type="button" class="gmc-toggle" data-flip-type="' + type +
                '" aria-pressed="' + (flips[type] ? 'true' : 'false') + '">' +
                '<span>' + esc(TYPE_LABELS[type]) + '</span></button>';
        }).join('');
    }

    function render(next) {
        if (next) root = next;
        if (!root) return;
        renderSession();
        renderChain();
        renderInjects();
        renderConsultant();
        renderHand();
        renderConsultantPicker();
        renderChainToggles();
        // The deck may have just changed, so the "add a procedure" pool needs to
        // follow it. Cheap: it re-fetches only when the deck key differs.
        refreshPool();
    }

    // ===================================================================== //
    // Link plumbing                                                         //
    // ===================================================================== //

    function setLinkState(stateName, text) {
        const pill = byId('gmc-link-pill');
        if (pill) pill.dataset.state = stateName;
        const textEl = byId('gmc-link-text');
        if (textEl) textEl.textContent = text;
        const footer = byId('gmc-footer-status');
        if (footer) footer.textContent = text;
    }

    /** Run a command, surfacing a refusal as a toast rather than silently. */
    function send(op, payload) {
        if (!global.GMLink || !GMLink.playerConnected()) {
            if (global.Utils && Utils.showToast) Utils.showToast('No player screen is connected.', 'error');
            return Promise.resolve(null);
        }
        return GMLink.command(op, payload).catch(function (err) {
            if (global.Utils && Utils.showToast) Utils.showToast(err.message, 'error');
            return null;
        });
    }

    /**
     * Parse the `data-gmc-arg` shorthand on a button: `show:true`, `reason:win`.
     * Keeps the markup declarative so adding an op is a one-line change.
     */
    function parseArg(str) {
        const out = {};
        String(str || '').split(',').forEach(function (pair) {
            if (!pair) return;
            const bits = pair.split(':');
            if (bits.length < 2) return;
            const key = bits[0].trim();
            let value = bits.slice(1).join(':').trim();
            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (value !== '' && !isNaN(Number(value))) value = Number(value);
            out[key] = value;
        });
        return out;
    }

    function bind() {
        // Declarative ops.
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-gmc-op]');
            if (btn) {
                send(btn.dataset.gmcOp, parseArg(btn.dataset.gmcArg));
                return;
            }

            // Per-type flip toggle.
            const flip = e.target.closest('[data-flip-type]');
            if (flip) {
                const type = flip.dataset.flipType;
                const isUp = flip.getAttribute('aria-pressed') === 'true';
                send('flip.card', { type: type, show: !isUp });
                return;
            }

            // Procedure select / remove.
            const remove = e.target.closest('[data-proc-remove]');
            if (remove) {
                e.stopPropagation();
                send('procedure.remove', { index: Number(remove.dataset.procRemove) });
                return;
            }
            const proc = e.target.closest('[data-proc-index]');
            if (proc) {
                send('procedure.select', { index: Number(proc.dataset.procIndex) });
                return;
            }

            // Consultant seat.
            const cons = e.target.closest('[data-cons-index]');
            if (cons) {
                send('consultant.set', { index: Number(cons.dataset.consIndex) });
                return;
            }
        });

        byId('gmc-apply-clock')?.addEventListener('click', function () {
            const turns = byId('gmc-set-turns');
            const strikes = byId('gmc-set-strikes');
            const jobs = [];
            // `turn.set` and `strike.set` are absolute, so order between them is
            // irrelevant - but they must both land, hence Promise.all.
            if (turns && turns.value !== '') jobs.push(send('turn.set', { turnsRemaining: Number(turns.value) }));
            if (strikes && strikes.value !== '') jobs.push(send('strike.set', { count: Number(strikes.value) }));
            Promise.all(jobs);
        });

        byId('gmc-apply-target')?.addEventListener('click', function () {
            const el = byId('gmc-set-target');
            if (el && el.value !== '') send('rules.set', { successTarget: Number(el.value) });
        });

        byId('gmc-add-proc-btn')?.addEventListener('click', function () {
            const select = byId('gmc-add-proc');
            if (!select || select.value === '') return;

            // The option value is the INDEX into the deck's procedure pool, not a
            // card id. Ids are not unique within a deck (mega-deck reuses 105 ids
            // across 345 cards), so resolving by id handed back whichever card
            // happened to share it - picking "Protocol Analysis" added "Cloud
            // Event Log Analysis".
            const pool = (poolCache && poolCache.key === deckKey()) ? poolCache.cards : [];
            const card = pool[Number(select.value)];
            if (!card) {
                if (global.Utils && Utils.showToast) {
                    Utils.showToast('Could not resolve that procedure from the deck.', 'error');
                }
                return;
            }

            // Reset the select straight away: the option is about to disappear
            // once the Player echoes the new hand back, and leaving the old value
            // selected would make a second click re-add the same card.
            select.value = '';
            send('procedure.add', { card: card });
        });

        byId('gmc-refresh-btn')?.addEventListener('click', function () {
            if (global.GMLink) GMLink.requestBoard();
        });

        byId('gmc-open-player-btn')?.addEventListener('click', function () {
            // A named window so repeat clicks focus the same screen rather than
            // opening a second copy that would compete for authority.
            global.open('../Engine-V2/player.html', 'bb_player');
        });
    }

    function init() {
        bind();
        setLinkState('waiting', 'Looking for a player…');

        if (!global.GMLink) {
            setLinkState('error', 'This browser cannot sync windows.');
            return;
        }

        GMLink.onBoard(function (next) {
            setLinkState('connected', 'Connected — controlling the player');
            render(next);
        });

        GMLink.onRoster(function (info) {
            if (info && info.connected) {
                setLinkState('connected', 'Connected — controlling the player');
                // Ask for the board straight away so the answer key is populated
                // before the GM has to do anything.
                GMLink.requestBoard();
            } else {
                setLinkState('waiting', 'Player disconnected');
            }
        });

        GMLink.start('gm');
        // The catalog powers the answer key's detection lists; render again once
        // it lands, since the first paint may beat the fetch. The procedure pool
        // is fetched separately by `refreshPool()` from the render path, because
        // it needs the deck key and that only arrives with the first board.
        loadCatalog().then(function () {
            render();
        });
    }

    /**
     * The deck's procedure pool, for the hand's "add a procedure" select.
     *
     * Read from the deck in play, not from the catalog: `docs/card-details.json`
     * indexes cards for their text and detection, and its entries are not shaped
     * like the `{id, name, image, type, details, description}` records the Player
     * deals into a hand. A card taken from here is therefore byte-identical to a
     * dealt one and `PlayerController.updateProcedureCards()` renders it
     * unchanged.
     *
     * The path comes from `CONFIG.decks[...].path`, but `CONFIG` is a bare
     * `const` and NOT on `window`, so it cannot be reached from here on a page
     * that did not itself load it as a global. It does not need to be: the deck
     * key arrives on the board payload, and every deck's JSON sits at the same
     * predictable `shared/decks/<key>/carddb.json` location relative to
     * `Engine-V2/`. Resolving it that way also works on the static copies, which
     * carry the deck JSONs but no scenario API.
     *
     * Returns [] until a deck is known (no board yet) or the fetch fails - the
     * console still allows removing from the hand in that state.
     * @returns {Array<Object>} Procedure cards, in deck order
     */
    function buildProcedurePool() {
        const key = deckKey();
        if (!key) return [];
        if (poolCache && poolCache.key === key) return poolCache.cards;
        // A fetch for this deck is already in flight: reuse it. Re-creating the
        // promise on every render (which happens on each board push) meant the
        // `.then` that repaints the select attached to a promise that a later
        // render had already replaced, so the select never updated.
        if (poolPromise && poolPromise.key === key) return [];

        // `CONFIG.decks[key].path` when reachable, else the conventional location.
        const defs = (typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks : {};
        const def = defs[key] || {};
        const path = def.path || ('../shared/decks/' + key + '/carddb.json');

        const p = fetch(path, { cache: 'force-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                const cards = (data && Array.isArray(data.data) ? data.data : [])
                    .filter(function (c) { return c && c.type === 'procedure'; });
                poolCache = { key: key, cards: cards };
                // Paint the select as soon as the pool exists, rather than relying
                // on a later render to notice.
                renderAddProcedureOptions((root && root.procedures) || []);
                return cards;
            })
            .catch(function () {
                poolCache = { key: key, cards: [] };
                return [];
            });
        p.key = key;
        poolPromise = p;

        return [];
    }

    /**
     * Rebuild the select once the pool arrives, and again whenever the deck
     * changes. Without this the select stayed on its placeholder forever, because
     * `buildProcedurePool()` returns [] while it fetches and nothing re-rendered
     * when the fetch landed.
     */
    function refreshPool() {
        const key = deckKey();
        if (!key) return;

        // Already have this deck's pool: just paint it. This is the common path
        // once the first fetch has resolved, and it must not depend on a promise.
        if (poolCache && poolCache.key === key) {
            renderAddProcedureOptions((root && root.procedures) || []);
            return;
        }

        buildProcedurePool();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : this);
