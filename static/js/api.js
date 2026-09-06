import { state, saveConversations } from './state.js';
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
            const inferenceMode = data.inference_mode || 'single';
            state.inferenceMode = inferenceMode;
            
            // Update mode selector buttons
            if (dom.routingModeBtn && dom.singleModeBtn) {
                dom.routingModeBtn.classList.toggle('active', inferenceMode === 'routing');
                dom.singleModeBtn.classList.toggle('active', inferenceMode === 'single');
                if (dom.apiModeBtn) dom.apiModeBtn.classList.toggle('active', inferenceMode === 'api');

                if (dom.routingModePanel) dom.routingModePanel.classList.toggle('hidden', inferenceMode !== 'routing');
                if (dom.singleModePanel) dom.singleModePanel.classList.toggle('hidden', inferenceMode !== 'single');
                if (dom.apiModePanel) dom.apiModePanel.classList.toggle('hidden', inferenceMode !== 'api');

                const isApi = inferenceMode === 'api';
                if (dom.downloadModelSection) dom.downloadModelSection.classList.toggle('hidden', isApi);
                if (dom.downloadDivider) dom.downloadDivider.classList.toggle('hidden', isApi);
                if (dom.smartEngineSection) dom.smartEngineSection.classList.toggle('hidden', isApi);
            }
            if (window.updateVisionAvailabilityUI) window.updateVisionAvailabilityUI();
            
            // Single model role
            if (dom.singleModelRoleSelect) dom.singleModelRoleSelect.value = data.single_model_role || 'coder';
            
            // Custom model path & history
            state.customModelPath = data.custom_model_path || '';
            state.customMmprojPath = data.custom_mmproj_path || '';
            state.rememberedPaths = data.remembered_model_paths || [];
            if (dom.customModelPathInput) dom.customModelPathInput.value = state.customModelPath;
            if (dom.customMmprojInput) dom.customMmprojInput.value = state.customMmprojPath;
            if (dom.customMmprojCpu) dom.customMmprojCpu.checked = data.custom_mmproj_use_gpu === false;
            if (dom.visionMmprojCpu) dom.visionMmprojCpu.checked = data.vision_mmproj_use_gpu === false;
            if (dom.pdfDpiSelect) dom.pdfDpiSelect.value = String(data.pdf_render_dpi || 150);

            // API Mode custom endpoints
            if (dom.apiBaseUrl && data.api_base_url) dom.apiBaseUrl.value = data.api_base_url;
            if (dom.apiChatUrl && data.api_chat_url) dom.apiChatUrl.value = data.api_chat_url;
            if (dom.apiKeyInput && data.api_key !== undefined) dom.apiKeyInput.value = data.api_key;
            if (dom.apiModelInput && data.api_model) dom.apiModelInput.value = data.api_model;

            const isMm = (data.api_multimodal !== undefined && data.api_multimodal !== null)
                ? Boolean(data.api_multimodal)
                : (window.isMultimodalModel ? window.isMultimodalModel(data.api_model || '', data.api_base_url || '') : false);
            state.apiMultimodal = isMm;
            if (dom.apiMultimodalCheck) dom.apiMultimodalCheck.checked = isMm;

            // Vision default toggle: if mmproj is configured or API model supports vision, enable vision by default
            const supported = window.isVisionSupported ? window.isVisionSupported() : false;
            if (window.setVisionEnabled) {
                window.setVisionEnabled(supported);
            } else if (window.updateVisionAvailabilityUI) {
                window.updateVisionAvailabilityUI();
            }

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
    const inferenceMode = state.inferenceMode || 'single';
    const singleRole = dom.singleModelRoleSelect ? dom.singleModelRoleSelect.value : 'coder';
    
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
        api_multimodal: dom.apiMultimodalCheck ? dom.apiMultimodalCheck.checked : (state.apiMultimodal !== null && state.apiMultimodal !== undefined ? state.apiMultimodal : false),
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
        state.customModelPath = payload.custom_model_path;
        state.customMmprojPath = payload.custom_mmproj_path;
        const hasMmproj = Boolean(state.customMmprojPath && state.customMmprojPath.trim()) || (singleRole === 'vision');
        if (window.setVisionEnabled) {
            window.setVisionEnabled(hasMmproj);
        }
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

export async function openNativeFileDialog(initialDir = null, title = "Select GGUF Model File") {
    try {
        const res = await fetch('/api/files/browse-dialog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initial_dir: initialDir, title: title })
        });
        if (res.ok) {
            return await res.json();
        }
    } catch (err) {
        console.warn('Failed to open native file dialog:', err);
    }
    return { success: false, error: 'Request failed' };
}

