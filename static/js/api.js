import { state, saveConversations, themeState, saveThemeConfig, saveEnabledTools, saveTerminalSecurityMode } from './state.js';
import { dom } from './dom.js';

// Unified HTTP request wrapper with automatic JSON serialization and error unwrapping
export async function apiFetch(url, options = {}) {
    const opts = { cache: 'no-store', ...options };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
        opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
            else if (err?.error) msg = err.error;
        } catch (_) {}
        throw new Error(msg);
    }
    const cType = res.headers.get('content-type') || '';
    return cType.includes('application/json') ? res.json() : res.text();
}

export async function apiFetchSafe(url, options = {}, fallback = null) {
    try {
        return await apiFetch(url, options);
    } catch (_) {
        return fallback;
    }
}

// Helper: set slider + val span for a role prefix
function _setSlider(slider, valSpan, value, isGpu) {
    if (slider) slider.value = value;
    if (!valSpan) return;
    if (isGpu) {
        const layers = parseInt(slider?.dataset?.totalLayers || slider?.max || '128', 10);
        const numVal = parseInt(value, 10);
        if (numVal === -1) {
            valSpan.textContent = layers > 0 && layers < 128 ? `-1 (All ${layers} Layers)` : '-1 (Max)';
        } else if (numVal === 0) {
            valSpan.textContent = '0 (CPU only)';
        } else if (layers > 0 && layers < 128) {
            valSpan.textContent = `${numVal} / ${layers} Layers (${Math.min(100, Math.round((numVal / layers) * 100))}% GPU)`;
        } else {
            valSpan.textContent = String(numVal);
        }
    } else {
        valSpan.textContent = value;
    }
}

// Helper: read per-role config from DOM into a flat settings object
function _readRoleFromDom(prefix) {
    const p = prefix.replace(/([A-Z])/g, '_$1').toLowerCase();
    const g = dom[prefix + 'GpuSlider'], c = dom[prefix + 'CtxSlider'], b = dom[prefix + 'BatchSlider'], k = dom[prefix + 'KvSelect'];
    return {
        [`${p}_gpu_layers`]: g ? parseInt(g.value) : -1,
        [`${p}_ctx`]: c ? parseInt(c.value) : 8192,
        [`${p}_batch`]: b ? parseInt(b.value) : 512,
        [`${p}_kv_type`]: k ? k.value : 'f16',
        [`${p}_flash_attn`]: dom[prefix + 'FlashAttn'] ? dom[prefix + 'FlashAttn'].checked : true,
        [`${p}_offload_kqv`]: dom[prefix + 'OffloadKqv'] ? dom[prefix + 'OffloadKqv'].checked : true,
        [`${p}_use_mlock`]: dom[prefix + 'Mlock'] ? dom[prefix + 'Mlock'].checked : false,
        [`${p}_use_mmap`]: dom[prefix + 'Mmap'] ? dom[prefix + 'Mmap'].checked : true,
    };
}

// Helper: populate per-role DOM controls from settings data
function _populateRoleDom(prefix, data, settingsPrefix) {
    _setSlider(dom[prefix + 'GpuSlider'], dom[prefix + 'GpuVal'], data[settingsPrefix + '_gpu_layers'] ?? -1, true);
    _setSlider(dom[prefix + 'CtxSlider'], dom[prefix + 'CtxVal'], data[settingsPrefix + '_ctx'] ?? 8192, false);
    _setSlider(dom[prefix + 'BatchSlider'], dom[prefix + 'BatchVal'], data[settingsPrefix + '_batch'] ?? 512, false);
    if (dom[prefix + 'KvSelect']) dom[prefix + 'KvSelect'].value = data[settingsPrefix + '_kv_type'] || 'f16';
    if (dom[prefix + 'FlashAttn']) dom[prefix + 'FlashAttn'].checked = data[settingsPrefix + '_flash_attn'] !== false;
    if (dom[prefix + 'OffloadKqv']) dom[prefix + 'OffloadKqv'].checked = data[settingsPrefix + '_offload_kqv'] !== false;
    if (dom[prefix + 'Mlock']) dom[prefix + 'Mlock'].checked = !!data[settingsPrefix + '_use_mlock'];
    if (dom[prefix + 'Mmap']) dom[prefix + 'Mmap'].checked = data[settingsPrefix + '_use_mmap'] !== false;
}

