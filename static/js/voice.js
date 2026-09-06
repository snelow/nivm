/**
 * Neural Voice Customizer & Speech Synthesis System for nivm
 * Color-based voice selector (Voice 1-5), iridescent glowing orb,
 * Pace & Expressivity sliders, and instant preview.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { renderActiveChat, scrollToBottom } from './ui.js';

export const VOICE_PROFILES = [
    { num: 1, id: 'af_heart', name: 'Voice 1', color: '#22c55e', label: 'Natural & Balanced' },
    { num: 2, id: 'af_bella', name: 'Voice 2', color: '#f59e0b', label: 'Warm Companion' },
    { num: 3, id: 'af_sarah', name: 'Voice 3', color: '#f97316', label: 'Modern & Focused' },
    { num: 4, id: 'af_nicole', name: 'Voice 4', color: '#f43f5e', label: 'Gentle & Calm' },
    { num: 5, id: 'bf_emma', name: 'Voice 5', color: '#a855f7', label: 'FRIDAY Intelligent Assistant' }
];

export const VOICE_GREETINGS = {
    '1': "Hello! I'm your primary voice. Clear, natural, and ready whenever you need me.",
    '2': "Hi there! I'm here to keep things friendly, warm, and helpful throughout your day.",
    '3': "Good day. I'm calibrated for focus, concise answers, and quick workflows.",
    '4': "Hello. If you prefer a calmer, softer tone for reading and thinking, I'm here.",
    '5': "Good morning, boss. Where would you like to start today?"
};

export const VOICE_PREVIEWS = {
    '1': [
        "Welcome to Nivm! I can assist you with coding, creative writing, research, and daily questions, all running securely on your machine.",
        "Local neural compute is ready. How does my pace and tone sound for you?"
    ],
    '2': [
        "The best part about having a sovereign AI is that your conversations remain entirely private and completely yours. What shall we explore next?",
        "I hope you're having a wonderful and productive day! Let me know whatever you'd like to work on."
    ],
    '3': [
        "Every task is processed locally with zero latency spikes or cloud dependence. Let's tackle your next project together.",
        "Precision and clarity are ready. Ready for complex logic, debugging, or research summaries whenever you are."
    ],
    '4': [
        "Take a deep breath and take your time. Whether you are studying or writing notes, I'm here to help at whatever pace you choose.",
        "Sometimes a quieter, softer tone makes long reading sessions much more relaxing. Let me know what you'd like to explore."
    ],
    '5': [
        "Always at your service, boss. Tell me what we're working on and I'll keep everything running quietly in the background.",
        "Morning, boss. Ready whenever you are. Let's see what problems we can solve today."
    ]
};

const DEFAULT_CONFIG = {
    voiceUri: 'af_heart',
    rate: 1.0,
    warmth: 0.0,
    volume: 1.0,
    autoSpeak: false
};

export let voiceConfig = { ...DEFAULT_CONFIG };

// Load persisted configuration from localStorage
try {
    const saved = localStorage.getItem('nivm_voice_config');
    if (saved) {
        voiceConfig = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    }
} catch (e) {
    console.warn('Failed to load voice config:', e);
}

export function saveVoiceConfig() {
    try {
        localStorage.setItem('nivm_voice_config', JSON.stringify(voiceConfig));
    } catch (e) {
        console.warn('Failed to save voice config:', e);
    }
}

export const VOICE_COLORS = {
    'af_heart': { hex: '#22c55e', rgb: '34, 197, 94', num: '1' },
    'af_bella': { hex: '#f59e0b', rgb: '245, 158, 11', num: '2' },
    'af_sarah': { hex: '#f97316', rgb: '249, 115, 22', num: '3' },
    'af_nicole': { hex: '#f43f5e', rgb: '244, 63, 94', num: '4' },
    'bf_emma':  { hex: '#a855f7', rgb: '168, 85, 247', num: '5' },
    'af_sky':   { hex: '#38bdf8', rgb: '56, 189, 248', num: '6' }
};

export function applyVoiceAccent(voiceId = null) {
    const id = voiceId || voiceConfig.voiceUri || 'af_heart';
    const info = VOICE_COLORS[id] || VOICE_COLORS['af_heart'];
    const root = document.documentElement;
    root.style.setProperty('--voice-accent', info.hex);
    root.style.setProperty('--voice-accent-rgb', info.rgb);
    root.style.setProperty('--voice-accent-glow', info.hex + '4d');
    root.style.setProperty('--voice-accent-ambient', `rgba(${info.rgb}, 0.16)`);
    root.style.setProperty('--voice-accent-ambient-active', `rgba(${info.rgb}, 0.30)`);

    const voiceWindow = document.getElementById('voiceWindow');
    if (voiceWindow) {
        voiceWindow.style.setProperty('--voice-accent', info.hex);
        voiceWindow.style.setProperty('--voice-accent-rgb', info.rgb);
    }
}

// Immediately apply persisted or default voice accent
applyVoiceAccent();

// Offline / Client-Side Pronunciation Dictionary
let clientPronunciationDict = {
    exact: {
        "nivm": "Nim",
        "baka": "bah-ka",
        "tsundere": "tsoon-deh-reh",
        "yandere": "yahn-deh-reh",
        "kuudere": "koo-deh-reh",
        "dandere": "dahn-deh-reh",
        "senpai": "sen-pie",
        "kouhai": "ko-high",
        "kawaii": "kah-wah-ee",
        "sugoi": "soo-goy",
        "nani": "nah-nee",
        "yamete": "yah-meh-teh",
        "chotto": "cho-toh",
        "ara ara": "ah-rah ah-rah",
        "e-to": "eh-toh",
        "ano": "ah-noh",
        "onii-chan": "oh-nee chahn",
        "onee-san": "oh-neh sahn",
        "uwu": "oo-woo",
        "owo": "oh-woh",
        "arigatou": "ah-ree-gah-toh",
        "gomen": "go-men",
        "itadakimasu": "ee-tah-dah-kee-mahs"
    },
    patterns: [
        { pattern: "\\b(h+m+p+h+|h+m+p+f+)\\b", replacement: "humph", flags: "i" },
        { pattern: "\\b(t+c+h+)\\b", replacement: "tsk", flags: "i" },
        { pattern: "\\b(nya+)\\b", replacement: "nyah", flags: "i" },
        { pattern: "\\b(p+f+f+t*)\\b", replacement: "poof", flags: "i" },
        { pattern: "\\b(m+p+h+)\\b", replacement: "humph", flags: "i" }
    ]
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
}

export function normalizeStutters(text) {
    if (!text || typeof text !== 'string') return '';
    const pattern = /\b([a-zA-Z]{1,3}(?:\s*-\s*[a-zA-Z]{1,3})*)\s*-\s*([a-zA-Z]+)\b/g;
    return text.replace(pattern, (match, fullPrefix, word) => {
        const parts = fullPrefix.split(/\s*-\s*/).map(p => p.trim()).filter(Boolean);
        const wLower = word.toLowerCase();
        const vowels = ['a', 'e', 'i', 'o', 'u'];
        let isStutter = true;
        for (const p of parts) {
            const pLower = p.toLowerCase();
            const hasVowel = vowels.some(v => pLower.includes(v));
            if (pLower.length > 1 && hasVowel) {
                isStutter = false;
                break;
            }
            if (!wLower.startsWith(pLower)) {
                isStutter = false;
                break;
            }
        }
        if (isStutter) {
            const firstP = parts[0];
            if (firstP && firstP[0] === firstP[0].toUpperCase() && word[0] === word[0].toLowerCase()) {
                return word.charAt(0).toUpperCase() + word.slice(1);
            }
            return word;
        }
        return match;
    });
}

