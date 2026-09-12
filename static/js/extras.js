/**
 * extras.js - Interactive easter eggs, audio effects, and project credits.
 */

let clickCount = 0;
let clickResetTimer = null;
let blehHideTimer = null;
let hypeCount = 0;
let glitchTimer = null;

/**
 * Synthesizes a playful anime-style "bleh~" tongue-out sound via Web Audio API.
 */
export function playBlehSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const overtone = ctx.createOscillator();
        const overtoneGain = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();

        // 38Hz flutter for cartoonish tongue-out raspberry
        lfo.frequency.setValueAtTime(38, now);
        lfoGain.gain.setValueAtTime(85, now);
        lfo.connect(osc.frequency);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(680, now);
        osc.frequency.exponentialRampToValueAtTime(1150, now + 0.12);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.38);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);

        overtone.type = 'sine';
        overtone.frequency.setValueAtTime(1360, now);
        overtone.frequency.exponentialRampToValueAtTime(2300, now + 0.12);
        overtone.frequency.exponentialRampToValueAtTime(840, now + 0.38);

        overtoneGain.gain.setValueAtTime(0.001, now);
        overtoneGain.gain.exponentialRampToValueAtTime(0.08, now + 0.05);
        overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);

        osc.connect(gain);
        gain.connect(ctx.destination);
        overtone.connect(overtoneGain);
        overtoneGain.connect(ctx.destination);

        lfo.start(now);
        osc.start(now);
        overtone.start(now);

        const stopTime = now + 0.46;
        lfo.stop(stopTime);
        osc.stop(stopTime);
        overtone.stop(stopTime);

        setTimeout(() => {
            try { ctx.close(); } catch (_) {}
        }, 600);
    } catch (e) {
        console.warn('Audio synthesis warning:', e);
    }
}

/**
 * Cybernetic holographic chime sound effect.
 */
export function playCyberGlitchSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        // Smooth digital hologram arpeggio
        const freqs = [320, 480, 640, 960];
        freqs.forEach((f, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const t = now + i * 0.045;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, t);
            osc.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.12);

            gain.gain.setValueAtTime(0.001, t);
            gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(t);
            osc.stop(t + 0.26);
        });

        setTimeout(() => {
            try { ctx.close(); } catch (_) {}
        }, 500);
    } catch (_) {}
}

/**
 * Plays a cheerful celebratory chime.
 */
export function playFanfareSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const t = now + idx * 0.075;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t);

            gain.gain.setValueAtTime(0.001, t);
            gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(t);
            osc.stop(t + 0.30);
        });

        setTimeout(() => {
            try { ctx.close(); } catch (_) {}
        }, 800);
    } catch (_) {}
}

/**
 * Plays a sweet bubbly pop sound when clicking Send Love.
 */
export function playPopSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(450 + Math.random() * 200, now);
        osc.frequency.exponentialRampToValueAtTime(800 + Math.random() * 300, now + 0.08);

        gain.gain.setValueAtTime(0.01, now);
        gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.16);

        setTimeout(() => {
            try { ctx.close(); } catch (_) {}
        }, 300);
    } catch (_) {}
}

/**
 * Plays a cute whoosh sound when spinning the avatar.
 */
export function playWhooshSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(950, now + 0.18);
        osc.frequency.exponentialRampToValueAtTime(500, now + 0.35);

        gain.gain.setValueAtTime(0.01, now);
        gain.gain.exponentialRampToValueAtTime(0.25, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.4);

        setTimeout(() => {
            try { ctx.close(); } catch (_) {}
        }, 500);
    } catch (_) {}
}

/**
 * Spawns a floating heart / star particle floating upward.
 */
function spawnFloatingHeart(x, y) {
    const emojis = ['💖', '💜', '✨', '⭐', '🌸', '🥰', '💫'];
    const el = document.createElement('div');
    el.className = 'floating-heart';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--rand-x', (Math.random() - 0.5) * 2);
    el.style.setProperty('--rand-rot', `${(Math.random() - 0.5) * 50}deg`);

    document.body.appendChild(el);
    setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, 1300);
}

/**
 * Synthesizes a punchy retro/cyber explosion sound with pin pull click via Web Audio API.
 */
export function playExplosionSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        // 1. Initial metallic grenade pin pull click
        const clickOsc = ctx.createOscillator();
        const clickGain = ctx.createGain();
        clickOsc.type = 'square';
        clickOsc.frequency.setValueAtTime(2200, now);
        clickOsc.frequency.exponentialRampToValueAtTime(500, now + 0.05);
        clickGain.gain.setValueAtTime(0.2, now);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        clickOsc.connect(clickGain);
        clickGain.connect(ctx.destination);
        clickOsc.start(now);
        clickOsc.stop(now + 0.06);

        // 2. White noise explosion burst
        const bufferSize = Math.floor(ctx.sampleRate * 0.9);
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const whiteNoise = ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(950, now + 0.04);
        filter.frequency.exponentialRampToValueAtTime(55, now + 0.75);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.setValueAtTime(0.001, now + 0.03);
        noiseGain.gain.linearRampToValueAtTime(0.42, now + 0.06);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

        whiteNoise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(ctx.destination);

        whiteNoise.start(now + 0.03);
        whiteNoise.stop(now + 0.9);

        // 3. Sub-bass boom oscillator
        const subOsc = ctx.createOscillator();
        const subGain = ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(150, now + 0.04);
        subOsc.frequency.exponentialRampToValueAtTime(30, now + 0.55);

        subGain.gain.setValueAtTime(0.001, now + 0.04);
        subGain.gain.linearRampToValueAtTime(0.45, now + 0.07);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

        subOsc.connect(subGain);
        subGain.connect(ctx.destination);

        subOsc.start(now + 0.04);
        subOsc.stop(now + 0.7);

        setTimeout(() => {
            try { ctx.close(); } catch (_) {}
        }, 1100);
    } catch (e) {
        console.warn('Audio synthesis warning:', e);
    }
}

