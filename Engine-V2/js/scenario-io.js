/**
 * B&B Shuffle - Scenario Import/Export
 * Handles scenario serialization, validation, migration, and file operations
 */

const ScenarioIO = {
    /**
     * Generate a fresh UUID
     * @returns {string} UUID v4 string
     */
    generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        // Fallback for older browsers
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    /**
     * Export scenario to JSON file download
     * @param {Object} scenario - Scenario object to export
     * @param {string} filename - Optional filename (without extension)
     */
    exportToFile(scenario, filename = null) {
        const exportData = {
            ...scenario,
            exportDate: new Date().toISOString()
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const defaultFilename = filename || 
            `bb-scenario-${scenario.metadata?.name || 'export'}-${Date.now()}`;
        const sanitizedFilename = defaultFilename
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        const link = document.createElement('a');
        link.href = url;
        link.download = `${sanitizedFilename}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    },

    /**
     * Import scenario from file
     * Always assigns a fresh UUID on import
     * @param {File} file - File object to import
     * @returns {Promise<Object>} Imported and validated scenario
     */
    async importFromFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('No file provided'));
                return;
            }

            if (!file.name.endsWith('.json')) {
                reject(new Error('File must be a JSON file'));
                return;
            }

            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const imported = this.processImport(data);
                    resolve(imported);
                } catch (error) {
                    reject(new Error(`Failed to parse JSON: ${error.message}`));
                }
            };

            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };

            reader.readAsText(file);
        });
    },

    /**
     * Process imported data - validate, migrate, and assign fresh UUID
     * @param {Object} data - Raw imported data
     * @returns {Object} Processed scenario with fresh UUID
     */
    processImport(data) {
        // Migrate if needed
        const migrated = this.migrateScenario(data);

        // Validate
        const validation = this.validateScenario(migrated);
        if (!validation.valid) {
            throw new Error(`Invalid scenario: ${validation.errors.join(', ')}`);
        }

        // Always assign fresh UUID on import
        const now = new Date().toISOString();
        migrated.id = this.generateUUID();
        migrated.metadata.modifiedAt = now;

        return migrated;
    },

    /**
     * Migrate scenario from older versions
     * @param {Object} data - Scenario data
     * @returns {Object} Migrated scenario
     */
    migrateScenario(data) {
        let current = { ...data };
        let version = data.version || '1.0';

        // Apply migrations sequentially
        while (version !== ScenarioSchema.CURRENT_VERSION) {
            const migration = ScenarioSchema.VERSION_MIGRATIONS[version];
            if (migration) {
                current = migration(current);
                version = current.version;
            } else {
                // No migration path, assume compatible or set to current
                current.version = ScenarioSchema.CURRENT_VERSION;
                break;
            }
        }

        // Ensure all required fields exist with defaults
        const empty = ScenarioSchema.createEmpty();
        return this.mergeWithDefaults(current, empty);
    },

    /**
     * Deep merge data with defaults
     * @param {Object} data - Source data
     * @param {Object} defaults - Default values
     * @returns {Object} Merged object
     */
    mergeWithDefaults(data, defaults) {
        const result = { ...defaults };

        for (const key in data) {
            if (data[key] !== null && data[key] !== undefined) {
                if (typeof data[key] === 'object' && !Array.isArray(data[key]) && 
                    typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
                    result[key] = this.mergeWithDefaults(data[key], defaults[key]);
                } else {
                    result[key] = data[key];
                }
            }
        }

        return result;
    },

    /**
     * Validate scenario against schema
     * @param {Object} scenario - Scenario to validate
     * @returns {Object} Validation result { valid: boolean, errors: string[] }
     */
    validateScenario(scenario) {
        const errors = [];

        // Check version
        if (!scenario.version) {
            errors.push('Missing version field');
        }

        // Check required fields
        const requiredFields = ScenarioSchema.getRequiredFields();
        for (const fieldPath of requiredFields) {
            const value = this.getNestedValue(scenario, fieldPath);
            if (value === undefined || value === null) {
                errors.push(`Missing required field: ${fieldPath}`);
            }
        }

        // Validate scenario cards
        const cardTypes = ['initial', 'pivot', 'c2', 'persist'];
        for (const type of cardTypes) {
            const card = scenario.scenario?.[type];
            if (card && !this.validateCard(card)) {
                errors.push(`Invalid ${type} card`);
            }
        }

        // Validate procedures
        if (scenario.procedures) {
            if (!Array.isArray(scenario.procedures)) {
                errors.push('Procedures must be an array');
            } else {
                scenario.procedures.forEach((proc, index) => {
                    if (proc && !this.validateCard(proc)) {
                        errors.push(`Invalid procedure card at index ${index}`);
                    }
                });
            }
        }

        // Validate difficulty range
        if (scenario.metadata?.difficulty) {
            const diff = scenario.metadata.difficulty;
            if (typeof diff !== 'number' || diff < 1 || diff > 5) {
                errors.push('Difficulty must be a number between 1 and 5');
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    },

    /**
     * Validate a card object
     * @param {Object} card - Card to validate
     * @returns {boolean} Whether card is valid
     */
    validateCard(card) {
        if (!card || typeof card !== 'object') return false;
        if (!card.id || typeof card.id !== 'string') return false;
        if (!card.name || typeof card.name !== 'string') return false;
        if (!card.type || !ScenarioSchema.getCardTypes().includes(card.type)) return false;
        return true;
    },

    /**
     * Get nested object value by path
     * @param {Object} obj - Object to query
     * @param {string} path - Dot-separated path
     * @returns {*} Value at path
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => 
            current && current[key] !== undefined ? current[key] : undefined, obj);
    },

    /**
     * Save scenario to API
     * @param {Object} scenario - Scenario to save
     * @returns {Promise<Object>} Saved scenario from server
     */
    async saveToServer(scenario) {
        const response = await fetch('/api/scenarios', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(scenario)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to save scenario');
        }

        const body = await response.json();
        // The API wraps payloads in { success, data }; tolerate bare responses too.
        return body && body.data !== undefined ? body.data : body;
    },

    /**
     * Load scenario from API
     * @param {string} id - Scenario UUID
     * @returns {Promise<Object>} Loaded scenario
     */
    async loadFromServer(id) {
        const response = await fetch(`/api/scenarios/${id}`);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to load scenario');
        }

        const body = await response.json();
        // The API wraps payloads in { success, data }; tolerate bare responses too.
        return body && body.data !== undefined ? body.data : body;
    },

    /**
     * List all scenarios from API
     * @returns {Promise<Array>} List of scenario summaries
     */
    async listFromServer() {
        const response = await fetch('/api/scenarios');

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to list scenarios');
        }

        const body = await response.json();
        if (Array.isArray(body)) return body; // bare-array tolerance
        return body && Array.isArray(body.data) ? body.data : [];
    },

    /**
     * Delete scenario from API
     * @param {string} id - Scenario UUID
     * @returns {Promise<void>}
     */
    async deleteFromServer(id) {
        const response = await fetch(`/api/scenarios/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to delete scenario');
        }
    },

    /**
     * Update scenario on API
     * @param {string} id - Scenario UUID
     * @param {Object} scenario - Updated scenario data
     * @returns {Promise<Object>} Updated scenario
     */
    async updateOnServer(id, scenario) {
        const response = await fetch(`/api/scenarios/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...scenario,
                metadata: {
                    ...scenario.metadata,
                    modifiedAt: new Date().toISOString()
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update scenario');
        }

        const body = await response.json();
        // The API wraps payloads in { success, data }; tolerate bare responses too.
        return body && body.data !== undefined ? body.data : body;
    }
};

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScenarioIO;
}
