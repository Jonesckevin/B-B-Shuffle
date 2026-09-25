/**
 * B&B Shuffle — Custom Card I/O
 * ------------------------------------------------------------------
 * Client wrapper around the /api/custom-cards endpoints. Mirrors the tolerant
 * response handling used by scenario-io.js (accepts {success,data} or a bare
 * payload).
 *
 * Public API
 *   CustomCardIO.list()                 -> Promise<Array>
 *   CustomCardIO.get(id)                -> Promise<Object|null>
 *   CustomCardIO.create(card)           -> Promise<Object|null>
 *   CustomCardIO.update(id, card)       -> Promise<Object|null>
 *   CustomCardIO.remove(id)             -> Promise<boolean>
 *   CustomCardIO.uploadImage(dataUrl)   -> Promise<string|null>  (app-relative path)
 *   CustomCardIO.available()            -> Promise<boolean>
 */

const CustomCardIO = {
    BASE: '/api/custom-cards',

    _unwrap(payload) {
        if (payload == null) return null;
        if (typeof payload === 'object' && 'data' in payload) return payload.data;
        return payload;
    },

    /** Is the API reachable? (The static-only preview has no /api.) */
    async available() {
        try {
            const res = await fetch(this.BASE, { cache: 'no-store' });
            if (!res.ok) return false;
            const data = await res.json().catch(() => null);
            return !!(data && data.success);
        } catch (e) {
            return false;
        }
    },

    /** All custom cards. */
    async list() {
        const res = await fetch(this.BASE, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to list custom cards (${res.status})`);
        const payload = await res.json();
        const data = this._unwrap(payload);
        return Array.isArray(data) ? data : [];
    },

    /** One custom card by id. */
    async get(id) {
        const res = await fetch(`${this.BASE}/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Failed to load custom card (${res.status})`);
        const payload = await res.json();
        return this._unwrap(payload);
    },

    /** Create a card (server assigns the CC-nnn id). */
    async create(card) {
        const res = await fetch(this.BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(card)
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) {
            throw new Error(payload?.error || `Failed to create custom card (${res.status})`);
        }
        return this._unwrap(payload);
    },

    /** Update an existing card. */
    async update(id, card) {
        const res = await fetch(`${this.BASE}/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(card)
        });
        const payload = await res.json().catch(() => null);
        if (res.status === 404) return null;
        if (!res.ok || !payload?.success) {
            throw new Error(payload?.error || `Failed to update custom card (${res.status})`);
        }
        return this._unwrap(payload);
    },

    /** Delete a card (and its rendered image). */
    async remove(id) {
        const res = await fetch(`${this.BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.status === 404) return false;
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) {
            throw new Error(payload?.error || `Failed to delete custom card (${res.status})`);
        }
        return true;
    },

    /**
     * Store a rendered PNG (base64 data URL) and get back its app-relative path
     * (e.g. "../data/uploads/cards/abc.png").
     */
    async uploadImage(dataUrl) {
        const res = await fetch(`${this.BASE}/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl })
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) {
            throw new Error(payload?.error || `Failed to store card image (${res.status})`);
        }
        return payload.path || null;
    }
};

window.CustomCardIO = CustomCardIO;
