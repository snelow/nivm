import { state } from './state.js';
import { dom } from './dom.js';

// Helper: set slider + val span for a role prefix
function _setSlider(slider, valSpan, value, isGpu) {
    if (slider) slider.value = value;
    if (valSpan) valSpan.textContent = isGpu && value == -1 ? '-1 (Max)' : value;
}

// Helper: read per-role config from DOM into a flat settings object
function _readRoleFromDom(prefix) {
    const gpuSlider = dom[prefix + 'GpuSlider'];
    const ctxSlider = dom[prefix + 'CtxSlider'];
    const batchSlider = dom[prefix + 'BatchSlider'];
    const kvSelect = dom[prefix + 'KvSelect'];
    const flashAttn = dom[prefix + 'FlashAttn'];
    const offloadKqv = dom[prefix + 'OffloadKqv'];
    const mlock = dom[prefix + 'Mlock'];
    const mmap = dom[prefix + 'Mmap'];
    
    // Map camelCase DOM prefix → snake_case settings key prefix
    const settingsPrefix = prefix.replace(/([A-Z])/g, '_$1').toLowerCase();
    
    return {
        [settingsPrefix + '_gpu_layers']: gpuSlider ? parseInt(gpuSlider.value) : -1,
        [settingsPrefix + '_ctx']: ctxSlider ? parseInt(ctxSlider.value) : 8192,
        [settingsPrefix + '_batch']: batchSlider ? parseInt(batchSlider.value) : 512,
        [settingsPrefix + '_kv_type']: kvSelect ? kvSelect.value : 'f16',
        [settingsPrefix + '_flash_attn']: flashAttn ? flashAttn.checked : true,
        [settingsPrefix + '_offload_kqv']: offloadKqv ? offloadKqv.checked : true,
        [settingsPrefix + '_use_mlock']: mlock ? mlock.checked : false,
        [settingsPrefix + '_use_mmap']: mmap ? mmap.checked : true,
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
    try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            
            // Engine mode
            state.engineMode = 'native';
            
            // Inference mode
            const inferenceMode = data.inference_mode || 'routing';
            state.inferenceMode = inferenceMode;
            
            // Update mode selector buttons
            if (dom.routingModeBtn && dom.singleModeBtn) {
                if (inferenceMode === 'single') {
                    dom.routingModeBtn.classList.remove('active');
                    dom.singleModeBtn.classList.add('active');
                    if (dom.routingModePanel) dom.routingModePanel.classList.add('hidden');
                    if (dom.singleModePanel) dom.singleModePanel.classList.remove('hidden');
                } else {
                    dom.routingModeBtn.classList.add('active');
                    dom.singleModeBtn.classList.remove('active');
                    if (dom.routingModePanel) dom.routingModePanel.classList.remove('hidden');
                    if (dom.singleModePanel) dom.singleModePanel.classList.add('hidden');
                }
            }
            
            // Single model role
            if (dom.singleModelRoleSelect) dom.singleModelRoleSelect.value = data.single_model_role || 'coder';
            
            // Custom model path & history
            state.customModelPath = data.custom_model_path || '';
            state.customMmprojPath = data.custom_mmproj_path || '';
            state.rememberedPaths = data.remembered_model_paths || [];
            if (dom.customModelPathInput) dom.customModelPathInput.value = state.customModelPath;
            if (dom.customMmprojInput) dom.customMmprojInput.value = state.customMmprojPath;
            if (dom.customModelCard) {
                if (data.single_model_role === 'custom') {
                    dom.customModelCard.classList.remove('hidden');
                } else {
                    dom.customModelCard.classList.add('hidden');
                }
            }

            // Per-role configs
            _populateRoleDom('router', data, 'router');
            _populateRoleDom('coder', data, 'coder');
            _populateRoleDom('vision', data, 'vision');
            
            // Single mode config — populate from whichever role is selected
            const singleRole = data.single_model_role || 'coder';
            _populateRoleDom('single', data, singleRole);
        }
    } catch (err) {
        console.warn('Backend settings fetch failed:', err);
    }
}