/**
 * Spawns explosion spark and flame particles around the Reze avatar.
 */
function spawnExplosionParticles(centerX, centerY) {
    const symbols = ['💥', '🔥', '✨', '⚡', '💣'];
    for (let i = 0; i < 18; i++) {
        const p = document.createElement('div');
        p.className = 'reze-boom-particle';
        p.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        const angle = Math.random() * Math.PI * 2;
        const dist = 45 + Math.random() * 85;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist - 25;

        p.style.left = `${centerX}px`;
        p.style.top = `${centerY}px`;
        p.style.setProperty('--tx', `${tx}px`);
        p.style.setProperty('--ty', `${ty}px`);
        p.style.setProperty('--rot', `${(Math.random() - 0.5) * 360}deg`);

        document.body.appendChild(p);
        setTimeout(() => {
            if (p.parentNode) p.parentNode.removeChild(p);
        }, 950);
    }
}


/**
 * Triggers full-screen cyber glitch effect across the site.
 */
export function triggerSiteGlitch() {
    playCyberGlitchSound();

    let glitchOverlay = document.getElementById('siteGlitchOverlay');
    if (!glitchOverlay) {
        glitchOverlay = document.createElement('div');
        glitchOverlay.id = 'siteGlitchOverlay';
        glitchOverlay.className = 'site-glitch-overlay';
        document.body.appendChild(glitchOverlay);
    }

    if (glitchTimer) clearTimeout(glitchTimer);

    document.body.classList.add('site-glitch-active');
    glitchOverlay.classList.remove('hidden');
    glitchOverlay.classList.add('active');

    glitchTimer = setTimeout(() => {
        document.body.classList.remove('site-glitch-active');
        glitchOverlay.classList.remove('active');
        setTimeout(() => {
            glitchOverlay.classList.add('hidden');
        }, 250);
    }, 750);
}

/**
 * Triggers the pixel art "Bleh~!" visual and sound effect.
 */
export function triggerBlehEasterEgg() {
    playBlehSound();

    const container = document.getElementById('blehEasterEgg');
    if (!container) return;

    // Reset any previous boom state to clean Bleh mode
    container.classList.remove('reze-boom-active');
    const bubbleText = container.querySelector('.bleh-bubble-text');
    if (bubbleText) bubbleText.textContent = 'Bleh~!';

    if (blehHideTimer) clearTimeout(blehHideTimer);

    container.classList.remove('hidden');
    container.classList.remove('bleh-animate-out');
    container.classList.add('bleh-animate-in');

    blehHideTimer = setTimeout(() => {
        container.classList.remove('bleh-animate-in');
        container.classList.add('bleh-animate-out');
        setTimeout(() => {
            container.classList.add('hidden');
            container.classList.remove('bleh-animate-out');
        }, 350);
    }, 3800);
}

/**
 * Triggers Reze's Bomb Devil explosion mode with "Boom!" text, audio roar, screen shake, and particles.
 */