export function renderCustomPronunciationsUI() {
    const listEl = document.getElementById('pronounceList');
    const badgeEl = document.getElementById('pronunciationCountBadge');
    if (!listEl) return;

    const custom = clientPronunciationDict.custom || {};
    const entries = Object.entries(custom);

    if (badgeEl) {
        badgeEl.textContent = entries.length;
        badgeEl.style.display = entries.length > 0 ? 'inline-block' : 'none';
    }

    if (entries.length === 0) {
        listEl.innerHTML = `
            <div style="font-size: 0.72rem; color: var(--text-muted); text-align: center; padding: 10px 4px; font-style: italic;">
                No custom pronunciations added yet.
            </div>
        `;
        return;
    }

    listEl.innerHTML = entries.map(([word, phonetic]) => `
        <div class="pronounce-item" data-word="${escapeHtml(word)}" data-phonetic="${escapeHtml(phonetic)}">
            <div class="pronounce-item-text" title="${escapeHtml(word)} sounds like ${escapeHtml(phonetic)}">
                <span class="pronounce-item-word">${escapeHtml(word)}</span>
                <span class="pronounce-item-arrow">→</span>
                <span class="pronounce-item-val">${escapeHtml(phonetic)}</span>
            </div>
            <div class="pronounce-item-actions">
                <button type="button" class="pronounce-btn-icon pronounce-btn-preview" title="Preview pronunciation aloud" data-phonetic="${escapeHtml(phonetic)}">
                    <i class="fa-solid fa-volume-high"></i>
                </button>
                <button type="button" class="pronounce-btn-icon pronounce-btn-edit" title="Tweak this pronunciation" data-word="${escapeHtml(word)}" data-phonetic="${escapeHtml(phonetic)}">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" class="pronounce-btn-icon pronounce-btn-del" title="Delete rule" data-word="${escapeHtml(word)}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `).join('');

    // Wire Preview buttons
    listEl.querySelectorAll('.pronounce-btn-preview').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const textToSay = btn.getAttribute('data-phonetic');
            if (textToSay) {
                btn.classList.add('playing');
                speakText(textToSay, null, null, () => {
                    btn.classList.remove('playing');
                });
            }
        });
    });

    // Wire Edit buttons (populate input for tweaking)
    listEl.querySelectorAll('.pronounce-btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const word = btn.getAttribute('data-word');
            const phonetic = btn.getAttribute('data-phonetic');
            const wordInput = document.getElementById('pronounceWordInput');
            const phoneticInput = document.getElementById('pronouncePhoneticInput');
            if (wordInput && phoneticInput) {
                wordInput.value = word || '';
                phoneticInput.value = phonetic || '';
                phoneticInput.focus();
            }
        });
    });

    // Wire Delete buttons
    listEl.querySelectorAll('.pronounce-btn-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const word = btn.getAttribute('data-word');
            if (!word) return;
            try {
                btn.disabled = true;
                const res = await fetch('/api/tts/pronunciations', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ word: word })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.custom) {
                        clientPronunciationDict.custom = data.custom;
                        if (clientPronunciationDict.exact) {
                            delete clientPronunciationDict.exact[word.toLowerCase()];
                        }
                    }
                    renderCustomPronunciationsUI();
                }
            } catch (err) {
                console.warn('Failed to delete pronunciation:', err);
            }
        });
    });
}

export function setupPronunciationsUI() {
    const toggleHeader = document.getElementById('togglePronunciationHeader');
    const bodyEl = document.getElementById('pronunciationBody');
    const chevron = document.getElementById('pronunciationChevron');
    const wordInput = document.getElementById('pronounceWordInput');
    const phoneticInput = document.getElementById('pronouncePhoneticInput');
    const testDraftBtn = document.getElementById('testPronounceDraftBtn');
    const addBtn = document.getElementById('addPronounceBtn');

    if (toggleHeader && bodyEl) {
        toggleHeader.addEventListener('click', () => {
            const isHidden = bodyEl.classList.contains('hidden');
            bodyEl.classList.toggle('hidden');
            if (chevron) {
                chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
            if (isHidden) {
                renderCustomPronunciationsUI();
            }
        });
    }

    if (testDraftBtn) {
        testDraftBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const draft = phoneticInput?.value.trim() || wordInput?.value.trim();
            if (draft) {
                testDraftBtn.classList.add('playing');
                speakText(draft, null, null, () => {
                    testDraftBtn.classList.remove('playing');
                });
            }
        });
    }

    [wordInput, phoneticInput].forEach(inputEl => {
        if (inputEl) {
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addBtn?.click();
                }
            });
        }
    });

    if (addBtn) {
        addBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const word = wordInput?.value.trim();
            const phonetic = phoneticInput?.value.trim();
            if (!word || !phonetic) return;

            if (word.toLowerCase() === 'nivm') {
                if (window.showNotification) {
                    window.showNotification('"nivm" is a protected core pronunciation ("Nim") and cannot be modified.', 'info');
                }
                return;
            }

            addBtn.disabled = true;
            addBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

            try {
                const res = await fetch('/api/tts/pronunciations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ word: word, pronunciation: phonetic })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.custom) {
                        clientPronunciationDict.custom = data.custom;
                        if (!clientPronunciationDict.exact) clientPronunciationDict.exact = {};
                        clientPronunciationDict.exact[word.toLowerCase()] = phonetic;
                    }
                    if (wordInput) wordInput.value = '';
                    if (phoneticInput) phoneticInput.value = '';
                    renderCustomPronunciationsUI();
                    // Audio feedback: speak the new phonetic pronunciation immediately!
                    speakText(phonetic);
                }
            } catch (err) {
                console.warn('Failed to save custom pronunciation:', err);
            } finally {
                addBtn.disabled = false;
                addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Save';
            }
        });
    }

    renderCustomPronunciationsUI();
}

