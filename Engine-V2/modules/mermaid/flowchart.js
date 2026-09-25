/**
 * B&B Shuffle - Mermaid Flowchart Editor
 * Interactive flowchart editor using Mermaid.js
 */

const FlowchartEditor = {
    // State
    zoom: 1,
    debounceTimer: null,

    // Templates. All four illustrate the same worked example - the Core 3.1
    // scenario "The Silent Architect" - so the set reads as one incident from
    // four angles: Compromised Trusted Relationship -> Weaponizing Active
    // Directory -> DNS as C2 -> Malicious Driver. Fill colours follow the
    // card-type tokens in shared/css/base.css.
    templates: {
        // Kill chain: the four scenario cards in the order they resolve.
        'attack-chain': `flowchart TD
    IC["Initial: Compromised Trusted Relationship"]
    PV["Pivot: Weaponizing Active Directory"]
    C2["C2: Domain Name System (DNS) as C2"]
    PS["Persist: Malicious Driver"]
    WIN(["Incident contained"])

    IC -->|"third-party SLA account"| PV
    PV -->|"delegation abuse, Kerberos tickets"| C2
    C2 -->|"tunnelled commands on port 53"| PS
    PS -->|"kernel-mode driver survives reboot"| WIN
    
    style IC fill:#ef4444,color:#fff
    style PV fill:#f59e0b,color:#1a1a1a
    style C2 fill:#b45309,color:#fff
    style PS fill:#8b5cf6,color:#fff
    style WIN fill:#10b981,color:#fff`,

        // Triage tree: how the table works that same incident with procedures.
        'decision-tree': `flowchart TD
    ALERT(["Alert: odd activity on the vendor SLA account"]) --> Q1{Remote session from the vendor?}
    Q1 -->|Yes| Q2{Kerberos ticket anomalies?}
    Q1 -->|No| P1[Endpoint Security Protection Analysis]
    Q2 -->|Yes| P2[Permissions Audit]
    Q2 -->|No| P3[Cloud Event Log Analysis]
    P2 --> Q3{DNS query spike to a single domain?}
    P3 --> Q3
    Q3 -->|Yes| P4[Network Threat Hunting]
    Q3 -->|No| TUNED[Triaged as benign]
    P4 --> Q4{Unsigned kernel-mode driver loaded?}
    Q4 -->|Yes| P6[Malicious Driver confirmed]
    Q4 -->|No| TUNED

    P1 --> CLOSE([Document and close])
    TUNED --> CLOSE
    P6 --> IR(["Isolate host, reimage, revoke vendor access"])
    
    style ALERT fill:#ef4444,color:#fff
    style Q1 fill:#f59e0b,color:#1a1a1a
    style Q2 fill:#f59e0b,color:#1a1a1a
    style Q3 fill:#f59e0b,color:#1a1a1a
    style Q4 fill:#f59e0b,color:#1a1a1a
    style P1 fill:#10b981,color:#fff
    style P2 fill:#10b981,color:#fff
    style P3 fill:#10b981,color:#fff
    style P4 fill:#10b981,color:#fff
    style P6 fill:#8b5cf6,color:#fff
    style CLOSE fill:#10b981,color:#fff
    style IR fill:#ef4444,color:#fff`,

        // Where that incident actually lives on the wire.
        'network': `flowchart LR
    subgraph ThirdParty["Third-party IT provider"]
        MSP[Vendor remote access]
    end

    subgraph Perimeter
        VPN[VPN gateway]
        FW[Firewall]
    end

    subgraph Corporate
        WS[Analyst workstation]
        DC[(Domain Controller)]
        FS[File server]
    end

    subgraph Egress
        DNS[Public DNS resolver]
    end

    MSP -->|"trusted SLA account"| VPN
    VPN --> FW
    FW --> WS
    WS -->|AD enumeration| DC
    DC --> FS
    WS -.->|"DNS queries on port 53"| DNS
    
    style MSP fill:#ef4444,color:#fff
    style DC fill:#b45309,color:#fff
    style DNS fill:#8b5cf6,color:#fff
    style VPN fill:#10b981,color:#fff`,

        // Dwell-time view of the same incident, from first access to containment.
        'timeline': `flowchart LR
    D0[Day 0<br/>Vendor credentials abused] --> D2[Day 2<br/>Active Directory recon]
    D2 --> D5[Day 5<br/>DNS tunnelling begins]
    D5 --> D9[Day 9<br/>Malicious driver loaded]
    D9 --> D12[Day 12<br/>DNS analytics alert]
    D12 --> D13[Day 13<br/>Host isolated and reimaged]
    
    style D0 fill:#ef4444,color:#fff
    style D2 fill:#f59e0b,color:#1a1a1a
    style D5 fill:#b45309,color:#fff
    style D9 fill:#8b5cf6,color:#fff
    style D12 fill:#10b981,color:#fff
    style D13 fill:#10b981,color:#fff`
    },

    /**
     * Initialize the editor
     */
    init() {
        this.initMermaid();
        this.initHighlight();
        this.bindEvents();
        this.renderDiagram();
    },

    /**
     * Wire the syntax-highlighting mirror behind the editor textarea.
     * Degrades to a plain, readable textarea if the highlighter is unavailable.
     */
    initHighlight() {
        if (typeof MermaidHighlight === 'undefined') return;

        const input = Utils.getElement('mermaid-input');
        const layer = document.querySelector('.editor-highlight-layer');
        this.paintHighlight = MermaidHighlight.attach(input, layer);
    },

    /**
     * Repaint the highlight mirror after the value is set programmatically
     */
    syncHighlight() {
        if (this.paintHighlight) this.paintHighlight();
    },

    /**
     * Initialize Mermaid configuration
     */
    initMermaid() {
        // Fixed dark theme to match the CCAS-style dark UI
        mermaid.initialize({
            startOnLoad: false,
            theme: 'base',
            securityLevel: 'loose',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis'
            },
            themeVariables: {
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                primaryColor: '#1e2430',
                primaryTextColor: '#e7eaf0',
                primaryBorderColor: '#333c4d',
                lineColor: '#9aa4b5',
                secondaryColor: '#2a3140',
                tertiaryColor: '#171b25',
                background: '#0f1117'
            }
        });
    },

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Editor input
        const input = Utils.getElement('mermaid-input');
        if (input) {
            input.addEventListener('input', () => {
                this.syncHighlight();
                this.debouncedRender();
            });
            input.addEventListener('keydown', (e) => this.handleKeydown(e));
        }

        // Clear button
        Utils.getElement('clear-btn')?.addEventListener('click', () => this.clearEditor());

        // Export dropdown
        const exportBtn = Utils.getElement('export-btn');
        const dropdown = exportBtn?.closest('.dropdown');
        if (exportBtn && dropdown) {
            exportBtn.addEventListener('click', () => {
                dropdown.classList.toggle('open');
            });

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (!dropdown.contains(e.target)) {
                    dropdown.classList.remove('open');
                }
            });
        }

        // Export options
        Utils.$$('[data-format]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.exportDiagram(btn.dataset.format);
                btn.closest('.dropdown')?.classList.remove('open');
            });
        });

        // Format button
        Utils.getElement('format-btn')?.addEventListener('click', () => this.formatCode());

        // Zoom controls
        Utils.getElement('zoom-in-btn')?.addEventListener('click', () => this.setZoom(this.zoom + 0.1));
        Utils.getElement('zoom-out-btn')?.addEventListener('click', () => this.setZoom(this.zoom - 0.1));
        Utils.getElement('reset-zoom-btn')?.addEventListener('click', () => this.setZoom(1));

        // Templates
        Utils.$$('[data-template]').forEach(btn => {
            btn.addEventListener('click', () => this.loadTemplate(btn.dataset.template));
        });
    },

    /**
     * Handle keyboard shortcuts in editor
     * @param {KeyboardEvent} e - Keyboard event
     */
    handleKeydown(e) {
        // Tab key for indentation
        if (e.key === 'Tab') {
            e.preventDefault();
            const input = e.target;
            const start = input.selectionStart;
            const end = input.selectionEnd;

            input.value = input.value.substring(0, start) + '    ' + input.value.substring(end);
            input.selectionStart = input.selectionEnd = start + 4;
            this.syncHighlight();
            this.debouncedRender();
        }

        // Ctrl+Enter to render
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            this.renderDiagram();
        }
    },

    /**
     * Debounced render function
     */
    debouncedRender() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.renderDiagram(), 500);
    },

    /**
     * Render the Mermaid diagram
     */
    async renderDiagram() {
        const input = Utils.getElement('mermaid-input')?.value || '';
        const preview = Utils.getElement('mermaid-preview');
        const status = Utils.getElement('preview-status');

        if (!preview || !input.trim()) {
            if (preview) preview.innerHTML = '<p class="empty-message">Enter Mermaid code to see the diagram</p>';
            if (status) {
                status.className = 'preview-status';
                status.querySelector('.status-text').textContent = 'Ready';
            }
            return;
        }

        try {
            // Validate syntax first
            await mermaid.parse(input);

            // Render the diagram
            const { svg } = await mermaid.render('mermaid-diagram', input);
            preview.innerHTML = svg;

            // Apply zoom
            this.applyZoom();

            // Update status
            if (status) {
                status.className = 'preview-status success';
                status.querySelector('.status-text').textContent = 'Diagram rendered successfully';
            }
        } catch (error) {
            console.error('Mermaid render error:', error);

            // Show error in preview
            preview.innerHTML = `<div class="error-message">
                <strong>Syntax Error</strong>
                <p>${Utils.escapeHtml(error.message || 'Invalid Mermaid syntax')}</p>
            </div>`;

            // Update status
            if (status) {
                status.className = 'preview-status error';
                status.querySelector('.status-text').textContent = 'Error: ' + (error.message || 'Invalid syntax');
            }
        }
    },

    /**
     * Set zoom level
     * @param {number} level - Zoom level (0.5 - 2)
     */
    setZoom(level) {
        this.zoom = Math.max(0.5, Math.min(2, level));
        this.applyZoom();
    },

    /**
     * Apply current zoom level to preview
     */
    applyZoom() {
        const preview = Utils.getElement('mermaid-preview');
        if (preview) {
            preview.style.transform = `scale(${this.zoom})`;
            preview.style.transformOrigin = 'center top';
        }
    },

    /**
     * Clear the editor
     */
    clearEditor() {
        const input = Utils.getElement('mermaid-input');
        if (input) {
            input.value = '';
            this.syncHighlight();
            this.renderDiagram();
        }
    },

    /**
     * Format the Mermaid code
     */
    formatCode() {
        const input = Utils.getElement('mermaid-input');
        if (!input) return;

        // Basic formatting: ensure consistent indentation
        let lines = input.value.split('\n');
        let indentLevel = 0;

        lines = lines.map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '';

            // Decrease indent for closing keywords
            if (trimmed.startsWith('end') || trimmed === '```') {
                indentLevel = Math.max(0, indentLevel - 1);
            }

            const indent = '    '.repeat(indentLevel);
            const formatted = indent + trimmed;

            // Increase indent for subgraphs
            if (trimmed.startsWith('subgraph')) {
                indentLevel++;
            }

            return formatted;
        });

        input.value = lines.join('\n');
        this.syncHighlight();
        this.renderDiagram();
    },

    /**
     * Load a template
     * @param {string} name - Template name
     */
    loadTemplate(name) {
        const template = this.templates[name];
        if (!template) return;

        const input = Utils.getElement('mermaid-input');
        if (input) {
            input.value = template;
            this.syncHighlight();
            this.renderDiagram();
        }
    },

    /**
     * Export the diagram
     * @param {string} format - Export format
     */
    async exportDiagram(format) {
        const input = Utils.getElement('mermaid-input')?.value || '';
        const preview = Utils.getElement('mermaid-preview');

        if (!input.trim()) {
            Utils.showToast('No diagram to export', 'warning');
            return;
        }

        try {
            switch (format) {
                case 'svg':
                    this.exportSVG(preview);
                    break;
                case 'png':
                    await this.exportPNG(preview);
                    break;
                case 'mmd':
                    this.exportMMD(input);
                    break;
                case 'clipboard':
                    await this.copyToClipboard(input);
                    break;
            }
        } catch (error) {
            console.error('Export error:', error);
            Utils.showToast('Export failed: ' + error.message, 'error');
        }
    },

    /**
     * Export as SVG
     * @param {HTMLElement} preview - Preview element
     */
    exportSVG(preview) {
        const svg = preview.querySelector('svg');
        if (!svg) {
            Utils.showToast('No diagram to export', 'warning');
            return;
        }

        const svgData = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        Utils.downloadFile(blob, 'flowchart.svg');
        Utils.showToast('SVG exported successfully', 'success');
    },

    /**
     * Export as PNG
     * @param {HTMLElement} preview - Preview element
     */
    async exportPNG(preview) {
        const svg = preview.querySelector('svg');
        if (!svg) {
            Utils.showToast('No diagram to export', 'warning');
            return;
        }

        const svgData = new XMLSerializer().serializeToString(svg);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        return new Promise((resolve, reject) => {
            img.onload = () => {
                canvas.width = img.width * 2; // Higher resolution
                canvas.height = img.height * 2;
                ctx.scale(2, 2);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);

                canvas.toBlob((blob) => {
                    Utils.downloadFile(blob, 'flowchart.png');
                    Utils.showToast('PNG exported successfully', 'success');
                    resolve();
                }, 'image/png');
            };
            img.onerror = reject;
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
        });
    },

    /**
     * Export as Mermaid file
     * @param {string} code - Mermaid code
     */
    exportMMD(code) {
        const blob = new Blob([code], { type: 'text/plain' });
        Utils.downloadFile(blob, 'flowchart.mmd');
        Utils.showToast('Mermaid file exported successfully', 'success');
    },

    /**
     * Copy code to clipboard
     * @param {string} code - Code to copy
     */
    async copyToClipboard(code) {
        await Utils.copyToClipboard(code);
        Utils.showToast('Copied to clipboard', 'success');
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    FlowchartEditor.init();
});