function _isUrlVal(val) {
    if (!val || typeof val !== 'string') return false;
    const v = val.trim().toLowerCase();
    return v.startsWith('http://') || v.startsWith('https://') || v.includes('googleapis') || v.includes('generativelanguage') || v.includes('groq.com') || v.includes('/v1');
}

export async function fetchApiSettings() {
    const data = await apiFetchSafe('/api/settings');
    if (!data) return;

    state.engineMode = 'native';
    const inferenceMode = data.inference_mode || localStorage.getItem('nivm_inference_mode') || 'single';
    state.inferenceMode = inferenceMode;
    try { localStorage.setItem('nivm_inference_mode', inferenceMode); } catch (_) {}

    const isApi = inferenceMode === 'api';

    if (dom.routingModeBtn && dom.singleModeBtn) {
        dom.routingModeBtn.classList.toggle('active', inferenceMode === 'routing');
        dom.singleModeBtn.classList.toggle('active', inferenceMode === 'single');
        if (dom.apiModeBtn) dom.apiModeBtn.classList.toggle('active', isApi);

        if (dom.routingModePanel) dom.routingModePanel.classList.toggle('hidden', inferenceMode !== 'routing');
        if (dom.singleModePanel) dom.singleModePanel.classList.toggle('hidden', inferenceMode !== 'single');
        if (dom.apiModePanel) dom.apiModePanel.classList.toggle('hidden', !isApi);

        ['memoryEstimatorCard', 'smartEngineSection'].forEach(k => {
            if (dom[k]) dom[k].classList.toggle('hidden', isApi);
        });
        if (dom.downloadModelSection) dom.downloadModelSection.classList.remove('hidden');
    }

    if (isApi) {
        state.isModelLoaded = true;
        if (dom.engineStatusText) {
            dom.engineStatusText.textContent = `API: ${data.api_model || state.selectedModel || 'Connected'}`;
            dom.engineStatusText.style.color = "var(--accent-cyan, #06b6d4)";
        }
        if (window.updateModelAvailabilityUI) window.updateModelAvailabilityUI(true);
    }
    if (window.updateVisionAvailabilityUI) window.updateVisionAvailabilityUI();

    state.singleModelRole = data.single_model_role || 'custom';
    localStorage.setItem('nivm_singleModelRole', state.singleModelRole);
    if (dom.singleModelRoleSelect) dom.singleModelRoleSelect.value = state.singleModelRole;

    state.customModelPath = data.custom_model_path || '';
    state.customMmprojPath = data.custom_mmproj_path || '';
    state.rememberedPaths = data.remembered_model_paths || [];
    if (dom.customModelPathInput) dom.customModelPathInput.value = state.customModelPath;
    if (dom.customMmprojInput) dom.customMmprojInput.value = state.customMmprojPath;
    if (dom.customMmprojCpu) dom.customMmprojCpu.checked = data.custom_mmproj_use_gpu === false;
    if (dom.visionMmprojCpu) dom.visionMmprojCpu.checked = data.vision_mmproj_use_gpu === false;
    if (dom.pdfDpiSelect) dom.pdfDpiSelect.value = String(data.pdf_render_dpi || 150);

    // Verify and prefill status pills for saved custom model and projector
    if (window.verifyPathStatus) {
        if (dom.customModelPathStatus) window.verifyPathStatus(state.customModelPath, dom.customModelPathStatus);
        if (dom.customMmprojStatus) window.verifyPathStatus(state.customMmprojPath, dom.customMmprojStatus, true);
    }

    if (dom.apiBaseUrl && data.api_base_url) dom.apiBaseUrl.value = data.api_base_url;
    if (dom.apiChatUrl && data.api_chat_url) dom.apiChatUrl.value = data.api_chat_url;
    if (dom.apiKeyInput && data.api_key !== undefined) dom.apiKeyInput.value = data.api_key;
    if (data.api_model) {
        if (dom.apiModelInput) dom.apiModelInput.value = data.api_model;
        if (dom.apiModelSelect) {
            let optExists = Array.from(dom.apiModelSelect.options).some(o => o.value === data.api_model);
            if (!optExists) {
                const opt = document.createElement('option');
                opt.value = data.api_model;
                opt.textContent = data.api_model;
                dom.apiModelSelect.insertBefore(opt, dom.apiModelSelect.firstChild);
            }
            dom.apiModelSelect.value = data.api_model;
        }
        if (isApi) {
            state.selectedModel = data.api_model;
            localStorage.setItem('nivm_lastModel', data.api_model);
        }
    }

    const isMm = (data.api_multimodal !== undefined && data.api_multimodal !== null)
        ? Boolean(data.api_multimodal)
        : (window.isMultimodalModel ? window.isMultimodalModel(data.api_model || '', data.api_base_url || '') : false);
    state.apiMultimodal = isMm;
    if (dom.apiMultimodalCheck) dom.apiMultimodalCheck.checked = isMm;

    const supported = window.isVisionSupported ? window.isVisionSupported() : false;
    if (window.setVisionEnabled) window.setVisionEnabled(supported);
    else if (window.updateVisionAvailabilityUI) window.updateVisionAvailabilityUI();

    if (dom.customModelCard) dom.customModelCard.classList.remove('hidden');

    _populateRoleDom('router', data, 'router');
    _populateRoleDom('coder', data, 'coder');
    _populateRoleDom('vision', data, 'vision');
    _populateRoleDom('single', data, data.single_model_role || 'coder');

    // --- Personalization & Client Preference Synchronization ---
    let needsInitialSync = false;

    // 1. User Name (Sanitize against previous autofill leaks)
    if (_isUrlVal(state.userName)) {
        state.userName = '';
        localStorage.removeItem('nivm_userName');
    }
    if (data.user_name !== undefined && data.user_name !== null && !_isUrlVal(data.user_name)) {
        if (data.user_name.trim()) {
            state.userName = data.user_name.trim();
            localStorage.setItem('nivm_userName', state.userName);
        } else if (state.userName && !_isUrlVal(state.userName)) {
            needsInitialSync = true;
        }
    } else if (state.userName && !_isUrlVal(state.userName)) {
        needsInitialSync = true;
    }
    if (dom.userNameInput) dom.userNameInput.value = state.userName;

    // 2. AI Name
    if (data.ai_name && typeof data.ai_name === 'string') {
        state.aiName = data.ai_name.trim() || 'nivm';
        if (state.aiName !== 'nivm') {
            localStorage.setItem('nivm_ai_name', state.aiName);
        } else {
            localStorage.removeItem('nivm_ai_name');
        }
        if (dom.aiNameInput) dom.aiNameInput.value = (state.aiName !== 'nivm') ? state.aiName : '';
    } else if (state.aiName && state.aiName !== 'nivm') {
        needsInitialSync = true;
    }
    if (window.updateAssistantNameUI) window.updateAssistantNameUI();

    // 3. Personality Prompt & Preset
    if (data.personality_prompt !== undefined && data.personality_prompt !== null) {
        if (data.personality_prompt) {
            state.personalityPrompt = data.personality_prompt;
            localStorage.setItem('nivm_personality_prompt', state.personalityPrompt);
            if (dom.personalityTextarea) dom.personalityTextarea.value = state.personalityPrompt;
        } else if (state.personalityPrompt) {
            needsInitialSync = true;
        }
    }
    if (data.personality_preset) {
        state.personalityPreset = data.personality_preset;
        localStorage.setItem('nivm_personality_preset', state.personalityPreset);
    } else if (state.personalityPreset && state.personalityPreset !== 'balanced') {
        needsInitialSync = true;
    }
    if (Array.isArray(data.saved_personas) && data.saved_personas.length > 0) {
        state.savedPersonas = data.saved_personas;
        localStorage.setItem('nivm_saved_personas', JSON.stringify(state.savedPersonas));
    } else if (Array.isArray(state.savedPersonas) && state.savedPersonas.length > 0) {
        needsInitialSync = true;
    }
    if (window.renderPersonalityDropdown) {
        window.renderPersonalityDropdown(state.personalityPreset || 'balanced');
    }

    // 4. NSFW Mode
    if (data.nsfw_mode !== undefined && data.nsfw_mode !== null) {
        state.nsfwMode = Boolean(data.nsfw_mode);
        localStorage.setItem('nivm_nsfw_mode', state.nsfwMode);
        if (dom.nsfwToggle) dom.nsfwToggle.checked = state.nsfwMode;
        if (dom.nsfwFireIcon) dom.nsfwFireIcon.style.color = state.nsfwMode ? '#fb7185' : 'var(--text-muted)';
    }

    // 5. Theme State
    if (data.theme_state && typeof data.theme_state === 'object' && Object.keys(data.theme_state).length > 0) {
        Object.assign(themeState, data.theme_state);
        saveThemeConfig();
        if (window.applyThemeState) window.applyThemeState();
    } else if (localStorage.getItem('nivm_theme_config')) {
        needsInitialSync = true;
    }

    // 6. Voice & Speech Settings
    if (data.voice_config && typeof data.voice_config === 'object') {
        localStorage.setItem('nivm_voice_config', JSON.stringify(data.voice_config));
        if (window.reloadVoiceConfig) window.reloadVoiceConfig();
    }
    if (data.stt_engine) localStorage.setItem('nivm_stt_engine', data.stt_engine);
    if (data.whisper_model) localStorage.setItem('nivm_whisper_model', data.whisper_model);

    // 7. Generation Sampling Parameters
    if (data.temperature !== undefined && data.temperature !== null) {
        state.temperature = parseFloat(data.temperature);
        localStorage.setItem('nivm_temperature', state.temperature);
    }
    if (data.repeat_penalty !== undefined && data.repeat_penalty !== null) {
        state.repeatPenalty = parseFloat(data.repeat_penalty);
        localStorage.setItem('nivm_repeat_penalty', state.repeatPenalty);
    }
    if (data.top_p !== undefined && data.top_p !== null) {
        state.topP = parseFloat(data.top_p);
        localStorage.setItem('nivm_top_p', state.topP);
    }

    // 8. Tool Toggles & Security Mode
    if (data.enabled_tools && typeof data.enabled_tools === 'object') {
        state.enabledTools = { ...state.enabledTools, ...data.enabled_tools };
        saveEnabledTools();
    }
    if (data.terminal_security_mode) {
        state.terminalSecurityMode = data.terminal_security_mode;
        saveTerminalSecurityMode(data.terminal_security_mode);
    }

    // 9. Downloader Parallel Connections
    const savedConn = data.downloader_connections !== undefined && data.downloader_connections !== null
        ? parseInt(data.downloader_connections, 10)
        : parseInt(localStorage.getItem('nivm_downloader_connections') || '4', 10);
    state.downloaderConnections = savedConn;
    localStorage.setItem('nivm_downloader_connections', savedConn);
    if (dom.aria2ConnectionsSlider) {
        dom.aria2ConnectionsSlider.value = savedConn;
    }
    if (dom.aria2ConnectionsVal) {
        dom.aria2ConnectionsVal.textContent = `${savedConn} connection${savedConn > 1 ? 's' : ''}`;
    }
    if (dom.aria2PresetChips) {
        dom.aria2PresetChips.querySelectorAll('.conn-preset-chip').forEach(chip => {
            chip.classList.toggle('active', parseInt(chip.dataset.conn, 10) === savedConn);
        });
    }

    if (window.setupDynamicGreeting) window.setupDynamicGreeting();

    if (needsInitialSync) {
        saveApiSettings().catch(() => {});
    }
}

