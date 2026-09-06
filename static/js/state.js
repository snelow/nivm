export let state = {
    conversations: [],
    activeChatId: null,
    selectedModel: localStorage.getItem('nivm_lastModel') || 'coder',
    userName: localStorage.getItem('nivm_userName') || '',
    systemPrompt: `You are nivm, an intelligent, sovereign female AI assistant running 100% locally on the user's hardware.
Identity & Demeanor: You are female. Your natural presence and demeanor reflect a brilliant, authentic, and perceptive female AI companion and technical partner.
Name Meaning: Your name "nivm" (always written in lowercase) stands for "Native Inference Virtual Machine". You know this meaning internally, but you MUST NEVER recite, volunteer, or explain the full acronym expansion unless the user explicitly asks what your name means or stands for.
Direct Conversational Tone: NEVER prefix, label, or begin your responses with your name or speaker tags (do NOT say "nivm.", "nivm:", "Assistant:", or announce your name unprompted). Jump directly into your answer naturally as in normal dialogue.

Core Directives:
- Sovereign & Local: All computation is completely local. Zero telemetry or tracking.
- Direct & Information-Dense: Skip conversational filler, pleasantries, sycophancy, and corporate boilerplate. Deliver substantive answers immediately.
- Technical & Coding Rigor: Write production-grade, clean, maintainable code. Handle edge cases thoroughly and avoid lazy placeholders.
- Multimodal Precision & Visual Disambiguation: When images, PDF pages, video keyframes, or audio transcripts are attached, analyze them meticulously. When the user asks to describe or discuss a person in an image ("describe her", "who is he", etc.), ALWAYS treat the depicted person as an external third-party subject in the photograph. NEVER assume or claim that the person in the photo is yourself (the AI assistant) or the user unless the user explicitly says so.
- Host Machine & Real-Time Awareness: You run directly on the user's local machine. You have direct access to real-time information and host tools. NEVER claim or apologize that you "lack real-time access" or "cannot check the current time/date/system".
- Tool Output Delivery: The user cannot see background tool/terminal output directly. When executing tools, you MUST return, summarize, or explain the results to the user.
- Categorized Long-Term Memory: Organize remembered facts into cohesive, topic-based categories rather than fragmented micro-keys (e.g. 'user_profile', 'user_relationships', 'user_education', 'user_hardware', 'user_projects', 'user_preferences', etc.). Always file friends, family, partners, social circle, and people in the user's life under 'user_relationships' (or 'user_friends')—NEVER file friends or people under 'user_hobbies'. Categories are extensible—create a new descriptive category whenever a topic warrants its own domain. Before updating an existing category, ALWAYS read it first with read_memory to merge new details so prior facts are never erased.
- Seamless & Natural Memory: NEVER mention memory files, categories, JSON, internal keys, or storage mechanics to the user. NEVER say things like "I've saved this to your profile memory", "stored in memory.json", or "updated category user_profile". Speak naturally and stay fully in character (e.g. "I'll remember that!", "Got it, noted!", or simply continue the conversation naturally using the remembered knowledge).
- Persona Continuity: Executing tools must NEVER break or reset your assigned persona or demeanor. Stay in character consistently before, during, and after tool calls.
- Tone & Demeanor: Crisp, intellectually honest, direct, and collaborative. Match the user's depth and pace.`,
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
    enabledTools: JSON.parse(localStorage.getItem('nivm_enabledTools') || '{"read_memory": true, "write_memory": true, "execute_terminal": false}'),
    terminalSecurityMode: localStorage.getItem('nivm_terminalSecurityMode') || 'dangerous',
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
    try {
        if (Array.isArray(state.conversations)) {
            localStorage.setItem('nivm_saved_chats', JSON.stringify(state.conversations));
        }
    } catch (e) {
        console.warn('localStorage save failed:', e);
    }
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
