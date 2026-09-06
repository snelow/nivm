import { themeState, saveThemeConfig as baseSaveThemeConfig } from './state.js';
import { dom } from './dom.js';
import { setupFlowFieldCanvas } from './flowfield.js';
export { setupFlowFieldCanvas };

let nodesAnimationId = null;
let nodesArray = [];
let matrixAnimationId = null;

let currentAccentHue = 0;
let currentBgHue = 0;
let cyclingAnimationFrame = null;

// Connecting Nodes Canvas Animation Loop
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

// Matrix Digital Rain Canvas Animation Loop
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

        const fade = themeState.matrixFade || 0.05;
        ctx.fillStyle = `rgba(0, 0, 0, ${fade})`;
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
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);
            matrixAnimationId = requestAnimationFrame(drawMatrixLoop);
        }
    };
}

// WebGL Fluid Simulation Engine
export function setupFluidCanvas() {
    window.startFluidAnimation = function() {};
}

function hexToRgb(hex) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
    }
    return {r, g, b, str: `${r}, ${g}, ${b}`};
}

function getLuminance(r, g, b) {
    let a = [r, g, b].map(function (v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHue(hex) {
    if (!hex || typeof hex !== 'string') return 275;
    const { r, g, b } = hexToRgb(hex);
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    if (d < 0.05) return 275; // for neutral/grey colors like #f4f4f5, start with vivid purple
    let h = 0;
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    return h;
}

let lastPickerUpdate = 0;
let lastCycleTime = 0;

export function stopColorCycleLoop() {
    if (cyclingAnimationFrame) {
        cancelAnimationFrame(cyclingAnimationFrame);
        cyclingAnimationFrame = null;
    }
    lastCycleTime = 0;
    document.body.classList.remove('theme-cycling');
}

export function colorCycleLoop() {
    if (!themeState.cycleAccent && !themeState.cycleBg) {
        stopColorCycleLoop();
        return;
    }

    if (cyclingAnimationFrame) {
        cancelAnimationFrame(cyclingAnimationFrame);
        cyclingAnimationFrame = null;
    }

    document.body.classList.add('theme-cycling');

    if (!currentAccentHue && themeState.accentColor) {
        currentAccentHue = hexToHue(themeState.accentColor);
    }
    if (!currentBgHue && themeState.bgTone) {
        currentBgHue = hexToHue(themeState.bgTone);
    }

    if (themeState.bgMotion === 'flowfield' && window.clearFlowFieldCanvas) {
        window.clearFlowFieldCanvas();
    }

    lastCycleTime = performance.now();
    cyclingAnimationFrame = requestAnimationFrame(colorCycleStep);
}

function colorCycleStep(timestamp) {
    if (!themeState.cycleAccent && !themeState.cycleBg) {
        stopColorCycleLoop();
        return;
    }

    if (!lastCycleTime) lastCycleTime = timestamp;
    const dt = Math.min((timestamp - lastCycleTime) / 1000, 0.1);
    lastCycleTime = timestamp;

    const speed = ((themeState.cycleSpeed || 50) / 100) * 80 + 15; // deg per sec

    if (themeState.cycleAccent) {
        currentAccentHue = (currentAccentHue + speed * dt) % 360;
        themeState.accentColor = hslToHex(currentAccentHue, 80, 65);
        document.documentElement.style.setProperty('--text-primary', themeState.accentColor);
        document.documentElement.style.setProperty('--theme-heart-color', themeState.accentColor);
    }

    if (themeState.cycleBg) {
        currentBgHue = (currentBgHue + (speed * 0.4) * dt) % 360;
        themeState.bgTone = hslToHex(currentBgHue, 50, 10);
        document.documentElement.style.setProperty('--bg-black', themeState.bgTone);

        const bgRgb = hexToRgb(themeState.bgTone);
        const luminance = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
        if (luminance > 0.5) {
            document.documentElement.style.setProperty('--text-secondary', '#334155');
            document.documentElement.style.setProperty('--text-muted', '#64748b');
            document.documentElement.style.setProperty('--glass-border', 'rgba(0, 0, 0, 0.1)');
        } else {
            document.documentElement.style.setProperty('--text-secondary', '#94a3b8');
            document.documentElement.style.setProperty('--text-muted', '#64748b');
            document.documentElement.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.06)');
        }
    }

    // Throttle color picker DOM updates to at most 4x/sec and ONLY if theme window is visible
    if (timestamp - lastPickerUpdate > 250) {
        lastPickerUpdate = timestamp;
        if (dom.themeWindow && dom.themeWindow.style.display !== 'none') {
            if (themeState.cycleAccent && dom.accentColorPicker) dom.accentColorPicker.value = themeState.accentColor;
            if (themeState.cycleBg && dom.bgTonePicker) dom.bgTonePicker.value = themeState.bgTone;
        }
    }

    cyclingAnimationFrame = requestAnimationFrame(colorCycleStep);
}

export function applyThemeState() {
    const isValidHex = (hex) => typeof hex === 'string' && hex.startsWith('#') && hex.length === 7 && !hex.includes('NaN');
    
    if (!themeState.bgMotion) themeState.bgMotion = 'none';
    if (!isValidHex(themeState.bgTone)) themeState.bgTone = '#09090b';
    if (!isValidHex(themeState.sidebarTone)) themeState.sidebarTone = '#121215';
    if (!isValidHex(themeState.accentColor)) themeState.accentColor = '#f4f4f5';
    if (themeState.cycleAccent === undefined) themeState.cycleAccent = false;
    if (themeState.cycleBg === undefined) themeState.cycleBg = false;
    if (themeState.cycleSpeed === undefined) themeState.cycleSpeed = 50;
    if (themeState.chatWidth === undefined) themeState.chatWidth = 'default';
    if (themeState.fontSize === undefined) themeState.fontSize = 15;
    
    if (themeState.fluidRadius === undefined) themeState.fluidRadius = 0.25;
    if (themeState.fluidCurl === undefined) themeState.fluidCurl = 30;
    if (themeState.fluidBloom === undefined) themeState.fluidBloom = 0.8;
    
    if (themeState.nodesDensity === undefined) themeState.nodesDensity = 25000;
    if (themeState.nodesDistance === undefined) themeState.nodesDistance = 130;
    if (themeState.matrixSpeed === undefined) themeState.matrixSpeed = 45;
    if (themeState.matrixFade === undefined) themeState.matrixFade = 0.05;
    if (themeState.flowSpeed === undefined) themeState.flowSpeed = 1.2;
    if (themeState.flowTrail === undefined || themeState.flowTrail === 0.04) themeState.flowTrail = 0.09;
    if (themeState.flowDensity === undefined || themeState.flowDensity === 1500) themeState.flowDensity = 450;

    if (dom.nodesBgCanvas) {
        dom.nodesBgCanvas.classList.toggle('active', themeState.bgMotion === 'nodes');
        if (themeState.bgMotion === 'nodes' && window.startNodesAnimation) window.startNodesAnimation();
    }
    if (dom.orbsBgLayer) dom.orbsBgLayer.classList.toggle('active', themeState.bgMotion === 'orbs');
    if (dom.sparklesBgLayer) dom.sparklesBgLayer.classList.toggle('active', themeState.bgMotion === 'sparkles');
    if (dom.rainBgLayer) dom.rainBgLayer.classList.toggle('active', themeState.bgMotion === 'rain');
    if (dom.jellyfishBgLayer) dom.jellyfishBgLayer.classList.toggle('active', themeState.bgMotion === 'jellyfish');
    if (dom.matrixBgCanvas) {
        dom.matrixBgCanvas.classList.toggle('active', themeState.bgMotion === 'matrix');
        if (themeState.bgMotion === 'matrix' && window.startMatrixAnimation) window.startMatrixAnimation();
    }
    if (dom.fluidBgCanvas) {
        dom.fluidBgCanvas.classList.toggle('active', themeState.bgMotion === 'fluid');
        if (themeState.bgMotion === 'fluid' && window.startFluidAnimation) window.startFluidAnimation();
    }
    if (dom.flowFieldBgCanvas) {
        dom.flowFieldBgCanvas.classList.toggle('active', themeState.bgMotion === 'flowfield');
        if (themeState.bgMotion === 'flowfield' && window.startFlowFieldAnimation) window.startFlowFieldAnimation();
    }

    if (dom.animationSettingsPanel) {
        const motion = themeState.bgMotion;
        const hasSettings = ['fluid', 'nodes', 'matrix', 'flowfield'].includes(motion);
        dom.animationSettingsPanel.style.display = hasSettings ? 'block' : 'none';
        
        if (dom.flowFieldSettings) dom.flowFieldSettings.style.display = motion === 'flowfield' ? 'block' : 'none';
        if (dom.fluidSettings) dom.fluidSettings.style.display = motion === 'fluid' ? 'block' : 'none';
        if (dom.nodesSettings) dom.nodesSettings.style.display = motion === 'nodes' ? 'block' : 'none';
        if (dom.matrixSettings) dom.matrixSettings.style.display = motion === 'matrix' ? 'block' : 'none';
    }

    document.querySelectorAll('.bg-motion-card').forEach(card => {
        if (card.getAttribute('data-motion') === themeState.bgMotion) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });

    if (dom.bgTonePicker) dom.bgTonePicker.value = themeState.bgTone;
    if (dom.sidebarTonePicker) dom.sidebarTonePicker.value = themeState.sidebarTone;
    if (dom.accentColorPicker) dom.accentColorPicker.value = themeState.accentColor;

    document.documentElement.style.setProperty('--bg-black', themeState.bgTone);
    document.documentElement.style.setProperty('--bg-surface', themeState.sidebarTone);
    document.documentElement.style.setProperty('--text-primary', themeState.accentColor);
    document.documentElement.style.setProperty('--font-size-base', `${themeState.fontSize}px`);
    let maxWidthStr = themeState.chatWidth === 'full' ? '100%' : '800px';
    document.documentElement.style.setProperty('--chat-max-width', maxWidthStr);
    
    document.querySelectorAll('button[data-width]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-width') === themeState.chatWidth);
    });
    if (dom.fontSizeSlider) {
        dom.fontSizeSlider.value = themeState.fontSize;
        if (dom.fontSizeVal) dom.fontSizeVal.innerText = `${themeState.fontSize}px`;
    }
    
    const sidebarRgb = hexToRgb(themeState.sidebarTone);
    document.documentElement.style.setProperty('--bg-surface-rgb', sidebarRgb.str);

    const bgRgb = hexToRgb(themeState.bgTone);
    const luminance = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
    
    if (luminance > 0.5) {
        document.documentElement.style.setProperty('--text-secondary', '#334155');
        document.documentElement.style.setProperty('--text-muted', '#64748b');
        document.documentElement.style.setProperty('--glass-border', 'rgba(0, 0, 0, 0.1)');
    } else {
        document.documentElement.style.setProperty('--text-secondary', '#94a3b8');
        document.documentElement.style.setProperty('--text-muted', '#64748b');
        document.documentElement.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.06)');
    }

    const heartColor = (themeState.accentColor && themeState.accentColor !== '#f4f4f5') 
        ? themeState.accentColor 
        : (luminance > 0.5 ? '#9333ea' : '#a855f7');
    document.documentElement.style.setProperty('--theme-heart-color', heartColor);

    if (dom.cycleAccentToggle) dom.cycleAccentToggle.checked = themeState.cycleAccent || false;
    if (dom.cycleBgToggle) dom.cycleBgToggle.checked = themeState.cycleBg || false;
    if (dom.clearTextToggle) dom.clearTextToggle.checked = themeState.clearText || false;
    document.body.classList.toggle('clear-text-active', !!themeState.clearText);
    if (dom.cycleSpeedSlider) {
        dom.cycleSpeedSlider.value = themeState.cycleSpeed || 50;
        if (dom.cycleSpeedVal) dom.cycleSpeedVal.textContent = dom.cycleSpeedSlider.value + '%';
    }

    if (dom.flowSpeedSlider) {
        dom.flowSpeedSlider.value = themeState.flowSpeed || 1.2;
        if (dom.flowSpeedVal) dom.flowSpeedVal.textContent = (themeState.flowSpeed || 1.2) + 'x';
    }
    if (dom.flowTrailSlider) {
        dom.flowTrailSlider.value = themeState.flowTrail || 0.09;
        if (dom.flowTrailVal) dom.flowTrailVal.textContent = themeState.flowTrail || 0.09;
    }
    if (dom.flowDensitySlider) {
        dom.flowDensitySlider.value = themeState.flowDensity || 450;
        if (dom.flowDensityVal) dom.flowDensityVal.textContent = themeState.flowDensity || 450;
    }

    if (themeState.cycleAccent || themeState.cycleBg) {
        if (!cyclingAnimationFrame) {
            colorCycleLoop();
        }
    } else if (cyclingAnimationFrame) {
        stopColorCycleLoop();
    }
}

export function saveThemeConfig() {
    baseSaveThemeConfig();
    applyThemeState();
}