export async function saveApiSettings() {
    const inferenceMode = state.inferenceMode || 'single';
    const singleRole = dom.singleModelRoleSelect ? dom.singleModelRoleSelect.value : 'custom';
    const activeApiModel = (dom.apiModelSelect && dom.apiModelSelect.value && dom.apiModelSelect.value !== '__custom__')
        ? dom.apiModelSelect.value
        : (dom.apiModelInput?.value.trim() || state.selectedModel || 'llama-3.3-70b-versatile');

    try { localStorage.setItem('nivm_inference_mode', inferenceMode); } catch (_) {}
    if (inferenceMode === 'api') {
        state.selectedModel = activeApiModel;
        try { localStorage.setItem('nivm_lastModel', activeApiModel); } catch (_) {}
    }

    let voiceCfg = null;
    try {
        const raw = localStorage.getItem('nivm_voice_config');
        if (raw) voiceCfg = JSON.parse(raw);
    } catch (_) {}

    const payload = {
        engine_mode: 'native',
        inference_mode: inferenceMode,
        single_model_role: singleRole,
        custom_model_path: (dom.customModelPathInput?.value ? dom.customModelPathInput.value.trim() : '') || (state.customModelPath || ''),
        custom_mmproj_path: (dom.customMmprojInput?.value ? dom.customMmprojInput.value.trim() : '') || (state.customMmprojPath || ''),
        custom_mmproj_use_gpu: dom.customMmprojCpu ? !dom.customMmprojCpu.checked : true,
        vision_mmproj_use_gpu: dom.visionMmprojCpu ? !dom.visionMmprojCpu.checked : true,
        pdf_render_dpi: dom.pdfDpiSelect ? parseInt(dom.pdfDpiSelect.value) : 150,
        api_base_url: dom.apiBaseUrl ? dom.apiBaseUrl.value.trim() : '',
        api_chat_url: dom.apiChatUrl ? dom.apiChatUrl.value.trim() : '',
        api_key: dom.apiKeyInput ? dom.apiKeyInput.value.trim() : '',
        api_model: activeApiModel,
        api_multimodal: dom.apiMultimodalCheck ? dom.apiMultimodalCheck.checked : (state.apiMultimodal ?? false),
        remembered_model_paths: state.rememberedPaths || [],
        user_name: _isUrlVal(state.userName) ? '' : (state.userName || ''),
        ai_name: state.aiName || 'nivm',
        personality_prompt: state.personalityPrompt || '',
        personality_preset: state.personalityPreset || 'balanced',
        saved_personas: state.savedPersonas || [],
        nsfw_mode: !!state.nsfwMode,
        theme_state: themeState || null,
        temperature: state.temperature ?? 0.6,
        repeat_penalty: state.repeatPenalty ?? 1.1,
        top_p: state.topP ?? 0.9,
        enabled_tools: state.enabledTools || {},
        terminal_security_mode: state.terminalSecurityMode || 'dangerous',
        voice_config: voiceCfg,
        stt_engine: localStorage.getItem('nivm_stt_engine') || 'web',
        whisper_model: localStorage.getItem('nivm_whisper_model') || 'base.en',
        downloader_connections: dom.aria2ConnectionsSlider
            ? parseInt(dom.aria2ConnectionsSlider.value, 10)
            : (state.downloaderConnections || parseInt(localStorage.getItem('nivm_downloader_connections') || '4', 10)),
        ..._readRoleFromDom('router'),
        ..._readRoleFromDom('coder'),
        ..._readRoleFromDom('vision'),
    };

    state.downloaderConnections = payload.downloader_connections;
    try { localStorage.setItem('nivm_downloader_connections', payload.downloader_connections); } catch (_) {}

    if (inferenceMode === 'single') {
        const singleSettings = _readRoleFromDom('single');
        for (const [key, value] of Object.entries(singleSettings)) {
            payload[key.replace('single_', singleRole + '_')] = value;
        }
    }

    await apiFetchSafe('/api/settings', { method: 'POST', body: payload });
    state.customModelPath = payload.custom_model_path;
    state.customMmprojPath = payload.custom_mmproj_path;
    const hasMmproj = Boolean(state.customMmprojPath && state.customMmprojPath.trim()) || (singleRole === 'vision');
    if (window.setVisionEnabled) window.setVisionEnabled(hasMmproj);
}

