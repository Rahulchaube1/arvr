/**
 * GMDraw – Gesture Processor  (Phase 1)
 *
 * Wraps MediaPipe Hands and classifies raw landmarks into named gestures:
 *   pinch        – thumb tip ↔ index tip close   → draw
 *   open         – all four fingers extended      → stop / navigate
 *   fist         – no fingers extended            → undo (hold)
 *   two_fingers  – index + middle extended        → eraser
 *   three_fingers– index + middle + ring          → shape-correction preview
 *   point        – only index extended            → cursor / select
 *   neutral      – everything else
 *   no_hand      – nothing in frame
 *
 * MediaPipe (Hands, Camera) are expected as globals (loaded via CDN).
 */
export class GestureProcessor {
    constructor(videoElement, onGesture) {
        this.video     = videoElement;
        this.onGesture = onGesture;
        this._hands    = null;
        this._cam      = null;
    }

    async init() {
        this._hands = new Hands({
            locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
        });
        this._hands.setOptions({
            maxNumHands:           1,
            modelComplexity:       1,
            minDetectionConfidence: 0.70,
            minTrackingConfidence:  0.65,
        });
        this._hands.onResults(r => this._onResults(r));
    }

    start() {
        this._cam = new Camera(this.video, {
            onFrame: async () => {
                if (this._hands) await this._hands.send({ image: this.video });
            },
            width:  1280,
            height:  720,
        });
        this._cam.start();
    }

    stop() {
        if (this._cam) this._cam.stop();
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    _onResults(results) {
        if (!results.multiHandLandmarks?.length) {
            this.onGesture({ type: 'no_hand' });
            return;
        }

        const lm   = results.multiHandLandmarks[0];
        const type = this._classify(lm);

        this.onGesture({
            type,
            landmarks:  lm,
            indexTip:   lm[8],
            thumbTip:   lm[4],
            middleTip:  lm[12],
            wrist:      lm[0],
            handedness: results.multiHandedness?.[0]?.label ?? 'Right',
        });
    }

    _classify(lm) {
        const thumbTip = lm[4];
        const indexTip = lm[8];

        // Pinch: thumb ↔ index distance in normalised space
        const pinchDist = this._dist3(thumbTip, indexTip);
        if (pinchDist < 0.055) return 'pinch';

        const indexUp  = this._fingerUp(lm, 8, 6);
        const middleUp = this._fingerUp(lm, 12, 10);
        const ringUp   = this._fingerUp(lm, 16, 14);
        const pinkyUp  = this._fingerUp(lm, 20, 18);

        const upCount = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

        if (upCount === 0)                                 return 'fist';
        if (upCount === 4)                                 return 'open';
        if (indexUp && middleUp && !ringUp && !pinkyUp)   return 'two_fingers';
        if (indexUp && middleUp && ringUp  && !pinkyUp)   return 'three_fingers';
        if (indexUp && !middleUp && !ringUp && !pinkyUp)  return 'point';

        return 'neutral';
    }

    /** Is landmark [tipIdx] above landmark [pipIdx] (lower y value)? */
    _fingerUp(lm, tipIdx, pipIdx) {
        return lm[tipIdx].y < lm[pipIdx].y;
    }

    _dist3(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }
}
