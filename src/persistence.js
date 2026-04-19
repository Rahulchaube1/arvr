/**
 * GMDraw – Persistence Manager  (Phase 1 + Phase 2)
 *
 * • Auto-saves the scene to IndexedDB every 30 s
 * • Offers named save / load sessions
 * • Exports: JSON scene file, PNG screenshot, SVG vector
 * • Imports: JSON scene file
 */
export class PersistenceManager {
    constructor(drawingEngine) {
        this.drawing   = drawingEngine;
        this._db       = null;
        this._timer    = null;
        this._DB_NAME  = 'GMDrawDB';
        this._DB_VER   = 1;
        this._STORE    = 'sessions';
    }

    async init() {
        this._db = await this._openDB();
        this._startAutoSave();
        return this.loadSession('autosave');
    }

    // ─── Session management ────────────────────────────────────────────────────

    async saveSession(id = 'autosave', label = null) {
        if (!this._db) return;
        const record = {
            id,
            label:     label ?? (id === 'autosave' ? 'Auto Save' : id),
            scene:     this.drawing.serialize(),
            timestamp: Date.now(),
        };
        await this._put(record);
    }

    async loadSession(id = 'autosave') {
        if (!this._db) return null;
        return this._get(id);
    }

    async listSessions() {
        if (!this._db) return [];
        return this._getAll();
    }

    async deleteSession(id) {
        if (!this._db) return;
        return this._delete(id);
    }

    // ─── Auto-save ─────────────────────────────────────────────────────────────

    _startAutoSave() {
        this._timer = setInterval(() => {
            if (this.drawing.strokes.length > 0) {
                this.saveSession('autosave').catch(console.error);
            }
        }, 30_000);
    }

    destroy() {
        clearInterval(this._timer);
    }

    // ─── Export ────────────────────────────────────────────────────────────────

    exportJSON() {
        const payload = {
            version:   '1.0',
            app:       'GMDraw',
            exported:  new Date().toISOString(),
            scene:     this.drawing.serialize(),
        };
        this._download(
            new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
            `gmdraw-${Date.now()}.json`,
        );
    }

    exportPNG(renderer) {
        // Force a render then snapshot
        renderer.renderer.render(renderer.scene, renderer.camera);
        const url  = renderer.getScreenshot();
        const link = document.createElement('a');
        link.download = `gmdraw-${Date.now()}.png`;
        link.href     = url;
        link.click();
    }

    exportSVG() {
        const W = window.innerWidth, H = window.innerHeight;
        const lines = this.drawing.strokes.map(s => {
            if (!s.points?.length) return '';
            const col = '#' + (s.color >>> 0).toString(16).padStart(6, '0');
            const sw  = Math.max(1, s.brushSize * 120).toFixed(1);
            const d   = s.points.map((p, i) => {
                // Simple orthographic projection of 3-D points onto 2-D canvas
                const sx = ((1 - (p.x / (s.brushSize * 0 + 3) * 0.5 + 0.5)) * W).toFixed(1);
                const sy = ((1 - (p.y / 3 * 0.5 + 0.5)) * H).toFixed(1);
                return `${i === 0 ? 'M' : 'L'}${sx} ${sy}`;
            }).join(' ');
            return `  <path d="${d}" stroke="${col}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
        }).join('\n');

        const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">\n  <rect width="100%" height="100%" fill="#000"/>\n${lines}\n</svg>`;
        this._download(new Blob([svg], { type: 'image/svg+xml' }), `gmdraw-${Date.now()}.svg`);
    }

    // ─── Import ────────────────────────────────────────────────────────────────

    importJSON(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.scene) throw new Error('No scene data found in file.');
                    this.drawing.deserialize(data.scene);
                    resolve(data);
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    // ─── IndexedDB helpers ─────────────────────────────────────────────────────

    _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this._DB_NAME, this._DB_VER);
            req.onupgradeneeded = e => {
                e.target.result.createObjectStore(this._STORE, { keyPath: 'id' });
            };
            req.onsuccess = e => resolve(e.target.result);
            req.onerror   = e => reject(e.target.error);
        });
    }

    _put(record) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction([this._STORE], 'readwrite');
            tx.objectStore(this._STORE).put(record);
            tx.oncomplete = resolve;
            tx.onerror    = () => reject(tx.error);
        });
    }

    _get(id) {
        return new Promise((resolve, reject) => {
            const tx  = this._db.transaction([this._STORE], 'readonly');
            const req = tx.objectStore(this._STORE).get(id);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror   = () => reject(req.error);
        });
    }

    _getAll() {
        return new Promise((resolve, reject) => {
            const tx  = this._db.transaction([this._STORE], 'readonly');
            const req = tx.objectStore(this._STORE).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }

    _delete(id) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction([this._STORE], 'readwrite');
            tx.objectStore(this._STORE).delete(id);
            tx.oncomplete = resolve;
            tx.onerror    = () => reject(tx.error);
        });
    }

    _download(blob, filename) {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href     = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
}