async function loadClientPronunciations() {
    try {
        const res = await fetch('/api/tts/pronunciations');
        if (res.ok) {
            const data = await res.json();
            if (data && (data.exact || data.patterns)) {
                clientPronunciationDict = data;
            }
        }
    } catch (e) {
        // Fallback to offline client dictionary
    }
    renderCustomPronunciationsUI();
}
loadClientPronunciations();

function matchCase(original, replacement) {
    if (original === original.toUpperCase()) return replacement.toUpperCase();
    if (original[0] === original[0].toUpperCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    return replacement.toLowerCase();
}

function applyClientPronunciations(text) {
    if (!text) return '';
    let res = text;
    if (clientPronunciationDict.patterns) {
        for (const item of clientPronunciationDict.patterns) {
            if (item.pattern && item.replacement) {
                try {
                    const regex = new RegExp(item.pattern, item.flags || 'gi');
                    res = res.replace(regex, (m) => matchCase(m, item.replacement));
                } catch (e) {}
            }
        }
    }
    if (clientPronunciationDict.exact) {
        for (const [word, rep] of Object.entries(clientPronunciationDict.exact)) {
            if (word && rep) {
                try {
                    const regex = new RegExp(`\\b${word}\\b`, 'gi');
                    res = res.replace(regex, (m) => matchCase(m, rep));
                } catch (e) {}
            }
        }
    }
    return res;
}

// Global audio & speech tracking
let currentActiveSpeakerBtn = null;
let currentAudioPlayer = null;
let currentAudioUrl = null;
let isSpeechActive = false;
let nativeTtsAvailable = true;

// Web Audio API Pipeline for Real-Time Speech Frequency Visualizer
let sharedAudioElement = null;
let audioContext = null;
let analyserNode = null;
let sourceNode = null;
let visualizerAnimFrame = null;

function getSharedAudio() {
    if (!sharedAudioElement) {
        sharedAudioElement = new Audio();
        sharedAudioElement.crossOrigin = "anonymous";
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            try {
                audioContext = new AudioCtx();
                analyserNode = audioContext.createAnalyser();
                analyserNode.fftSize = 64; // 32 frequency bins
                analyserNode.smoothingTimeConstant = 0.75;
                sourceNode = audioContext.createMediaElementSource(sharedAudioElement);
                sourceNode.connect(analyserNode);
                analyserNode.connect(audioContext.destination);
            } catch (e) {
                console.warn('Web Audio setup notice:', e);
            }
        }
    }
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }
    return { audio: sharedAudioElement, analyser: analyserNode };
}

function startDynamicVisualizer() {
    stopDynamicVisualizer();
    const { analyser } = getSharedAudio();
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function updateVisuals() {
        if (!isSpeaking() && (!currentAudioPlayer || currentAudioPlayer.paused)) {
            stopDynamicVisualizer();
            return;
        }

        analyser.getByteFrequencyData(dataArray);

        // Calculate speech frequency energy
        let total = 0;
        const count = Math.min(18, dataArray.length);
        for (let i = 0; i < count; i++) {
            total += dataArray[i];
        }

        const now = performance.now() / 1000;
        const hasFrequencyData = total > 5;
        const energy = hasFrequencyData
            ? Math.min(1.0, (total / count) / 150)
            : (0.35 + Math.sin(now * 10) * 0.25 + Math.sin(now * 17) * 0.15);

        // 1. Modulate docked wave bars (5 frequency bands)
        const dockedBars = document.querySelectorAll('.docked-wave-bars span');
        if (dockedBars.length > 0) {
            const barIndices = [2, 5, 8, 12, 16];
            dockedBars.forEach((bar, i) => {
                let h;
                let op;
                if (hasFrequencyData) {
                    const idx = barIndices[i] || (i * 3);
                    const raw = dataArray[idx] || 0;
                    h = Math.max(4, Math.round((raw / 255) * 20));
                    op = 0.4 + (raw / 255) * 0.6;
                } else {
                    const wave = Math.sin(now * 8 + i * 1.4) * 0.4 + Math.sin(now * 15 + i * 2.3) * 0.3 + 0.5;
                    h = Math.round(4 + wave * 16);
                    op = 0.45 + wave * 0.55;
                }
                bar.style.height = `${h}px`;
                bar.style.opacity = `${op}`;
            });
        }

        // 2. Modulate voice conversation stage waveform (8 frequency bands)
        const stageBars = document.querySelectorAll('.voice-conversation-waveform span');
        if (stageBars.length > 0) {
            const stageIndices = [1, 3, 6, 9, 12, 15, 18, 22];
            stageBars.forEach((bar, i) => {
                let h;
                let op;
                if (hasFrequencyData) {
                    const idx = stageIndices[i] || (i * 2);
                    const raw = dataArray[idx] || 0;
                    h = Math.max(5, Math.round((raw / 255) * 34));
                    op = 0.4 + (raw / 255) * 0.6;
                } else {
                    const wave = Math.sin(now * 7 + i * 1.1) * 0.4 + Math.sin(now * 13 + i * 1.9) * 0.3 + 0.5;
                    h = Math.round(6 + wave * 26);
                    op = 0.45 + wave * 0.55;
                }
                bar.style.height = `${h}px`;
                bar.style.opacity = `${op}`;
            });
        }

        // 3. Modulate docked orb core & glow dynamically
        const dockedVisual = dom.dockedOrbVisual;
        if (dockedVisual) {
            const core = dockedVisual.querySelector('.voice-orb-core');
            const glow = dockedVisual.querySelector('.voice-orb-glow');
            if (core) core.style.transform = `scale(${1.0 + energy * 0.26})`;
            if (glow) {
                glow.style.transform = `scale(${1.15 + energy * 0.38})`;
                glow.style.opacity = `${0.65 + energy * 0.35}`;
            }
        }

        // 4. Modulate large central voice mode orb in real-time
        const largeOrb = dom.voiceConversationOrb;
        if (largeOrb) {
            const core = largeOrb.querySelector('.voice-orb-core');
            const glow = largeOrb.querySelector('.voice-orb-glow');
            const rings = largeOrb.querySelector('.voice-orb-rings');
            if (core) core.style.transform = `scale(${1.0 + energy * 0.3})`;
            if (glow) {
                glow.style.transform = `scale(${1.18 + energy * 0.45})`;
                glow.style.opacity = `${0.7 + energy * 0.3}`;
            }
            if (rings) rings.style.transform = `scale(${1.1 + energy * 0.25})`;
        }

        visualizerAnimFrame = requestAnimationFrame(updateVisuals);
    }

    visualizerAnimFrame = requestAnimationFrame(updateVisuals);
}