export async function scanLocalGgufs() {
    return (await apiFetchSafe('/api/models/scan')) || { models: [], remembered_paths: [] };
}

export async function openNativeFileDialog(initialDir = null, title = "Select GGUF Model File") {
    return (await apiFetchSafe('/api/files/browse-dialog', { method: 'POST', body: { initial_dir: initialDir, title } })) || { success: false, error: 'Request failed' };
}

export async function listDirectory(path = null) {
    const url = path ? `/api/files/list-dir?path=${encodeURIComponent(path)}` : '/api/files/list-dir';
    return (await apiFetchSafe(url)) || { current_path: '', parent_path: null, folders: [], files: [], shortcuts: [] };
}

export async function verifyFile(path) {
    return (await apiFetchSafe('/api/files/verify', { method: 'POST', body: { path } })) || { exists: false, error: 'Verification failed' };
}

export async function locateFile(filename, size = null) {
    let url = `/api/files/locate?filename=${encodeURIComponent(filename)}`;
    if (size) url += `&size=${size}`;
    return (await apiFetchSafe(url)) || { found: false };
}

export async function startModelDownload(url, filename = null, connections = null) {
    const conn = connections !== null && connections !== undefined
        ? connections
        : (dom.aria2ConnectionsSlider ? parseInt(dom.aria2ConnectionsSlider.value, 10) : (state.downloaderConnections || 4));
    return apiFetch('/api/models/download', { method: 'POST', body: { url, filename, connections: conn } });
}

