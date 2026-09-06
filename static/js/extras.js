/**
 * extras.js - Interactive easter eggs, audio effects, and project credits.
 */

let clickCount = 0;
let clickResetTimer = null;
let blehHideTimer = null;
let hypeCount = 0;

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
 * Plays a cheerful celebratory chime when opening the Creator card.
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
            const t = now + idx * 0.08;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t);

            gain.gain.setValueAtTime(0.001, t);
            gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
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
 * Triggers the pixel art "Bleh~!" visual and sound effect.
 */
export function triggerBlehEasterEgg() {
    playBlehSound();

    const container = document.getElementById('blehEasterEgg');
    if (!container) return;

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
 * Lightweight canvas confetti explosion for the Creator Card.
 */
function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#a855f7', '#ec4899', '#38bdf8', '#facc15', '#10b981', '#ffffff'];
    const particles = [];
    const count = 75;

    for (let i = 0; i < count; i++) {
        particles.push({
            x: canvas.width / 2 + (Math.random() - 0.5) * 160,
            y: canvas.height * 0.45,
            vx: (Math.random() - 0.5) * 14,
            vy: -Math.random() * 12 - 4,
            size: Math.random() * 7 + 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * 360,
            rSpeed: (Math.random() - 0.5) * 10,
            alpha: 1
        });
    }

    let animId;
    const startTime = performance.now();

    function render(t) {
        const elapsed = (t - startTime) / 1000;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let activeCount = 0;
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.4;
            p.vx *= 0.98;
            p.rotation += p.rSpeed;
            if (elapsed > 1.2) {
                p.alpha = Math.max(0, p.alpha - 0.02);
            }

            if (p.alpha > 0 && p.y < canvas.height + 20) {
                activeCount++;
                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
                ctx.restore();
            }
        }

        if (activeCount > 0 && elapsed < 3.5) {
            animId = requestAnimationFrame(render);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            cancelAnimationFrame(animId);
        }
    }

    animId = requestAnimationFrame(render);
}

/**
 * Opens the Creator Card modal.
 */
export function openCreatorModal(withConfetti = true) {
    const modal = document.getElementById('creatorModal');
    if (!modal) return;

    modal.classList.remove('hidden');

    if (withConfetti) {
        launchConfetti();
        playFanfareSound();
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
    // 1. New Chat 15-clicks tracker
    const handleNewChatClick = () => {
        clickCount++;
        if (clickResetTimer) clearTimeout(clickResetTimer);
        clickResetTimer = setTimeout(() => {
            clickCount = 0;
        }, 8000);

        if (clickCount >= 15) {
            clickCount = 0;
            triggerBlehEasterEgg();
        }
    };

    const newChatBtn = document.getElementById('newChatBtn');
    const convoEndedNewChatBtn = document.getElementById('convoEndedNewChatBtn');

    if (newChatBtn) newChatBtn.addEventListener('click', handleNewChatClick);
    if (convoEndedNewChatBtn) convoEndedNewChatBtn.addEventListener('click', handleNewChatClick);

    // 2. Pixel art container click to dismiss early
    const blehContainer = document.getElementById('blehEasterEgg');
    if (blehContainer) {
        blehContainer.addEventListener('click', () => {
            blehContainer.classList.remove('bleh-animate-in');
            blehContainer.classList.add('bleh-animate-out');
            setTimeout(() => {
                blehContainer.classList.add('hidden');
                blehContainer.classList.remove('bleh-animate-out');
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

    const dismissCreatorBtn = document.getElementById('dismissCreatorBtn');
    if (dismissCreatorBtn) {
        dismissCreatorBtn.addEventListener('click', closeCreatorModal);
    }

    const creatorModal = document.getElementById('creatorModal');
    if (creatorModal) {
        creatorModal.addEventListener('click', (e) => {
            if (e.target === creatorModal) closeCreatorModal();
        });
    }

    // 4. Interactive Avatar Spin Clicker
    const avatarWrap = document.getElementById('creatorAvatarWrap');
    if (avatarWrap) {
        avatarWrap.addEventListener('click', () => {
            avatarWrap.classList.remove('spin');
            void avatarWrap.offsetWidth; // trigger reflow
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

            if (hypeCount === 10) {
                launchConfetti();
            }
        });
    }

    // Expose helpers on window
    window.__nivm_openCreator = openCreatorModal;
    window.__nivm_triggerBleh = triggerBlehEasterEgg;
}