function stopDynamicVisualizer() {
    if (visualizerAnimFrame) {
        cancelAnimationFrame(visualizerAnimFrame);
        visualizerAnimFrame = null;
    }
    const allBars = document.querySelectorAll('.docked-wave-bars span, .voice-conversation-waveform span');
    allBars.forEach(b => {
        b.style.height = '';
        b.style.opacity = '';
    });
    const dockedVisual = dom.dockedOrbVisual;
    if (dockedVisual) {
        const core = dockedVisual.querySelector('.voice-orb-core');
        const glow = dockedVisual.querySelector('.voice-orb-glow');
        if (core) core.style.transform = '';
        if (glow) glow.style.transform = '';
    }
    const largeOrb = dom.voiceConversationOrb;
    if (largeOrb) {
        const core = largeOrb.querySelector('.voice-orb-core');
        const glow = largeOrb.querySelector('.voice-orb-glow');
        const rings = largeOrb.querySelector('.voice-orb-rings');
        if (core) core.style.transform = '';
        if (glow) glow.style.transform = '';
        if (rings) rings.style.transform = '';
    }
}

export function isSpeaking() {
    return isSpeechActive || (currentAudioPlayer && !currentAudioPlayer.paused);
}

function setOrbSpeakingState(active) {
    // 1. Voice Settings Modal Orb
    const voiceStage = document.getElementById('voiceStage');
    if (voiceStage) {
        if (active) voiceStage.classList.add('speaking');
        else voiceStage.classList.remove('speaking');
    }

    // 2. Docked Ambient Speech Orb (Smooth, silky fade-in & graceful float-out)
    const dockedOrb = dom.dockedSpeechOrb;
    const dockedVisual = dom.dockedOrbVisual;
    if (dockedOrb) {
        if (active) {
            dockedOrb.classList.remove('hidden');
            requestAnimationFrame(() => {
                dockedOrb.classList.add('visible');
            });
            if (dockedVisual) dockedVisual.classList.add('speaking');
        } else {
            dockedOrb.classList.remove('visible');
            if (dockedVisual) dockedVisual.classList.remove('speaking');
            setTimeout(() => {
                if (!isSpeaking() && dockedOrb) {
                    dockedOrb.classList.add('hidden');
                }
            }, 420);
        }
    }

    // 3. Pure Voice Conversation Stage (Large Central Orb)
    const convOrb = dom.voiceConversationOrb;
    if (convOrb) {
        if (active) {
            convOrb.classList.add('speaking');
        } else {
            convOrb.classList.remove('speaking');
        }
    }

    const voiceConvStage = document.getElementById('voiceConversationStage');
    if (voiceConvStage) {
        voiceConvStage.classList.toggle('speaking', !!active);
    }
    const statusEl = document.getElementById('voiceStageStatus');
    if (statusEl) {
        statusEl.textContent = active ? 'Speaking... (tap orb to stop)' : 'Tap orb to speak';
    }

    // 4. Drive Dynamic Web Audio Visualizer
    if (active) {
        startDynamicVisualizer();
    } else {
        stopDynamicVisualizer();
    }
}

export function stopSpeaking() {
    setOrbSpeakingState(false);

    // Stop Native HTML5 Audio Player
    if (currentAudioPlayer) {
        try {
            currentAudioPlayer.pause();
            currentAudioPlayer.currentTime = 0;
        } catch (e) {}
        currentAudioPlayer = null;
    }
    if (currentAudioUrl) {
        try {
            URL.revokeObjectURL(currentAudioUrl);
        } catch (e) {}
        currentAudioUrl = null;
    }

    // Stop Web Speech Synthesis fallback if running
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        try {
            window.speechSynthesis.cancel();
        } catch (e) {}
    }

    isSpeechActive = false;

    if (currentActiveSpeakerBtn) {
        setSpeakerButtonState(currentActiveSpeakerBtn, false);
        currentActiveSpeakerBtn = null;
    }

    // Update preview button state if active
    if (dom.previewVoiceBtn) {
        dom.previewVoiceBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>Preview Voice</span>';
        dom.previewVoiceBtn.classList.remove('btn-active-speaking');
    }
}

function setSpeakerButtonState(btn, active) {
    if (!btn) return;
    if (active) {
        btn.classList.add('speaking');
        btn.innerHTML = '<i class="fa-solid fa-stop" style="color: var(--accent-rose, #f43f5e);"></i>';
        btn.title = 'Stop reading aloud';
    } else {
        btn.classList.remove('speaking');
        btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        btn.title = 'Read aloud';
    }
}

/**
 * Strips code blocks, thoughts, and complex markdown formatting
 * and applies phonetic pronunciation rules for fluid, natural speech.
 */