export async function pollDownloadStatus() {
    return apiFetchSafe('/api/models/download/status');
}

export async function cancelModelDownload() {
    return apiFetchSafe('/api/models/download/cancel', { method: 'POST' });
}

export async function smartToggleEngine() {
    return apiFetch('/api/engine/smart-toggle', { method: 'POST' });
}

export async function unloadAllModels() {
    return apiFetch('/api/engine/unload-all', { method: 'POST' });
}

export async function unloadVoiceEngine() {
    return apiFetch('/api/tts/unload', { method: 'POST' });
}

export async function fetchBackendConfig() {
    const config = await apiFetchSafe('/api/config');
    if (config) {
        if (!localStorage.getItem('nivm_lastModel')) {
            state.selectedModel = config.default_model || state.selectedModel;
        }
        state.systemPrompt = config.default_system_prompt || state.systemPrompt;
        state.temperature = config.default_temperature || state.temperature;
        state.maxTokens = config.default_max_tokens || state.maxTokens;
    }
}

export async function checkBackendHealth() {
    const data = await apiFetchSafe('/api/health');
    if (data) {
        state.lmStudioConnected = data.has_llama_cpp;
        updateStatusDot(data.has_llama_cpp, data.has_llama_cpp ? null : 'llama-cpp-python not available');
    } else {
        updateStatusDot(false, 'Backend server offline');
    }
}

