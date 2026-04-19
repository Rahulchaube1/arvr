/**
 * GMDraw – AI Processor  (Phase 2)
 *
 * Provides:
 *  • Shape recognition  – scores stroke points against circle / rectangle /
 *                         triangle / line templates
 *  • Shape correction   – replaces detected shapes with clean geometric forms
 *
 * THREE is expected as a global.
 */
export class AIProcessor {
    constructor() {
        this.smoothingEnabled       = true;
        this.shapeCorrectionEnabled = true;

        // Minimum confidence needed to accept a shape classification
        this.shapeThreshold = 0.82;
    }

    /**
     * Attempt to recognise the shape drawn by `points`.
     * Returns null when no shape is confident enough.
     *
     * @param {THREE.Vector3[]} points
     * @returns {{ type: string, confidence: number, correctedPoints: THREE.Vector3[] }|null}
     */
    recognizeShape(points) {
        if (points.length < 6) return null;

        const scores = {
            circle:    this._scoreCircle(points),
            rectangle: this._scoreRectangle(points),
            triangle:  this._scoreTriangle(points),
            line:      this._scoreLine(points),
        };

        const [bestType, bestScore] = Object.entries(scores)
            .reduce((best, cur) => cur[1] > best[1] ? cur : best, ['', 0]);

        if (bestScore < this.shapeThreshold) return null;

        return {
            type:            bestType,
            confidence:      bestScore,
            correctedPoints: this._correctShape(points, bestType),
        };
    }

    // ─── Scoring heuristics ────────────────────────────────────────────────────

    _scoreCircle(pts) {
        const c    = this._centroid(pts);
        const dists = pts.map(p => p.distanceTo(c));
        const mean  = dists.reduce((a, b) => a + b, 0) / dists.length;
        if (mean === 0) return 0;

        const variance   = dists.reduce((a, d) => a + (d - mean) ** 2, 0) / dists.length;
        const uniformity = 1 - Math.min(Math.sqrt(variance) / mean, 1);

        const openness = pts[0].distanceTo(pts[pts.length - 1]) / (mean * 2);
        const closure  = 1 - Math.min(openness, 1);

        return uniformity * 0.55 + closure * 0.45;
    }

    _scoreRectangle(pts) {
        const corners = this._findCorners(pts, Math.PI / 4);
        if (corners.length < 3 || corners.length > 5) return 0;

        let rightAngleScore = 0;
        for (let i = 0; i < corners.length; i++) {
            const prev  = corners[(i - 1 + corners.length) % corners.length];
            const curr  = corners[i];
            const next  = corners[(i + 1) % corners.length];
            const angle = this._angleBetween(prev, curr, next);
            rightAngleScore += 1 - Math.abs(angle - Math.PI / 2) / (Math.PI / 2);
        }
        rightAngleScore /= corners.length;

        const span      = pts[0].distanceTo(pts[Math.floor(pts.length / 2)]);
        const closure   = span > 0 ? 1 - Math.min(pts[0].distanceTo(pts[pts.length - 1]) / (span * 0.5), 1) : 0;

        return rightAngleScore * 0.6 + closure * 0.4;
    }

    _scoreTriangle(pts) {
        const corners = this._findCorners(pts, Math.PI / 3);
        if (corners.length < 2 || corners.length > 4) return 0;

        const perim   = this._perimeter(pts);
        const closure = perim > 0 ? 1 - Math.min(pts[0].distanceTo(pts[pts.length - 1]) / (perim * 0.3), 1) : 0;
        const base    = corners.length === 3 ? 0.75 : 0.50;

        return base * closure;
    }

    _scoreLine(pts) {
        const start  = pts[0];
        const end    = pts[pts.length - 1];
        const length = start.distanceTo(end);
        if (length < 0.01) return 0;

        const dir = end.clone().sub(start);
        const residuals = pts.map(p => {
            const t    = Math.max(0, Math.min(1, p.clone().sub(start).dot(dir) / dir.lengthSq()));
            const proj = start.clone().add(dir.clone().multiplyScalar(t));
            return p.distanceTo(proj);
        });

        const avgRes = residuals.reduce((a, b) => a + b, 0) / residuals.length;
        return 1 - Math.min(avgRes / (length * 0.10), 1);
    }

    // ─── Shape generators ──────────────────────────────────────────────────────

    _correctShape(pts, type) {
        switch (type) {
            case 'circle':    return this._makeCircle(pts);
            case 'rectangle': return this._makeRectangle(pts);
            case 'triangle':  return this._makeTriangle(pts);
            case 'line':      return [pts[0], pts[pts.length - 1]];
            default:          return pts;
        }
    }

    _makeCircle(pts) {
        const c      = this._centroid(pts);
        const radius = pts.reduce((sum, p) => sum + p.distanceTo(c), 0) / pts.length;
        const out    = [];
        for (let i = 0; i <= 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            out.push(new THREE.Vector3(c.x + Math.cos(a) * radius, c.y + Math.sin(a) * radius, c.z));
        }
        return out;
    }

    _makeRectangle(pts) {
        let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
        for (const p of pts) {
            mnX = Math.min(mnX, p.x); mxX = Math.max(mxX, p.x);
            mnY = Math.min(mnY, p.y); mxY = Math.max(mxY, p.y);
        }
        const z = this._centroid(pts).z;
        return [
            new THREE.Vector3(mnX, mnY, z), new THREE.Vector3(mxX, mnY, z),
            new THREE.Vector3(mxX, mxY, z), new THREE.Vector3(mnX, mxY, z),
            new THREE.Vector3(mnX, mnY, z),
        ];
    }

    _makeTriangle(pts) {
        const c      = this._centroid(pts);
        const radius = pts.reduce((sum, p) => sum + p.distanceTo(c), 0) / pts.length;
        const z      = c.z;
        return [
            new THREE.Vector3(c.x,                     c.y + radius,         z),
            new THREE.Vector3(c.x + radius * 0.866,    c.y - radius * 0.5,   z),
            new THREE.Vector3(c.x - radius * 0.866,    c.y - radius * 0.5,   z),
            new THREE.Vector3(c.x,                     c.y + radius,         z),
        ];
    }

    // ─── Geometric utilities ───────────────────────────────────────────────────

    _centroid(pts) {
        const sum = new THREE.Vector3();
        for (const p of pts) sum.add(p);
        return sum.divideScalar(pts.length);
    }

    _findCorners(pts, minAngleChange) {
        const win     = Math.max(3, Math.floor(pts.length * 0.08));
        const corners = [];
        for (let i = win; i < pts.length - win; i++) {
            const angle = this._angleBetween(pts[i - win], pts[i], pts[i + win]);
            if (Math.abs(angle - Math.PI) > minAngleChange) {
                corners.push(pts[i]);
                i += win;
            }
        }
        return corners;
    }

    _angleBetween(a, b, c) {
        const v1 = a.clone().sub(b).normalize();
        const v2 = c.clone().sub(b).normalize();
        return Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
    }

    _perimeter(pts) {
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
        return len;
    }
}
