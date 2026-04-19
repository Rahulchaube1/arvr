/**
 * GMDraw – Collaboration Manager  (Phase 3)
 *
 * Uses the BroadcastChannel API so multiple browser tabs on the same device
 * can draw together in real-time.  In a production deployment this layer
 * would be replaced with a WebSocket / WebRTC backend, but the message
 * protocol is identical and the drawing engine contract is unchanged.
 *
 * Message types
 * ─────────────
 *  join            – user arrived; carries { name, color }
 *  announce        – reply to a join; carries { name, color }
 *  leave           – user departed
 *  sync_request    – ask peers for their current scene
 *  sync_data       – reply with serialised scene
 *  stroke_complete – a finished stroke; carries { stroke }
 *  cursor          – live cursor position; carries { x, y, z }
 *  clear           – all strokes removed
 *  undo            – undo last stroke
 */
export class CollaborationManager {
    constructor(drawingEngine, onEvent) {
        this.drawing   = drawingEngine;
        this.onEvent   = onEvent;

        this.userId    = 'u_' + this._secureRandHex(8);
        this.userName  = `User ${this._secureRandInt(1000, 9999)}`;
        this.userColor = this._randomColor();

        this.roomId    = null;
        this._channel  = null;
        this.isConnected = false;
        this.peers     = new Map(); // userId → { name, color }

        this._syncDone          = false;
        this._lastCursorSent    = 0;
        this._CURSOR_THROTTLE   = 60; // ms
    }

    joinRoom(roomId) {
        this.leaveRoom();
        this.roomId    = roomId;
        this._syncDone = false;
        this._channel  = new BroadcastChannel(`gmdraw:${roomId}`);
        this._channel.onmessage = e => this._receive(e.data);
        this.isConnected = true;

        this._send({ type: 'join',         name: this.userName, color: this.userColor });
        this._send({ type: 'sync_request' });
        return roomId;
    }

    leaveRoom() {
        if (!this._channel) return;
        this._send({ type: 'leave' });
        this._channel.close();
        this._channel    = null;
        this.roomId      = null;
        this.isConnected = false;
        this.peers.clear();
    }

    broadcastStrokeEnd(stroke) {
        this._send({
            type: 'stroke_complete',
            stroke: {
                id:        stroke.id,
                points:    stroke.points,
                color:     stroke.color,
                brushSize: stroke.brushSize,
                brushType: stroke.brushType,
                timestamp: stroke.timestamp,
            },
        });
    }

    broadcastCursorMove(x, y, z) {
        const now = Date.now();
        if (now - this._lastCursorSent < this._CURSOR_THROTTLE) return;
        this._lastCursorSent = now;
        this._send({ type: 'cursor', x, y, z });
    }

    broadcastClear() { this._send({ type: 'clear' }); }
    broadcastUndo()  { this._send({ type: 'undo'  }); }

    // ─── Private ───────────────────────────────────────────────────────────────

    _send(data) {
        this._channel?.postMessage({ ...data, userId: this.userId, ts: Date.now() });
    }

    _receive(msg) {
        if (msg.userId === this.userId) return; // echo guard

        switch (msg.type) {
            case 'join':
                this.peers.set(msg.userId, { name: msg.name, color: msg.color });
                this.onEvent({ type: 'peer_joined', userId: msg.userId, name: msg.name });
                // Welcome message back
                this._send({ type: 'announce', name: this.userName, color: this.userColor });
                break;

            case 'announce':
                this.peers.set(msg.userId, { name: msg.name, color: msg.color });
                break;

            case 'leave':
                this.peers.delete(msg.userId);
                this.onEvent({ type: 'peer_left', userId: msg.userId });
                break;

            case 'sync_request':
                // Small random delay to avoid all tabs replying simultaneously
                setTimeout(() => {
                    this._send({ type: 'sync_data', scene: this.drawing.serialize() });
                }, this._secureRandInt(50, 450));
                break;

            case 'sync_data':
                if (!this._syncDone && msg.scene?.strokes?.length) {
                    this._syncDone = true;
                    this.drawing.deserialize(msg.scene);
                    this.onEvent({ type: 'synced', strokeCount: msg.scene.strokes.length });
                }
                break;

            case 'stroke_complete':
                this.drawing.addExternalStroke(msg.stroke);
                this.onEvent({ type: 'remote_stroke', userId: msg.userId });
                break;

            case 'cursor':
                this.onEvent({
                    type:     'remote_cursor',
                    userId:   msg.userId,
                    position: { x: msg.x, y: msg.y, z: msg.z },
                    color:    this.peers.get(msg.userId)?.color ?? 0x5ac8fa,
                });
                break;

            case 'clear':
                this.drawing.clearAll();
                this.onEvent({ type: 'remote_clear', userId: msg.userId });
                break;

            case 'undo':
                this.drawing.undo();
                break;
        }
    }

    _randomColor() {
        const palette = [0xff3b30, 0x007aff, 0x34c759, 0xffcc00, 0xaf52de, 0xff9500, 0xff2d55, 0x5ac8fa];
        return palette[this._secureRandInt(0, palette.length - 1)];
    }

    /** Generate a hex string of `len` bytes using the Web Crypto API. */
    _secureRandHex(len) {
        const buf = new Uint8Array(len);
        crypto.getRandomValues(buf);
        return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    }

    /** Uniform integer in [min, max] using the Web Crypto API. */
    _secureRandInt(min, max) {
        const range = max - min + 1;
        const buf   = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return min + (buf[0] % range);
    }
}