export function updateStatusDot(online, errorMsg) {
    if (online) {
        dom.statusDot.className = 'status-dot online';
        dom.connStatusWrapper.setAttribute('title', 'Local engine ready');
        dom.offlineBanner.classList.add('hidden');
    } else {
        dom.statusDot.className = 'status-dot offline';
        dom.connStatusWrapper.setAttribute('title', errorMsg || 'Engine Unavailable');
        dom.offlineBanner.classList.remove('hidden');
    }
}

export async function fetchEngineStatus() {
    const data = await apiFetchSafe('/api/engine/status');
    if (!data) return;

    if (state.inferenceMode === 'api') {
        state.isModelLoaded = true;
        if (dom.engineStatusText) {
            dom.engineStatusText.textContent = `API: ${state.selectedModel || 'Connected'}`;
            dom.engineStatusText.style.color = "var(--accent-cyan, #06b6d4)";
        }
        if (dom.smartToggleBtn) dom.smartToggleBtn.classList.remove('is-loaded');
        if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'API Mode';
        if (window.updateModelAvailabilityUI) window.updateModelAvailabilityUI(true);
        return data;
    }

    const isLoaded = !!(data.active && data.active.loaded);
    state.isModelLoaded = isLoaded;

    if (dom.engineStatusText) {
        if (isLoaded) {
            dom.engineStatusText.textContent = `Active: ${data.active.name}`;
            dom.engineStatusText.style.color = "var(--accent-emerald)";
            if (dom.smartToggleBtn) dom.smartToggleBtn.classList.add('is-loaded');
            if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'Unload Engine';
        } else if (data.has_llama_cpp) {
            dom.engineStatusText.textContent = "Ready";
            dom.engineStatusText.style.color = "var(--text-tertiary)";
            if (dom.smartToggleBtn) dom.smartToggleBtn.classList.remove('is-loaded');
            if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'Load Engine';
        } else {
            dom.engineStatusText.textContent = "Status: Unavailable";
            dom.engineStatusText.style.color = "#ef4444";
        }
    }

    if (window.updateModelAvailabilityUI) window.updateModelAvailabilityUI(isLoaded);
    if (isLoaded && data.active && window.applyModelMetadataToUI) window.applyModelMetadataToUI(data.active);
    return data;
}

