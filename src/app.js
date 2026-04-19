/**
 * GMDraw – Application Orchestrator  (all four phases)
 *
 * Wires together every module and owns the gesture → action state machine.
 *
 * Exposed on window.gmdraw for HTML onclick handlers.
 */

import { Renderer }              from './renderer.js';
import { DrawingEngine }         from './drawing.js';
import { GestureProcessor }      from './gestures.js';
import { AIProcessor }           from './aiProcessor.js';
import { VoiceCommands }         from './voiceCommands.js';
import { CollaborationManager }  from './collaboration.js';
import { PersistenceManager }    from './persistence.js';
import { NotificationSystem }    from './notifications.js';

// ─── Size presets ─────────────────────────────────────────────────────────────
const SIZE_PRESETS = { small: 0.006, medium: 0.015, large: 0.030, xl: 0.055 };

class GMDrawApp {
    constructor() {
        this.notify       = new NotificationSystem();
        this.renderer     = null;
        this.drawing      = null;
        this.gestures     = null;
        this.ai           = null;
        this.voice        = null;
        this.collab       = null;
        this.persistence  = null;

        // Gesture state
        this._isStarted    = false;
        this._eraserMode   = false; // temporary eraser via gesture
        this._savedTool    = 'pen';
        this._lastUndoAt   = 0;

        // Remote peer cursors  userId → THREE.Mesh
        this._peerCursors  = new Map();

        this._bindWindowAPI();
    }

    // ─── Startup ───────────────────────────────────────────────────────────────

