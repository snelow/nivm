import { saveChats } from './api.js';

export let state = {
    conversations: [],
    activeChatId: null,
    selectedModel: localStorage.getItem('nivm_lastModel') || 'qwen3.5-2b-claude-4.6-os-auto-variable-heretic-uncensored-thinking',
    userName: localStorage.getItem('nivm_userName') || '',
    systemPrompt: 'You are nivm, an intelligent and helpful local AI assistant created to assist users. Your name is nivm (all lowercase). Always identify yourself solely as nivm. Never claim to be Microsoft Phi, OpenAI, ChatGPT, or any other entity. Always maintain a lowercase spelling of your name.',
    temperature: 0.7,
    maxTokens: 1024,
    lmStudioUrl: 'http://127.0.0.1:1234/v1',
    apiKey: '',
    engineMode: 'api', // 'api' or 'native'
    isGenerating: false,
    abortController: null,
    lmStudioConnected: false,
    models: [],
    usageStats: JSON.parse(localStorage.getItem('nivm_usageStats') || '{"totalTokens": 0, "totalCost": 0, "totalDurationSec": 0}'),
    memory: {},
    enabledTools: JSON.parse(localStorage.getItem('nivm_enabledTools') || '{"read_memory": true, "write_memory": true}'),
    visionEnabled: false,
    attachedImages: []
};

export let themeState = JSON.parse(localStorage.getItem('nivm_theme_config') || JSON.stringify({
    bgMotion: 'none',
    bgTone: '#09090b',
    sidebarTone: '#121215',
    accentColor: '#f4f4f5',
    cycleAccent: false,
    cycleBg: false,
    cycleSpeed: 50,
    chatWidth: 'default',
    fontSize: 15
}));

export function saveThemeConfig() {
    localStorage.setItem('nivm_theme_config', JSON.stringify(themeState));
}

export function saveConversations() {
    saveChats(state.conversations);
}

export function saveUsageStats() {
    localStorage.setItem('nivm_usageStats', JSON.stringify(state.usageStats));
}

export function saveEnabledTools() {
    localStorage.setItem('nivm_enabledTools', JSON.stringify(state.enabledTools));
}