export function cleanTextForSpeech(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text;

    // 1. Remove all internal thinking blocks completely
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');

    // 2. Remove tool call blocks and status notifications
    cleaned = cleaned.replace(/TOOL_CALL:[\s\S]*?(\n\n|$)/g, '');
    cleaned = cleaned.replace(/\[System Note:[\s\S]*?\]/g, '');

    // 3. Handle fenced code blocks gracefully
    cleaned = cleaned.replace(/```[\w]*\n[\s\S]*?\n```/g, ' ... ');

    // 4. Strip markdown formatting
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
    cleaned = cleaned.replace(/#{1,6}\s+/g, '');
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');
    cleaned = cleaned.replace(/>\s+/g, '');

    // 4b. Strip literal escaped newline/tab characters like \n, /n, \r, \t so TTS doesn't say "slash n"
    cleaned = cleaned.replace(/\\+n|\/n|\\+r|\\+t/gi, ' ');
    cleaned = cleaned.replace(/(?<=\s)[\\/]+(?=\s)/g, ' ');

    // 5. Normalize stutters (Wh-what -> What, h-h- hello -> hello, w-wait -> wait)
    cleaned = normalizeStutters(cleaned);

    // 6. Apply sovereign & anime pronunciation lexicon (hmph -> humph, baka -> bah-ka, nivm -> Nim)
    cleaned = applyClientPronunciations(cleaned);

    // 7. Clean punctuation & whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
}

/**
 * Main speech synthesis driver
 * Streams high-fidelity WAV from backend /api/tts with animated glowing orb.
 */
export async function speakText(rawText, buttonEl = null, onStartCallback = null, onEndCallback = null) {
    // If clicking the currently playing button, treat it as a stop toggle
    if (buttonEl && buttonEl === currentActiveSpeakerBtn && isSpeaking()) {
        stopSpeaking();
        return;
    }

    stopSpeaking();

    const clean = cleanTextForSpeech(rawText);
    if (!clean) return;

    currentActiveSpeakerBtn = buttonEl;
    if (currentActiveSpeakerBtn) {
        setSpeakerButtonState(currentActiveSpeakerBtn, true);
    }
    isSpeechActive = true;
    setOrbSpeakingState(true);

    if (onStartCallback) onStartCallback();

    try {
        const speedVal = parseFloat(voiceConfig.rate) || 1.00;
        const warmthVal = voiceConfig.warmth !== undefined ? parseFloat(voiceConfig.warmth) : 0.0;
        const voiceVal = voiceConfig.voiceUri || 'af_heart';

        const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: clean,
                voice: voiceVal,
                speed: speedVal,
                warmth: warmthVal
            })
        });

        if (!res.ok) {
            throw new Error(`Native TTS returned HTTP ${res.status}`);
        }

        const blob = await res.blob();
        currentAudioUrl = URL.createObjectURL(blob);
        const { audio } = getSharedAudio();
        currentAudioPlayer = audio;
        currentAudioPlayer.src = currentAudioUrl;

        const vol = parseFloat(voiceConfig.volume);
        currentAudioPlayer.volume = isNaN(vol) ? 1.0 : Math.max(0, Math.min(1, vol));

        currentAudioPlayer.onended = () => {
            stopSpeaking();
            if (onEndCallback) onEndCallback();
        };

        currentAudioPlayer.onerror = (err) => {
            console.warn('Native audio playback error:', err);
            stopSpeaking();
            if (onEndCallback) onEndCallback();
        };

        await currentAudioPlayer.play();
        return;
    } catch (err) {
        console.warn('Speech synthesis error:', err);
        stopSpeaking();
        if (onEndCallback) onEndCallback();
    }
}

/**
 * Initializes the Voice Customizer UI
 */
