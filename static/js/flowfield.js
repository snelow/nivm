/**
 * Perlin / Simplex Noise Flow Field Background Simulation
 * High-performance, 60fps canvas silk flow field that dynamically harmonizes
 * with the active theme's accent color and background tone, reacting to mouse motion.
 */

import { themeState } from './state.js';
import { dom } from './dom.js';

// ── 2D/3D Simplex Noise Implementation ──
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;

const pTable = new Uint8Array(256);
for (let i = 0; i < 256; i++) pTable[i] = i;
// Deterministic shuffle
let seed = 42;
for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    const temp = pTable[i];
    pTable[i] = pTable[j];
    pTable[j] = temp;
}
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
for (let i = 0; i < 512; i++) {
    perm[i] = pTable[i & 255];
    permMod12[i] = perm[i] % 12;
}

const grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
]);

function simplex3(x, y, z) {
    let n0, n1, n2, n3;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;

    let i1, j1, k1;
    let i2, j2, k2;
    if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2.0 * G3;
    const y2 = y0 - j2 + 2.0 * G3;
    const z2 = z0 - k2 + 2.0 * G3;
    const x3 = x0 - 1.0 + 3.0 * G3;
    const y3 = y0 - 1.0 + 3.0 * G3;
    const z3 = z0 - 1.0 + 3.0 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0.0;
    else {
        const gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
        t0 *= t0;
        n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0.0;
    else {
        const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
        t1 *= t1;
        n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0.0;
    else {
        const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
        t2 *= t2;
        n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0.0;
    else {
        const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
        t3 *= t3;
        n3 = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
    }

    return 32.0 * (n0 + n1 + n2 + n3);
}

// ── Particle System & Simulation ──
class FlowParticle {
    constructor(w, h) {
        this.reset(w, h);
        // Stagger initial particle life so they don't all cycle at the same time
        this.life = Math.random() * this.maxLife;
    }

    reset(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.prevX = this.x;
        this.prevY = this.y;
        this.life = Math.random() * 200 + 80;
        this.maxLife = this.life;
        this.speedOffset = (Math.random() * 0.4 + 0.8);
        this.colorOffset = (Math.random() - 0.5) * 30; // subtle hue variance
    }

    update(w, h, zTime, mouse, speedMultiplier) {
        this.prevX = this.x;
        this.prevY = this.y;

        const noiseScale = 0.0018;
        const n = simplex3(this.x * noiseScale, this.y * noiseScale, zTime);
        const angle = n * Math.PI * 2.5;

        let vx = Math.cos(angle) * 2.0 * this.speedOffset * speedMultiplier;
        let vy = Math.sin(angle) * 2.0 * this.speedOffset * speedMultiplier;

        // Interactive mouse deflection & swirl
        if (mouse.active) {
            const dx = this.x - mouse.x;
            const dy = this.y - mouse.y;
            const distSq = dx * dx + dy * dy;
            const maxDist = 200;
            if (distSq < maxDist * maxDist && distSq > 1) {
                const dist = Math.sqrt(distSq);
                const force = (1 - dist / maxDist) * 3.5;
                // Add tangent vortex swirl around mouse
                const swirlAngle = Math.atan2(dy, dx) + Math.PI * 0.55;
                vx += Math.cos(swirlAngle) * force;
                vy += Math.sin(swirlAngle) * force;
            }
        }

        this.x += vx;
        this.y += vy;
        this.life--;

        // Screen boundary or life expiry
        if (this.life <= 0 || this.x < -10 || this.x > w + 10 || this.y < -10 || this.y > h + 10) {
            this.reset(w, h);
        }
    }
}

let flowAnimationId = null;
let particles = [];
let zOff = 0;
let frameCount = 0;
let mouse = { x: -1000, y: -1000, active: false, lastMove: 0 };

function hexToRgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return `rgba(255, 255, 255, ${alpha})`;
    let r = 255, g = 255, b = 255;
    if (hex.length === 7) {
        r = parseInt(hex.slice(1, 3), 16) || 0;
        g = parseInt(hex.slice(3, 5), 16) || 0;
        b = parseInt(hex.slice(5, 7), 16) || 0;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function setupFlowFieldCanvas() {
    const canvas = dom.flowFieldBgCanvas;
    if (!canvas) return;
    // Use opaque 2D context to avoid alpha buffer compositing lag and grey ghosting
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function clearSolid() {
        ctx.fillStyle = themeState.bgTone || '#09090b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Instantly paint solid background to avoid transparent buffer grey flashes
        clearSolid();
        initParticles();
    }

    function initParticles() {
        const targetCount = Math.min(800, themeState.flowDensity || 450);
        particles = [];
        for (let i = 0; i < targetCount; i++) {
            particles.push(new FlowParticle(canvas.width, canvas.height));
        }

        // Pre-simulate particles for 35 steps along the Simplex field
        // so they are already naturally aligned with flow vectors at frame 0,
        // completely eliminating the initial random scatter ("grey shadow trail").
        const speedMultiplier = themeState.flowSpeed !== undefined ? themeState.flowSpeed : 1.2;
        for (let step = 0; step < 35; step++) {
            zOff += 0.0018 * speedMultiplier;
            for (let i = 0; i < particles.length; i++) {
                particles[i].update(canvas.width, canvas.height, zOff, { active: false }, speedMultiplier);
            }
        }
    }

    window.addEventListener('resize', resize);
    window.resizeFlowFieldCanvas = resize;
    window.clearFlowFieldCanvas = clearSolid;
    resize();

    // Mouse tracking
    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
        mouse.lastMove = performance.now();
    });

    window.addEventListener('mouseleave', () => {
        mouse.active = false;
    });

    function draw() {
        if (themeState.bgMotion !== 'flowfield') {
            if (flowAnimationId) {
                cancelAnimationFrame(flowAnimationId);
                flowAnimationId = null;
            }
            return;
        }

        const w = canvas.width;
        const h = canvas.height;

        // Auto deactivate mouse if idle for > 2 seconds
        if (mouse.active && performance.now() - mouse.lastMove > 2000) {
            mouse.active = false;
        }

        // Fading trail effect: ensure decay is high enough (>= 0.07) so trails dissolve cleanly into background
        // rather than leaving an accumulated web of dark grey scribbles
        const trailFade = Math.max(0.07, themeState.flowTrail !== undefined ? themeState.flowTrail : 0.09);
        ctx.fillStyle = hexToRgba(themeState.bgTone || '#09090b', trailFade);
        ctx.fillRect(0, 0, w, h);

        frameCount++;
        // Periodic wash to eliminate any sub-threshold 8-bit integer truncation residue
        if (frameCount % 100 === 0) {
            ctx.fillStyle = hexToRgba(themeState.bgTone || '#09090b', 0.22);
            ctx.fillRect(0, 0, w, h);
        }

        const speedMultiplier = themeState.flowSpeed !== undefined ? themeState.flowSpeed : 1.2;
        zOff += 0.0018 * speedMultiplier;

        const accent = themeState.accentColor || '#f4f4f5';
        ctx.lineWidth = 1.6;

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.update(w, h, zOff, mouse, speedMultiplier);

            const lifeRatio = p.life / p.maxLife;
            // Smooth sine fade from 0 -> peak -> 0 opacity so particles never abruptly pop in/out
            const alpha = Math.sin(lifeRatio * Math.PI) * 0.7;
            if (alpha <= 0.02) continue;

            ctx.beginPath();
            ctx.moveTo(p.prevX, p.prevY);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = hexToRgba(accent, alpha);
            ctx.stroke();
        }

        flowAnimationId = requestAnimationFrame(draw);
    }

    window.startFlowFieldAnimation = function () {
        clearSolid();
        if (!flowAnimationId) {
            draw();
        }
    };
}
