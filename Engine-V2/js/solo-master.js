/**
 * B&B Shuffle Engine-V2 - Solo AI (PvE) Incident Master
 *
 * Enabled by `player.html?mode=solo`. Adds the Incident Master rail, hides the
 * attack chain, generates investigation clues, and handles accusations.
 *
 * Self-mounting: initialization requires `?mode=solo` and the rail markup.
 *
 * DESIGN NOTES
 * - The scenario is never scraped out of the DOM. `PlayerController.scenario` is
 *   already a parsed ScenarioSchema, and `resolveRoll()` hands back structured
 *   outcome meta, so both are read directly.
 * - Clue relevance comes from printed DETECTION lists in `docs/card-details.json`.
 * - Turns and strikes ride on the existing GameState counters, so the header,
 *   the strike dots and the game-over modal stay the single source of truth.
 * - Every string that reaches the DOM goes through Utils.escapeHtml: model output
 *   is untrusted text.
 */
(function (global) {
    'use strict';

    // ------------------------------------------------------------------ ids
    const PANEL_ID = 'incident-master-panel';
    const LOG_ID = 'im-log';
    const TURN_ID = 'im-turn';
    const STATUS_ID = 'im-status';
    const TARGET_ID = 'im-target';
    const PERSONA_ID = 'im-persona';
    const SPINNER_ID = 'im-spinner';
    const TYPING_ID = 'im-typing';
    const BADGE_ID = 'solo-badge';
    const REV_ID = 'deck-rev';
    const ACCUSE_BTN_ID = 'im-accuse-btn';
    const ACCUSATION_MODAL_ID = 'accusation-modal';
    const ACCUSATION_RESULT_ID = 'accusation-result';
    // Body copy for the shared "no procedure selected" prompt. PlayerController
    // owns that modal for both modes; an untargeted sweep means something
    // different here, so this mode supplies its own wording.
    const ROLL_PROMPT_HINT = 'Rolling without a procedure sweeps everything at once: a good roll still tells ' +
        'you which phase looks loudest, but it cannot use a card\'s DETECTION list to name the technique ' +
        '— and it still spends a turn.';
    const INTRO_MODAL_ID = 'solo-intro-modal';
    const CREDIT_ID = 'solo-credit';
    const SETTINGS_MODAL_ID = 'im-settings-modal';
    const SETTINGS_STATUS_ID = 'im-settings-status';

    // Controls that would spoil a solo game, and the two the AI drives itself.
    const SPOILER_IDS = ['gm-mode-btn', 'reveal-cards-btn', 'print-sheet-btn'];
    const MANAGED_IDS = ['add-strike-btn', 'use-turn-btn'];

    const CATALOG_URL = '../docs/card-details.json';
    const AI_SETTINGS_KEY = 'bb-ai-settings';
    const AI_KEY_SOURCE_KEY = 'bb-ai-key-source';
    // Prevent repeated AI-setup prompts after a player chooses offline mode.
    const INTRO_NUDGED_KEY = 'bb-solo-intro-nudged';

    const SCENARIO_TYPES = (typeof Utils !== 'undefined' && Utils.SCENARIO_TYPES)
        ? Utils.SCENARIO_TYPES
        : ['initial', 'pivot', 'c2', 'persist'];

    const TYPE_LABELS = (typeof Utils !== 'undefined' && Utils.CARD_TYPE_LABELS)
        ? Utils.CARD_TYPE_LABELS
        : {};

    // ------------------------------------------------------------------ state
    const state = {
        active: false,
        ready: false,
        loadingModels: false,
        warnedProvider: false,
        providerDown: false,
        consecutiveFailures: 0,
        draining: false,
        pendingGameOver: false,
        // Phases the player has legitimately detected: their cards are the only
        // ones allowed to stay face-up (see enforceHidden).
        revealedTypes: new Set(),
        // Set while the AI target dialog is standing in for a deal prompt: an
        // empty board is only offered Quick Start once that dialog closes.
        dealAfterSettings: false,
        // Investigations waiting for a clue, in roll order. A roll is never
        // dropped: a slow provider only delays the narration.
        queue: [],
        history: [],
        lastCall: 0,
        indexPromise: null,
        pools: null
    };

    // ---------------------------------------------------------------- helpers

    function byId(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        return Utils.escapeHtml(String(value == null ? '' : value));
    }

    function controller() {
        return (typeof PlayerController !== 'undefined') ? PlayerController : null;
    }

    function game() {
        return (typeof GameState !== 'undefined' && GameState.game) ? GameState.game : null;
    }

    function soloConfig() {
        // CONFIG is a bare `const`, not a window property - hence the typeof guard.
        const cfg = (typeof CONFIG !== 'undefined' && CONFIG.solo) ? CONFIG.solo : {};
        return {
            maxTurns: cfg.maxTurns || 10,
            maxStrikes: cfg.maxStrikes || 3,
            clueHistoryLimit: cfg.clueHistoryLimit || 8,
            minCallInterval: cfg.minCallInterval || 1200
        };
    }

    function label(type) {
        return TYPE_LABELS[type] || type;
    }

    /** Fold accents and punctuation so printed titles compare to deck titles. */
    function norm(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    // Joining words dropped before comparison: "New Service Creation/Modification"
    // and "New Service Creation or Modification" are the same physical card.
    const DROP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'on', 'in', 'de', 'del', 'la', 'el', 'y']);

    function matchKey(value) {
        return norm(value).split(' ').filter(w => w && !DROP.has(w)).join(' ');
    }

    /**
     * Normalise an art path to the form the catalog uses.
     *
     * `carddb.json` spells art from `shared/decks/<deck>/` while the catalog
     * stores the same file as `decks/<deck>/<file>` - the form catalogue.html
     * produces. Both collapse to one key, which is why the index is keyed by
     * IMAGE: mega-deck and the sponsor decks reprint each other's art, and one
     * name can be a different physical card per deck.
     */
    function imageKey(src) {
        const value = String(src || '');
        const at = value.indexOf('shared/decks/');
        const rel = at >= 0 ? value.slice(at + 'shared/'.length) : value.replace(/^(\.\.\/)+/, '');
        return rel.toLowerCase();
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
    }

    // -------------------------------------------------------- detection index

    /**
     * image/name -> printed DETECTION list, built once per page load.
     * Best effort: a failure only means clues stop being relevance-aware.
     * @returns {Promise<{byImage: Map, byName: Map}>}
     */
    function detectionIndex() {
        if (state.indexPromise) return state.indexPromise;
        state.indexPromise = (async () => {
            const byImage = new Map();
            const byName = new Map();
            try {
                const data = await Utils.loadJson(CATALOG_URL);
                const decks = Array.isArray(data && data.decks) ? data.decks : [];
                decks.forEach(deck => {
                    Object.keys(deck.cards || {}).forEach(type => {
                        (deck.cards[type] || []).forEach(card => {
                            if (!card || !Array.isArray(card.detection) || !card.detection.length) return;
                            const ik = imageKey(card.image);
                            if (ik && !byImage.has(ik)) byImage.set(ik, card.detection);
                            const nk = matchKey(card.name);
                            if (nk && !byName.has(nk)) byName.set(nk, card.detection);
                        });
                    });
                });
            } catch (error) {
                console.warn('[SoloMaster] detection catalog unavailable — clues lose relevance', error);
            }
            return { byImage, byName };
        })();
        return state.indexPromise;
    }

    /**
     * Printed DETECTION list for a card: its own field first, then the catalog
     * by art, then by name. Absent (never []) when it was never read.
     * @returns {Promise<string[]|null>}
     */
    async function detectionFor(card) {
        if (!card) return null;
        if (Array.isArray(card.detection) && card.detection.length) return card.detection;
        const index = await detectionIndex();
        const ik = imageKey(card.image);
        if (ik && index.byImage.has(ik)) return index.byImage.get(ik);
        const nk = matchKey(card.name);
        if (nk && index.byName.has(nk)) return index.byName.get(nk);
        return null;
    }

    /** Whether a DETECTION entry names the procedure in play. */
    function namesProcedure(detection, procedure) {
        if (!Array.isArray(detection) || !procedure || !procedure.name) return false;
        const exact = matchKey(procedure.name);
        const loose = norm(procedure.name);
        return detection.some(entry => {
            const key = matchKey(entry);
            if (!key) return false;
            if (exact && key === exact) return true;
            if (loose && (norm(entry).includes(loose) || loose.includes(norm(entry)))) return true;
            return !!(exact && key.includes(exact));
        });
    }

    // ------------------------------------------------------------- card access

    function hiddenCards() {
        const pc = controller();
        const scenario = (pc && pc.scenario && pc.scenario.scenario) || {};
        const out = {};
        SCENARIO_TYPES.forEach(type => { out[type] = scenario[type] || null; });
        return out;
    }

    function activeProcedure() {
        const pc = controller();
        if (!pc) return null;
        const list = (pc.scenario && pc.scenario.procedures) || [];
        const index = typeof pc.activeProcIndex === 'number' ? pc.activeProcIndex : -1;
        return (index >= 0 && list[index]) ? list[index] : null;
    }

    /** The deck's full scenario pools, for the accusation dropdowns. */
    async function loadPools() {
        const pc = controller();
        const deckKey = pc && pc.scenario && pc.scenario.deck && pc.scenario.deck.key;
        const decks = (typeof CONFIG !== 'undefined' && CONFIG.decks) ? CONFIG.decks : null;
        const cfg = (deckKey && decks) ? decks[deckKey] : null;
        const pools = { initial: [], pivot: [], c2: [], persist: [], title: '', revdate: '' };
        if (!cfg) return pools;
        try {
            const json = await Utils.loadJson(cfg.path);
            pools.title = json.title || '';
            pools.revdate = json.revdate || '';
            (Array.isArray(json.data) ? json.data : []).forEach(card => {
                const type = String(card.type || '').toLowerCase();
                if (pools[type]) pools[type].push(card);
            });
        } catch (error) {
            console.warn('[SoloMaster] deck pool unavailable', error);
        }
        return pools;
    }

    function sameCard(a, b) {
        if (!a || !b) return false;
        if (a.id && b.id) return String(a.id) === String(b.id);
        return matchKey(a.name) === matchKey(b.name);
    }

    // ------------------------------------------------------------- personas

    /**
     * Who is speaking, and what they are allowed to know.
     *
    * Role knowledge and limits constrain the evidence each persona may describe.
    * `knows`, `limits`, and `voice` are prompt content; `blurb` appears in the UI.
     */
    const ROLES = [
        {
            key: 'soc-lead',
            name: 'SOC Shift Lead',
            blurb: 'Alert triage and the overnight queue — the SIEM\'s point of view.',
            knows: 'You live in the alert queue: which rule fired, in what order, what the console showed, ' +
                'how the shift escalated it. You speak in triage, severity, timing and noise.',
            limits: 'you are not the forensic examiner. When a question needs memory, disk or registry ' +
                'detail, say who you would have to ask.'
        },
        {
            key: 'ir-commander',
            name: 'Incident Commander',
            blurb: 'Coordination, containment trade-offs and business impact.',
            knows: 'You own the room: scope, containment options and their cost, what the business is ' +
                'losing per hour, and what decision is needed next.',
            limits: 'you are deliberately not the deepest technical voice. You relay what your specialists ' +
                'report, and ask them for specifics.'
        },
        {
            key: 'forensics',
            name: 'Host Forensics Examiner',
            blurb: 'Memory, disk and endpoint artefacts, in chain-of-custody order.',
            knows: 'You work in artefacts: process lineage, memory injection, registry keys, scheduled ' +
                'tasks, file timeline, and what a sound acquisition looks like.',
            limits: 'network flow and DNS detail reaches you second-hand. Say so rather than guessing at it.'
        },
        {
            key: 'network',
            name: 'Network Security Analyst',
            blurb: 'Flows, DNS, proxy and TLS metadata — what crossed the wire.',
            knows: 'You read traffic: NetFlow, DNS resolution, proxy logs, TLS metadata, beacon timing ' +
                'and jitter, and where the segmentation boundaries are.',
            limits: 'you cannot see inside a host. When a question is about files, memory or the registry, ' +
                'that is someone else\'s console.'
        },
        {
            key: 'threat-intel',
            name: 'Threat Intelligence Analyst',
            blurb: 'Actor tradecraft and campaign context — patterns, not confirmed facts.',
            knows: 'You think in pattern and likelihood: what this class of tradecraft usually implies, ' +
                'who normally uses it, and how it fits a wider campaign.',
            limits: 'you speak in inference, never in confirmed local findings — you say what is typical ' +
                'and lean on the evidence others collect to rule it in or out.'
        },
        {
            key: 'hunt',
            name: 'Threat Hunter',
            blurb: 'Hypotheses, telemetry coverage and what to go looking for next.',
            knows: 'You work hypothesis-first: what would have to be true, which telemetry would prove it, ' +
                'and where the coverage gaps are.',
            limits: 'you propose and pursue; you are not the one who confirms an artefact. Say what you ' +
                'would search for rather than what you have already found.'
        },
        {
            key: 'ciso',
            name: 'CISO / Executive Sponsor',
            blurb: 'Risk, exposure and the regulatory clock — technical detail in plain language.',
            knows: 'You speak in risk and consequence: exposure, customer impact, breach-notification ' +
                'clocks, and what you would have to tell the board.',
            limits: 'you are not technical. You translate what the team says into plain language and never ' +
                'quote artefacts, hashes or tooling yourself.'
        }
    ];

    /**
    * Voice is independent of role so personas can be combined across games.
     */
    const VOICES = [
        {
            key: 'plain',
            name: 'Matter-of-Fact',
            blurb: 'Clear and professional, with no particular colour.',
            voice: 'even, clear and professional — no jokes, no drama, no filler'
        },
        {
            key: 'veteran',
            name: 'Grizzled Veteran',
            blurb: 'Terse and dry; has seen this before.',
            voice: 'terse and dry, with the weariness of someone who has done this many times — short ' +
                'sentences and understated humour'
        },
        {
            key: 'mentor',
            name: 'Encouraging Mentor',
            blurb: 'Patient and instructive; explains the why.',
            voice: 'patient and encouraging — you explain why a clue matters and what it rules in or out, ' +
                'without ever being condescending'
        },
        {
            key: 'bybook',
            name: 'By the Book',
            blurb: 'Precise and procedural; cites the process.',
            voice: 'precise and procedural — you name the step you are on and what the playbook says next'
        },
        {
            key: 'deadpan',
            name: 'Deadpan',
            blurb: 'Flat delivery and heavy understatement.',
            voice: 'flat and unexcitable — facts arrive with no emotional colour and the occasional ' +
                'deadpan aside'
        },
        {
            key: 'blunt',
            name: 'Blunt',
            blurb: 'Direct, no pleasantries, says the hard thing.',
            voice: 'blunt and impatient — no pleasantries, and you say the uncomfortable thing plainly'
        },
        {
            key: 'enthusiast',
            name: 'Enthusiast',
            blurb: 'Animated; genuinely enjoys the puzzle.',
            voice: 'animated and genuinely interested in the puzzle — visibly invested when a lead lands'
        }
    ];

    const DEFAULT_ROLE = 'soc-lead';
    const DEFAULT_VOICE = 'plain';

    function roleFor(key) {
        return ROLES.find(r => r.key === key) || ROLES.find(r => r.key === DEFAULT_ROLE) || ROLES[0];
    }

    function voiceFor(key) {
        return VOICES.find(v => v.key === key) || VOICES.find(v => v.key === DEFAULT_VOICE) || VOICES[0];
    }

    /**
     * The framing block every prompt opens with.
     *
    * Explicit knowledge limits reduce unsupported claims when evidence is outside
    * the selected role's scope.
     */
    function personaBlock() {
        const role = roleFor(settings.role);
        const voice = voiceFor(settings.personality);
        return [
            'You are the Incident Master for a Backdoors & Breaches incident-response training game.',
            '',
            'WHO YOU ARE — stay inside this for the whole game:',
            `- Job role: ${role.name}. ${role.knows}`,
            `- What you do NOT know: ${role.limits}`,
            `- Personality: ${voice.name} — speak ${voice.voice}.`,
            '- Write plain prose: no markdown, no headings, no bullet points, no bold or italics.'
        ];
    }

    // ---------------------------------------------------------------- prompts

    const prompts = {
        opening(context) {
            const cards = context.cards;
            return [
                ...personaBlock(),
                '',
                'Narrate an evolving incident. NEVER name the attack techniques directly — describe only the',
                'evidence: logs, processes, network traffic, forensic artefacts. Present tense, second person.',
                '',
                'THE SECRET ATTACK CHAIN (never reveal these names):',
                SCENARIO_TYPES.map(type => {
                    const card = cards[type];
                    const name = card ? card.name : 'Unknown';
                    const text = card && card.description ? card.description : '';
                    return `- ${label(type)}: ${name}${text ? '\n  Printed text: ' + text : ''}`;
                }).join('\n'),
                '',
                'Write a 3-4 sentence opening. Set the scene: what triggered the alert, and what it looked',
                `like from where you sit. Create urgency, in your own voice. Do not name any technique.`,
                `The defender has ${context.maxTurns} turns.`
            ].join('\n');
        },

        clue(context) {
            const { procedure, tier, relevance, history } = context;
            const quality = {
                critical_fail: 'CRITICAL FAIL - misleading information, or the investigation itself goes wrong',
                failure: 'FAILURE - nothing useful; a dead end or normal activity',
                partial: 'PARTIAL - a vague directional hint; something feels off but is not conclusive',
                success: 'SUCCESS - a clear clue pointing at one technique\'s indicators',
                critical_success: 'CRITICAL SUCCESS - detailed evidence that nearly identifies the technique'
            }[tier] || tier;

            const relevanceLine = context.general
                ? `No procedure was selected, so this was an untargeted sweep. You may name the PHASE that looks loudest` +
                  (context.loudestPhase ? ` (${label(context.loudestPhase)})` : '') +
                  ', but never name a technique, and do not imply a card was identified.'
                : (relevance.length
                    ? `This procedure CAN detect evidence of: ${relevance.map(label).join(', ')}.`
                    : 'This procedure is NOT directly relevant to the attack chain, so it yields nothing that identifies it.');

            return [
                ...personaBlock(),
                'Describe only evidence — NEVER name an attack technique directly.',
                '',
                `TURN ${context.turn}/${context.maxTurns}`,
                '',
                'INVESTIGATION SO FAR:',
                history.length
                    ? history.map(h => `Turn ${h.turn}: ${h.procedure} — roll ${h.total} (${h.tier})\n  Clue given: "${h.clue}"`).join('\n')
                    : 'Nothing yet.',
                '',
                'THIS TURN:',
                `- Procedure used: ${procedure ? procedure.name : 'Unknown procedure'}`,
                procedure && procedure.description ? `- What it does: ${procedure.description}` : '',
                `- Roll: ${context.roll} (natural) with +${context.bonus} enhanced = ${context.total}`,
                `- Result quality: ${quality}`,
                `- ${relevanceLine}`,
                context.confirmed
                    ? `- This investigation CONFIRMS the ${context.confirmed} phase. The evidence should land that` +
                      ' identification clearly, without ever naming a technique.'
                    : '',
                '',
                'Write 2-4 sentences. Match the quality to the roll. Keep it consistent with the clues above;',
                'build on earlier evidence rather than contradicting it. Stay in character and in your lane —',
                'if the answer belongs to another discipline, say whose console it is.',
                context.turn >= context.maxTurns - 2 ? 'Time is nearly up — add tension.' : ''
            ].filter(Boolean).join('\n');
        },

        inject(context) {
            return [
                ...personaBlock(),
                'Describe only evidence — never name an attack technique.',
                '',
                `An INJECT card has been drawn because of: ${context.source}.`,
                `Inject card: ${context.inject ? context.inject.name : 'unknown'}`,
                context.inject && context.inject.description ? `Printed rule: ${context.inject.description}` : '',
                context.inject && context.inject.notes ? `Notes: ${context.inject.notes}` : '',
                '',
                `Turn ${context.turn}/${context.maxTurns}. Write 2-3 sentences on how this complication lands`,
                'on the investigation team, then the GM applies the printed rule.'
            ].filter(Boolean).join('\n');
        },

        debrief(context) {
            const cards = context.cards;
            return [
                ...personaBlock(),
                '',
                `The game is over. The defender ${context.won ? 'identified the whole attack chain' : 'did not identify the attack chain'}.`,
                '',
                'ACTUAL ATTACK CHAIN:',
                SCENARIO_TYPES.map(type => {
                    const card = cards[type];
                    return `- ${label(type)}: ${card ? card.name : 'Unknown'}`;
                }).join('\n'),
                '',
                'INVESTIGATION:',
                context.history.length
                    ? context.history.map(h => `Turn ${h.turn}: ${h.procedure} — roll ${h.total} (${h.tier})`).join('\n')
                    : 'No investigations were recorded.',
                '',
                'Write a 4-5 sentence educational debrief: how the chain fitted together, which clues pointed at',
                'each phase, which procedures would have been most effective here, and one real-world IR lesson.',
                'Be encouraging either way, and stay in your own voice — but here you MAY name the techniques,',
                'because the case is closed.',
            ].join('\n');
        }
    };

    // ---------------------------------------------------------- offline clues

    const OFFLINE = {
        critical_fail: [
            'Your query floods the SIEM with false positives and you burn the window filtering noise.',
            'The evidence you were examining gets overwritten — the chain of custody is now compromised.',
            'You follow a promising lead that turns out to be routine administrative activity.'
        ],
        failure: [
            'The data is either too noisy to read or the attacker covered their tracks well.',
            'The logs for this window are suspiciously sparse — nothing stands out.',
            'Your search is too broad to be useful. You need a more targeted question.'
        ],
        partial: [
            'Something looks off, but you cannot yet say what. An anomaly in the timing, perhaps.',
            'You find indirect evidence of suspicious activity. Suggestive, not conclusive.',
            'The pattern is there but faint — someone was here, but the picture stays unclear.'
        ],
        generic_success: [
            'Solid evidence uncovered. You are making real progress on the attack.',
            'You have found something that narrows the field considerably.',
            'The evidence lines up. One part of this chain is close to certain now.'
        ],
        relevant_success: [
            'The logs show behaviour that clearly is not normal business traffic.',
            'You have found artefacts the attacker almost certainly left behind.',
            'This is exactly the evidence you needed — it points squarely at one technique.'
        ]
    };

    function pick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    /** Clue text when there is no provider configured (also the failure fallback). */
    function offlineClue(context) {
        const tier = context.tier;

        // Untargeted sweeps may identify a phase but do not confirm a card.
        if (context.general && (tier === 'success' || tier === 'critical_success')) {
            return context.loudestPhase
                ? `Sweeping everything at once only tells you where the noise is loudest: ${label(context.loudestPhase)}. ` +
                  'Choose a procedure that covers that phase to pin it down.'
                : 'The sweep found only background noise. Choose a procedure to investigate with.';
        }

        if (tier === 'critical_success') {
            const card = context.bestCard;
            if (card && card.description) {
                return `${pick(OFFLINE.relevant_success)} The printed scenario text reads: "${card.description}" — that is the clearest possible read on this phase.`;
            }
            return pick(OFFLINE.relevant_success);
        }

        // A confirmed phase reads as a win even when the roll itself was middling:
        // 11-14 counts as a success by the board's rule, so the narration should
        // not contradict the card that just flipped.
        if (context.confirmed) {
            const card = context.bestCard;
            return card && card.description
                ? `${pick(OFFLINE.relevant_success)} ${card.description}`
                : pick(OFFLINE.relevant_success);
        }
        if (tier === 'success') {
            if (context.relevance.length) {
                const card = context.bestCard;
                return card && card.description
                    ? `${pick(OFFLINE.relevant_success)} ${card.description}`
                    : pick(OFFLINE.relevant_success);
            }
            const procedure = context.procedure ? context.procedure.name : 'This procedure';
            return `${procedure} turned up nothing that identifies the attack. Whatever is happening, this is not the angle.`;
        }
        if (tier === 'partial') return pick(OFFLINE.partial);
        if (tier === 'critical_fail') return pick(OFFLINE.critical_fail);
        return pick(OFFLINE.failure);
    }

    // ------------------------------------------------------------------- panel

    function log(text, kind) {
        const box = byId(LOG_ID);
        if (!box) return;
        // Strip Markdown emphasis before rendering in the plain-text log.
        const plain = String(text == null ? '' : text).replace(/\*\*(.+?)\*\*/g, '$1');
        const msg = document.createElement('div');
        msg.className = 'im-msg im-' + (kind || 'narrator');
        msg.innerHTML = '<div class="im-msg-body">' + esc(plain).replace(/\n/g, '<br>') + '</div>';
        box.appendChild(msg);
        box.scrollTop = box.scrollHeight;
    }

    /** Transient line above the log. With text it reads as "working on it". */
    function setStatus(text) {
        const el = byId(STATUS_ID);
        if (!el) return;
        if (!text) {
            Utils.hideElement(el);
            return;
        }
        el.innerHTML = '<span class="im-spinner"></span><span class="im-status-text"></span>';
        const label = el.querySelector('.im-status-text');
        if (label) label.textContent = text;
        Utils.showElement(el);
    }

    /**
     * Show or clear the "Incident Master is working" feedback: an activity light
     * in the rail header, the status row, and a bubble exactly where the reply
     * will land. A model call can take a while, so silence must never be the
     * only indication that something is happening.
     * @param {boolean} busy
     * @param {string} [note] - What it is doing right now
     */
    function setBusy(busy, note) {
        const spinner = byId(SPINNER_ID);
        if (spinner) (busy ? Utils.showElement(spinner) : Utils.hideElement(spinner));

        const box = byId(LOG_ID);
        let typing = byId(TYPING_ID);

        if (!busy) {
            if (typing) typing.remove();
            setStatus('');
            return;
        }

        setStatus(note || 'The Incident Master is thinking…');
        if (!box) return;
        if (!typing) {
            typing = document.createElement('div');
            typing.id = TYPING_ID;
            typing.className = 'im-msg im-msg-typing';
            typing.innerHTML = '<span class="im-spinner"></span><span class="im-typing-text"></span>';
            box.appendChild(typing);
        }
        const label = typing.querySelector('.im-typing-text');
        if (label) {
            const extra = state.queue.length > 1 ? ` · ${state.queue.length} investigations queued` : '';
            label.textContent = (note || 'The Incident Master is thinking…') + extra;
        }
        box.scrollTop = box.scrollHeight;
    }

    function syncTurnDisplay() {
        const el = byId(TURN_ID);
        const g = game();
        if (!el || !g) return;
        const spent = Math.max(0, g.maxTurns - g.turnsRemaining);
        const display = Math.min(g.maxTurns, spent + (g.turnsRemaining > 0 ? 1 : 0));
        el.textContent = `Turn ${Math.max(1, display)}/${g.maxTurns}`;
    }

    // ------------------------------------------------------------------- LLM

    /**
     * Ask the Incident Master. Returns null (never throws) when no provider is
     * configured or the call fails, so the caller falls back to offline clues.
     * @returns {Promise<string|null>}
     */
    async function ask(kind, context) {
        const ai = (typeof AIClient !== 'undefined') ? AIClient : null;
        if (!ai || typeof ai.chat !== 'function') return null;
        // Avoid repeated provider timeouts after the provider is marked unavailable.
        if (state.providerDown) return null;

        const cfg = soloConfig();
        const since = Date.now() - state.lastCall;
        if (state.lastCall && since < cfg.minCallInterval) await wait(cfg.minCallInterval - since);

        try {
            if (typeof ai.resolve === 'function') {
                const resolved = await ai.resolve();
                if (!resolved || !resolved.ok) return null;
            }
            state.lastCall = Date.now();
            const text = await ai.chat(prompts[kind](context));
            state.consecutiveFailures = 0;
            return (text && String(text).trim()) || null;
        } catch (error) {
            console.warn('[SoloMaster] AI call failed, using offline clues:', error);
            state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
            // Report provider failures once to distinguish them from offline mode.
            if (!state.warnedProvider) {
                state.warnedProvider = true;
                log('The Incident Master could not be reached (' + scrub(error && error.message ? error.message : 'request failed') +
                    ') — falling back to offline clues.', 'meta');
            }
            if (state.consecutiveFailures >= 2) {
                state.providerDown = true;
                log('The provider is not answering, so the rest of this game uses the offline clue tables. ' +
                    'Check the AI target from the gear icon when you get a moment.', 'meta');
            }
            return null;
        }
    }

    // ------------------------------------------------------------- game hooks

    /** 5 quality tiers layered on the board's existing 11+ success rule. */
    function tierFor(meta) {
        if (meta.isCritFail) return 'critical_fail';
        if (meta.isCritSuccess) return 'critical_success';
        if (meta.total < (meta.target || 11)) return 'failure';
        if (meta.total <= 14) return 'partial';
        return 'success';
    }

    /**
     * Board-facing wording for a tier.
     *
    * Rolls from 11 through 14 meet the board's success threshold but produce a
    * weaker clue; retain the board's success classification in the log.
     */
    function tierLabel(tier) {
        return {
            critical_fail: 'CRITICAL FAILURE',
            failure: 'FAILURE',
            partial: 'SUCCESS (partial read)',
            success: 'SUCCESS',
            critical_success: 'CRITICAL SUCCESS'
        }[tier] || String(tier).toUpperCase();
    }

    /**
     * Roll hook, called by PlayerController.resolveRoll() with its outcome meta.
     *
    * Queue rolls received while a clue is being generated and process them in
    * order so slow provider responses do not discard investigations.
     */
    function onRoll(meta) {
        if (!state.active || !state.ready || !meta) return;
        if (game() && game().isGameOver) return;

        const procedure = activeProcedure();
        const g = game();
        const tier = tierFor(meta);
        const entry = {
            kind: 'clue',
            tier,
            roll: meta.base,
            bonus: meta.bonus,
            total: meta.total,
            target: meta.target,
            procedure,
            // No procedure = an untargeted sweep: it can point at a phase but
            // cannot use a DETECTION list, so it never confirms a card.
            general: !procedure,
            // The BOARD's success, not the clue tier (see prepareEntry).
            isSuccess: !!meta.isSuccess,
            // Read the turn number BEFORE spending it, so the first roll is turn 1.
            turn: g ? Math.max(1, g.maxTurns - g.turnsRemaining + 1) : 1,
            maxTurns: g ? g.maxTurns : soloConfig().maxTurns,
            cards: hiddenCards()
        };
        if (entry.general) {
            log('Untargeted sweep — no procedure selected, so this is a general hint.', 'meta');
        }

        // Spend the turn now so the board agrees with the roll immediately, even
        // while the Incident Master is still composing its answer.
        spendTurn();

        log(`Roll ${meta.base}${meta.bonus ? ' +' + meta.bonus : ''} = ${meta.total} — ${tierLabel(tier)}` +
            (procedure ? ` · ${procedure.name}` : ''), 'meta');

        state.queue.push(entry);
        void drainQueue();
    }

    /** Narrate queued rolls (and injects) one at a time, strictly in order. */
    async function drainQueue() {
        if (state.draining) return;
        state.draining = true;
        try {
            while (state.queue.length) {
                const entry = state.queue[0];

                if (entry.kind === 'inject') {
                    setBusy(true, 'The Incident Master is reacting…');
                    log(await injectText(entry), 'inject');
                } else {
                    setBusy(true, 'The Incident Master is reading the evidence…');
                    // Flip first (inside prepareEntry), then narrate: the board
                    // answers the roll immediately and a slow provider cannot
                    // hold up the payoff.
                    await prepareEntry(entry);
                    const clue = await writeClue(entry);
                    log(clue, clueTone(entry.tier));
                    if (entry.confirm) {
                        const card = entry.cards[entry.confirm];
                        log(`DETECTION CONFIRMED · ${TYPE_LABELS[entry.confirm] || entry.confirm}` +
                            (card ? ' — ' + card.name : ''), 'success');
                    } else if (entry.alreadyKnown) {
                        log('Nothing new — the phases this procedure covers are already identified.', 'meta');
                    }
                    state.history.push({
                        turn: entry.turn,
                        procedure: entry.procedure ? entry.procedure.name : 'Unknown procedure',
                        roll: entry.roll,
                        total: entry.total,
                        tier: entry.tier,
                        clue
                    });
                }

                state.queue.shift();
                setBusy(state.queue.length > 0, 'The Incident Master is reading the evidence…');
            }
        } finally {
            state.draining = false;
            setBusy(false);
        }
        // The reveal waits for the evidence, so the last roll is still readable.
        flushGameOver();
    }

    /**
     * The clue for one investigation: relevance first (printed DETECTION lists),
     * then the model, then the offline tables.
     * @returns {Promise<string>}
     */
    /**
     * Work out what the roll found, and flip any newly confirmed card.
     *
    * Reveal phases according to the board's success rule (`total >= target`),
    * not the clue tier. This includes rolls from 11 through 14.
     * @param {Object} entry - Queue entry, enriched in place
     */
    async function prepareEntry(entry) {
        const relevance = [];
        if (!entry.general) {
            for (const type of SCENARIO_TYPES) {
                const detection = await detectionFor(entry.cards[type]);
                if (namesProcedure(detection, entry.procedure)) relevance.push(type);
            }
        }

        entry.relevance = relevance;
        // For untargeted sweeps, identify the first phase that remains hidden.
        entry.loudestPhase = relevance.length
            ? relevance[0]
            : (SCENARIO_TYPES.find(type => !state.revealedTypes.has(type)) || null);
        entry.confirm = entry.isSuccess
            ? (relevance.find(type => !state.revealedTypes.has(type)) || null)
            : null;
        // A success that covers phases but adds nothing: say so, rather than
        // looking like the reveal silently failed.
        entry.alreadyKnown = !entry.confirm && entry.isSuccess && relevance.length > 0;

        if (entry.confirm) flipPhase(entry.confirm);
    }

    /** The clue text for a prepared entry: the model, else the offline tables. */
    async function writeClue(entry) {
        const context = {
            tier: entry.tier,
            roll: entry.roll,
            bonus: entry.bonus,
            total: entry.total,
            target: entry.target,
            procedure: entry.procedure,
            turn: entry.turn,
            maxTurns: entry.maxTurns,
            history: state.history.slice(-soloConfig().clueHistoryLimit),
            relevance: entry.relevance,
            general: !!entry.general,
            loudestPhase: entry.general ? entry.loudestPhase : null,
            confirmed: entry.confirm ? (TYPE_LABELS[entry.confirm] || entry.confirm) : null,
            bestCard: entry.cards[entry.relevance.length ? entry.relevance[0] : null] || null
        };

        const clue = await ask('clue', context);
        return clue || offlineClue(context);
    }

    /** CSS tone for a clue bubble. */
    function clueTone(tier) {
        if (tier === 'critical_fail' || tier === 'failure') return 'fail';
        if (tier === 'partial') return 'warn';
        return 'ok';
    }

    /** Inject hook, called by PlayerController.advanceInject(). Narrates only. */
    function onInject(source) {
        if (!state.active || !state.ready) return;
        const pc = controller();
        const inject = (pc && pc.injectQueue) ? pc.injectQueue[pc.activeInjectIndex] : null;
        const g = game();

        // Queue inject narration after the clue from the triggering roll.
        state.queue.push({
            kind: 'inject',
            source,
            inject,
            turn: g ? Math.max(1, g.maxTurns - g.turnsRemaining + 1) : 1,
            maxTurns: g ? g.maxTurns : soloConfig().maxTurns
        });
        void drainQueue();
    }

    /** Narrative for an inject: the model, else the card's own printed rule. */
    async function injectText(entry) {
        const text = await ask('inject', {
            source: entry.source,
            inject: entry.inject,
            turn: entry.turn,
            maxTurns: entry.maxTurns
        });
        if (text) return text;
        return entry.inject
            ? `INJECT: ${entry.inject.name}. ${entry.inject.description || 'Apply the card as printed.'}`
            : `The incident moves against you (${entry.source}).`;
    }

    /**
     * Spend one investigation turn. The existing GameState counter is the only
     * turn model, so the header and the game-over modal agree with the rail.
     */
    function spendTurn() {
        if (typeof GameState === 'undefined') return;
        // `useTurn()` reports whether a turn was consumed; check `isGameOver` separately.
        GameState.useTurn();
        const pc = controller();
        if (pc) pc.updateStats();
        syncTurnDisplay();

        // Defer the game-over reveal until queued clues have been written.
        if (game() && game().isGameOver) state.pendingGameOver = true;
    }

    /** Show the time-out ending once nothing is left in flight. */
    function flushGameOver() {
        if (!state.pendingGameOver || state.queue.length || state.draining) return;
        state.pendingGameOver = false;
        const pc = controller();
        if (pc) pc.showGameOver('timeout');
        void endGame(false);
    }

    async function endGame(won) {
        if (!state.active || !state.ready) return;
        state.ready = false;
        const cards = hiddenCards();
        const reveal = SCENARIO_TYPES
            .map(type => `${TYPE_LABELS[type] || type}: ${cards[type] ? cards[type].name : 'Unknown'}`)
            .join('\n');
        log(reveal, 'reveal');

        setBusy(true, 'The Incident Master is writing the debrief…');
        const text = await ask('debrief', { won, cards, history: state.history });
        if (text) log(text, 'narrator');
        else if (!won) log('Review the clues against the chain above — the evidence for each phase was there.', 'narrator');
        setBusy(false);
    }

    // ------------------------------------------------------------ accusation

    function openAccusation() {
        const modal = byId(ACCUSATION_MODAL_ID);
        if (!modal) return;
        const hidden = hiddenCards();
        SCENARIO_TYPES.forEach(type => {
            const select = byId('accuse-' + type);
            if (!select) return;
            const pool = (state.pools && state.pools[type] && state.pools[type].length)
                ? state.pools[type]
                : (hidden[type] ? [hidden[type]] : []);
            const seen = new Set();
            const options = pool.filter(card => {
                const key = matchKey(card.name);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
            select.innerHTML = '<option value="">— Select —</option>' + options
                .map(card => `<option value="${esc(card.id != null ? card.id : card.name)}">${esc(card.name)}</option>`)
                .join('');
        });
        const result = byId(ACCUSATION_RESULT_ID);
        if (result) result.textContent = '';
        Utils.showElement(modal);
    }

    function closeAccusation() {
        Utils.hideElement(ACCUSATION_MODAL_ID);
    }

    function submitAccusation() {
        const hidden = hiddenCards();
        const resultEl = byId(ACCUSATION_RESULT_ID);
        const picks = {};
        let missing = false;

        SCENARIO_TYPES.forEach(type => {
            const select = byId('accuse-' + type);
            picks[type] = select ? select.value : '';
            if (!picks[type]) missing = true;
        });

        if (missing) {
            if (resultEl) resultEl.textContent = 'Pick a card for each of the four phases before submitting.';
            return;
        }

        let correct = 0;
        SCENARIO_TYPES.forEach(type => {
            const card = hidden[type];
            const actual = card ? String(card.id != null ? card.id : card.name) : '';
            if (actual && picks[type] === actual) correct++;
        });

        // Only the count is reported: a per-phase map would make the game
        // solvable by enumeration, which is what the strikes are there to stop.
        if (correct === SCENARIO_TYPES.length) {
            closeAccusation();
            log(`ACCUSATION: ${correct}/${SCENARIO_TYPES.length} correct — case closed.`, 'success');
            const pc = controller();
            if (pc) pc.showGameOver('win');
            void endGame(true);
            return;
        }

        log(`ACCUSATION: ${correct}/${SCENARIO_TYPES.length} correct. That costs a strike.`, 'fail');
        closeAccusation();

        const pc = controller();
        if (pc) pc.addStrike();
        if (game() && game().isGameOver) void endGame(false);
    }

    // ------------------------------------------------------- AI target picker

    const settings = {
        provider: '',
        model: '',
        apiKey: '',
        source: 'shared',
        // Literal defaults, not ROLES[0].key: this object is built before the
        // persona tables are evaluated, so touching them here would be a TDZ error.
        role: DEFAULT_ROLE,
        personality: DEFAULT_VOICE
    };

    /** Provider keys offered by the AI target picker. */
    function providerKeys() {
        const ai = (typeof AIClient !== 'undefined') ? AIClient : null;
        return (ai && ai.PROVIDERS) ? Object.keys(ai.PROVIDERS) : [];
    }

    /** The curated model list a provider ships with, used before/without a live one. */
    function curatedModels(provider) {
        const ai = (typeof AIClient !== 'undefined') ? AIClient : null;
        const cfg = (ai && ai.PROVIDERS) ? ai.PROVIDERS[provider] : null;
        return (cfg && Array.isArray(cfg.models)) ? cfg.models.slice() : [];
    }

    /**
    * Whether this build exposes the server-side AI key path. Static demos do
    * not provide `/api/ai/*`, so `AIClient.getSharedConfig` is absent there.
     */
    function hasSharedKeyPath() {
        const ai = (typeof AIClient !== 'undefined') ? AIClient : null;
        return !!(ai && typeof ai.getSharedConfig === 'function');
    }

    /** Which key path the form is currently set to. */
    function currentSource() {
        if (!hasSharedKeyPath()) return 'own';
        const checked = document.querySelector('input[name="im-keymode"]:checked');
        return checked ? checked.value : settings.source;
    }

    function setModelHint(text, tone) {
        const el = byId('im-model-hint');
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('im-hint-error', tone === 'error');
        el.classList.toggle('im-hint-ok', tone === 'ok');
    }

    /**
     * Rebuild the Model dropdown, keeping the current choice when the new list
     * still offers it (and adding it back when a live list does not mention it).
     */
    function populateModels(models, preferred) {
        const select = byId('im-model');
        if (!select) return;
        const list = Array.isArray(models) ? models.slice() : [];
        const wanted = preferred || settings.model || '';
        select.innerHTML = '<option value="">— provider default —</option>' +
            list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
        if (wanted && list.includes(wanted)) {
            select.value = wanted;
        } else if (wanted) {
            // A saved model the live list did not mention: keep it selectable.
            const option = document.createElement('option');
            option.value = wanted;
            option.textContent = wanted;
            select.appendChild(option);
            select.value = wanted;
        }
    }

    function readSettings() {
        const own = Utils.getFromStorage(AI_SETTINGS_KEY, null, true) || {};
        settings.provider = own.provider || 'openai';
        settings.model = own.model || '';
        settings.apiKey = own.apiKey || '';
        // roleFor/voiceFor resolve an unknown or retired key to the default, so a
        // renamed persona never leaves the picker blank.
        settings.role = roleFor(own.role).key;
        settings.personality = voiceFor(own.personality).key;
        // A key the user already stored IS their choice, even if the source was
        // never written: opening the dialog to an empty hidden field reads as
        // "my key was thrown away".
        const source = Utils.getFromStorage(AI_KEY_SOURCE_KEY, null);
        settings.source = !hasSharedKeyPath() ? 'own'
            : (source ? ((source === 'own') ? 'own' : 'shared') : (settings.apiKey ? 'own' : 'shared'));
    }

    /** Fill the role + personality pickers, and describe the current choice. */
    function populatePersona() {
        const roleSelect = byId('im-role');
        if (roleSelect) {
            roleSelect.innerHTML = ROLES.map(r => `<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('');
            roleSelect.value = roleFor(settings.role).key;
        }
        const voiceSelect = byId('im-personality');
        if (voiceSelect) {
            voiceSelect.innerHTML = VOICES.map(v => `<option value="${esc(v.key)}">${esc(v.name)}</option>`).join('');
            voiceSelect.value = voiceFor(settings.personality).key;
        }
        syncPersonaHints();
    }

    /**
    * Short descriptions shown under each picker. The role line describes the
    * evidence the selected persona can corroborate.
     */
    function syncPersonaHints() {
        const role = roleFor(byId('im-role') ? byId('im-role').value : settings.role);
        const voice = voiceFor(byId('im-personality') ? byId('im-personality').value : settings.personality);
        const roleHint = byId('im-role-hint');
        if (roleHint) roleHint.textContent = role.blurb;
        const voiceHint = byId('im-personality-hint');
        if (voiceHint) voiceHint.textContent = voice.blurb;
    }

    function renderSettings() {
        const providerSelect = byId('im-provider');
        const keys = providerKeys();

        if (providerSelect) {
            providerSelect.innerHTML = keys
                .map(key => `<option value="${esc(key)}">${esc((AIClient.PROVIDERS[key] || {}).name || key)}</option>`)
                .join('');
            if (keys.includes(settings.provider)) providerSelect.value = settings.provider;
            else if (keys.length) {
                settings.provider = keys[0];
                providerSelect.value = settings.provider;
            }
        }

        // Populate the dropdown from the curated list before fetching live models.
        populateModels(curatedModels(settings.provider), settings.model);

        const keyField = byId('im-apikey-field');
        if (keyField) (settings.source === 'own' ? Utils.showElement(keyField) : Utils.hideElement(keyField));
        const apiKey = byId('im-apikey');
        if (apiKey) apiKey.value = settings.apiKey || '';

        document.querySelectorAll('input[name="im-keymode"]').forEach(radio => {
            radio.checked = (radio.value === settings.source);
        });

        // No server, no server key: drop the whole choice instead of showing a
        // radio that cannot be honoured.
        const keymode = byId('im-keymode-field');
        if (keymode) (hasSharedKeyPath() ? Utils.showElement(keymode) : Utils.hideElement(keymode));

        populatePersona();
    }

    async function describeTarget() {
        const ai = (typeof AIClient !== 'undefined') ? AIClient : null;
        if (!ai || typeof ai.resolve !== 'function') return 'Offline clues';
        try {
            const resolved = await ai.resolve();
            if (resolved && resolved.ok) return resolved.label || 'AI Incident Master';
        } catch (error) { /* treat as offline */ }
        return 'Offline clues (no key set)';
    }

    // ------------------------------------------------------------- intro card

    function introOpen() {
        const modal = byId(INTRO_MODAL_ID);
        return !!modal && !modal.classList.contains('hidden');
    }

    function openIntro() {
        Utils.showElement(INTRO_MODAL_ID);
    }

    function closeIntro() {
        Utils.hideElement(INTRO_MODAL_ID);
    }

    /**
     * Deal an empty board, or leave a running game alone.
     *
     * Only ever called from a user gesture (the intro or the AI target closing),
     * so `loadScenario()` has long since settled — unlike init(), where the board
     * is still loading and "no scenario" cannot yet be told from "not loaded".
     */
    function promptForDeal() {
        const board = controller();
        if (!board) return;
        if (board.scenario && board.scenario.scenario) return;
        if (typeof board.openQuickStart !== 'function') return;
        board.openQuickStart();
        log('Choose a deck to deal a hidden attack chain.', 'meta');
    }

    /**
    * Prompt for AI configuration once when no target is set. Persist the choice
    * so players who select offline mode are not prompted again.
     */
    async function afterIntro() {
        const nudged = Utils.getFromStorage(INTRO_NUDGED_KEY, false);
        if (nudged) { promptForDeal(); return; }

        const target = await describeTarget();
        if (!/offline/i.test(String(target))) { promptForDeal(); return; }

        Utils.saveToStorage(INTRO_NUDGED_KEY, true);
        state.dealAfterSettings = true;
        await openSettings();
        const status = byId(SETTINGS_STATUS_ID);
        if (status) {
            status.textContent = 'No AI target set yet — add a key for full narration, '
                + 'or close this to play with the offline clue tables.';
        }
    }

    /** "Set up the AI" from the rules card: settings now, deal prompt behind it. */
    function introToSettings() {
        Utils.saveToStorage(INTRO_NUDGED_KEY, true);
        closeIntro();
        state.dealAfterSettings = true;
        void openSettings();
    }

    /** Every way out of the rules card runs the same follow-up. */
    function dismissIntro() {
        closeIntro();
        void afterIntro();
    }

    async function refreshStatus() {
        const text = await describeTarget();
        const el = byId(TARGET_ID);
        if (el) el.textContent = text;
        // Who is speaking is part of the target, not a hidden setting: the rail
        // should say which voice is answering before the player reads a clue.
        const persona = byId(PERSONA_ID);
        if (persona) {
            const role = roleFor(settings.role);
            const voice = voiceFor(settings.personality);
            persona.textContent = `${role.name} · ${voice.name}`;
            persona.title = role.knows + ' Does not know: ' + role.limits;
            Utils.showElement(persona);
        }
        const g = game();
        syncTurnDisplay();
        const cfg = soloConfig();
        if (g && !g.maxTurns) g.maxTurns = cfg.maxTurns;
    }

    async function openSettings() {
        readSettings();
        renderSettings();
        const status = byId(SETTINGS_STATUS_ID);
        if (status) status.textContent = 'Current: ' + await describeTarget();
        Utils.showElement(SETTINGS_MODAL_ID);
        void refreshModels({ silent: true });
    }

    function closeSettings() {
        Utils.hideElement(SETTINGS_MODAL_ID);
        // The dialog was standing in for the deal prompt: an empty board is only
        // offered Quick Start once it closes, so the key question is answered
        // first and the player does not come back to two stacked modals.
        if (!state.dealAfterSettings) return;
        state.dealAfterSettings = false;
        promptForDeal();
    }

    /** Strip the API key out of any text before it can reach the screen. */
    function scrub(text) {
        const key = (byId('im-apikey') ? byId('im-apikey').value.trim() : '') || settings.apiKey || '';
        const value = String(text == null ? '' : text);
        return key ? value.split(key).join('••••') : value;
    }

    /**
     * Persist the AI target. Nothing is wiped when switching key source - the
     * stored key simply goes unused until the source is set back to "my own".
     * @param {Object} [options]
     * @param {boolean} [options.quiet] - Skip validation messages and the toast
     * @returns {Promise<boolean>} Whether the settings were saved
     */
    async function saveSettings(options = {}) {
        const provider = byId('im-provider') ? byId('im-provider').value : settings.provider;
        const model = byId('im-model') ? byId('im-model').value : '';
        const apiKey = byId('im-apikey') ? byId('im-apikey').value.trim() : '';
        const source = currentSource();
        const role = byId('im-role') ? byId('im-role').value : settings.role;
        const personality = byId('im-personality') ? byId('im-personality').value : settings.personality;
        const status = byId(SETTINGS_STATUS_ID);

        const keyless = provider === 'ollama';
        if (source === 'own' && !apiKey && !keyless) {
            if (!options.quiet && status) status.textContent = 'Enter your API key, or switch to this server\'s key.';
            return false;
        }

        Utils.saveToStorage(AI_SETTINGS_KEY, { provider, model, apiKey, role, personality, temperature: 0.7, maxTokens: 900 });
        Utils.saveToStorage(AI_KEY_SOURCE_KEY, source);

        settings.provider = provider;
        settings.model = model;
        settings.source = source;
        settings.role = role;
        settings.personality = personality;
        // A new target deserves a fresh chance even if the last one was down.
        state.providerDown = false;
        state.consecutiveFailures = 0;
        state.warnedProvider = false;

        const target = await describeTarget();
        if (!options.quiet && status) status.textContent = 'Saved — clues will come from ' + target + '.';
        await refreshStatus();
        // Re-evaluate the model list so a stale "not offered by this key" warning
        // clears as soon as the choice is fixed.
        void refreshModels({ silent: true });
        if (!options.quiet) Utils.showToast('Incident Master AI target saved', 'success');
        return true;
    }

    /**
     * Save, then make one real call so a bad key or model is reported plainly
     * (the message is scrubbed of the key before it is shown).
     */
    async function testSettings() {
        const status = byId(SETTINGS_STATUS_ID);
        if (status) status.textContent = 'Testing…';

        const saved = await saveSettings({ quiet: true });
        if (!saved) {
            if (status) status.textContent = 'Add your API key first (or choose this server\'s key).';
            return;
        }

        try {
            const reply = await AIClient.chat('Reply with exactly one word: ready');
            const spoken = scrub(String(reply || '').trim().replace(/\s+/g, ' ').slice(0, 60));
            if (status) status.textContent = spoken
                ? `Connection OK — the model replied “${spoken}”.`
                : 'Connection OK, but the model returned no text.';
            Utils.showToast('Incident Master connection OK', 'success');
        } catch (error) {
            // The client already turns 404/429 into an actionable message
            // (see AIClient.apiError) - do not append a second hint here.
            const message = scrub(error && error.message ? error.message : 'request failed');
            if (status) status.textContent = 'Failed: ' + message;
            Utils.showToast('Incident Master could not reach the provider', 'error');
        }
    }

    function clearSettings() {
        // Clearing the key must not also reset who is running the incident: those
        // are unrelated choices, and the persona is not stored in the key.
        Utils.saveToStorage(AI_SETTINGS_KEY, {
            provider: settings.provider,
            model: '',
            apiKey: '',
            role: settings.role,
            personality: settings.personality,
            temperature: 0.7,
            maxTokens: 900
        });
        settings.apiKey = '';
        settings.model = '';
        const apiKey = byId('im-apikey');
        if (apiKey) apiKey.value = '';
        const status = byId(SETTINGS_STATUS_ID);
        if (status) status.textContent = 'Stored key cleared.';
        Utils.showToast('Stored AI key cleared', 'info');
        void refreshStatus();
    }

    /**
     * Load the models the current target can actually use. Falls back to the
     * provider's curated list, so the dropdown is never left empty.
     * @param {Object} [options]
     * @param {boolean} [options.silent] - Skip the transient "Loading…" hint
     */
    async function refreshModels(options = {}) {
        const ai = (typeof AIClient !== 'undefined') ? AIClient : null;
        const select = byId('im-model');
        const button = byId('im-model-refresh');
        if (!ai || typeof ai.listModels !== 'function' || !select || state.loadingModels) return;

        const provider = byId('im-provider') ? byId('im-provider').value : settings.provider;
        const apiKey = byId('im-apikey') ? byId('im-apikey').value.trim() : '';
        const source = currentSource();

        if (source === 'own' && provider !== 'ollama' && !apiKey) {
            populateModels(curatedModels(provider), settings.model || select.value);
            setModelHint('Add your API key to load the models it can use.');
            return;
        }

        state.loadingModels = true;
        if (button) button.disabled = true;
        if (!options.silent) setModelHint('Loading models…');

        try {
            const result = await ai.listModels({ source, provider, apiKey });
            const chosen = settings.model || select.value || '';
            populateModels(result.models, chosen);
            if (result.source === 'provider' || result.source === 'server') {
                const origin = (result.source === 'server') ? "this server's key" : 'this provider';
                if (chosen && !result.models.includes(chosen)) {
                    // The likely cause of a bare 404 on the first real call.
                    setModelHint(`${result.models.length} model(s) available, but “${chosen}” is not one of them. Pick a model from the list.`, 'error');
                } else {
                    setModelHint(`${result.models.length} model${result.models.length === 1 ? '' : 's'} available from ${origin}.`, 'ok');
                }
            } else if (result.error) {
                setModelHint('Showing common models — ' + result.error + '.', 'error');
            } else {
                setModelHint('Showing common models for this provider.');
            }
        } catch (error) {
            populateModels(curatedModels(provider), settings.model || select.value);
            setModelHint('Showing common models for this provider.');
        } finally {
            state.loadingModels = false;
            if (button) button.disabled = false;
        }
    }

    // ----------------------------------------------------------------- gating

    /**
     * Close every route to the hidden scenario and hand the two manual controls
     * (turn, strike) to the Incident Master. Re-applied after each deal, because
     * PrintSheet's own refresh re-enables its button when a scenario is ready.
     */
    function applyGating() {
        if (!state.active) return;
        SPOILER_IDS.concat(MANAGED_IDS).forEach(id => {
            const el = byId(id);
            if (!el) return;
            el.disabled = true;
            el.setAttribute('aria-disabled', 'true');
            el.title = 'Solo AI (PvE): the Incident Master runs this for you';
        });
        // Hide GM reveal controls in addition to disabling spoiler actions.
        const reveal = byId('reveal-cards-btn');
        if (reveal) Utils.hideElement(reveal);
        const gm = byId('gm-mode-btn');
        if (gm) Utils.hideElement(gm);
        // The GM Console drives the turn clock and strike count directly, and the
        // Incident Master spends both from inside its own roll handling - a console
        // attached here would fight it. Hidden rather than removed, like the
        // Scenario Editor button, so the `#gm-mode-btn` page-identity test in
        // session-sync.js / gm-link.js still recognises this as the Player.
        const console_btn = byId('gm-console-btn');
        if (console_btn) Utils.hideElement(console_btn);

        // The Incident Master spends the turn itself, from inside its roll
        // handling, so the tabletop's roll/strike -> turn coupling does not apply.
        // Hide the switch as well as ignore it, so solo never shows a control
        // that would do nothing.
        const coupleLabel = byId('turn-couple-label');
        if (coupleLabel) Utils.hideElement(coupleLabel);

        const badge = byId(BADGE_ID);
        if (badge) Utils.showElement(badge);

        // Show the SOC Invader attribution only in solo mode.
        const credit = byId(CREDIT_ID);
        if (credit) Utils.showElement(credit);
    }

    /**
    * Keep scenario cards hidden except for phases confirmed by the player.
    * Reapply this state after sync imports and other external updates.
     */
    function enforceHidden() {
        if (!state.active) return;
        const pc = controller();

        document.querySelectorAll('.scenario-row .card-wrapper').forEach(wrapper => {
            const type = wrapper.dataset.type;
            if (!type || SCENARIO_TYPES.indexOf(type) === -1) return;
            const legal = state.revealedTypes.has(type);
            const card = wrapper.querySelector('.flip-card');
            if (card) card.classList.toggle('flipped', legal);
            if (pc && pc.revealed && Object.prototype.hasOwnProperty.call(pc.revealed, type)) {
                pc.revealed[type] = legal;
            }
            if (typeof GameState !== 'undefined' && GameState.revealed) {
                GameState.revealed[type] = legal;
            }
        });

        if (pc && typeof pc.setRevealState === 'function') pc.setRevealState(false);
    }

    /**
     * Turn one hidden scenario card face-up, silently. The player-facing
     * confirmation line is logged after the clue so the evidence reads first.
     * @param {string} type - Scenario phase
     */
    function flipPhase(type) {
        if (!type || state.revealedTypes.has(type)) return;
        state.revealedTypes.add(type);

        const wrapper = document.querySelector(`.scenario-row .card-wrapper[data-type="${type}"]`);
        const flip = wrapper ? wrapper.querySelector('.flip-card') : null;
        if (flip) flip.classList.add('flipped');

        const pc = controller();
        if (pc && pc.revealed) pc.revealed[type] = true;
        if (typeof GameState !== 'undefined' && GameState.revealed) GameState.revealed[type] = true;
    }

    // ------------------------------------------------------------ game start

    /** Serialises overlapping deals: only the newest one may narrate. */
    let readyToken = 0;

    /** Called after every deal (setupGame is the single funnel). */
    async function onGameReady() {
        if (!state.active) return;
        const token = ++readyToken;
        applyGating();
        enforceHidden();
        state.history = [];

        const pc = controller();
        if (!pc || !pc.scenario || !pc.scenario.scenario) return;

        state.ready = true;
        state.warnedProvider = false;
        state.providerDown = false;
        state.consecutiveFailures = 0;
        state.queue = [];
        state.draining = false;
        state.pendingGameOver = false;
        state.revealedTypes = new Set();
        closeRollPrompt();
        setBusy(false);
        state.pools = await loadPools();
        void detectionIndex();
        if (token !== readyToken) return;   // a newer deal superseded this one

        // Solo reads like the tabletop player's own hand: the procedures are the
        // player's options, so deal them face-up (the fork shows them face-up too).
        const procBtn = byId('reveal-procedures-btn');
        if (pc && procBtn && procBtn.dataset.state !== 'shown' && typeof pc.toggleRevealProcedures === 'function') {
            pc.toggleRevealProcedures();
        }

        const rev = byId(REV_ID);
        if (rev && state.pools && state.pools.revdate) {
            // Date only: the badge above already names the deck, so repeating it
            // here just duplicated the same words twice in the header.
            rev.textContent = `rev ${state.pools.revdate}`;
            Utils.showElement(rev);
        }

        const box = byId(LOG_ID);
        if (box) box.innerHTML = '';

        // Name the speaker before the first clue, so the voice has an owner.
        const seat = `${roleFor(settings.role).name} · ${voiceFor(settings.personality).name}`;
        log(`${seat} is running this incident.`, 'meta');
        await refreshStatus();
        if (token !== readyToken) return;
        syncTurnDisplay();

        const cards = hiddenCards();
        setBusy(true, 'The Incident Master is opening the incident…');
        let opening = await ask('opening', { cards, maxTurns: soloConfig().maxTurns });
        setBusy(false);
        if (token !== readyToken) return;
        if (!opening) {
            opening = [
                'ALERT — your SOC escalates an incident and the overnight analyst\'s notes mention',
                '"anomalous network traffic" and "possible lateral movement". The attack chain is hidden',
                'from you: investigate with procedure cards to earn clues, then accuse four cards to close the case.'
            ].join(' ');
        }
        log(opening, 'narrator');
        log('Pick a procedure card, then roll the d20. Every roll spends one turn. A success on a procedure that covers a phase flips that scenario card, and a partial success (11–14) flips it too, with a vaguer clue.', 'meta');
    }

    function wrapSetupGame() {
        const pc = controller();
        if (!pc || pc._soloWrapped) return;
        const original = pc.setupGame;
        pc.setupGame = function () {
            const result = original.apply(this, arguments);
            void onGameReady();
            return result;
        };
        pc._soloWrapped = true;
    }

    /** Close the shared roll prompt (PlayerController owns that modal). */
    function closeRollPrompt() {
        const pc = controller();
        if (pc && typeof pc.closeRollPrompt === 'function') pc.closeRollPrompt();
    }

    // -------------------------------------------------------------- lifecycle

    function isSoloRequest() {
        if (typeof Utils === 'undefined' || typeof Utils.getQueryParams !== 'function') return false;
        const params = Utils.getQueryParams() || {};
        return String(params.mode || '').toLowerCase() === 'solo';
    }

    function bindPanel() {
        byId(ACCUSE_BTN_ID)?.addEventListener('click', openAccusation);

        // Accusation modal
        byId('accusation-close-btn')?.addEventListener('click', closeAccusation);
        byId('accusation-cancel-btn')?.addEventListener('click', closeAccusation);
        byId('accusation-submit-btn')?.addEventListener('click', submitAccusation);
        byId(ACCUSATION_MODAL_ID)?.addEventListener('click', (e) => {
            if (e.target.id === ACCUSATION_MODAL_ID) closeAccusation();
        });

        // Rules card — every exit runs the same follow-up (see afterIntro)
        byId('solo-intro-done-btn')?.addEventListener('click', dismissIntro);
        byId('solo-intro-close-btn')?.addEventListener('click', dismissIntro);
        byId('solo-intro-settings-btn')?.addEventListener('click', introToSettings);
        byId(INTRO_MODAL_ID)?.addEventListener('click', (e) => {
            if (e.target.id === INTRO_MODAL_ID) dismissIntro();
        });

        // AI target modal
        byId('im-settings-btn')?.addEventListener('click', () => void openSettings());
        byId('im-settings-close-btn')?.addEventListener('click', closeSettings);
        byId('im-settings-save-btn')?.addEventListener('click', () => void saveSettings());
        byId('im-settings-test-btn')?.addEventListener('click', () => void testSettings());
        byId('im-settings-clear-btn')?.addEventListener('click', clearSettings);
        byId('im-model-refresh')?.addEventListener('click', () => void refreshModels());
        byId(SETTINGS_MODAL_ID)?.addEventListener('click', (e) => {
            if (e.target.id === SETTINGS_MODAL_ID) closeSettings();
        });
        byId('im-provider')?.addEventListener('change', (e) => {
            settings.provider = e.target.value;
            settings.model = '';
            populateModels(curatedModels(settings.provider), '');
            setModelHint('Loading models…');
            void refreshModels({ silent: true });
        });

        // Persona pickers: update the descriptions as you browse, but only take
        // the choice on Save - browsing the list should not change the game.
        byId('im-role')?.addEventListener('change', syncPersonaHints);
        byId('im-personality')?.addEventListener('change', syncPersonaHints);

        // Auto-load the model list once the key looks complete, like the AI Generator.
        let keyTimer = null;
        byId('im-apikey')?.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            window.clearTimeout(keyTimer);
            if (value.length < 20) {
                setModelHint('Add your API key to load the models it can use.');
                return;
            }
            keyTimer = window.setTimeout(() => void refreshModels({ silent: true }), 500);
        });

        document.querySelectorAll('input[name="im-keymode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                settings.source = e.target.value;
                renderSettings();
                if (settings.source === 'own') void refreshModels({ silent: true });
                else void refreshModels({ silent: true });
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (introOpen()) { dismissIntro(); return; }
            closeRollPrompt();
            closeAccusation();
            closeSettings();
        });
    }

    function init() {
        if (!isSoloRequest()) return;              // normal board: stay out of the way
        const panel = byId(PANEL_ID);
        if (!panel) return;                        // page does not want the rail

        state.active = true;
        document.body.classList.add('solo-match');
        Utils.showElement(panel);
        readSettings();
        bindPanel();
        wrapSetupGame();
        // The "no procedure selected" prompt belongs to PlayerController; hand it
        // this mode's wording instead of wrapping the roll ourselves.
        if (typeof PlayerController !== 'undefined') PlayerController.rollPromptHint = ROLL_PROMPT_HINT;
        // Gate spoiler controls at page load, before a game is dealt.
        applyGating();

        // Reapply hidden-card state after peer-tab or GM-popup updates.
        if (typeof GameState !== 'undefined' && typeof GameState.subscribe === 'function') {
            GameState.subscribe(() => enforceHidden());
        }

        // `setupGame()` handles init, Quick Start, and Load. Start onboarding
        // after the rules card so setup prompts appear in sequence.
        setTimeout(openIntro, 0);
    }

    global.SoloMaster = {
        // Page-level: true as soon as ?mode=solo mounted the rail.
        isSolo() { return state.active; },
        // Game-level: true once a hidden chain is on the board.
        isActive() { return state.active && state.ready; },
        onRoll,
        onInject,
        openAccusation,
        // Expose the offline clue path for tests and keyless play.
        offlineClue
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
