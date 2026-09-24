export let state = {
    conversations: [],
    activeChatId: null,
    selectedModel: localStorage.getItem('nivm_lastModel') || 'coder',
    userName: localStorage.getItem('nivm_userName') || '',
    aiName: localStorage.getItem('nivm_ai_name') || 'nivm',
    // System prompt is dynamically loaded from backend /api/config (core/config.py is the single source of truth)
    systemPrompt: '',
    personalityPrompt: localStorage.getItem('nivm_personality_prompt') || '',
    personalityPreset: localStorage.getItem('nivm_personality_preset') || 'balanced',
    savedPersonas: JSON.parse(localStorage.getItem('nivm_saved_personas') || '[]'),
    nsfwMode: localStorage.getItem('nivm_nsfw_mode') === 'true',
    temperature: parseFloat(localStorage.getItem('nivm_temperature') || '0.6'),
    repeatPenalty: parseFloat(localStorage.getItem('nivm_repeat_penalty') || '1.1'),
    topP: parseFloat(localStorage.getItem('nivm_top_p') || '0.9'),
    maxTokens: 1024,
    lmStudioUrl: '',
    apiKey: '',
    engineMode: 'native',
    inferenceMode: 'single',
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
    usageStats: JSON.parse(localStorage.getItem('nivm_usageStats') || '{"totalTokens": 0, "totalCost": 0, "totalDurationSec": 0}'),
    memory: {},
    enabledTools: (() => {
        const stored = JSON.parse(localStorage.getItem('nivm_enabledTools') || '{"read_memory": true, "write_memory": true, "execute_terminal": false, "end_conversation": true, "generate_image": true, "edit_image": true, "generate_anime_image": true}');
        if (stored.end_conversation === undefined) stored.end_conversation = true;
        if (stored.generate_image === undefined) stored.generate_image = true;
        if (stored.edit_image === undefined) stored.edit_image = true;
        if (stored.generate_anime_image === undefined) stored.generate_anime_image = true;
        return stored;
    })(),
    terminalSecurityMode: localStorage.getItem('nivm_terminalSecurityMode') || 'dangerous',
    visionEnabled: false,
    attachedImages: [],
    lastGeneratedImage: ''
};

export let themeState = JSON.parse(localStorage.getItem('nivm_theme_config') || JSON.stringify({
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
    auroraSpeed: 1.0
}));
if (!themeState.fontFamily) {
    themeState.fontFamily = 'monocraft';
}
if (themeState.mutedColor === undefined) {
    themeState.mutedColor = null;
}
if (themeState.bgMotion === 'embers') {
    themeState.bgMotion = 'hexgrid';
}
if (themeState.circuitSpeed === undefined) themeState.circuitSpeed = 1.2;
if (themeState.hexSpeed === undefined) themeState.hexSpeed = 1.0;
if (themeState.auroraSpeed === undefined) themeState.auroraSpeed = 1.0;

export function saveThemeConfig() {
    localStorage.setItem('nivm_theme_config', JSON.stringify(themeState));
}

// Purge legacy plaintext chats from client localStorage for security
try {
    localStorage.removeItem('nivm_saved_chats');
} catch (e) {}

export function saveConversations() {
    try {
        if (Array.isArray(state.conversations)) {
            fetch('/api/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.conversations)
            }).catch(err => {
                console.error("Failed to save chats to server:", err);
            });
        }
    } catch (err) {
        console.error("Failed to initiate chats save:", err);
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