export function triggerRezeExplosion() {
    playExplosionSound();

    const container = document.getElementById('blehEasterEgg');
    if (!container) return;

    // Activate fiery boom styling & text
    container.classList.add('reze-boom-active');
    const bubbleText = container.querySelector('.bleh-bubble-text');
    if (bubbleText) bubbleText.textContent = 'Boom!';

    // Screen shake
    document.body.classList.remove('reze-screen-shake');
    void document.body.offsetWidth;
    document.body.classList.add('reze-screen-shake');
    setTimeout(() => {
        document.body.classList.remove('reze-screen-shake');
    }, 450);

    // Particle blast from avatar
    const avatar = container.querySelector('.bleh-pixel-avatar');
    if (avatar) {
        const rect = avatar.getBoundingClientRect();
        spawnExplosionParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    if (blehHideTimer) clearTimeout(blehHideTimer);

    container.classList.remove('hidden');
    container.classList.remove('bleh-animate-out');
    container.classList.add('bleh-animate-in');

    blehHideTimer = setTimeout(() => {
        container.classList.remove('bleh-animate-in');
        container.classList.add('bleh-animate-out');
        setTimeout(() => {
            container.classList.add('hidden');
            container.classList.remove('bleh-animate-out');
            container.classList.remove('reze-boom-active');
            if (bubbleText) bubbleText.textContent = 'Bleh~!';
        }, 350);
    }, 4000);
}

/**
 * Opens the Creator Card modal.
 */
export function openCreatorModal(withGlitch = true) {
    const modal = document.getElementById('creatorModal');
    if (!modal) return;

    modal.classList.remove('hidden');

    if (withGlitch) {
        triggerSiteGlitch();
        setTimeout(() => playFanfareSound(), 200);
    }
}

/**
 * Closes the Creator Card modal.
 */
export function closeCreatorModal() {
    const modal = document.getElementById('creatorModal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Initializes all easter egg triggers, click handlers, and modal bindings.
 */
export function initExtras() {
    // 1. New Chat 15-clicks tracker (15 taps = Bleh, another 15 = Boom!)
    const handleNewChatClick = () => {
        clickCount++;
        if (clickResetTimer) clearTimeout(clickResetTimer);
        clickResetTimer = setTimeout(() => {
            clickCount = 0;
        }, 16000);

        if (clickCount > 0 && clickCount % 15 === 0) {
            const step = Math.floor(clickCount / 15);
            if (step % 2 === 0) {
                // 30, 60, 90... Explode with Boom!
                triggerRezeExplosion();
            } else {
                // 15, 45, 75... Bleh~!
                triggerBlehEasterEgg();
            }
        }
    };

    const newChatBtn = document.getElementById('newChatBtn');
    const convoEndedNewChatBtn = document.getElementById('convoEndedNewChatBtn');
    const mobileNewChatBtn = document.getElementById('mobileNewChatBtn');

    if (newChatBtn) newChatBtn.addEventListener('click', handleNewChatClick);
    if (convoEndedNewChatBtn) convoEndedNewChatBtn.addEventListener('click', handleNewChatClick);
    if (mobileNewChatBtn) mobileNewChatBtn.addEventListener('click', handleNewChatClick);

    // 2. Pixel art container click handlers
    const blehContainer = document.getElementById('blehEasterEgg');
    const blehAvatar = blehContainer ? blehContainer.querySelector('.bleh-pixel-avatar') : null;

    // Clicking Reze's avatar or pin choker detonates the Boom explosion directly!
    if (blehAvatar) {
        blehAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            triggerRezeExplosion();
        });
    }

    // Clicking anywhere else on the bubble / container dismisses early
    if (blehContainer) {
        blehContainer.addEventListener('click', () => {
            blehContainer.classList.remove('bleh-animate-in');
            blehContainer.classList.add('bleh-animate-out');
            setTimeout(() => {
                blehContainer.classList.add('hidden');
                blehContainer.classList.remove('bleh-animate-out');
                blehContainer.classList.remove('reze-boom-active');
            }, 250);
        });
    }

    // 3. Creator Card modal open / close handlers
    const openCreatorBtn = document.getElementById('openCreatorBtn');
    if (openCreatorBtn) {
        openCreatorBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openCreatorModal(true);
        });
    }

    const closeCreatorBtn = document.getElementById('closeCreatorBtn');
    if (closeCreatorBtn) {
        closeCreatorBtn.addEventListener('click', closeCreatorModal);
    }

    // Dismiss by clicking anywhere on background overlay outside window
    const creatorModal = document.getElementById('creatorModal');
    const creatorWindow = document.getElementById('creatorWindow');
    if (creatorModal) {
        creatorModal.addEventListener('click', (e) => {
            if (!creatorWindow || !creatorWindow.contains(e.target)) {
                closeCreatorModal();
            }
        });
    }

    // 4. Interactive Avatar Spin Clicker
    const avatarWrap = document.getElementById('creatorAvatarWrap');
    if (avatarWrap) {
        avatarWrap.addEventListener('click', () => {
            avatarWrap.classList.remove('spin');
            void avatarWrap.offsetWidth;
            avatarWrap.classList.add('spin');
            playWhooshSound();
            const rect = avatarWrap.getBoundingClientRect();
            spawnFloatingHeart(rect.left + rect.width / 2, rect.top);
        });
    }

    // 5. Interactive "Send Love" Heart Clicker
    const hypeBtn = document.getElementById('creatorHypeBtn');
    const hypeBadge = document.getElementById('hypeCountBadge');
    if (hypeBtn) {
        hypeBtn.addEventListener('click', (e) => {
            hypeCount++;
            if (hypeBadge) hypeBadge.textContent = hypeCount;
            playPopSound();

            const rect = hypeBtn.getBoundingClientRect();
            const clickX = e.clientX || (rect.left + rect.width / 2);
            const clickY = e.clientY || (rect.top);
            spawnFloatingHeart(clickX, clickY);

            if (hypeCount > 0 && hypeCount % 10 === 0) {
                triggerSiteGlitch();
            }
        });
    }

    // Expose helpers on window
    window.__nivm_openCreator = openCreatorModal;
    window.__nivm_triggerBleh = triggerBlehEasterEgg;
    window.__nivm_triggerBoom = triggerRezeExplosion;
    window.__nivm_triggerGlitch = triggerSiteGlitch;
}

