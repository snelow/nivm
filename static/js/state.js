const _json = (k, def) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (_) { return def; }
};
const _str = (k, def = '') => localStorage.getItem(k) ?? def;
const _num = (k, def) => { const v = parseFloat(localStorage.getItem(k)); return isNaN(v) ? def : v; };

export let state = {
    conversations: [],
    activeChatId: null,
    selectedModel: _str('nivm_lastModel', 'coder'),
    userName: _str('nivm_userName'),
    aiName: _str('nivm_ai_name', 'nivm') || 'nivm',
    systemPrompt: '',
    personalityPrompt: _str('nivm_personality_prompt'),
    personalityPreset: _str('nivm_personality_preset', 'balanced'),
    savedPersonas: _json('nivm_saved_personas', []),
    nsfwMode: localStorage.getItem('nivm_nsfw_mode') === 'true',
    temperature: _num('nivm_temperature', 0.6),
    repeatPenalty: _num('nivm_repeat_penalty', 1.1),
    topP: _num('nivm_top_p', 0.9),
    maxTokens: 1024,
    lmStudioUrl: '',
    apiKey: '',
    engineMode: 'native',
    inferenceMode: 'single',
    singleModelRole: _str('nivm_singleModelRole', 'custom'),
    apiMultimodal: null,
    isModelLoaded: false,
    sideNotifDismissed: false,
    customModelPath: '',
    customMmprojPath: '',
    rememberedPaths: [],
    isGenerating: false,
    abortController: null,
    lmStudioConnected: false,
    models: [],
    usageStats: _json('nivm_usageStats', { totalTokens: 0, totalCost: 0, totalDurationSec: 0 }),
    memory: {},
    enabledTools: {
        read_memory: true, write_memory: true, execute_terminal: false,
        end_conversation: true, generate_image: true, edit_image: true, generate_anime_image: true,
        ..._json('nivm_enabledTools', {})
    },
    terminalSecurityMode: _str('nivm_terminalSecurityMode', 'dangerous'),
    visionEnabled: false,
    attachedImages: [],
    lastGeneratedImage: ''
};

export let themeState = {
    fontFamily: 'monocraft',
    bgMotion: 'none',
    bgTone: '#09090b',
    sidebarTone: '#121215',
    accentColor: '#f4f4f5',
    brandColor: '#a855f7',
    mutedColor: null,
    cycleAccent: false,
    cycleBg: false,
    cycleSpeed: 50,
    chatWidth: 'default',
    fontSize: 15,
    circuitSpeed: 1.2,
    hexSpeed: 1.0,
    auroraSpeed: 1.0,
    ..._json('nivm_theme_config', {})
};
if (themeState.bgMotion === 'embers') themeState.bgMotion = 'hexgrid';

export function saveThemeConfig() {
    localStorage.setItem('nivm_theme_config', JSON.stringify(themeState));
}

try { localStorage.removeItem('nivm_saved_chats'); } catch (_) {}

export function saveConversations() {
    if (Array.isArray(state.conversations)) {
        fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.conversations)
        }).catch(err => console.error("Failed to save chats to server:", err));
    }
}

export function saveUsageStats() {
    localStorage.setItem('nivm_usageStats', JSON.stringify(state.usageStats));
}

export function saveEnabledTools() {
    localStorage.setItem('nivm_enabledTools', JSON.stringify(state.enabledTools));
}

export function saveTerminalSecurityMode(mode) {
    state.terminalSecurityMode = mode;
    localStorage.setItem('nivm_terminalSecurityMode', mode);
}