export async function loadAvailableModels() {
    const data = await apiFetchSafe('/api/models');
    if (!data?.data) return;
    state.models = data.data;

    if (state.inferenceMode === 'api') {
        return;
    }

    if (dom.modelSelect) {
        dom.modelSelect.innerHTML = '';
        if (state.models.length === 0) {
            state.models.push({ id: state.selectedModel });
        }

        let found = false;
        state.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            const ctx = m.context_window || m.context_length;
            opt.textContent = ctx ? `${m.id} (${Math.round(ctx / 1000)}k context)` : m.id;
            if (m.id === state.selectedModel) {
                opt.selected = true;
                found = true;
            }
            dom.modelSelect.appendChild(opt);
        });

        if (!found && state.models.length > 0) {
            state.selectedModel = state.models[0].id;
            dom.modelSelect.value = state.selectedModel;
        }
        localStorage.setItem('nivm_lastModel', state.selectedModel);
    } else if (state.models.length > 0) {
        if (!state.models.some(m => m.id === state.selectedModel)) {
            state.selectedModel = state.models[0].id;
        }
        localStorage.setItem('nivm_lastModel', state.selectedModel);
    }
}

export async function fetchChats() {
    const serverChats = await apiFetchSafe('/api/chats', {}, []);
    return Array.isArray(serverChats) ? serverChats : [];
}

export async function saveChats(conversations) {
    if (!Array.isArray(conversations)) return;
    await apiFetchSafe('/api/chats', { method: 'POST', body: conversations });
}

export async function fetchMemoryAPI() {
    return (await apiFetchSafe('/api/memory', {}, { enabled: true, memories: [] })) || { enabled: true, memories: [] };
}

export async function addMemoryAPI(text) {
    return apiFetchSafe('/api/memory', { method: 'POST', body: { text } });
}

export async function deleteMemoryAPI(id) {
    return apiFetchSafe('/api/memory', { method: 'DELETE', body: { id } });
}

export async function clearAllMemoriesAPI() {
    return apiFetchSafe('/api/memory/clear', { method: 'POST' });
}