export async function setupVoiceUI() {
    const colorBtns = document.querySelectorAll('.voice-color-btn');

    // Set initial active color button
    const currentVoiceId = voiceConfig.voiceUri || 'af_heart';
    let activeBtn = document.querySelector(`.voice-color-btn[data-voice="${currentVoiceId}"]`);
    if (!activeBtn && colorBtns.length > 0) activeBtn = colorBtns[0];

    if (activeBtn) {
        colorBtns.forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
        applyVoiceAccent(currentVoiceId);
    } else {
        applyVoiceAccent('af_heart');
    }

    // Color Button Click Listeners (Voice 1 - 5)
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const voiceId = btn.getAttribute('data-voice');
            const num = btn.getAttribute('data-num');

            voiceConfig.voiceUri = voiceId;
            applyVoiceAccent(voiceId);
            saveVoiceConfig();

            // Instant speech preview tailored to each unique voice
            const greeting = VOICE_GREETINGS[num] || `Hello! This is Voice ${num}.`;
            speakText(greeting, null);
        });
    });

    // Sync Slider Displays
    function updateSliderDisplays() {
        if (dom.voiceWarmthSlider) {
            const warmthPct = Math.round((parseFloat(voiceConfig.warmth ?? 0.0)) * 100);
            dom.voiceWarmthSlider.value = warmthPct;
            if (dom.voiceWarmthVal) dom.voiceWarmthVal.textContent = `${warmthPct}%`;
        }
        if (dom.voiceRateSlider) {
            dom.voiceRateSlider.value = voiceConfig.rate || 1.00;
            if (dom.voiceRateVal) dom.voiceRateVal.textContent = `${parseFloat(voiceConfig.rate || 1.00).toFixed(2)}x`;
        }
        if (dom.autoSpeakToggle) {
            dom.autoSpeakToggle.checked = !!voiceConfig.autoSpeak;
        }
    }

    updateSliderDisplays();

    // Pace Slider Listener
    if (dom.voiceRateSlider) {
        dom.voiceRateSlider.addEventListener('input', (e) => {
            voiceConfig.rate = parseFloat(e.target.value);
            if (dom.voiceRateVal) dom.voiceRateVal.textContent = `${voiceConfig.rate.toFixed(2)}x`;
            saveVoiceConfig();
        });
    }

    // Expressivity / Warmth Slider Listener
    if (dom.voiceWarmthSlider) {
        dom.voiceWarmthSlider.addEventListener('input', (e) => {
            const pct = parseInt(e.target.value, 10);
            voiceConfig.warmth = pct / 100;
            if (dom.voiceWarmthVal) dom.voiceWarmthVal.textContent = `${pct}%`;
            saveVoiceConfig();
        });
    }

    // Auto-Speak Toggle
    if (dom.autoSpeakToggle) {
        dom.autoSpeakToggle.addEventListener('change', (e) => {
            voiceConfig.autoSpeak = e.target.checked;
            saveVoiceConfig();
        });
    }

    // Preview Voice Button
    if (dom.previewVoiceBtn) {
        dom.previewVoiceBtn.addEventListener('click', () => {
            if (isSpeaking()) {
                stopSpeaking();
                return;
            }

            // Find current active voice number
            const activeDot = document.querySelector('.voice-color-btn.active');
            const num = activeDot ? activeDot.getAttribute('data-num') : '1';

            const pool = VOICE_PREVIEWS[num] || VOICE_PREVIEWS['1'];
            const sampleText = pool[Math.floor(Math.random() * pool.length)];

            dom.previewVoiceBtn.innerHTML = '<i class="fa-solid fa-stop"></i><span>Stop Preview</span>';
            dom.previewVoiceBtn.classList.add('btn-active-speaking');

            speakText(sampleText, null, null, () => {
                if (dom.previewVoiceBtn) {
                    dom.previewVoiceBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>Preview Voice</span>';
                    dom.previewVoiceBtn.classList.remove('btn-active-speaking');
                }
            });
        });
    }

    // Modal Visibility Toggles
    if (dom.voiceBtn) {
        dom.voiceBtn.addEventListener('click', () => {
            if (dom.voiceModal) dom.voiceModal.classList.toggle('hidden');
        });
    }

    if (dom.closeVoiceBtn) {
        dom.closeVoiceBtn.addEventListener('click', () => {
            if (dom.voiceModal) dom.voiceModal.classList.add('hidden');
        });
    }

    if (dom.saveVoiceBtn) {
        dom.saveVoiceBtn.addEventListener('click', () => {
            saveVoiceConfig();
            if (dom.voiceModal) dom.voiceModal.classList.add('hidden');
        });
    }

    if (dom.resetVoiceBtn) {
        dom.resetVoiceBtn.addEventListener('click', () => {
            voiceConfig = { ...DEFAULT_CONFIG };
            updateSliderDisplays();
            const firstBtn = document.querySelector('.voice-color-btn[data-num="1"]');
            if (firstBtn) {
                colorBtns.forEach(b => b.classList.remove('active'));
                firstBtn.classList.add('active');
                updateAccent(firstBtn.getAttribute('data-color') || '#22c55e');
            }
            saveVoiceConfig();
        });
    }

    // Custom Pronunciation dictionary accordion & live preview
    setupPronunciationsUI();

    // Docked Speech Orb Stop Listener
    if (dom.dockedOrbStopBtn) {
        dom.dockedOrbStopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stopSpeaking();
        });
    }
    if (dom.dockedSpeechOrb) {
        dom.dockedSpeechOrb.addEventListener('click', (e) => {
            if (e.target.closest('.docked-orb-stop-btn')) return;
            stopSpeaking();
        });
    }

    // Voice Conversation Mode (Full-screen focus or collapsed dock)
    function toggleVoiceMode(forceState = null) {
        const chatViewport = dom.chatViewport;
        const toggleBtn = dom.voiceModeToggleBtn;
        const stage = dom.voiceConversationStage;
        if (!chatViewport) return;

        const shouldEnable = forceState !== null ? forceState : !chatViewport.classList.contains('voice-mode-active');
        if (shouldEnable) {
            applyVoiceAccent();
            document.body.classList.add('voice-mode-active');
            chatViewport.classList.add('voice-mode-active');
            if (toggleBtn) toggleBtn.classList.add('active');
            if (stage) stage.classList.remove('hidden');
            const statusEl = document.getElementById('voiceStageStatus');
            if (statusEl) statusEl.textContent = 'Tap orb to speak';
        } else {
            document.body.classList.remove('voice-mode-active');
            document.body.classList.remove('voice-mode-collapsed');
            chatViewport.classList.remove('voice-mode-active');
            if (toggleBtn) toggleBtn.classList.remove('active');
            if (stage) stage.classList.add('hidden');
            stopSpeaking();
            stopVoiceModeRecording(false);

            // Re-render conversation cleanly when idle so everything said/replied in voice mode is visible in normal chat
            if (!state.isGenerating) {
                renderActiveChat();
            }
            scrollToBottom();
        }
    }

    // Toggle between Full-Screen Immersive and Collapsed Bottom Dock
    function toggleVoiceDockMode() {
        const isCollapsed = document.body.classList.toggle('voice-mode-collapsed');
        const icon = document.getElementById('voiceDockBtnIcon');
        const label = document.getElementById('voiceDockBtnLabel');

        if (isCollapsed) {
            if (icon) icon.className = 'fa-solid fa-up-right-and-down-left-from-center';
            if (label) label.textContent = 'Expand';
            // Messages are already preserved in the DOM, smooth scroll to latest message
            scrollToBottom();
        } else {
            if (icon) icon.className = 'fa-solid fa-down-left-and-up-right-to-center';
            if (label) label.textContent = 'Collapse';
        }
    }

    const toggleDockBtn = document.getElementById('toggleVoiceDockBtn');
    if (toggleDockBtn) {
        toggleDockBtn.addEventListener('click', () => toggleVoiceDockMode());
    }

    if (dom.voiceModeToggleBtn) {
        dom.voiceModeToggleBtn.addEventListener('click', () => toggleVoiceMode());
    }
    if (dom.exitVoiceModeBtn) {
        dom.exitVoiceModeBtn.addEventListener('click', () => toggleVoiceMode(false));
    }

    // Robust Voice Conversation Recording with Live Audio Visualization, Filler Protection & Silence Detection
    let voiceModeStream = null;
    let voiceModeMediaRecorder = null;
    let voiceModeAudioChunks = [];
    let voiceModeAudioContext = null;
    let voiceModeAnalyser = null;
    let voiceModeAnimFrame = null;
    let voiceModeMaxTimer = null;
    let voiceModeSilenceTimer = null;
    let voiceModeHasSpoken = false;
    let voiceModeIsRecording = false;
    let voiceModeSpeechRec = null;
    let voiceModeTranscript = '';

    const FILLER_WORDS = new Set([
        'uh', 'um', 'umm', 'uhh', 'uhm', 'er', 'erm', 'ah', 'ahh', 'eh', 'hmm', 'hm', 'huh', 'mhm'
    ]);

    function isFillerOnly(text) {
        if (!text) return true;
        const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (!clean) return true;
        const words = clean.split(/\s+/).filter(Boolean);
        if (words.length === 0) return true;
        return words.every(w => FILLER_WORDS.has(w));
    }

    function clearVoiceSilenceTimer() {
        if (voiceModeSilenceTimer) {
            clearTimeout(voiceModeSilenceTimer);
            voiceModeSilenceTimer = null;
        }
    }

    function stopVoiceModeRecording(sendAfterStop = true) {
        if (!voiceModeIsRecording) return;
        voiceModeIsRecording = false;

        clearVoiceSilenceTimer();

        if (voiceModeMaxTimer) {
            clearTimeout(voiceModeMaxTimer);
            voiceModeMaxTimer = null;
        }
        if (voiceModeAnimFrame) {
            cancelAnimationFrame(voiceModeAnimFrame);
            voiceModeAnimFrame = null;
        }

        if (dom.voiceConversationOrb) {
            dom.voiceConversationOrb.classList.remove('listening');
        }
        if (dom.voiceConversationStage) {
            dom.voiceConversationStage.classList.remove('listening');
        }

        // Reset waveform bars
        const stageBars = document.querySelectorAll('.voice-conversation-waveform span');
        stageBars.forEach(bar => {
            bar.style.height = '6px';
            bar.style.opacity = '0.55';
        });

        if (voiceModeAudioContext && voiceModeAudioContext.state !== 'closed') {
            try { voiceModeAudioContext.close(); } catch (e) {}
            voiceModeAudioContext = null;
        }

        const statusEl = document.getElementById('voiceStageStatus');
        if (sendAfterStop) {
            if (statusEl) statusEl.textContent = 'Processing...';
        } else {
            if (statusEl) statusEl.textContent = 'Tap orb to speak';
        }

        // Allow Web Speech Recognition a brief moment (250ms) to flush its final phrase before submitting
        const finalizeAndSend = async () => {
            if (voiceModeSpeechRec) {
                try { voiceModeSpeechRec.stop(); } catch (e) {}
                voiceModeSpeechRec = null;
            }

            if (voiceModeStream) {
                voiceModeStream.getTracks().forEach(t => t.stop());
                voiceModeStream = null;
            }

            if (!sendAfterStop) {
                if (statusEl) statusEl.textContent = 'Tap orb to speak';
                return;
            }

            let promptText = '';

            // ALWAYS prioritize sovereign offline Faster-Whisper via /api/stt directly from recorded audio
            if (voiceModeAudioChunks.length > 0) {
                try {
                    if (statusEl) statusEl.textContent = 'Transcribing with Whisper...';
                    const mimeType = voiceModeMediaRecorder?.mimeType || 'audio/webm';
                    const audioBlob = new Blob(voiceModeAudioChunks, { type: mimeType });
                    const ext = mimeType.includes('wav') ? '.wav' : (mimeType.includes('ogg') ? '.ogg' : '.webm');
                    const formData = new FormData();
                    formData.append('audio', audioBlob, `voice_recording${ext}`);
                    const res = await fetch('/api/stt', {
                        method: 'POST',
                        body: formData
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.text) {
                            promptText = data.text.trim();
                        }
                    }

                    // If multimodal (mmproj/vision) is active, also attach raw audio to message payload
                    if (state.visionEnabled && audioBlob.size > 500) {
                        const audioFile = new File([audioBlob], `voice_input_${Date.now()}${ext}`, { type: audioBlob.type });
                        state.attachedImages.push({
                            file: audioFile,
                            type: audioBlob.type,
                            url: URL.createObjectURL(audioBlob)
                        });
                        if (window.renderImagePreviews) window.renderImagePreviews();
                    }
                } catch (sttErr) {
                    console.warn('Faster-Whisper STT notice:', sttErr);
                }
            }

            // Fallback only if /api/stt returned nothing
            if (!promptText && voiceModeTranscript) {
                promptText = voiceModeTranscript.trim();
            }

            if (!promptText && dom.userPrompt) {
                promptText = dom.userPrompt.value.trim();
            }

            if (promptText && !isFillerOnly(promptText)) {
                // Send transcribed speech text to the model
                if (statusEl) statusEl.textContent = `"${promptText}"`;
                if (dom.userPrompt) dom.userPrompt.value = promptText;
                if (dom.sendBtn) dom.sendBtn.click();
            } else if (promptText && isFillerOnly(promptText)) {
                // Hesitation or filler only, do not send empty filler to model
                if (statusEl) statusEl.textContent = 'Tap orb to speak';
            } else {
                // No words recognized
                if (statusEl) statusEl.textContent = 'Tap orb to speak';
            }
        };

        if (voiceModeMediaRecorder && voiceModeMediaRecorder.state === 'recording') {
            voiceModeMediaRecorder.onstop = () => {
                setTimeout(finalizeAndSend, 250);
            };
            try { voiceModeMediaRecorder.stop(); } catch (e) { finalizeAndSend(); }
        } else {
            setTimeout(finalizeAndSend, 250);
        }
    }

    async function startVoiceModeRecording() {
        if (voiceModeIsRecording) return;

        try {
            voiceModeStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            voiceModeIsRecording = true;
            voiceModeHasSpoken = false;
            voiceModeTranscript = '';
            voiceModeAudioChunks = [];
            clearVoiceSilenceTimer();

            if (dom.voiceConversationOrb) {
                dom.voiceConversationOrb.classList.add('listening');
            }
            if (dom.voiceConversationStage) {
                dom.voiceConversationStage.classList.add('listening');
            }

            const statusEl = document.getElementById('voiceStageStatus');
            if (statusEl) statusEl.textContent = 'Listening... say something';

            // Real-time audio analyser for orb & waveform visual modulation + Time-Domain VAD
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    voiceModeAudioContext = new AudioCtx();
                    const source = voiceModeAudioContext.createMediaStreamSource(voiceModeStream);
                    voiceModeAnalyser = voiceModeAudioContext.createAnalyser();
                    voiceModeAnalyser.fftSize = 256;
                    source.connect(voiceModeAnalyser);

                    const timeData = new Uint8Array(voiceModeAnalyser.fftSize);
                    const freqData = new Uint8Array(voiceModeAnalyser.frequencyBinCount);
                    const stageBars = document.querySelectorAll('.voice-conversation-waveform span');

                    let noiseFloor = 0.008;
                    let calibrationCount = 0;
                    let lastSpeechTimestamp = null;
                    let speechFrames = 0;

                    function updateMicMeter() {
                        if (!voiceModeIsRecording) return;

                        // Compute true Time-Domain RMS for accurate physical voice detection
                        voiceModeAnalyser.getByteTimeDomainData(timeData);
                        let sumSq = 0;
                        for (let i = 0; i < timeData.length; i++) {
                            const val = (timeData[i] - 128) / 128.0;
                            sumSq += val * val;
                        }
                        const rms = Math.sqrt(sumSq / timeData.length);

                        // Calibrate noise floor in the first 25 frames (~400ms)
                        if (calibrationCount < 25) {
                            noiseFloor = Math.max(0.004, noiseFloor * 0.75 + rms * 0.25);
                            calibrationCount++;
                        } else if (rms < noiseFloor * 1.5) {
                            noiseFloor = noiseFloor * 0.98 + rms * 0.02;
                        }

                        // Animate waveform bars from frequency data
                        voiceModeAnalyser.getByteFrequencyData(freqData);
                        if (stageBars.length > 0) {
                            const step = Math.max(1, Math.floor(freqData.length / stageBars.length));
                            stageBars.forEach((bar, idx) => {
                                const val = freqData[idx * step] || 0;
                                const barH = Math.max(6, Math.min(48, Math.round((val / 255) * 44 + 6)));
                                bar.style.height = `${barH}px`;
                                bar.style.opacity = `${0.5 + (val / 255) * 0.5}`;
                            });
                        }

                        // Speech is detected when RMS is distinctly above the noise floor
                        const speechThreshold = Math.max(0.026, noiseFloor * 2.3);
                        const isSpeakingNow = rms > speechThreshold;

                        if (isSpeakingNow) {
                            speechFrames++;
                            // Require at least 4 consecutive active frames (~60ms) to avoid single clicks
                            if (speechFrames >= 4) {
                                voiceModeHasSpoken = true;
                                lastSpeechTimestamp = performance.now();
                                clearVoiceSilenceTimer();
                                if (statusEl && !voiceModeTranscript) {
                                    statusEl.textContent = 'Listening... (tap orb to send)';
                                }
                            }
                        } else {
                            speechFrames = Math.max(0, speechFrames - 1);

                            // Only auto-send on silence if:
                            // 1. User has actually spoken
                            // 2. The spoken content is NOT just filler words ("uh", "um", etc.)
                            // 3. Silence has lasted for a generous, natural conversational pause (~2.2s)
                            if (voiceModeHasSpoken && lastSpeechTimestamp && !voiceModeSilenceTimer) {
                                const currentText = voiceModeTranscript.trim();
                                const isOnlyFiller = isFillerOnly(currentText);

                                if (!isOnlyFiller) {
                                    // For short statements (1-2 words), give 2.6s. For longer phrases, give 2.1s.
                                    const wordCount = currentText.split(/\s+/).filter(Boolean).length;
                                    const silenceDelay = wordCount <= 2 ? 2600 : 2100;
                                    const timeSinceSpeech = performance.now() - lastSpeechTimestamp;

                                    if (timeSinceSpeech >= silenceDelay) {
                                        stopVoiceModeRecording(true);
                                        return;
                                    }
                                } else if (currentText) {
                                    // User said only "uh" or "um" -> give them time and keep listening
                                    if (statusEl) statusEl.textContent = `Listening... "${currentText}..."`;
                                }
                            }
                        }

                        voiceModeAnimFrame = requestAnimationFrame(updateMicMeter);
                    }
                    updateMicMeter();
                }
            } catch (err) {
                console.warn('AudioContext setup skipped:', err);
            }

            // Start MediaRecorder
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : '';
            voiceModeMediaRecorder = new MediaRecorder(voiceModeStream, mimeType ? { mimeType } : undefined);
            voiceModeMediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) voiceModeAudioChunks.push(e.data);
            };
            voiceModeMediaRecorder.start(250);

            // In parallel, attempt Web Speech Recognition for live text transcription
            const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRec) {
                try {
                    voiceModeSpeechRec = new SpeechRec();
                    voiceModeSpeechRec.continuous = true;
                    voiceModeSpeechRec.interimResults = true;
                    voiceModeSpeechRec.lang = 'en-US';

                    voiceModeSpeechRec.onresult = (event) => {
                        let text = '';
                        let hasFinal = false;
                        for (let i = 0; i < event.results.length; ++i) {
                            text += event.results[i][0].transcript;
                            if (event.results[i].isFinal) hasFinal = true;
                        }

                        const trimmed = text.trim();
                        if (trimmed) {
                            voiceModeTranscript = trimmed;
                            voiceModeHasSpoken = true;

                            // If only filler ("uh", "um"), show as hesitation without triggering auto-send
                            if (isFillerOnly(trimmed)) {
                                if (statusEl) statusEl.textContent = `Listening... "${trimmed}..."`;
                                clearVoiceSilenceTimer();
                                return;
                            }

                            if (statusEl) statusEl.textContent = `Listening... ("${voiceModeTranscript}")`;
                            // Reset silence timer on every new speech chunk
                            clearVoiceSilenceTimer();

                            // Natural conversational pause: wait 2.2s after final phrase before auto-sending
                            // Giving the user ample time to pause, breathe, or continue
                            if (hasFinal) {
                                const words = trimmed.split(/\s+/).filter(Boolean);
                                const pauseMs = words.length <= 2 ? 2600 : 2200;
                                voiceModeSilenceTimer = setTimeout(() => {
                                    if (voiceModeIsRecording && voiceModeHasSpoken) {
                                        stopVoiceModeRecording(true);
                                    }
                                }, pauseMs);
                            }
                        }
                    };

                    voiceModeSpeechRec.onerror = (e) => {
                        console.warn('Web Speech Recognition non-fatal error:', e.error);
                    };

                    voiceModeSpeechRec.start();
                } catch (recErr) {
                    console.warn('Web Speech Recognition start error:', recErr);
                }
            }

            // Safeguard timeout (60 seconds)
            voiceModeMaxTimer = setTimeout(() => {
                if (voiceModeIsRecording) {
                    stopVoiceModeRecording(true);
                }
            }, 60000);

        } catch (permErr) {
            console.error('Mic access denied:', permErr);
            if (dom.voiceConversationOrb) {
                dom.voiceConversationOrb.classList.remove('listening');
            }
            if (statusEl) statusEl.textContent = 'Microphone access denied';
            if (window.showNotification) {
                window.showNotification('Microphone access denied. Please allow microphone in browser settings.', 'error');
            }
        }
    }

    if (dom.voiceConversationOrb) {
        dom.voiceConversationOrb.addEventListener('click', () => {
            if (isSpeaking()) {
                stopSpeaking();
                return;
            }

            if (voiceModeIsRecording) {
                // If user manually taps the orb to send, send immediately
                stopVoiceModeRecording(true);
            } else {
                startVoiceModeRecording();
            }
        });
    }
}
