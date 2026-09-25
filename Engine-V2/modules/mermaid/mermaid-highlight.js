/**
 * B&B Shuffle - Mermaid syntax highlighting for the Flowchart Editor
 *
 * Loaded as a classic <script> (no bundler, no ES modules) like the rest of
 * Engine-V2, and it adds NO new external dependency - the project's only CDN
 * library stays Mermaid itself.
 *
 * The token set is modelled on the TextMate scopes used by
 * bpruitt-goddard/vscode-mermaid-syntax-highlight. That grammar is followed in
 * spirit rather than ported verbatim: a TextMate grammar needs an oniguruma
 * engine plus nested begin/end scope resolution, whereas what actually reads
 * well on this dark UI is a flatter set of classes.
 *
 *   keyword.control.mermaid      -> .hl-keyword / .hl-arrow / .hl-punct
 *   entity.name.function.mermaid -> .hl-direction / .hl-prop
 *   variable                     -> .hl-id
 *   string                       -> .hl-string / .hl-label
 *   comment                      -> .hl-comment
 *   (init directive)             -> .hl-directive
 *
 * Painting technique: a <pre> mirror sits behind the textarea, which keeps the
 * real caret, selection and scrollbar while rendering its own glyphs
 * transparent. #mermaid-input therefore stays a genuine <textarea>, so every
 * existing reader of it (renderDiagram, formatCode, loadTemplate, export, the
 * Tab handler) keeps working untouched - no contenteditable and no faked value
 * accessors.
 */