export async function toggleMemoryModeAPI(enabled) {
    return apiFetchSafe('/api/memory/toggle', { method: 'POST', body: { enabled } });
}


export async function fetchModelDetailsAPI(modelId) {
    if (!modelId) return null;
    const data = await apiFetchSafe('/api/models');
    const found = data?.data?.find(m => m.id === modelId);
    return found ? { arch: 'GGUF', type: found.available ? 'local' : 'missing', quantization: found.name || 'Unknown', loadedContextLength: '8192' } : null;
}

export async function generateChatTitle(activeChat) {
    if (!activeChat || activeChat.messages.length < 2) return;
    const { renderChatHistory } = await import('./ui.js');

    let userPrompt = activeChat.messages.find(m => m.role === 'user')?.content;
    if (Array.isArray(userPrompt)) {
        userPrompt = userPrompt.find(i => i.type === 'text')?.text || '';
    }
    let titleContext = (typeof userPrompt === 'string' ? userPrompt.trim() : '');

    if (!titleContext) {
        const assistantMsg = [...activeChat.messages].reverse().find(m => m.role === 'assistant');
        if (assistantMsg?.content) {
            let c = typeof assistantMsg.content === 'string' ? assistantMsg.content : '';
            c = c.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            if (c.includes('</think>')) c = c.split('</think>').pop().trim();
            if (c) titleContext = c.slice(0, 350).trim();
        }
    }
    if (!titleContext) return;

    try {
        const data = await apiFetch('/api/chat', {
            method: 'POST',
            body: {
                messages: [
                    { role: 'system', content: 'Generate a short 3 to 5 word title for this conversation. Respond ONLY with title text, no quotes or prefixes.' },
                    { role: 'user', content: titleContext }
                ],
                model: state.selectedModel,
                temperature: 0.3,
                max_tokens: 20,
                stream: false,
                engine_mode: state.engineMode
            }
        });

        let title = (data.choices?.[0]?.message?.content || data.message?.content || '').trim();
        title = title.replace(/<think>[\s\S]*?<\/think>/g, '')
                     .replace(/<think>[\s\S]*$/g, '')
                     .replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/gi, '')
                     .replace(/<\|im_start\|>|<\|im_end\|>/gi, '')
                     .replace(/^(Title|Topic):\s*/i, '')
                     .replace(/^(Here is|Here's|We need to generate|Generate)\s+(a\s+)?(short\s+)?(3\s*to\s*5\s*word\s+)?(title)?[:\s]*/i, '')
                     .replace(/^["'`*#\-_.\s]+|["'`*#\-_.\s]+$/g, '')
                     .trim();

        if (title.toLowerCase().startsWith('we need to') || title.toLowerCase().startsWith('generate a')) {
            title = '';
        }

        if (!title && titleContext) {
            title = titleContext.split('\n')[0].replace(/^["'`*#\-_.\s]+|["'`*#\-_.\s]+$/g, '').trim();
            if (title.length > 40) title = title.slice(0, 40).trim() + '...';
        }

        if (title) {
            activeChat.title = title.length > 45 ? title.slice(0, 45).trim() + '...' : title;
            activeChat.titleGenerated = true;
            saveConversations();
            renderChatHistory();
        }
    } catch (_) {}
}

export async function uploadImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    const data = await apiFetchSafe('/api/upload', { method: 'POST', body: formData });
    return data?.url || null;
}

export async function deleteUploadedFilesAPI(urls) {
    if (!urls || urls.length === 0) return;
    await apiFetchSafe('/api/upload/delete', { method: 'POST', body: { urls } });
}
window.deleteUploadedFilesAPI = deleteUploadedFilesAPI;

export async function executeTerminalAPI(command) {
    try {
        const data = await apiFetch('/api/tools/execute_terminal', { method: 'POST', body: { command } });
        return data.output || data.error;
    } catch (e) {
        return `Execution failed: ${e.message}`;
    }
}
