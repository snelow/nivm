import { state } from './state.js';
import { dom } from './dom.js';

export async function fetchApiSettings() {
    try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (dom.lmStudioUrlInput) dom.lmStudioUrlInput.value = data.base_url || '';
            if (dom.apiKeyInput) dom.apiKeyInput.value = data.api_key || '';
            
            // Engine mode
            state.engineMode = data.engine_mode || 'native';
            if (dom.safetyBypassToggle) dom.safetyBypassToggle.checked = !!data.safety_bypass;
            
            // Native settings
            if (data.native_model_path && dom.nativeModelPath) dom.nativeModelPath.value = data.native_model_path;
            if (dom.nativeMmprojPath) dom.nativeMmprojPath.value = data.native_mmproj_path !== undefined ? data.native_mmproj_path : "";
            if (dom.nativeChatHandler) dom.nativeChatHandler.value = data.native_chat_handler !== undefined ? data.native_chat_handler : "gemma4";
            if (dom.nativeMmprojCpuToggle) dom.nativeMmprojCpuToggle.checked = !!data.native_mmproj_cpu;
            if (data.native_gpu_layers !== undefined && dom.nativeGpuSlider) {
                dom.nativeGpuSlider.value = data.native_gpu_layers;
                if (dom.nativeGpuVal) dom.nativeGpuVal.textContent = data.native_gpu_layers === -1 ? '-1 (Max)' : data.native_gpu_layers;
            }
            if (data.native_ctx !== undefined && dom.nativeCtxSlider) {
                dom.nativeCtxSlider.value = data.native_ctx;
                if (dom.nativeCtxVal) dom.nativeCtxVal.textContent = data.native_ctx;
            }
            if (data.native_batch !== undefined && dom.nativeBatchSlider) {
                dom.nativeBatchSlider.value = data.native_batch;
                if (dom.nativeBatchVal) dom.nativeBatchVal.textContent = data.native_batch;
            }
            if (dom.nativeFlashAttnToggle) dom.nativeFlashAttnToggle.checked = !!data.native_flash_attn;
            if (dom.nativeOffloadKqvToggle) dom.nativeOffloadKqvToggle.checked = data.native_offload_kqv !== false;
            if (dom.nativeUseMlockToggle) dom.nativeUseMlockToggle.checked = !!data.native_use_mlock;
            if (dom.nativeUseMmapToggle) dom.nativeUseMmapToggle.checked = data.native_use_mmap !== false;
            if (data.native_kv_type && dom.nativeKvTypeSelect) dom.nativeKvTypeSelect.value = data.native_kv_type;
        }
    } catch (err) {
        console.warn('Backend settings fetch failed:', err);
    }
}

export async function saveApiSettings() {
    let baseUrl = dom.lmStudioUrlInput ? dom.lmStudioUrlInput.value.trim() : '';
    const apiKey = dom.apiKeyInput ? dom.apiKeyInput.value.trim() : '';
    
    baseUrl = baseUrl.replace(/^(POST|GET|PUT|DELETE)\s+/i, '');
    if (dom.lmStudioUrlInput && baseUrl !== dom.lmStudioUrlInput.value) {
        dom.lmStudioUrlInput.value = baseUrl;
    }
    
    const payload = { 
        base_url: baseUrl, 
        api_key: apiKey,
        engine_mode: state.engineMode,
        safety_bypass: dom.safetyBypassToggle ? dom.safetyBypassToggle.checked : false,
        native_model_path: dom.nativeModelPath ? dom.nativeModelPath.value : '',
        native_gpu_layers: dom.nativeGpuSlider ? parseInt(dom.nativeGpuSlider.value) : -1,
        native_ctx: dom.nativeCtxSlider ? parseInt(dom.nativeCtxSlider.value) : 4096,
        native_batch: dom.nativeBatchSlider ? parseInt(dom.nativeBatchSlider.value) : 512,
        native_flash_attn: dom.nativeFlashAttnToggle ? dom.nativeFlashAttnToggle.checked : false,
        native_offload_kqv: dom.nativeOffloadKqvToggle ? dom.nativeOffloadKqvToggle.checked : true,
        native_use_mlock: dom.nativeUseMlockToggle ? dom.nativeUseMlockToggle.checked : false,
        native_use_mmap: dom.nativeUseMmapToggle ? dom.nativeUseMmapToggle.checked : true,
        native_kv_type: dom.nativeKvTypeSelect ? dom.nativeKvTypeSelect.value : 'f16',
        native_mmproj_path: dom.nativeMmprojPath ? dom.nativeMmprojPath.value : "",
        native_chat_handler: dom.nativeChatHandler ? dom.nativeChatHandler.value : "gemma4",
        native_mmproj_cpu: dom.nativeMmprojCpuToggle ? dom.nativeMmprojCpuToggle.checked : false
    };
    
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
            state.lmStudioConnected = data.lm_studio_connected;
            updateStatusDot(data.lm_studio_connected, data.lm_studio_error);
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
        dom.connStatusWrapper.setAttribute('title', 'External API Connected');
        dom.offlineBanner.classList.add('hidden');
    } else {
        dom.statusDot.className = 'status-dot offline';
        dom.connStatusWrapper.setAttribute('title', errorMsg || 'External API Disconnected');
        if (state.engineMode === 'external') {
            dom.offlineBanner.classList.remove('hidden');
        } else {
            dom.offlineBanner.classList.add('hidden');
        }
    }
}

export async function fetchEngineStatus() {
    try {
        const res = await fetch('/api/engine/status', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (dom.nativeStatusText) {
                if (data.status === 'loaded') {
                    dom.nativeStatusText.textContent = "Status: Loaded Successfully";
                    dom.nativeStatusText.style.color = "var(--accent-emerald)";
                } else if (data.status === 'unloaded') {
                    dom.nativeStatusText.textContent = "Status: Unloaded";
                    dom.nativeStatusText.style.color = "var(--text-tertiary)";
                } else {
                    dom.nativeStatusText.textContent = "Status: Unavailable";
                    dom.nativeStatusText.style.color = "#ef4444";
                }
            }
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
    const { state } = await import('./state.js');
    try {
        const url = state.lmStudioUrl ? state.lmStudioUrl.replace(/\/v1\/?$/, '') : 'http://127.0.0.1:1234';
        const response = await fetch(`${url}/api/v0/models`, { cache: 'no-store' });
        if (!response.ok) return null;
        
        const data = await response.json();
        if (data && data.data && Array.isArray(data.data)) {
            const foundModel = data.data.find(m => m.id === modelId);
            if (foundModel) {
                return {
                    arch: foundModel.arch || 'Unknown',
                    type: foundModel.type || 'Unknown',
                    quantization: foundModel.quantization || 'Unknown',
                    loadedContextLength: foundModel.loaded_context_length || foundModel.max_context_length || 'Unknown'
                };
            }
        }
        return null;
    } catch (e) {
        console.warn("Failed to fetch detailed model info from /api/v0/models", e);
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
