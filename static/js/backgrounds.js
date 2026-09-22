import { themeState } from './state.js';
import { dom } from './dom.js';
import { setupFlowFieldCanvas } from './flowfield.js';
export { setupFlowFieldCanvas };

let nodesAnimationId = null;
let nodesArray = [];
let matrixAnimationId = null;
let circuitsAnimationId = null;
let hexAnimationId = null;
let auroraAnimationId = null;

// Parse hex color string to RGB object
function hexToRgb(hex) {
    let r = 0, g = 0, b = 0;
    if (!hex) return { r: 168, g: 85, b: 247, str: '168, 85, 247' };
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
    }
    return { r, g, b, str: `${r}, ${g}, ${b}` };
}

// Connecting nodes canvas animation
export function setupNodesCanvas() {
    if (!dom.nodesBgCanvas) return;
    const ctx = dom.nodesBgCanvas.getContext('2d');

    function resizeCanvas() {
        dom.nodesBgCanvas.width = window.innerWidth;
        dom.nodesBgCanvas.height = window.innerHeight;
        initNodes();
    }

    window.addEventListener('resize', resizeCanvas);
    window.resizeNodesCanvas = resizeCanvas;
    resizeCanvas();

    function initNodes() {
        nodesArray = [];
        const count = Math.floor((dom.nodesBgCanvas.width * dom.nodesBgCanvas.height) / (themeState.nodesDensity || 25000));
        for (let i = 0; i < count; i++) {
            nodesArray.push({
                x: Math.random() * dom.nodesBgCanvas.width,
                y: Math.random() * dom.nodesBgCanvas.height,
                vx: (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8,
                radius: Math.random() * 2 + 1
            });
        }
    }

    function drawNodes() {
        if (themeState.bgMotion !== 'nodes') {
            if (nodesAnimationId) {
                cancelAnimationFrame(nodesAnimationId);
                nodesAnimationId = null;
            }
            return;
        }

        ctx.clearRect(0, 0, dom.nodesBgCanvas.width, dom.nodesBgCanvas.height);
        const accentHex = themeState.accentColor || '#f4f4f5';

        for (let i = 0; i < nodesArray.length; i++) {
            const node = nodesArray[i];
            node.x += node.vx;
            node.y += node.vy;

            if (node.x < 0 || node.x > dom.nodesBgCanvas.width) node.vx *= -1;
            if (node.y < 0 || node.y > dom.nodesBgCanvas.height) node.vy *= -1;

            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = accentHex;
            ctx.fill();

            for (let j = i + 1; j < nodesArray.length; j++) {
                const node2 = nodesArray[j];
                const dx = node.x - node2.x;
                const dy = node.y - node2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxDist = themeState.nodesDistance || 130;

                if (dist < maxDist) {
                    ctx.beginPath();
                    ctx.moveTo(node.x, node.y);
                    ctx.lineTo(node2.x, node2.y);
                    ctx.strokeStyle = accentHex;
                    ctx.globalAlpha = (1 - dist / maxDist) * 0.8;
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            }
        }

        nodesAnimationId = requestAnimationFrame(drawNodes);
    }

    window.startNodesAnimation = function() {
        if (!nodesAnimationId) {
            drawNodes();
        }
    };
}

// Matrix digital rain canvas animation
export function setupMatrixCanvas() {
    if (!dom.matrixBgCanvas) return;
    const ctx = dom.matrixBgCanvas.getContext('2d');
    
    let width, height;
    const fontSize = 16;
    let columns = [];
    let drops = [];
    const chars = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレゲゼデベペオォコソトノホモヨョロゴゾドボポヴッン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    function resizeCanvas() {
        width = dom.matrixBgCanvas.width = window.innerWidth;
        height = dom.matrixBgCanvas.height = window.innerHeight;
        columns = Math.floor(width / fontSize) + 1;
        drops = [];
        for (let x = 0; x < columns; x++) {
            drops[x] = 1;
        }
        ctx.fillStyle = themeState.bgTone || '#09090b';
        ctx.fillRect(0, 0, width, height);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    let lastDrawTime = 0;
    const drawMatrixLoop = (timestamp) => {
        if (themeState.bgMotion !== 'matrix') {
            if (matrixAnimationId) {
                cancelAnimationFrame(matrixAnimationId);
                matrixAnimationId = null;
            }
            return;
        }

        const speed = themeState.matrixSpeed || 45;
        if (timestamp - lastDrawTime < speed) {
            matrixAnimationId = requestAnimationFrame(drawMatrixLoop);
            return;
        }
        lastDrawTime = timestamp;

        const accentHex = themeState.accentColor || '#f4f4f5';
        const bgRgb = hexToRgb(themeState.bgTone || '#09090b');

        const fade = themeState.matrixFade || 0.05;
        ctx.fillStyle = `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${fade})`;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = accentHex;
        ctx.font = fontSize + 'px "Fira Code", monospace';

        for (let i = 0; i < drops.length; i++) {
            const text = chars.charAt(Math.floor(Math.random() * chars.length));
            ctx.fillText(text, i * fontSize, drops[i] * fontSize);

            if (drops[i] * fontSize > height && Math.random() > 0.975) {
                drops[i] = 0;
            }
            drops[i]++;
        }

        matrixAnimationId = requestAnimationFrame(drawMatrixLoop);
    };

    window.startMatrixAnimation = function() {
        if (!matrixAnimationId) {
            ctx.fillStyle = themeState.bgTone || '#09090b';
            ctx.fillRect(0, 0, width, height);
            matrixAnimationId = requestAnimationFrame(drawMatrixLoop);
        }
    };
}

// WebGL fluid simulation settings bridge
export function setupFluidCanvas() {
    const updateFluidTheme = () => {
        if (window.fluidConfig) {
            const bgRgb = hexToRgb(themeState.bgTone || '#09090b');
            window.fluidConfig.BACK_COLOR = { r: bgRgb.r, g: bgRgb.g, b: bgRgb.b };
            if (themeState.fluidRadius !== undefined) window.fluidConfig.SPLAT_RADIUS = themeState.fluidRadius;
            if (themeState.fluidCurl !== undefined) window.fluidConfig.CURL = themeState.fluidCurl;
            if (themeState.fluidBloom !== undefined) window.fluidConfig.BLOOM_INTENSITY = themeState.fluidBloom;
        }
    };
    updateFluidTheme();
    window.startFluidAnimation = function() {
        updateFluidTheme();
    };
}

// Circuit traces simulation with multi-lane buses and IC packages
export function setupCircuitsCanvas() {
    if (!dom.circuitsBgCanvas) return;
    const ctx = dom.circuitsBgCanvas.getContext('2d');
    let width, height;
    let chips = [];
    let buses = [];
    let packets = [];
    let pulseRings = [];

    window.addEventListener('mousemove', (e) => {
        if (themeState.bgMotion === 'circuits' && Math.random() < 0.25) {
            spawnMousePacket(e.clientX, e.clientY);
        }
    });

    function resizeCanvas() {
        width = dom.circuitsBgCanvas.width = window.innerWidth;
        height = dom.circuitsBgCanvas.height = window.innerHeight;
        initBoard();
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function initBoard() {
        chips = [];
        buses = [];
        packets = [];
        pulseRings = [];

        const chipConfigs = [
            { w: 110, h: 80 },
            { w: 85, h: 65 },
            { w: 95, h: 70 },
            { w: 80, h: 55 }
        ];

        const padding = 120;
        const availableWidth = Math.max(300, width - padding * 2);
        const availableHeight = Math.max(300, height - padding * 2);

        chipConfigs.forEach((cfg, idx) => {
            const cols = 2;
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            const cx = padding + (col + 0.5) * (availableWidth / cols) + (Math.random() - 0.5) * 80;
            const cy = padding + (row + 0.5) * (availableHeight / 2) + (Math.random() - 0.5) * 80;

            chips.push({
                x: cx - cfg.w / 2,
                y: cy - cfg.h / 2,
                w: cfg.w,
                h: cfg.h
            });
        });

        chips.forEach((chip) => {
            const directions = ['right', 'down', 'left', 'up'];
            directions.forEach((dir) => {
                if (Math.random() > 0.6) return;

                const lanes = Math.floor(Math.random() * 3) + 2;
                const laneSpacing = 8;
                let startX, startY;

                if (dir === 'right') { startX = chip.x + chip.w; startY = chip.y + chip.h * 0.35; }
                else if (dir === 'left') { startX = chip.x; startY = chip.y + chip.h * 0.35; }
                else if (dir === 'down') { startX = chip.x + chip.w * 0.35; startY = chip.y + chip.h; }
                else { startX = chip.x + chip.w * 0.35; startY = chip.y; }

                const busLength = 120 + Math.random() * 180;
                const turnAngle = Math.random() > 0.5 ? 45 : -45;

                for (let l = 0; l < lanes; l++) {
                    const offset = l * laneSpacing;
                    const pts = [];

                    let x = startX + (dir === 'down' || dir === 'up' ? offset : 0);
                    let y = startY + (dir === 'right' || dir === 'left' ? offset : 0);
                    pts.push({ x, y });

                    if (dir === 'right') x += busLength * 0.5;
                    else if (dir === 'left') x -= busLength * 0.5;
                    else if (dir === 'down') y += busLength * 0.5;
                    else y -= busLength * 0.5;
                    pts.push({ x, y });

                    const diag = 60 + Math.random() * 60;
                    if (dir === 'right' || dir === 'left') {
                        x += dir === 'right' ? diag : -diag;
                        y += turnAngle > 0 ? diag : -diag;
                    } else {
                        y += dir === 'down' ? diag : -diag;
                        x += turnAngle > 0 ? diag : -diag;
                    }
                    pts.push({ x, y });

                    if (dir === 'right') x += 80;
                    else if (dir === 'left') x -= 80;
                    else if (dir === 'down') y += 80;
                    else y -= 80;
                    pts.push({ x, y });

                    const busIndex = buses.length;
                    buses.push({
                        points: pts,
                        viaEnd: { x, y }
                    });

                    packets.push({
                        busIndex,
                        progress: Math.random(),
                        speed: 0.003 + Math.random() * 0.0035,
                        size: 3,
                        laneOffset: l
                    });
                }
            });
        });

        const numExtra = Math.floor((width * height) / 36000);
        for (let e = 0; e < numExtra; e++) {
            let x = Math.floor(Math.random() * (width / 40)) * 40;
            let y = Math.floor(Math.random() * (height / 40)) * 40;
            const pts = [{ x, y }];
            const segs = Math.floor(Math.random() * 3) + 2;

            for (let s = 0; s < segs; s++) {
                const angle = Math.floor(Math.random() * 4);
                const stepLen = (Math.floor(Math.random() * 3) + 2) * 32;
                if (angle === 0) x += stepLen;
                else if (angle === 1) y += stepLen;
                else if (angle === 2) { x += stepLen; y += stepLen; }
                else { x += stepLen; y -= stepLen; }
                pts.push({ x, y });
            }

            const busIndex = buses.length;
            buses.push({
                points: pts,
                viaEnd: { x, y }
            });

            packets.push({
                busIndex,
                progress: Math.random(),
                speed: 0.0025 + Math.random() * 0.003,
                size: 2.5
            });
        }
    }

    function spawnMousePacket(mx, my) {
        if (buses.length === 0) return;
        let closestBus = 0;
        let minDist = 999999;
        for (let i = 0; i < buses.length; i++) {
            const pt = buses[i].points[0];
            const dist = (pt.x - mx) ** 2 + (pt.y - my) ** 2;
            if (dist < minDist) {
                minDist = dist;
                closestBus = i;
            }
        }
        if (minDist < 60000) {
            packets.push({
                busIndex: closestBus,
                progress: 0,
                speed: 0.007,
                size: 4,
                isBurst: true
            });
        }
    }

    function getPointOnBus(points, t) {
        if (!points || points.length < 2) return { x: 0, y: 0 };
        const totalSegments = points.length - 1;
        const scaledT = Math.max(0, Math.min(0.9999, t)) * totalSegments;
        const segIndex = Math.floor(scaledT);
        const segT = scaledT - segIndex;
        const p1 = points[segIndex];
        const p2 = points[segIndex + 1];
        return {
            x: p1.x + (p2.x - p1.x) * segT,
            y: p1.y + (p2.y - p1.y) * segT
        };
    }

    function drawCircuits() {
        if (themeState.bgMotion !== 'circuits') {
            if (circuitsAnimationId) {
                cancelAnimationFrame(circuitsAnimationId);
                circuitsAnimationId = null;
            }
            return;
        }

        ctx.clearRect(0, 0, width, height);

        const accentRgb = hexToRgb(themeState.accentColor || '#f4f4f5');
        const brandRgb = hexToRgb(themeState.brandColor || '#a855f7');
        const speedMult = themeState.circuitSpeed || 1.2;

        chips.forEach((c) => {
            ctx.fillStyle = 'rgba(8, 8, 12, 0.75)';
            ctx.fillRect(c.x, c.y, c.w, c.h);

            ctx.strokeStyle = `rgba(${brandRgb.str}, 0.28)`;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(c.x, c.y, c.w, c.h);

            ctx.beginPath();
            ctx.arc(c.x + 8, c.y + 8, 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${accentRgb.str}, 0.4)`;
            ctx.fill();

            ctx.strokeStyle = `rgba(${brandRgb.str}, 0.16)`;
            ctx.lineWidth = 1;
            ctx.strokeRect(c.x + 8, c.y + 8, c.w - 16, c.h - 16);
            ctx.strokeRect(c.x + c.w / 2 - 8, c.y + c.h / 2 - 8, 16, 16);

            ctx.fillStyle = `rgba(${brandRgb.str}, 0.4)`;
            for (let px = c.x + 12; px < c.x + c.w - 10; px += 10) {
                ctx.fillRect(px, c.y - 3, 5, 3);
                ctx.fillRect(px, c.y + c.h, 5, 3);
            }
            for (let py = c.y + 12; py < c.y + c.h - 10; py += 10) {
                ctx.fillRect(c.x - 3, py, 3, 5);
                ctx.fillRect(c.x + c.w, py, 3, 5);
            }
        });

        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(${brandRgb.str}, 0.14)`;
        for (let i = 0; i < buses.length; i++) {
            const pts = buses[i].points;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let j = 1; j < pts.length; j++) {
                ctx.lineTo(pts[j].x, pts[j].y);
            }
            ctx.stroke();

            const v = buses[i].viaEnd;
            ctx.beginPath();
            ctx.arc(v.x, v.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${brandRgb.str}, 0.35)`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(v.x, v.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fill();
        }

        for (let i = 0; i < packets.length; i++) {
            const p = packets[i];
            const bus = buses[p.busIndex];
            if (!bus) continue;

            p.progress += p.speed * speedMult;
            if (p.progress > 1) {
                p.progress = 0;
                if (pulseRings.length < 24) {
                    pulseRings.push({
                        x: bus.viaEnd.x,
                        y: bus.viaEnd.y,
                        radius: 3,
                        alpha: 0.85
                    });
                }
            }

            const currentPos = getPointOnBus(bus.points, p.progress);
            const prevPos = getPointOnBus(bus.points, Math.max(0, p.progress - 0.08));

            const grad = ctx.createLinearGradient(prevPos.x, prevPos.y, currentPos.x, currentPos.y);
            grad.addColorStop(0, `rgba(${accentRgb.str}, 0)`);
            grad.addColorStop(1, `rgba(${accentRgb.str}, 0.95)`);

            ctx.beginPath();
            ctx.moveTo(prevPos.x, prevPos.y);
            ctx.lineTo(currentPos.x, currentPos.y);
            ctx.strokeStyle = grad;
            ctx.lineWidth = p.size;
            ctx.lineCap = 'round';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(currentPos.x, currentPos.y, p.size * 1.3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${accentRgb.str}, 1.0)`;
            ctx.shadowColor = `rgba(${accentRgb.str}, 0.95)`;
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        packets = packets.filter((p) => !p.isBurst || p.progress < 0.98);

        for (let r = pulseRings.length - 1; r >= 0; r--) {
            const ring = pulseRings[r];
            ring.radius += 1.2 * speedMult;
            ring.alpha -= 0.035 * speedMult;

            if (ring.alpha <= 0 || ring.radius > 24) {
                pulseRings.splice(r, 1);
                continue;
            }

            ctx.beginPath();
            ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${accentRgb.str}, ${ring.alpha})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }

        circuitsAnimationId = requestAnimationFrame(drawCircuits);
    }

    window.startCircuitsAnimation = function() {
        if (!circuitsAnimationId) {
            drawCircuits();
        }
    };
}

// Cyber hex grid animation with mouse reactivity
export function setupHexCanvas() {
    if (!dom.hexBgCanvas) return;
    const ctx = dom.hexBgCanvas.getContext('2d');
    let width, height;
    let hexes = [];
    let mouse = { x: -1000, y: -1000 };
    let step = 0;

    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });

    function resizeCanvas() {
        width = dom.hexBgCanvas.width = window.innerWidth;
        height = dom.hexBgCanvas.height = window.innerHeight;
        initHexGrid();
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function initHexGrid() {
        hexes = [];
        const R = 34;
        const W = R * Math.sqrt(3);
        const H = R * 1.5;

        const cols = Math.ceil(width / W) + 2;
        const rows = Math.ceil(height / H) + 2;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = c * W + (r % 2 === 1 ? W / 2 : 0);
                const cy = r * H;
                hexes.push({
                    cx,
                    cy,
                    R,
                    glowAlpha: 0,
                    phase: (cx + cy) * 0.003
                });
            }
        }
    }

    function drawHexPath(cx, cy, r) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
    }

    function drawHex() {
        if (themeState.bgMotion !== 'hexgrid') {
            if (hexAnimationId) {
                cancelAnimationFrame(hexAnimationId);
                hexAnimationId = null;
            }
            return;
        }

        ctx.clearRect(0, 0, width, height);

        const accentRgb = hexToRgb(themeState.accentColor || '#f4f4f5');
        const brandRgb = hexToRgb(themeState.brandColor || '#a855f7');
        const speed = (themeState.hexSpeed || 1.0) * 0.03;
        step += speed;

        if (Math.random() < 0.04 * (themeState.hexSpeed || 1.0) && hexes.length > 0) {
            const randHex = hexes[Math.floor(Math.random() * hexes.length)];
            if (randHex.glowAlpha < 0.2) {
                randHex.glowAlpha = 0.85;
            }
        }

        ctx.lineWidth = 1;

        for (let i = 0; i < hexes.length; i++) {
            const h = hexes[i];
            const waveShimmer = 0.04 + 0.03 * Math.sin(h.phase + step);

            const dx = h.cx - mouse.x;
            const dy = h.cy - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            let mouseInfluence = 0;
            if (dist < 140) {
                mouseInfluence = (1 - dist / 140) * 0.7;
            }

            if (h.glowAlpha > 0) {
                h.glowAlpha = Math.max(0, h.glowAlpha - 0.015);
            }

            const totalAlpha = Math.min(1.0, waveShimmer + mouseInfluence + h.glowAlpha);

            drawHexPath(h.cx, h.cy, h.R - 1);
            ctx.strokeStyle = `rgba(${brandRgb.str}, ${totalAlpha * 0.8})`;
            ctx.stroke();

            if (mouseInfluence > 0.05 || h.glowAlpha > 0.1) {
                const fillAlpha = Math.max(mouseInfluence, h.glowAlpha);
                const grad = ctx.createRadialGradient(h.cx, h.cy, 0, h.cx, h.cy, h.R);
                grad.addColorStop(0, `rgba(${accentRgb.str}, ${fillAlpha * 0.35})`);
                grad.addColorStop(0.7, `rgba(${brandRgb.str}, ${fillAlpha * 0.15})`);
                grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = grad;
                ctx.fill();
            }
        }

        hexAnimationId = requestAnimationFrame(drawHex);
    }

    window.startHexAnimation = function() {
        if (!hexAnimationId) {
            drawHex();
        }
    };
}

// Aurora wave curtains animation
export function setupAuroraCanvas() {
    if (!dom.auroraBgCanvas) return;
    const ctx = dom.auroraBgCanvas.getContext('2d');
    let width, height;
    let step = 0;

    function resizeCanvas() {
        width = dom.auroraBgCanvas.width = window.innerWidth;
        height = dom.auroraBgCanvas.height = window.innerHeight;
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function drawAurora() {
        if (themeState.bgMotion !== 'aurora') {
            if (auroraAnimationId) {
                cancelAnimationFrame(auroraAnimationId);
                auroraAnimationId = null;
            }
            return;
        }

        ctx.clearRect(0, 0, width, height);

        const accentRgb = hexToRgb(themeState.accentColor || '#f4f4f5');
        const brandRgb = hexToRgb(themeState.brandColor || '#a855f7');
        const speed = (themeState.auroraSpeed || 1.0) * 0.008;
        step += speed;

        const waves = [
            { amp: 65, freq: 0.0016, phaseOffset: 0, yBase: height * 0.52, rgb: brandRgb, alpha: 0.16 },
            { amp: 55, freq: 0.0022, phaseOffset: 2.1, yBase: height * 0.60, rgb: accentRgb, alpha: 0.13 },
            { amp: 75, freq: 0.0013, phaseOffset: 4.2, yBase: height * 0.68, rgb: brandRgb, alpha: 0.15 }
        ];

        ctx.globalCompositeOperation = 'screen';

        for (let w = 0; w < waves.length; w++) {
            const wave = waves[w];
            
            ctx.beginPath();
            ctx.moveTo(0, height);

            for (let x = 0; x <= width; x += 12) {
                const y1 = Math.sin(x * wave.freq + step + wave.phaseOffset) * wave.amp;
                const y2 = Math.cos(x * wave.freq * 0.5 + step * 0.8) * (wave.amp * 0.4);
                const y = wave.yBase + y1 + y2;
                ctx.lineTo(x, y);
            }

            ctx.lineTo(width, height);
            ctx.closePath();

            const grad = ctx.createLinearGradient(0, wave.yBase - wave.amp, 0, height);
            grad.addColorStop(0, `rgba(${wave.rgb.str}, 0)`);
            grad.addColorStop(0.18, `rgba(${wave.rgb.str}, ${wave.alpha})`);
            grad.addColorStop(0.55, `rgba(${wave.rgb.str}, ${wave.alpha * 0.8})`);
            grad.addColorStop(1, `rgba(${wave.rgb.str}, ${wave.alpha * 0.65})`);

            ctx.fillStyle = grad;
            ctx.fill();

            ctx.beginPath();
            for (let x = 0; x <= width; x += 12) {
                const y1 = Math.sin(x * wave.freq + step + wave.phaseOffset) * wave.amp;
                const y2 = Math.cos(x * wave.freq * 0.5 + step * 0.8) * (wave.amp * 0.4);
                const y = wave.yBase + y1 + y2;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = `rgba(${wave.rgb.str}, ${wave.alpha * 1.4})`;
            ctx.lineWidth = 1.8;
            ctx.stroke();
        }

        ctx.globalCompositeOperation = 'source-over';

        auroraAnimationId = requestAnimationFrame(drawAurora);
    }

    window.startAuroraAnimation = function() {
        if (!auroraAnimationId) {
            drawAurora();
        }
    };
}