export async function saveApiSettings() {
    // Base payload
    const inferenceMode = state.inferenceMode || 'routing';
    const singleRole = dom.singleModelRoleSelect ? dom.singleModelRoleSelect.value : 'coder';
    
    const payload = { 
        engine_mode: 'native',
        inference_mode: inferenceMode,
        single_model_role: singleRole,
        custom_model_path: dom.customModelPathInput ? dom.customModelPathInput.value.trim() : (state.customModelPath || ''),
        custom_mmproj_path: dom.customMmprojInput ? dom.customMmprojInput.value.trim() : (state.customMmprojPath || ''),
        remembered_model_paths: state.rememberedPaths || [],
    };
    
    // Per-role settings from routing mode
    Object.assign(payload, _readRoleFromDom('router'));
    Object.assign(payload, _readRoleFromDom('coder'));
    Object.assign(payload, _readRoleFromDom('vision'));
    
    // If in single mode, the single panel's controls override the selected role
    if (inferenceMode === 'single') {
        const singleSettings = _readRoleFromDom('single');
        // Map single_* keys to the appropriate role_* keys
        for (const [key, value] of Object.entries(singleSettings)) {
            const roleKey = key.replace('single_', singleRole + '_');
            payload[roleKey] = value;
        }
    }
    
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.warn('Backend settings save failed:', err);
    }
}

export async function scanLocalGgufs() {
    try {
        const res = await fetch('/api/models/scan', { cache: 'no-store' });
        if (res.ok) {
            return await res.json();
        }
    } catch (err) {
        console.warn('Failed to scan local GGUFs:', err);
    }
    return { models: [], remembered_paths: [] };
}

export async function startModelDownload(url, filename) {
    const res = await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, filename })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Download request failed');
    }
    return await res.json();
}

export async function pollDownloadStatus() {
    try {
        const res = await fetch('/api/models/download/status', { cache: 'no-store' });
        if (res.ok) {
            return await res.json();
        }
    } catch (err) {
        console.warn('Failed to poll download status:', err);
    }
    return null;
}

export async function cancelModelDownload() {
    try {
        const res = await fetch('/api/models/download/cancel', { method: 'POST' });
        if (res.ok) {
            return await res.json();
        }
    } catch (err) {
        console.warn('Failed to cancel download:', err);
    }
    return null;
}

export async function smartToggleEngine() {
    const res = await fetch('/api/engine/smart-toggle', { method: 'POST' });
    if (res.ok) {
        return await res.json();
    }
    throw new Error('Smart toggle failed');
}

export async function fetchBackendConfig() {
    try {
        const res = await fetch('/api/config', { cache: 'no-store' });
        if (res.ok) {
            const config = await res.json();
            if (!localStorage.getItem('nivm_lastModel')) {
                state.selectedModel = config.default_model || state.selectedModel;
            }
            state.systemPrompt = config.default_system_prompt || state.systemPrompt;
            state.temperature = config.default_temperature || state.temperature;
            state.maxTokens = config.default_max_tokens || state.maxTokens;
        }
    } catch (err) {
        console.warn('Backend config fetch failed:', err);
    }
}

export async function checkBackendHealth() {
    try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            state.lmStudioConnected = data.has_llama_cpp;
            updateStatusDot(data.has_llama_cpp, data.has_llama_cpp ? null : 'llama-cpp-python not available');
        } else {
            updateStatusDot(false, 'Backend API unresponsive');
        }
    } catch (err) {
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
    try {
        const res = await fetch('/api/engine/status', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            const isLoaded = !!(data.active && data.active.loaded);
            state.isModelLoaded = isLoaded;

            if (dom.engineStatusText) {
                if (isLoaded) {
                    dom.engineStatusText.textContent = `Active: ${data.active.name}`;
                    dom.engineStatusText.style.color = "var(--accent-emerald)";
                    if (dom.smartToggleBtn) dom.smartToggleBtn.classList.add('is-loaded');
                    if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'Unload Engine';
                } else if (data.has_llama_cpp) {
                    dom.engineStatusText.textContent = "Status: Ready (no model active)";
                    dom.engineStatusText.style.color = "var(--text-tertiary)";
                    if (dom.smartToggleBtn) dom.smartToggleBtn.classList.remove('is-loaded');
                    if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'Load Engine';
                } else {
                    dom.engineStatusText.textContent = "Status: Unavailable";
                    dom.engineStatusText.style.color = "#ef4444";
                }
            }

            if (window.updateModelAvailabilityUI) {
                window.updateModelAvailabilityUI(isLoaded);
            }
            return data;
        }
    } catch (e) {
        console.warn('Failed to fetch engine status:', e);
    }
}

