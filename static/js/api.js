import { state, saveConversations } from './state.js';
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

export async function fetchApiSettings() {
    const data = await apiFetchSafe('/api/settings');
    if (!data) return;

    state.engineMode = 'native';
    const inferenceMode = data.inference_mode || 'single';
    state.inferenceMode = inferenceMode;

    if (dom.routingModeBtn && dom.singleModeBtn) {
        dom.routingModeBtn.classList.toggle('active', inferenceMode === 'routing');
        dom.singleModeBtn.classList.toggle('active', inferenceMode === 'single');
        if (dom.apiModeBtn) dom.apiModeBtn.classList.toggle('active', inferenceMode === 'api');

        if (dom.routingModePanel) dom.routingModePanel.classList.toggle('hidden', inferenceMode !== 'routing');
        if (dom.singleModePanel) dom.singleModePanel.classList.toggle('hidden', inferenceMode !== 'single');
        if (dom.apiModePanel) dom.apiModePanel.classList.toggle('hidden', inferenceMode !== 'api');

        const isApi = inferenceMode === 'api';
        ['downloadModelSection', 'downloadDivider', 'memoryEstimatorCard', 'smartEngineSection'].forEach(k => {
            if (dom[k]) dom[k].classList.toggle('hidden', isApi);
        });
    }
    if (window.updateVisionAvailabilityUI) window.updateVisionAvailabilityUI();

    if (dom.singleModelRoleSelect) dom.singleModelRoleSelect.value = data.single_model_role || 'custom';

    state.customModelPath = data.custom_model_path || '';
    state.customMmprojPath = data.custom_mmproj_path || '';
    state.rememberedPaths = data.remembered_model_paths || [];
    if (dom.customModelPathInput) dom.customModelPathInput.value = state.customModelPath;
    if (dom.customMmprojInput) dom.customMmprojInput.value = state.customMmprojPath;
    if (dom.customMmprojCpu) dom.customMmprojCpu.checked = data.custom_mmproj_use_gpu === false;
    if (dom.visionMmprojCpu) dom.visionMmprojCpu.checked = data.vision_mmproj_use_gpu === false;
    if (dom.pdfDpiSelect) dom.pdfDpiSelect.value = String(data.pdf_render_dpi || 150);

    if (dom.apiBaseUrl && data.api_base_url) dom.apiBaseUrl.value = data.api_base_url;
    if (dom.apiChatUrl && data.api_chat_url) dom.apiChatUrl.value = data.api_chat_url;
    if (dom.apiKeyInput && data.api_key !== undefined) dom.apiKeyInput.value = data.api_key;
    if (dom.apiModelInput && data.api_model) dom.apiModelInput.value = data.api_model;

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
}

export async function saveApiSettings() {
    const inferenceMode = state.inferenceMode || 'single';
    const singleRole = dom.singleModelRoleSelect ? dom.singleModelRoleSelect.value : 'custom';

    const payload = {
        engine_mode: 'native',
        inference_mode: inferenceMode,
        single_model_role: singleRole,
        custom_model_path: dom.customModelPathInput ? dom.customModelPathInput.value.trim() : (state.customModelPath || ''),
        custom_mmproj_path: dom.customMmprojInput ? dom.customMmprojInput.value.trim() : (state.customMmprojPath || ''),
        custom_mmproj_use_gpu: dom.customMmprojCpu ? !dom.customMmprojCpu.checked : true,
        vision_mmproj_use_gpu: dom.visionMmprojCpu ? !dom.visionMmprojCpu.checked : true,
        pdf_render_dpi: dom.pdfDpiSelect ? parseInt(dom.pdfDpiSelect.value) : 150,
        api_base_url: dom.apiBaseUrl ? dom.apiBaseUrl.value.trim() : '',
        api_chat_url: dom.apiChatUrl ? dom.apiChatUrl.value.trim() : '',
        api_key: dom.apiKeyInput ? dom.apiKeyInput.value.trim() : '',
        api_model: dom.apiModelInput ? dom.apiModelInput.value.trim() : '',
        api_multimodal: dom.apiMultimodalCheck ? dom.apiMultimodalCheck.checked : (state.apiMultimodal ?? false),
        remembered_model_paths: state.rememberedPaths || [],
        ..._readRoleFromDom('router'),
        ..._readRoleFromDom('coder'),
        ..._readRoleFromDom('vision'),
    };

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

export async function startModelDownload(url, filename) {
    return apiFetch('/api/models/download', { method: 'POST', body: { url, filename } });
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

    const isLoaded = !!(data.active && data.active.loaded);
    state.isModelLoaded = state.inferenceMode !== 'api' ? isLoaded : true;

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
    return (await apiFetchSafe('/api/memory', {}, {})) || {};
}

export async function saveMemoryAPI(key, value) {
    return apiFetchSafe('/api/memory', { method: 'POST', body: { key, value } });
}

export async function deleteMemoryAPI(key) {
    return apiFetchSafe('/api/memory', { method: 'DELETE', body: { key } });
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
        title = title.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^(Title|Topic):\s*/i, '').replace(/^["'`*#\-_.\s]+|["'`*#\-_.\s]+$/g, '').trim();
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
