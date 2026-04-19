/**
 * GMDraw – Drawing Engine  (Phase 1 + Phase 2)
 *
 * Responsibilities:
 *  • Manage active and completed strokes
 *  • Render in-progress strokes as thin Lines (fast) and convert finished
 *    strokes to TubeGeometry meshes (visually thick)
 *  • Douglas-Peucker simplification + Catmull-Rom smoothing
 *  • Undo / redo stack
 *  • Eraser (proximity-based stroke deletion)
 *  • Serialise / deserialise for persistence and collaboration
 *
 * THREE is expected as a global.
 */
export class DrawingEngine {
    constructor(renderer) {
        this.renderer = renderer;
        this.scene    = renderer.scene;

        // Completed stroke records  [ { id, points[], color, brushSize, brushType, timestamp, mesh } ]
        this.strokes = [];

        // In-progress stroke
        this._activeLine   = null; // THREE.Line used as preview
        this._activePoints = [];   // THREE.Vector3[]

        // Undo / Redo
        this._undoStack = [];
        this._redoStack = [];

        // Current tool state
        this.color     = 0xff3b30;
        this.brushSize = 0.015;
        this.brushType = 'pen'; // 'pen' | 'marker' | 'brush' | 'eraser'

        // Drawing depth from camera
        this.depth = 3;

        // Minimum distance between consecutive points (noise filter)
        this._minDist = 0.004;
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    isDrawingActive() { return this._activeLine !== null; }
    getActivePointCount() { return this._activePoints.length; }

    startStroke() {
        if (this._activeLine || this.brushType === 'eraser') return;
        this._activePoints = [];

        const geo = new THREE.BufferGeometry();
        const mat = new THREE.LineBasicMaterial({
            color: this.color,
            transparent: this.brushType === 'brush',
            opacity: this.brushType === 'brush' ? 0.65 : 1.0,
        });
        this._activeLine = new THREE.Line(geo, mat);
        this.scene.add(this._activeLine);
    }

    addPoint(point) {
        if (this.brushType === 'eraser') {
            this._eraseNear(point);
            return;
        }
        if (!this._activeLine) return;

        // Distance threshold – skip near-duplicate points
        if (this._activePoints.length > 0) {
            const last = this._activePoints[this._activePoints.length - 1];
            if (last.distanceTo(point) < this._minDist) return;
        }

        this._activePoints.push(point.clone());
        if (this._activePoints.length > 1) {
            this._activeLine.geometry.setFromPoints(this._activePoints);
        }
    }

    /**
     * Finish the active stroke.
     * @param {boolean} smooth  apply smoothing pipeline before finalising
     * @returns {object|null}   the stroke record, or null if nothing was drawn
     */
    endStroke(smooth = true) {
        if (!this._activeLine) return null;

        // Clean up preview line
        this.scene.remove(this._activeLine);
        this._activeLine.geometry.dispose();
        this._activeLine.material.dispose();
        this._activeLine = null;

        if (this._activePoints.length < 2) {
            this._activePoints = [];
            return null;
        }

        const pts = smooth ? this._smoothPipeline(this._activePoints) : this._activePoints;
        this._activePoints = [];

        return this._finaliseStroke(pts, this.color, this.brushSize, this.brushType);
    }

    undo() {
        if (!this._undoStack.length) return false;
        const action = this._undoStack.pop();
        this._redoStack.push(action);

        if (action.type === 'add') {
            this._detachStroke(action.stroke);
        } else if (action.type === 'remove') {
            this._reattachStroke(action.stroke);
        } else if (action.type === 'clear') {
            for (const s of action.strokes) this._reattachStroke(s);
        }
        return true;
    }

    redo() {
        if (!this._redoStack.length) return false;
        const action = this._redoStack.pop();
        this._undoStack.push(action);

        if (action.type === 'add') {
            this._reattachStroke(action.stroke);
        } else if (action.type === 'remove') {
            this._detachStroke(action.stroke);
        } else if (action.type === 'clear') {
            for (const s of action.strokes) this._detachStroke(s);
        }
        return true;
    }

    clearAll() {
        if (!this.strokes.length) return;
        const cleared = [...this.strokes];
        this._undoStack.push({ type: 'clear', strokes: cleared });
        this._redoStack = [];
        for (const s of cleared) this._detachStroke(s);
    }

    setColor(c)     { this.color     = c; }
    setBrushSize(s) { this.brushSize = s; }
    setBrushType(t) { this.brushType = t; }

    /**
     * Replace a finished stroke's geometry with corrected points
     * (used by the AI shape-correction layer).
     */
    replaceStrokePoints(stroke, newPoints) {
        if (!stroke) return;
        this._removeMesh(stroke);
        stroke.points   = newPoints.map(p => ({ x: p.x, y: p.y, z: p.z }));
        stroke.mesh = this._buildMesh(newPoints, stroke.color, stroke.brushSize, stroke.brushType);
        if (stroke.mesh) this.scene.add(stroke.mesh);
    }

    // ─── Serialisation ─────────────────────────────────────────────────────────

    serialize() {
        return {
            version: 1,
            strokes: this.strokes.map(s => ({
                id:        s.id,
                points:    s.points,
                color:     s.color,
                brushSize: s.brushSize,
                brushType: s.brushType,
                timestamp: s.timestamp,
            })),
        };
    }

    deserialize(data) {
        this.clearAll();
        this._undoStack = [];
        this._redoStack = [];
        if (!data?.strokes) return;
        for (const sd of data.strokes) {
            const pts = sd.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
            const mesh = this._buildMesh(pts, sd.color, sd.brushSize, sd.brushType);
            const stroke = { ...sd, mesh };
            if (mesh) this.scene.add(mesh);
            this.strokes.push(stroke);
        }
    }

    /** Add a stroke received from a remote collaborator. */
    addExternalStroke(strokeData) {
        const pts  = strokeData.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
        const mesh = this._buildMesh(pts, strokeData.color, strokeData.brushSize, strokeData.brushType);
        const stroke = { ...strokeData, mesh };
        if (mesh) this.scene.add(mesh);
        this.strokes.push(stroke);
    }

    // ─── Private helpers ───────────────────────────────────────────────────────

    _finaliseStroke(pts, color, brushSize, brushType) {
        const stroke = {
            id:        `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            points:    pts.map(p => ({ x: p.x, y: p.y, z: p.z })),
            color,
            brushSize,
            brushType,
            timestamp: Date.now(),
            mesh:      null,
        };
        stroke.mesh = this._buildMesh(pts, color, brushSize, brushType);
        if (stroke.mesh) this.scene.add(stroke.mesh);
        this.strokes.push(stroke);
        this._undoStack.push({ type: 'add', stroke });
        this._redoStack = [];
        return stroke;
    }

    _buildMesh(pts, color, size, type) {
        if (!pts || pts.length < 2) return null;

        const radius = type === 'marker' ? size * 2.2
                     : type === 'brush'  ? size * 1.8
                     : size;

        try {
            if (pts.length === 2) {
                // Short strokes: simple cylinder
                const dir    = pts[1].clone().sub(pts[0]);
                const length = dir.length();
                if (length < 0.0001) return null;
                const geo  = new THREE.CylinderGeometry(radius, radius, length, 8);
                const mat  = new THREE.MeshBasicMaterial({ color });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(pts[0].clone().lerp(pts[1], 0.5));
                mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
                return mesh;
            }

            const curve    = new THREE.CatmullRomCurve3(pts);
            const segments = Math.min(Math.max(pts.length * 3, 12), 300);
            const geo = new THREE.TubeGeometry(curve, segments, radius, 7, false);
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: type === 'brush',
                opacity:     type === 'brush' ? 0.72 : 1.0,
            });
            return new THREE.Mesh(geo, mat);
        } catch {
            // Fallback: basic line
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color });
            return new THREE.Line(geo, mat);
        }
    }

    _detachStroke(stroke) {
        this._removeMesh(stroke);
        const idx = this.strokes.indexOf(stroke);
        if (idx > -1) this.strokes.splice(idx, 1);
    }

    _reattachStroke(stroke) {
        if (!stroke.mesh) {
            const pts  = stroke.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
            stroke.mesh = this._buildMesh(pts, stroke.color, stroke.brushSize, stroke.brushType);
        }
        if (stroke.mesh) this.scene.add(stroke.mesh);
        if (!this.strokes.includes(stroke)) this.strokes.push(stroke);
    }

    _removeMesh(stroke) {
        if (stroke.mesh) {
            this.scene.remove(stroke.mesh);
            stroke.mesh.geometry?.dispose();
            stroke.mesh.material?.dispose();
            stroke.mesh = null;
        }
    }

    _eraseNear(position) {
        const radius = this.brushSize * 8;
        const removed = [];
        for (const s of [...this.strokes]) {
            if (s.points.some(p => position.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < radius)) {
                this._detachStroke(s);
                removed.push(s);
            }
        }
        if (removed.length) {
            for (const s of removed) this._undoStack.push({ type: 'remove', stroke: s });
            this._redoStack = [];
        }
    }

    // ─── AI Smoothing Pipeline (Phase 2) ──────────────────────────────────────

    _smoothPipeline(pts) {
        if (pts.length < 4) return pts;
        const simplified = this._douglasPeucker(pts, 0.006);
        if (simplified.length < 3) return simplified;
        const curve = new THREE.CatmullRomCurve3(simplified);
        curve.curveType = 'centripetal';
        return curve.getPoints(Math.max(simplified.length * 3, 24));
    }

    _douglasPeucker(pts, epsilon) {
        if (pts.length < 3) return pts;
        let maxDist = 0, maxIdx = 0;
        const s = pts[0], e = pts[pts.length - 1];
        for (let i = 1; i < pts.length - 1; i++) {
            const d = this._pointLineDist(pts[i], s, e);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }
        if (maxDist > epsilon) {
            const left  = this._douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
            const right = this._douglasPeucker(pts.slice(maxIdx), epsilon);
            return [...left.slice(0, -1), ...right];
        }
        return [s, e];
    }

    _pointLineDist(p, a, b) {
        const ab = b.clone().sub(a);
        const len2 = ab.lengthSq();
        if (len2 === 0) return p.distanceTo(a);
        const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / len2));
        return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
    }
}