export async function loadAvailableModels() {
    try {
        const res = await fetch('/api/models', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            state.models = data.data || [];
            
            dom.modelSelect.innerHTML = '';
            if (state.models.length === 0) {
                state.models.push({ id: state.selectedModel });
            }

            let found = false;
            state.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                let text = m.id;
                if (m.context_window) {
                    const ctxK = Math.round(m.context_window / 1000);
                    text += ` (${ctxK}k context)`;
                } else if (m.context_length) {
                    const ctxK = Math.round(m.context_length / 1000);
                    text += ` (${ctxK}k context)`;
                }
                opt.textContent = text;
                if (m.id === state.selectedModel) {
                    opt.selected = true;
                    found = true;
                }
                dom.modelSelect.appendChild(opt);
            });

            if (!found && state.models.length > 0) {
                state.selectedModel = state.models[0].id;
                dom.modelSelect.value = state.selectedModel;
                localStorage.setItem('nivm_lastModel', state.selectedModel);
            } else if (found) {
                localStorage.setItem('nivm_lastModel', state.selectedModel);
            }
        }
    } catch (err) {
        console.warn('Failed to load models list:', err);
    }
}

export async function fetchChats() {
    try {
        const res = await fetch('/api/chats', { cache: 'no-store' });
        if (res.ok) {
            return await res.json();
        }
    } catch (err) {
        console.warn('Failed to fetch chats from server:', err);
    }
    return [];
}

export async function saveChats(conversations) {
    const response = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversations)
    });
    if (!response.ok) {
        console.error("Failed to save chats to server");
    }
}

export async function fetchMemoryAPI() {
    try {
        const response = await fetch('/api/memory', { cache: 'no-store' });
        if (!response.ok) return {};
        return await response.json();
    } catch (e) {
        console.error("Failed to fetch memory", e);
        return {};
    }
}

export async function saveMemoryAPI(key, value) {
    try {
        const response = await fetch('/api/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
        if (!response.ok) {
            console.error("Failed to save memory to server");
        }
    } catch (e) {
        console.error("Failed to save memory", e);
    }
}

export async function deleteMemoryAPI(key) {
    try {
        const response = await fetch('/api/memory', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        if (!response.ok) {
            console.error("Failed to delete memory from server");
        }
    } catch (e) {
        console.error("Failed to delete memory", e);
    }
}

export async function fetchModelDetailsAPI(modelId) {
    if (!modelId) return null;
    try {
        const response = await fetch('/api/models', { cache: 'no-store' });
        if (!response.ok) return null;
        const data = await response.json();
        if (data && data.data && Array.isArray(data.data)) {
            const foundModel = data.data.find(m => m.id === modelId);
            if (foundModel) {
                return {
                    arch: 'GGUF',
                    type: foundModel.available ? 'local' : 'missing',
                    quantization: foundModel.name || 'Unknown',
                    loadedContextLength: '8192'
                };
            }
        }
        return null;
    } catch (e) {
        console.warn('Failed to fetch local model metadata', e);
        return null;
    }
}

export async function generateChatTitle(activeChat) {
    if (!activeChat || activeChat.messages.length < 2) return;
    
    // Create a payload similar to what sendMessage sends, but for title generation
    const { state } = await import('./state.js');
    const { renderChatHistory } = await import('./ui.js');
    
    let userPrompt = activeChat.messages.find(m => m.role === 'user')?.content;
    if (Array.isArray(userPrompt)) {
        const textItem = userPrompt.find(i => i.type === 'text');
        userPrompt = textItem ? textItem.text : '';
    }
    if (!userPrompt) return;

    const payload = {
        messages: [
            { role: 'system', content: 'Generate a short 3 to 5 word title for the following message. Respond ONLY with the title. Do not use quotes or punctuation.' },
            { role: 'user', content: userPrompt }
        ],
        model: state.selectedModel,
        temperature: 0.3,
        max_tokens: 15,
        stream: false,
        engine_mode: state.engineMode
    };

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const data = await response.json();
            let title = '';
            if (data.choices && data.choices[0] && data.choices[0].message) {
                title = data.choices[0].message.content.trim();
            } else if (data.message && data.message.content) {
                title = data.message.content.trim();
            }
            
            // Cleanup any trailing/leading quotes
            title = title.replace(/^["']|["']$/g, '').trim();
            
            if (title) {
                activeChat.title = title;
                activeChat.titleGenerated = true;
                const { saveConversations } = await import('./state.js');
                saveConversations();
                renderChatHistory();
            }
        }
    } catch (e) {
        console.warn('Failed to generate chat title:', e);
    }
}

export async function uploadImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        if (res.ok) {
            const data = await res.json();
            return data.url;
        }
    } catch (e) {
        console.error("Upload failed", e);
    }
    return null;
}

export async function executeTerminalAPI(command) {
    try {
        const res = await fetch('/api/tools/execute_terminal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: command })
        });
        if (res.ok) {
            const data = await res.json();
            return data.output || data.error;
        }
        return `HTTP Error: ${res.status}`;
    } catch (e) {
        return `Execution failed: ${e.message}`;
    }
}