(function () {
    'use strict';

    // ==================================================================
    // Vocabulary
    // ==================================================================

    /** Diagram openers (keyword.control.mermaid). */
    var DIAGRAM_TYPES = [
        'flowchart', 'graph', 'sequenceDiagram', 'classDiagram',
        'stateDiagram-v2', 'stateDiagram', 'erDiagram', 'journey', 'gantt',
        'pie', 'gitGraph', 'mindmap', 'timeline', 'quadrantChart',
        'xychart-beta', 'sankey-beta', 'block-beta', 'packet-beta',
        'architecture-beta', 'kanban', 'radar-beta', 'requirementDiagram',
        'zenuml', 'C4Context', 'C4Container', 'C4Component', 'C4Dynamic',
        'C4Deployment'
    ];

    /** Structural statement keywords (keyword.control.mermaid). */
    var STATEMENTS = [
        'subgraph', 'end', 'direction', 'classDef', 'class', 'style',
        'linkStyle', 'click', 'call', 'href', 'participant', 'actor',
        'autonumber', 'activate', 'deactivate', 'note', 'loop', 'alt', 'else',
        'opt', 'par', 'rect', 'critical', 'break', 'box', 'title', 'accTitle',
        'accDescr', 'state', 'namespace', 'requirement',
        'functionalRequirement', 'interfaceRequirement',
        'performanceRequirement', 'physicalRequirement', 'designConstraint',
        'element', 'risk', 'verifymethod', 'docRef', 'commit', 'branch',
        'checkout', 'merge', 'section', 'dateFormat', 'axisFormat', 'excludes',
        'includes', 'todayMarker', 'tickInterval', 'category', 'showData',
        'x-axis', 'y-axis', 'quadrant-1', 'quadrant-2', 'quadrant-3',
        'quadrant-4', 'group', 'service', 'junction'
    ];

    /** Flow orientation (entity.name.function.mermaid, e.g. `graph TB`). */
    var DIRECTIONS = ['TB', 'TD', 'BT', 'RL', 'LR', 'RB'];

    /** Link operators. */
    var ARROWS = [
        '<-->', '<==>', '<--', '-->', '---', '--x', '--o', 'o--o', 'x--x',
        '-.->', '-.-', '-..->', '==>', '===', '~~~', '->>', '-->>', '->',
        '<-', '--', '==', ':::', '..>', '..|>', '|>', '<|', '<|--', '--|>',
        '*--', '--*', 'o--', '--o'
    ];

    /** Keys recognised inside `style` / `classDef`. */
    var PROPERTIES = [
        'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'color',
        'font-size', 'font-weight', 'font-family', 'opacity', 'rx', 'ry',
        'shape', 'label', 'text'
    ];

    /** Shape delimiters, longest opener first so `[[` wins over `[`. */
    var SHAPES = [
        ['[[', ']]'], ['([', '])'], ['[(', ')]'], ['((', '))'], ['{{', '}}'],
        ['[/', '/]'], ['[\\', '\\]'], ['[', ']'], ['(', ')'], ['{', '}'],
        ['>', ']']
    ].sort(function (a, b) { return b[0].length - a[0].length; });

    // ==================================================================
    // Rule table
    // ==================================================================

    /** Escape a literal so it can be dropped into a RegExp. */
    function literal(word) {
        return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /** `a|b|c`, longest first so no alternative is a prefix of another. */
    function alternation(words) {
        return words.slice()
            .sort(function (a, b) { return b.length - a.length; })
            .map(literal)
            .join('|');
    }

    // A label body is either a quoted string, or lazily anything up to the
    // closing delimiter. Each shape owns its own closer (so `[a (b)]` does not
    // terminate early on the parenthesis), which is why shapes are generated
    // per-pair below instead of sharing one bracket alternation.
    var LABEL_INNER = '(?:"(?:[^"\\\\]|\\\\.)*"|[^\\n]*?)';

    // Ordered: the first rule that matches at the current offset wins, so the
    // greedy/statement-level patterns come before the single-token ones.
    var RULES = [
        // %%{init: {...}}%% before the plain %% comment rule.
        { cls: 'hl-directive', re: /%%\{[^\n]*?\}%%/y },
        { cls: 'hl-comment', re: /%%[^\n]*/y },

        { cls: 'hl-string', re: /"(?:[^"\\]|\\.)*"|`[^`]*`/y },

        // Unquoted edge label: -->|Yes|
        { pipe: true, re: /\|([^|"\n]*)\|/y }
    ]
        // Shapes: A[text]  B{text}  C(text)  D([text])  E[(text)] ...
        .concat(SHAPES.map(function (pair) {
            return {
                shape: pair,
                re: new RegExp(literal(pair[0]) + '(' + LABEL_INNER + ')' + literal(pair[1]), 'y')
            };
        }))
        .concat([
            { cls: 'hl-arrow', re: new RegExp('(?:' + alternation(ARROWS) + ')', 'y') },
            { cls: 'hl-keyword', re: new RegExp('(?:' + alternation(DIAGRAM_TYPES) + '|' + alternation(STATEMENTS) + ')\\b', 'y') },
            { cls: 'hl-direction', re: new RegExp('(?:' + alternation(DIRECTIONS) + ')(?![\\w-])', 'y') },
            { cls: 'hl-prop', re: new RegExp('(?:' + alternation(PROPERTIES) + ')(?=\\s*:)', 'y') },
            { cls: 'hl-color', re: /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)\n]*\)/y },
            { cls: 'hl-number', re: /[0-9]+(?:\.[0-9]+)?/y },
            // Ids may contain dots and internal hyphens, but a hyphen only
            // continues the id when a word character follows, so `ID-1-->B`
            // still splits at the arrow.
            { cls: 'hl-id', re: /[A-Za-z_][A-Za-z0-9_.]*(?:-[A-Za-z0-9_.]+)*/y },
            { cls: 'hl-punct', re: /[:;,|&]/y },
            { re: /\s+/y } // plain
        ]);

    // ==================================================================
    // Rendering
    // ==================================================================

    // Delegates to the canonical Utils.escapeHtml (utils.js loads before this
    // file). Called for whole tokens, for single characters, and for the
    // punctuation token class - all of which the shared escaper covers.
    function escapeHtml(text) {
        return Utils.escapeHtml(text);
    }

    function span(cls, text) {
        return '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
    }

    /**
     * A label body is either bare text or a quoted string. Quotes are
     * punctuation and their contents are a string, which is how the reference
     * grammar scopes `ID["text"]` - and it keeps node labels consistent with
     * the quoted edge labels the pipe rule sees.
     * @param {string} inner - the text between the shape delimiters
     * @returns {string} HTML
     */
    function labelSpan(inner) {
        var quoted = /^"([\s\S]*)"$/.exec(inner);
        if (quoted) {
            return span('hl-punct', '"') +
                span('hl-string', quoted[1]) +
                span('hl-punct', '"');
        }
        return span('hl-label', inner);
    }

    /**
     * Tokenise Mermaid source into highlighted HTML.
     * @param {string} text - raw Mermaid source
     * @returns {string} HTML with one <span class="hl-*"> per token
     */
    function render(text) {
        var source = String(text == null ? '' : text);
        var html = '';
        var pos = 0;

        while (pos < source.length) {
            var hit = null;

            for (var i = 0; i < RULES.length; i++) {
                var rule = RULES[i];
                rule.re.lastIndex = pos; // sticky: only matches exactly here
                var m = rule.re.exec(source);
                if (m && m[0].length) {
                    hit = { rule: rule, m: m };
                    break;
                }
            }

            if (!hit) {
                // Nothing claimed this character - emit it verbatim.
                html += escapeHtml(source.charAt(pos));
                pos += 1;
                continue;
            }

            var cls = hit.rule.cls;
            var match = hit.m;

            if (hit.rule.shape) {
                html += span('hl-punct', hit.rule.shape[0]) +
                    labelSpan(match[1]) +
                    span('hl-punct', hit.rule.shape[1]);
            } else if (hit.rule.pipe) {
                html += span('hl-punct', '|') +
                    labelSpan(match[1]) +
                    span('hl-punct', '|');
            } else if (cls) {
                html += span(cls, match[0]);
            } else {
                html += escapeHtml(match[0]); // whitespace
            }

            pos += match[0].length;
        }

        return html;
    }

    // ==================================================================
    // Attaching to the editor
    // ==================================================================

    /**
     * Paint the mirror and keep it scrolled in step with the textarea.
     * @param {HTMLTextAreaElement} textarea - the real input element
     * @param {HTMLElement} pre - the .editor-highlight-layer element
     * @returns {Function|null} repaint callback, or null if not attachable
     */
    function attach(textarea, pre) {
        if (!textarea || !pre) return null;

        var code = pre.querySelector('code') || pre;

        function syncScroll() {
            pre.scrollTop = textarea.scrollTop;
            pre.scrollLeft = textarea.scrollLeft;
        }

        function paint() {
            // The trailing newline keeps the final (possibly empty) line box,
            // the same way a textarea reserves one for the caret.
            code.innerHTML = render(textarea.value) + '\n';
            syncScroll();
        }

        textarea.addEventListener('scroll', syncScroll, { passive: true });
        window.addEventListener('resize', syncScroll);

        // Only hide the textarea's own glyphs once the mirror is genuinely
        // painting, so a script failure leaves an ordinary readable editor.
        if (pre.parentElement) pre.parentElement.classList.add('is-active');
        paint();

        return paint;
    }

    window.MermaidHighlight = {
        render: render,
        attach: attach
    };
})();