    async start() {
        const startBtn = document.getElementById('start-btn');
        startBtn.disabled = true;
        startBtn.innerHTML = `<span class="animate-spin inline-block mr-2">⏳</span> Starting…`;

        try {
            // 1. Camera stream
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: 1280, height: 720 },
            });
            const video = document.getElementById('webcam-video');
            video.srcObject = stream;
            await new Promise(r => { video.onloadedmetadata = () => { video.play(); r(); }; });

            // 2. Three.js scene
            this.renderer = new Renderer('ar-canvas');

            // 3. Drawing engine
            this.drawing = new DrawingEngine(this.renderer);

            // 4. AI processor
            this.ai = new AIProcessor();

            // 5. Gesture processor
            this.gestures = new GestureProcessor(video, g => this._onGesture(g));
            await this.gestures.init();
            this.gestures.start();

            // 6. Persistence (IndexedDB) – offer to restore last session
            this.persistence = new PersistenceManager(this.drawing);
            const saved = await this.persistence.init();
            if (saved?.scene?.strokes?.length) this._offerRestore(saved);

            // 7. Collaboration
            this.collab = new CollaborationManager(this.drawing, e => this._onCollabEvent(e));

            // 8. Voice commands (Phase 4)
            this.voice = new VoiceCommands(c => this._onVoiceCommand(c));
            if (this.voice.init()) {
                document.getElementById('voice-btn')?.classList.remove('hidden');
                this.notify.info('🎤 Voice commands ready — say "help"', 4000);
            }

            // 9. Show main UI
            this._showMainUI();
            this._isStarted = true;

        } catch (err) {
            console.error('GMDraw start error:', err);
            startBtn.disabled = false;
            startBtn.textContent = '⚠️ ' + (err.name === 'NotAllowedError' ? 'Camera permission denied' : err.message);
        }
    }

    // ─── Gesture state machine ─────────────────────────────────────────────────

    _onGesture(g) {
        if (!this._isStarted) return;

        const cursor = this.renderer.cursor;

        if (g.type === 'no_hand') {
            cursor.position.set(0, 0, 1000);
            if (this.drawing.isDrawingActive()) {
                const stroke = this.drawing.endStroke(this.ai.smoothingEnabled);
                this._handleFinishedStroke(stroke);
            }
            if (this._eraserMode) this._exitEraserMode();
            this._setGestureHUD('No hand ✋');
            return;
        }

        // Map landmark → 3-D world position
        const pos = this.renderer.screenToWorld(g.indexTip.x, g.indexTip.y, this.drawing.depth);
        cursor.position.copy(pos);

        // Broadcast cursor to collaborators
        this.collab?.broadcastCursorMove(pos.x, pos.y, pos.z);

        switch (g.type) {
            // ── Draw ───────────────────────────────────────────────────────────
            case 'pinch': {
                if (this._eraserMode) this._exitEraserMode();
                cursor.material.color.setHex(this.drawing.color);
                cursor.scale.setScalar(1.6);

                if (!this.drawing.isDrawingActive()) {
                    this.drawing.startStroke();
                    this._setGestureHUD('Drawing ✏️');
                }
                this.drawing.addPoint(pos);
                break;
            }

            // ── Stop / release ─────────────────────────────────────────────────
            case 'open':
            case 'neutral': {
                if (this._eraserMode) this._exitEraserMode();
                cursor.material.color.setHex(0xffffff);
                cursor.scale.setScalar(1);

                if (this.drawing.isDrawingActive()) {
                    const stroke = this.drawing.endStroke(this.ai.smoothingEnabled);
                    this._handleFinishedStroke(stroke);
                    this._setGestureHUD('Ready ✋');
                }
                break;
            }

            // ── Undo (fist) ────────────────────────────────────────────────────
            case 'fist': {
                cursor.material.color.setHex(0xff6b6b);
                cursor.scale.setScalar(0.7);
                const now = Date.now();
                if (now - this._lastUndoAt > 900) {
                    this._lastUndoAt = now;
                    const ok = this.drawing.undo();
                    if (ok) {
                        this.notify.info('↩ Undo', 1200);
                        this.collab?.broadcastUndo();
                        this._setGestureHUD('Undo 👊');
                    }
                }
                break;
            }

            // ── Eraser (two fingers) ───────────────────────────────────────────
            case 'two_fingers': {
                if (!this._eraserMode) this._enterEraserMode();
                cursor.material.color.setHex(0xff9500);
                cursor.scale.setScalar(2.0);
                this.drawing.addPoint(pos);
                this._setGestureHUD('Eraser ✌️');
                break;
            }

            // ── Shape-correction preview (three fingers) ───────────────────────
            case 'three_fingers': {
                cursor.material.color.setHex(0xaf52de);
                cursor.scale.setScalar(1.2);
                this._setGestureHUD('Shape Snap 🖖');
                break;
            }

            // ── Point / navigate ───────────────────────────────────────────────
            case 'point': {
                if (this._eraserMode) this._exitEraserMode();
                cursor.material.color.setHex(0x5ac8fa);
                cursor.scale.setScalar(1);
                this._setGestureHUD('Pointing ☝️');
                break;
            }
        }
    }

    _handleFinishedStroke(stroke) {
        if (!stroke) return;
        // Shape correction
        if (this.ai.shapeCorrectionEnabled) {
            const pts = stroke.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
            const res = this.ai.recognizeShape(pts);
            if (res) {
                this.drawing.replaceStrokePoints(stroke, res.correctedPoints);
                this.notify.success(`Shape: ${res.type} (${Math.round(res.confidence * 100)}%)`, 2000);
            }
        }
        // Broadcast to collaborators
        this.collab?.broadcastStrokeEnd(stroke);
    }

    _enterEraserMode() {
        this._eraserMode  = true;
        this._savedTool   = this.drawing.brushType;
        this.drawing.setBrushType('eraser');
        this._updateToolUI('eraser');
    }

    _exitEraserMode() {
        this._eraserMode = false;
        this.drawing.setBrushType(this._savedTool);
        this._updateToolUI(this._savedTool);
    }

    // ─── Voice command handler ─────────────────────────────────────────────────

    _onVoiceCommand(cmd) {
        this._flashVoiceHUD(cmd.action);
        switch (cmd.action) {
            case 'set_color':
                this.drawing.setColor(cmd.value);
                this._updateColorUI(cmd.value);
                this.notify.info(`🎨 ${cmd.label}`, 1800);
                break;
            case 'set_size': {
                const s = SIZE_PRESETS[cmd.value] ?? SIZE_PRESETS.medium;
                this.drawing.setBrushSize(s);
                this.notify.info(`📏 Size: ${cmd.value}`, 1800);
                break;
            }
            case 'set_tool':
                this.drawing.setBrushType(cmd.value);
                this._updateToolUI(cmd.value);
                this.notify.info(`🖌️ Tool: ${cmd.value}`, 1800);
                break;
            case 'clear':
                this.drawing.clearAll();
                this.collab?.broadcastClear();
                this.notify.warning('🗑️ Canvas cleared');
                break;
            case 'undo':
                this.drawing.undo();
                this.notify.info('↩ Undo', 1200);
                break;
            case 'redo':
                this.drawing.redo();
                this.notify.info('↪ Redo', 1200);
                break;
            case 'export':
                this.persistence?.exportJSON();
                this.notify.success('💾 Exported!');
                break;
            case 'toggle_smooth':
                this.ai.smoothingEnabled = cmd.value;
                document.getElementById('ai-smooth-toggle').checked = cmd.value;
                this.notify.info(`AI Smooth ${cmd.value ? 'ON' : 'OFF'}`, 1800);
                break;
            case 'toggle_shape':
                this.ai.shapeCorrectionEnabled = cmd.value;
                document.getElementById('shape-correct-toggle').checked = cmd.value;
                this.notify.info(`Shape Correction ${cmd.value ? 'ON' : 'OFF'}`, 1800);
                break;
            case 'draw_shape':
                this._spawnShape(cmd.shape);
                break;
            case 'help':
                this.notify.info(
                    '🎤 Say: color names, "big/small", "pen/marker/brush/eraser", ' +
                    '"undo/redo/clear/export", "draw circle/square/triangle/line"',
                    9000,
                );
                break;
        }
    }

    // ─── Collaboration event handler ───────────────────────────────────────────

    _onCollabEvent(event) {
        switch (event.type) {
            case 'peer_joined':
                this.notify.success(`👤 ${event.name} joined`);
                this._updatePeerCount();
                break;
            case 'peer_left':
                this._removePeerCursor(event.userId);
                this.notify.info('👤 A user left');
                this._updatePeerCount();
                break;
            case 'synced':
                this.notify.success(`🔄 Synced ${event.strokeCount} strokes from room`);
                break;
            case 'remote_cursor':
                this._updatePeerCursor(event.userId, event.position, event.color);
                break;
            case 'remote_clear':
                this.notify.warning('🗑️ Room cleared by another user');
                break;
        }
    }

    // ─── Peer cursors ──────────────────────────────────────────────────────────

    _updatePeerCursor(userId, pos, color) {
        if (!this._peerCursors.has(userId)) {
            const geo  = new THREE.SphereGeometry(0.02, 8, 8);
            const mat  = new THREE.MeshBasicMaterial({ color: color ?? 0x5ac8fa, transparent: true, opacity: 0.75 });
            const mesh = new THREE.Mesh(geo, mat);
            this.renderer.scene.add(mesh);
            this._peerCursors.set(userId, mesh);
        }
        this._peerCursors.get(userId).position.set(pos.x, pos.y, pos.z);
    }

    _removePeerCursor(userId) {
        const m = this._peerCursors.get(userId);
        if (m) {
            this.renderer.scene.remove(m);
            m.geometry.dispose(); m.material.dispose();
            this._peerCursors.delete(userId);
        }
    }

    // ─── Shape generation (voice / toolbar) ───────────────────────────────────

    _spawnShape(shape) {
        const z = -this.drawing.depth;
        let pts = [];
        switch (shape) {
            case 'circle':
                for (let i = 0; i <= 64; i++) {
                    const a = (i / 64) * Math.PI * 2;
                    pts.push(new THREE.Vector3(Math.cos(a) * 0.5, Math.sin(a) * 0.5, z));
                }
                break;
            case 'rectangle':
                pts = [
                    new THREE.Vector3(-0.7, -0.4, z), new THREE.Vector3( 0.7, -0.4, z),
                    new THREE.Vector3( 0.7,  0.4, z), new THREE.Vector3(-0.7,  0.4, z),
                    new THREE.Vector3(-0.7, -0.4, z),
                ];
                break;
            case 'triangle': {
                const r = 0.55;
                pts = [
                    new THREE.Vector3(0, r, z),
                    new THREE.Vector3( r * 0.866, -r * 0.5, z),
                    new THREE.Vector3(-r * 0.866, -r * 0.5, z),
                    new THREE.Vector3(0, r, z),
                ];
                break;
            }
            case 'line':
                pts = [new THREE.Vector3(-0.8, 0, z), new THREE.Vector3(0.8, 0, z)];
                break;
        }
        if (!pts.length) return;

        // Bypass gesture loop – inject points directly
        const prevTool = this.drawing.brushType;
        this.drawing.startStroke();
        for (const p of pts) this.drawing.addPoint(p);
        const stroke = this.drawing.endStroke(false);
        this.drawing.setBrushType(prevTool);
        if (stroke) this.collab?.broadcastStrokeEnd(stroke);
        this.notify.success(`Drew a ${shape}!`, 2000);
    }

    // ─── Restore prompt ────────────────────────────────────────────────────────

    _offerRestore(session) {
        const count = session.scene.strokes.length;
        const bar   = document.createElement('div');
        bar.id      = 'restore-bar';
        bar.innerHTML = `
            <span>Restore last session? (${count} stroke${count !== 1 ? 's' : ''})</span>
            <div class="flex gap-2">
                <button id="restore-yes" class="px-4 py-1 bg-blue-500 hover:bg-blue-400 rounded-lg text-sm font-semibold transition-colors">Restore</button>
                <button id="restore-no"  class="px-4 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors">Start Fresh</button>
            </div>`;
        document.body.appendChild(bar);

        document.getElementById('restore-yes').onclick = () => {
            this.drawing.deserialize(session.scene);
            this.notify.success('Session restored ✅');
            bar.remove();
        };
        document.getElementById('restore-no').onclick = () => bar.remove();
    }

    // ─── UI helpers ────────────────────────────────────────────────────────────

    _showMainUI() {
        document.getElementById('start-overlay').classList.add('hidden');
        document.getElementById('toolbar').classList.remove('hidden');
        document.getElementById('toolbar').style.cssText = '';
        document.getElementById('status-badge').innerHTML =
            `<span class="h-2 w-2 rounded-full bg-green-500 inline-block mr-1.5"></span> AR Active`;
        document.getElementById('status-badge').className =
            'px-3 py-1 rounded-full text-xs font-semibold bg-green-500/20 text-green-300 border border-green-500/50 flex items-center';
    }

    _setGestureHUD(text) {
        const el = document.getElementById('gesture-hud');
        if (el) el.textContent = text;
    }

    _flashVoiceHUD(action) {
        const el = document.getElementById('voice-hud');
        if (!el) return;
        el.textContent = `🎤 ${action.replace(/_/g, ' ')}`;
        el.style.opacity = '1';
        setTimeout(() => { el.style.opacity = '0'; }, 2200);
    }

    _updateColorUI(hex) {
        document.querySelectorAll('[data-color]').forEach(btn => {
            const match = parseInt(btn.dataset.color, 16) === hex;
            btn.classList.toggle('ring-2', match);
            btn.classList.toggle('ring-white', match);
        });
    }

    _updateToolUI(tool) {
        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.classList.toggle('ring-2', btn.dataset.tool === tool);
            btn.classList.toggle('ring-white', btn.dataset.tool === tool);
        });
    }

    _updatePeerCount() {
        const el = document.getElementById('peer-count');
        if (el && this.collab) el.textContent = this.collab.peers.size;
    }

    // ─── Global window API (for HTML onclick / oninput handlers) ─────────────

    _bindWindowAPI() {
        window.gmdraw = {
            start: () => this.start(),

            setColor: hex => {
                this.drawing?.setColor(hex);
                this._updateColorUI(hex);
            },
            setBrushType: t => {
                this.drawing?.setBrushType(t);
                this._savedTool = t;
                this._eraserMode = (t === 'eraser');
                this._updateToolUI(t);
            },
            setBrushSize: sliderVal => {
                const values = [SIZE_PRESETS.small, SIZE_PRESETS.medium, SIZE_PRESETS.large, SIZE_PRESETS.xl];
                this.drawing?.setBrushSize(values[sliderVal - 1] ?? SIZE_PRESETS.medium);
            },

            undo:  () => { this.drawing?.undo();    this.notify.info('↩ Undo', 1000); },
            redo:  () => { this.drawing?.redo();    this.notify.info('↪ Redo', 1000); },
            clear: () => {
                this.drawing?.clearAll();
                this.collab?.broadcastClear();
                this.notify.warning('🗑️ Cleared');
            },

            toggleSmooth: () => {
                if (this.ai) {
                    this.ai.smoothingEnabled = !this.ai.smoothingEnabled;
                    this.notify.info(`AI Smooth ${this.ai.smoothingEnabled ? 'ON' : 'OFF'}`, 1500);
                }
            },
            toggleShapeCorrection: () => {
                if (this.ai) {
                    this.ai.shapeCorrectionEnabled = !this.ai.shapeCorrectionEnabled;
                    this.notify.info(`Shape Correction ${this.ai.shapeCorrectionEnabled ? 'ON' : 'OFF'}`, 1500);
                }
            },

            exportJSON: () => { this.persistence?.exportJSON();              this.notify.success('💾 JSON exported!'); },
            exportPNG:  () => { this.persistence?.exportPNG(this.renderer);  this.notify.success('🖼️ PNG exported!');  },
            exportSVG:  () => { this.persistence?.exportSVG();               this.notify.success('📐 SVG exported!');  },

            importFile: () => {
                const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
                inp.onchange = async e => {
                    try {
                        await this.persistence.importJSON(e.target.files[0]);
                        this.notify.success('📂 Scene imported!');
                    } catch (err) { this.notify.error('Import failed: ' + err.message); }
                };
                inp.click();
            },

            saveSession: async () => {
                const name = await this._inputModal('Session name:', `Session ${Date.now()}`);
                if (name === null) return; // cancelled
                await this.persistence?.saveSession(name, name);
                this.notify.success(`💾 Saved "${name}"`);
            },

            joinRoom: async () => {
                const input = await this._inputModal('Room code (leave blank for random):', '');
                if (input === null) return; // cancelled
                const code = (input.trim() || this._randomCode()).toUpperCase();
                this.collab?.joinRoom(code);
                document.getElementById('room-code').textContent  = code;
                document.getElementById('collab-status').classList.remove('hidden');
                this.notify.success(`🔗 Joined room ${code}`);
            },
            leaveRoom: () => {
                this.collab?.leaveRoom();
                document.getElementById('collab-status').classList.add('hidden');
                this.notify.info('Disconnected from room');
            },

            toggleVoice: () => {
                if (!this.voice?.isSupported) { this.notify.warning('Voice not supported in this browser'); return; }
                if (this.voice.isListening) {
                    this.voice.stop();
                    document.getElementById('voice-btn')?.classList.remove('text-green-400');
                    this.notify.info('🎤 Voice OFF');
                } else {
                    this.voice.start();
                    document.getElementById('voice-btn')?.classList.add('text-green-400');
                    this.notify.success('🎤 Voice ON — say "help"');
                }
            },

            spawnShape: shape => this._spawnShape(shape),
        };
    }

    _randomCode() {
        const buf = new Uint8Array(4);
        crypto.getRandomValues(buf);
        return Array.from(buf, b => b.toString(36).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
    }

    /**
     * Accessible custom modal for single-line text input.
     * Resolves with the entered string, or null if cancelled.
     * @param {string} label
     * @param {string} defaultValue
     * @returns {Promise<string|null>}
     */
    _inputModal(label, defaultValue = '') {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-label', label);
            Object.assign(overlay.style, {
                position: 'fixed', inset: '0', zIndex: '10000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
            });

            overlay.innerHTML = `
                <div style="background:rgba(15,23,42,0.96);border:1px solid rgba(255,255,255,0.12);
                    border-radius:16px;padding:24px 28px;min-width:280px;max-width:90vw;
                    font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#fff;">
                    <label id="_modal_lbl" style="display:block;font-size:14px;color:rgba(255,255,255,0.8);margin-bottom:10px;">${label}</label>
                    <input id="_modal_inp" type="text"
                        aria-labelledby="_modal_lbl"
                        style="width:100%;padding:8px 12px;background:rgba(255,255,255,0.08);
                            border:1px solid rgba(255,255,255,0.2);border-radius:10px;
                            color:#fff;font-size:14px;outline:none;box-sizing:border-box;"
                        value="${defaultValue.replace(/"/g, '&quot;')}" />
                    <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end;">
                        <button id="_modal_cancel"
                            style="padding:8px 18px;background:rgba(255,255,255,0.08);
                                border:none;border-radius:10px;color:rgba(255,255,255,0.7);
                                cursor:pointer;font-size:13px;">Cancel</button>
                        <button id="_modal_ok"
                            style="padding:8px 18px;background:#007aff;
                                border:none;border-radius:10px;color:#fff;
                                cursor:pointer;font-size:13px;font-weight:600;">OK</button>
                    </div>
                </div>`;

            document.body.appendChild(overlay);
            const inp    = overlay.querySelector('#_modal_inp');
            const okBtn  = overlay.querySelector('#_modal_ok');
            const canBtn = overlay.querySelector('#_modal_cancel');
            inp.focus();
            inp.select();

            const close = val => { overlay.remove(); resolve(val); };
            okBtn.addEventListener('click',  () => close(inp.value));
            canBtn.addEventListener('click', () => close(null));
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter')  close(inp.value);
                if (e.key === 'Escape') close(null);
            });
        });
    }

}

// Bootstrap
const app = new GMDrawApp();
document.getElementById('start-btn').addEventListener('click', () => app.start());
