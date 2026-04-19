/**
 * GMDraw – Renderer
 * Wraps the Three.js scene, camera, WebGL renderer, and the fingertip cursor.
 * THREE is expected to be available as a global (loaded via CDN).
 */
export class Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);

        // Scene
        this.scene = new THREE.Scene();

        // Camera – matches a typical webcam FOV
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.01,
            100,
        );
        this.camera.position.set(0, 0, 0);

        // WebGL renderer with transparency so the video feed shows through
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true, // needed for PNG export
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Fingertip cursor sphere
        this.cursor = this._buildCursor();
        this.scene.add(this.cursor);

        // Ambient fill so tube meshes are not pitch-black
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));

        window.addEventListener('resize', () => this._onResize());
        this._animate();
    }

    _buildCursor() {
        const geo  = new THREE.SphereGeometry(0.025, 16, 16);
        const mat  = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 0, 1000); // hidden until hand detected
        return mesh;
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

            _animate() {
        requestAnimationFrame(() => this._animate());
        if (this.autoRotate) {
             if (!this.orbitAngle) {
                 this.orbitAngle = 0;
                 this.camera.position.set(0, 0, 0); // start here
             }
             this.orbitAngle += 0.01;
             this.camera.position.x = Math.sin(this.orbitAngle) * 3;
             this.camera.position.z = -3 + Math.cos(this.orbitAngle) * 3;
             this.camera.lookAt(0, 0, -3);
        } else {
             this.orbitAngle = 0;
        }
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Convert normalised MediaPipe coordinates (0–1, top-left origin,
     * x already compensated for mirror) to a Three.js world position.
     *
     * @param {number} nx  normalised x  [0,1]
     * @param {number} ny  normalised y  [0,1]
     * @param {number} depth  distance from camera (units)
     * @returns {THREE.Vector3}
     */
    screenToWorld(nx, ny, depth = 3) {
        // Mirror x because the video element is CSS-flipped
        const ndcX = -(nx - 0.5) * 2;
        const ndcY = -(ny - 0.5) * 2;

        const vec = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera);
        const dir = vec.sub(this.camera.position).normalize();
        return this.camera.position.clone().add(dir.multiplyScalar(depth));
    }

    /** Return a data-URL of the current canvas frame (PNG). */
    setVREnvironment(enabled) {
        if (!this.stars) {
            const geo = new THREE.BufferGeometry();
            const pts = [];
            for (let i = 0; i < 3000; i++) {
                pts.push(
                    (Math.random() - 0.5) * 100,
                    (Math.random() - 0.5) * 100,
                    (Math.random() - 0.5) * 100
                );
            }
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
            const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15 });
            this.stars = new THREE.Points(geo, mat);
        }
        
        if (enabled) {
            this.scene.add(this.stars);
            this.renderer.setClearColor(0x050510, 1.0); // solid background
        } else {
            this.scene.remove(this.stars);
            this.renderer.setClearColor(0x000000, 0); // transparent (shows webcam)
        }
    }

    /** Return a data-URL of the current canvas frame (PNG). */
    getScreenshot() {
        return this.canvas.toDataURL('image/png');
    }
}


