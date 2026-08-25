import { themeState, saveThemeConfig as baseSaveThemeConfig } from './state.js';
import { dom } from './dom.js';

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

export function colorCycleLoop() {
    if (!themeState.cycleAccent && !themeState.cycleBg) {
        if (cyclingAnimationFrame) cancelAnimationFrame(cyclingAnimationFrame);
        cyclingAnimationFrame = null;
        return;
    }

    const speed = (themeState.cycleSpeed / 100) * 1.5 + 0.05;
    let needsUpdate = false;

    if (themeState.cycleAccent) {
        currentAccentHue = (currentAccentHue + speed) % 360;
        themeState.accentColor = hslToHex(currentAccentHue, 80, 65);
        if (dom.accentColorPicker) dom.accentColorPicker.value = themeState.accentColor;
        needsUpdate = true;
    }

    if (themeState.cycleBg) {
        currentBgHue = (currentBgHue + (speed * 0.5)) % 360;
        themeState.bgTone = hslToHex(currentBgHue, 50, 10);
        if (dom.bgTonePicker) dom.bgTonePicker.value = themeState.bgTone;
        needsUpdate = true;
    }

    if (needsUpdate) {
        document.documentElement.style.setProperty('--bg-black', themeState.bgTone);
        document.documentElement.style.setProperty('--text-primary', themeState.accentColor);
        
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

    cyclingAnimationFrame = requestAnimationFrame(colorCycleLoop);
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

    if (dom.animationSettingsPanel) {
        const motion = themeState.bgMotion;
        const hasSettings = ['fluid', 'nodes', 'matrix'].includes(motion);
        dom.animationSettingsPanel.style.display = hasSettings ? 'block' : 'none';
        
        if (dom.fluidSettings) dom.fluidSettings.style.display = motion === 'fluid' ? 'block' : 'none';
        if (dom.nodesSettings) dom.nodesSettings.style.display = motion === 'nodes' ? 'block' : 'none';
        if (dom.matrixSettings) dom.matrixSettings.style.display = motion === 'matrix' ? 'block' : 'none';
    }

    if (window.fluidConfig) {
        window.fluidConfig.SPLAT_RADIUS = themeState.fluidRadius;
        window.fluidConfig.CURL = themeState.fluidCurl;
        window.fluidConfig.BLOOM_INTENSITY = themeState.fluidBloom;
    }

    if (dom.fluidRadiusSlider) {
        dom.fluidRadiusSlider.value = themeState.fluidRadius;
        if (dom.fluidRadiusVal) dom.fluidRadiusVal.textContent = themeState.fluidRadius;
    }
    if (dom.fluidCurlSlider) {
        dom.fluidCurlSlider.value = themeState.fluidCurl;
        if (dom.fluidCurlVal) dom.fluidCurlVal.textContent = themeState.fluidCurl;
    }
    if (dom.fluidBloomSlider) {
        dom.fluidBloomSlider.value = themeState.fluidBloom;
        if (dom.fluidBloomVal) dom.fluidBloomVal.textContent = themeState.fluidBloom;
    }
    
    if (dom.nodesDensitySlider) {
        dom.nodesDensitySlider.value = themeState.nodesDensity;
        if (dom.nodesDensityVal) dom.nodesDensityVal.textContent = themeState.nodesDensity;
    }
    if (dom.nodesDistanceSlider) {
        dom.nodesDistanceSlider.value = themeState.nodesDistance;
        if (dom.nodesDistanceVal) dom.nodesDistanceVal.textContent = themeState.nodesDistance;
    }
    
    if (dom.matrixSpeedSlider) {
        dom.matrixSpeedSlider.value = themeState.matrixSpeed;
        if (dom.matrixSpeedVal) dom.matrixSpeedVal.textContent = themeState.matrixSpeed + 'ms';
    }
    if (dom.matrixFadeSlider) {
        dom.matrixFadeSlider.value = themeState.matrixFade;
        if (dom.matrixFadeVal) dom.matrixFadeVal.textContent = themeState.matrixFade;
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

    if (dom.cycleAccentToggle) dom.cycleAccentToggle.checked = themeState.cycleAccent || false;
    if (dom.cycleBgToggle) dom.cycleBgToggle.checked = themeState.cycleBg || false;
    if (dom.clearTextToggle) dom.clearTextToggle.checked = themeState.clearText || false;
    document.body.classList.toggle('clear-text-active', !!themeState.clearText);
    if (dom.cycleSpeedSlider) {
        dom.cycleSpeedSlider.value = themeState.cycleSpeed || 50;
        if (dom.cycleSpeedVal) dom.cycleSpeedVal.textContent = dom.cycleSpeedSlider.value + '%';
    }

    if ((themeState.cycleAccent || themeState.cycleBg) && !cyclingAnimationFrame) {
        colorCycleLoop();
    }
}

export function saveThemeConfig() {
    baseSaveThemeConfig();
    applyThemeState();
}