export async function listDirectory(path = null) {
    try {
        const url = path ? `/api/files/list-dir?path=${encodeURIComponent(path)}` : '/api/files/list-dir';
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
            return await res.json();
        }
    } catch (err) {
        console.warn('Failed to list directory:', err);
    }
    return { current_path: '', parent_path: null, folders: [], files: [], shortcuts: [] };
}

export async function verifyFile(path) {
    try {
        const res = await fetch('/api/files/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        if (res.ok) {
            return await res.json();
        }
    } catch (err) {
        console.warn('Failed to verify file:', err);
    }
    return { exists: false, error: 'Verification failed' };
}

export async function locateFile(filename, size = null) {
    try {
        let url = `/api/files/locate?filename=${encodeURIComponent(filename)}`;
        if (size) url += `&size=${size}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
            return await res.json();
        }
    } catch (err) {
        console.warn('Failed to locate file:', err);
    }
    return { found: false };
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
            if (state.inferenceMode !== 'api') {
                state.isModelLoaded = isLoaded;
            } else {
                state.isModelLoaded = true;
            }

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
            
            if (dom.modelSelect) {
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
            } else {
                if (state.models.length > 0) {
                    const found = state.models.some(m => m.id === state.selectedModel);
                    if (!found) {
                        state.selectedModel = state.models[0].id;
                    }
                    localStorage.setItem('nivm_lastModel', state.selectedModel);
                }
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
            const serverChats = await res.json();
            if (Array.isArray(serverChats) && serverChats.length > 0) {
                try {
                    localStorage.setItem('nivm_saved_chats', JSON.stringify(serverChats));
                } catch (e) {}
                return serverChats;
            }
        }
    } catch (err) {
        console.warn('Failed to fetch chats from server:', err);
    }
    // Fallback: restore from localStorage if server has no chats or is unavailable
    try {
        const localChats = localStorage.getItem('nivm_saved_chats');
        if (localChats) {
            const parsed = JSON.parse(localChats);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // Sync back to server in background
                fetch('/api/chats', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(parsed)
                }).catch(() => {});
                return parsed;
            }
        }
    } catch (e) {}
    return [];
}

export async function saveChats(conversations) {
    if (!conversations || !Array.isArray(conversations)) return;
    try {
        localStorage.setItem('nivm_saved_chats', JSON.stringify(conversations));
    } catch (e) {}
    try {
        const response = await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(conversations)
        });
        if (!response.ok) {
            console.error("Failed to save chats to server, status:", response.status);
        }
    } catch (err) {
        console.error("Error connecting to server for chat save:", err);
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
    const { renderChatHistory } = await import('./ui.js');
    
    let userPrompt = activeChat.messages.find(m => m.role === 'user')?.content;
    if (Array.isArray(userPrompt)) {
        const textItem = userPrompt.find(i => i.type === 'text');
        userPrompt = textItem ? textItem.text : '';
    }

    let titleContext = (typeof userPrompt === 'string' ? userPrompt.trim() : '');

    // If user's first prompt had no text (e.g. voice note / audio or media only),
    // derive context from the assistant's response to understand what was asked/discussed!
    if (!titleContext) {
        const assistantMsg = [...activeChat.messages].reverse().find(m => m.role === 'assistant');
        if (assistantMsg && assistantMsg.content) {
            let content = typeof assistantMsg.content === 'string' ? assistantMsg.content : '';
            // Strip thinking blocks
            content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            if (content.includes('</think>')) {
                content = content.split('</think>').pop().trim();
            }
            if (content) {
                // Take an excerpt of the assistant's answer or audio transcription
                titleContext = content.slice(0, 350).trim();
            }
        }
    }

    if (!titleContext) return;

    const payload = {
        messages: [
            { 
                role: 'system', 
                content: 'You generate short, accurate conversation titles. Based on the provided message or response topic, generate a concise 3 to 5 word title. Respond ONLY with the title text. Do NOT use quotes, punctuation, or prefixes like "Title:".' 
            },
            { role: 'user', content: titleContext }
        ],
        model: state.selectedModel,
        temperature: 0.3,
        max_tokens: 20,
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
            
            // Cleanup thinking tags, prefixes, and quotes
            title = title.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            if (title.includes('</think>')) {
                title = title.split('</think>').pop().trim();
            }
            title = title.replace(/^(Title|Topic):\s*/i, '').trim();
            title = title.replace(/^["'`*#\-_.\s]+|["'`*#\-_.\s]+$/g, '').trim();
            
            if (title) {
                if (title.length > 45) {
                    title = title.slice(0, 45).trim() + '...';
                }
                activeChat.title = title;
                activeChat.titleGenerated = true;
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

export async function deleteUploadedFilesAPI(urls) {
    if (!urls || urls.length === 0) return;
    try {
        await fetch('/api/upload/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls })
        });
    } catch (e) {
        console.warn("Failed to delete uploaded files on server", e);
    }
}
window.deleteUploadedFilesAPI = deleteUploadedFilesAPI;

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
