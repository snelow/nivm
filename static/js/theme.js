import { themeState, saveThemeConfig as baseSaveThemeConfig } from './state.js';
import { dom } from './dom.js';
import {
    setupNodesCanvas,
    setupMatrixCanvas,
    setupFluidCanvas,
    setupFlowFieldCanvas,
    setupCircuitsCanvas,
    setupHexCanvas,
    setupAuroraCanvas
} from './backgrounds.js';

export {
    setupNodesCanvas,
    setupMatrixCanvas,
    setupFluidCanvas,
    setupFlowFieldCanvas,
    setupCircuitsCanvas,
    setupHexCanvas,
    setupAuroraCanvas
};

let currentAccentHue = 0;
let currentBgHue = 0;
let cyclingAnimationFrame = null;

function hexToRgb(hex) {
    let r = 0, g = 0, b = 0;
    if (!hex) return {r, g, b, str: `${r}, ${g}, ${b}`};
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

export function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + [clamp(r), clamp(g), clamp(b)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

export function calculateHarmonizedMutedColor(bgHex, primaryHex, brandHex) {
    const bg = hexToRgb(bgHex || '#09090b');
    const primary = hexToRgb(primaryHex || '#f4f4f5');
    const brand = hexToRgb(brandHex || '#a855f7');
    const lum = getLuminance(bg.r, bg.g, bg.b);

    if (lum > 0.5) {
        // Light background: muted text blends text (55%), background (35%), brand (10%)
        const r = primary.r * 0.55 + bg.r * 0.35 + brand.r * 0.10;
        const g = primary.g * 0.55 + bg.g * 0.35 + brand.g * 0.10;
        const b = primary.b * 0.55 + bg.b * 0.35 + brand.b * 0.10;
        return rgbToHex(r, g, b);
    } else {
        // Dark background: muted text blends primary text (~52%), canvas background (~36%), brand accent (~12%)
        const r = primary.r * 0.52 + bg.r * 0.36 + brand.r * 0.12;
        const g = primary.g * 0.52 + bg.g * 0.36 + brand.g * 0.12;
        const b = primary.b * 0.52 + bg.b * 0.36 + brand.b * 0.12;
        return rgbToHex(r, g, b);
    }
}

export function calculateHarmonizedSecondaryColor(mutedHex, primaryHex) {
    const muted = hexToRgb(mutedHex);
    const primary = hexToRgb(primaryHex || '#f4f4f5');
    const r = muted.r * 0.65 + primary.r * 0.35;
    const g = muted.g * 0.65 + primary.g * 0.35;
    const b = muted.b * 0.65 + primary.b * 0.35;
    return rgbToHex(r, g, b);
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
        document.documentElement.style.setProperty('--glass-border', luminance > 0.5 ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.06)');

        if (window.fluidConfig) {
            window.fluidConfig.BACK_COLOR = { r: bgRgb.r, g: bgRgb.g, b: bgRgb.b };
        }

        const cycleMuted = (themeState.mutedColor && typeof themeState.mutedColor === 'string' && themeState.mutedColor.startsWith('#'))
            ? themeState.mutedColor
            : calculateHarmonizedMutedColor(themeState.bgTone, themeState.accentColor, themeState.brandColor);
        const cycleSec = calculateHarmonizedSecondaryColor(cycleMuted, themeState.accentColor);
        document.documentElement.style.setProperty('--text-muted', cycleMuted);
        document.documentElement.style.setProperty('--text-secondary', cycleSec);
    }

    // Throttle color picker DOM updates to at most 4x/sec and ONLY if theme window is visible
    if (timestamp - lastPickerUpdate > 250) {
        lastPickerUpdate = timestamp;
        if (dom.themeWindow && dom.themeWindow.style.display !== 'none') {
            if (themeState.cycleAccent && dom.accentColorPicker) dom.accentColorPicker.value = themeState.accentColor;
            if (themeState.cycleBg && dom.bgTonePicker) dom.bgTonePicker.value = themeState.bgTone;
            if (dom.mutedColorPicker && !themeState.mutedColor) {
                dom.mutedColorPicker.value = calculateHarmonizedMutedColor(themeState.bgTone, themeState.accentColor, themeState.brandColor);
            }
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
    if (!isValidHex(themeState.brandColor)) themeState.brandColor = '#a855f7';
    if (themeState.mutedColor !== null && !isValidHex(themeState.mutedColor)) themeState.mutedColor = null;
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
    if (dom.circuitsBgCanvas) {
        dom.circuitsBgCanvas.classList.toggle('active', themeState.bgMotion === 'circuits');
        if (themeState.bgMotion === 'circuits' && window.startCircuitsAnimation) window.startCircuitsAnimation();
    }
    if (dom.hexBgCanvas) {
        dom.hexBgCanvas.classList.toggle('active', themeState.bgMotion === 'hexgrid');
        if (themeState.bgMotion === 'hexgrid' && window.startHexAnimation) window.startHexAnimation();
    }
    if (dom.auroraBgCanvas) {
        dom.auroraBgCanvas.classList.toggle('active', themeState.bgMotion === 'aurora');
        if (themeState.bgMotion === 'aurora' && window.startAuroraAnimation) window.startAuroraAnimation();
    }

    if (window.fluidConfig) {
        const bg = hexToRgb(themeState.bgTone || '#09090b');
        window.fluidConfig.BACK_COLOR = { r: bg.r, g: bg.g, b: bg.b };
        if (themeState.fluidRadius !== undefined) window.fluidConfig.SPLAT_RADIUS = themeState.fluidRadius;
        if (themeState.fluidCurl !== undefined) window.fluidConfig.CURL = themeState.fluidCurl;
        if (themeState.fluidBloom !== undefined) window.fluidConfig.BLOOM_INTENSITY = themeState.fluidBloom;
    }

    if (dom.animationSettingsPanel) {
        const motion = themeState.bgMotion;
        const hasSettings = ['fluid', 'nodes', 'matrix', 'flowfield', 'circuits', 'hexgrid', 'aurora'].includes(motion);
        dom.animationSettingsPanel.style.display = hasSettings ? 'block' : 'none';
        
        if (dom.flowFieldSettings) dom.flowFieldSettings.style.display = motion === 'flowfield' ? 'block' : 'none';
        if (dom.fluidSettings) dom.fluidSettings.style.display = motion === 'fluid' ? 'block' : 'none';
        if (dom.nodesSettings) dom.nodesSettings.style.display = motion === 'nodes' ? 'block' : 'none';
        if (dom.matrixSettings) dom.matrixSettings.style.display = motion === 'matrix' ? 'block' : 'none';
        if (dom.circuitsSettings) dom.circuitsSettings.style.display = motion === 'circuits' ? 'block' : 'none';
        if (dom.hexSettings) dom.hexSettings.style.display = motion === 'hexgrid' ? 'block' : 'none';
        if (dom.auroraSettings) dom.auroraSettings.style.display = motion === 'aurora' ? 'block' : 'none';
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
    if (dom.brandColorPicker) dom.brandColorPicker.value = themeState.brandColor;

    const activeMutedColor = (themeState.mutedColor && isValidHex(themeState.mutedColor))
        ? themeState.mutedColor
        : calculateHarmonizedMutedColor(themeState.bgTone, themeState.accentColor, themeState.brandColor);
    const activeSecondaryColor = calculateHarmonizedSecondaryColor(activeMutedColor, themeState.accentColor);

    if (dom.mutedColorPicker) dom.mutedColorPicker.value = activeMutedColor;

    document.documentElement.style.setProperty('--bg-black', themeState.bgTone);
    document.documentElement.style.setProperty('--bg-surface', themeState.sidebarTone);
    document.documentElement.style.setProperty('--text-primary', themeState.accentColor);
    document.documentElement.style.setProperty('--text-muted', activeMutedColor);
    document.documentElement.style.setProperty('--text-secondary', activeSecondaryColor);
    document.documentElement.style.setProperty('--font-size-base', `${themeState.fontSize}px`);
    
    // Dynamic Typography Font Family
    if (!themeState.fontFamily) themeState.fontFamily = 'monocraft';
    const fontValue = themeState.fontFamily === 'opensans'
        ? "'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        : "'Monocraft', monospace";
    document.documentElement.style.setProperty('--font-main', fontValue);
    document.documentElement.style.setProperty('--font-chat', fontValue);
    document.querySelectorAll('button[data-font]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-font') === themeState.fontFamily);
    });

    // Dynamic Brand Accent (Custom Purple replacement)
    const brandRgb = hexToRgb(themeState.brandColor);
    document.documentElement.style.setProperty('--accent-purple', themeState.brandColor);
    document.documentElement.style.setProperty('--accent-purple-rgb', brandRgb.str);
    document.documentElement.style.setProperty('--accent-purple-glow', `rgba(${brandRgb.str}, 0.35)`);

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
        document.documentElement.style.setProperty('--glass-border', 'rgba(0, 0, 0, 0.1)');
    } else {
        document.documentElement.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.06)');
    }

    const heartColor = (themeState.accentColor && themeState.accentColor !== '#f4f4f5') 
        ? themeState.accentColor 
        : themeState.brandColor;
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

    if (dom.circuitSpeedSlider) {
        dom.circuitSpeedSlider.value = themeState.circuitSpeed || 1.2;
        if (dom.circuitSpeedVal) dom.circuitSpeedVal.textContent = (themeState.circuitSpeed || 1.2) + 'x';
    }
    if (dom.hexSpeedSlider) {
        dom.hexSpeedSlider.value = themeState.hexSpeed || 1.0;
        if (dom.hexSpeedVal) dom.hexSpeedVal.textContent = (themeState.hexSpeed || 1.0) + 'x';
    }
    if (dom.auroraSpeedSlider) {
        dom.auroraSpeedSlider.value = themeState.auroraSpeed || 1.0;
        if (dom.auroraSpeedVal) dom.auroraSpeedVal.textContent = (themeState.auroraSpeed || 1.0) + 'x';
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
