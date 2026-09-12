/* settings modal, inference modes & engine status */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { saveApiSettings, smartToggleEngine, unloadAllModels, scanLocalGgufs, fetchEngineStatus, verifyFile } from '../api.js';
import { showNotification, showAlert } from './dialogs.js';
import { setVisionEnabled, updateVisionAvailabilityUI, initImageStudioSettings } from '../ui.js';
import { handleBrowseFile, openFileBrowserModal } from './file_browser.js';

let scannedModelsCache = [];
let fetchModelsDebounce = null;

export function setInferenceMode(mode) {
    state.inferenceMode = mode;
    if (dom.routingModeBtn) dom.routingModeBtn.classList.toggle('active', mode === 'routing');
    if (dom.singleModeBtn) dom.singleModeBtn.classList.toggle('active', mode === 'single');
    if (dom.apiModeBtn) dom.apiModeBtn.classList.toggle('active', mode === 'api');

    if (dom.routingModePanel) dom.routingModePanel.classList.toggle('hidden', mode !== 'routing');
    if (dom.singleModePanel) dom.singleModePanel.classList.toggle('hidden', mode !== 'single');
    if (dom.apiModePanel) dom.apiModePanel.classList.toggle('hidden', mode !== 'api');

    const isApi = mode === 'api';
    if (dom.downloadModelSection) dom.downloadModelSection.classList.toggle('hidden', isApi);
    if (dom.downloadDivider) dom.downloadDivider.classList.toggle('hidden', isApi);
    if (dom.smartEngineSection) dom.smartEngineSection.classList.toggle('hidden', isApi);

    if (isApi) {
        updateModelAvailabilityUI(true);
        fetchRemoteModels(true);
    } else {
        refreshEngineStatusUI();
    }

    updateVisionAvailabilityUI();
    saveApiSettings();
}

export function updateApiCurlSnippet() {
    if (!dom.apiCurlSnippet) return;
    const chatUrl = dom.apiChatUrl?.value.trim() || 'https://api.groq.com/openai/v1/chat/completions';
    const modelName = dom.apiModelInput?.value.trim() || 'llama-3.3-70b-versatile';
    const key = dom.apiKeyInput?.value.trim();
    const authHeader = key ? `  -H "Authorization: Bearer ${key}" \\\n` : '';
    dom.apiCurlSnippet.textContent = `curl -X POST ${chatUrl} \\\n  -H "Content-Type: application/json" \\\n${authHeader}  -d '{"model": "${modelName}", "messages": [{"role": "user", "content": "Hello!"}]}'`;
}

export async function fetchRemoteModels(silent = false) {
    const baseUrl = dom.apiBaseUrl?.value.trim();
    if (!baseUrl) return;
    const apiKey = dom.apiKeyInput?.value.trim() || '';

    if (dom.fetchRemoteModelsBtn) {
        dom.fetchRemoteModelsBtn.disabled = true;
        dom.fetchRemoteModelsBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Fetching...';
    }
    if (dom.fetchModelsStatus) {
        dom.fetchModelsStatus.style.display = 'block';
        dom.fetchModelsStatus.innerHTML = '<span style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Querying provider for models...</span>';
    }

    try {
        const res = await fetch('/api/external/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_url: baseUrl, api_key: apiKey })
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.models) && data.models.length > 0) {
            if (dom.remoteApiModelsList) {
                dom.remoteApiModelsList.innerHTML = data.models.map(m => `<option value="${m}">`).join('');
            }
            if (dom.apiModelSelect) {
                dom.apiModelSelect.innerHTML = `<option value="">(Select model)</option>` +
                    data.models.map(m => `<option value="${m}">${m}</option>`).join('');
                dom.apiModelSelect.style.display = 'block';

                const curr = dom.apiModelInput?.value.trim();
                if (curr && data.models.includes(curr)) {
                    dom.apiModelSelect.value = curr;
                } else {
                    const chosen = data.models[0];
                    if (dom.apiModelInput) dom.apiModelInput.value = chosen;
                    dom.apiModelSelect.value = chosen;
                    state.selectedModel = chosen;
                    saveApiSettings();
                    updateApiCurlSnippet();
                }
            }
            if (dom.fetchModelsStatus) {
                dom.fetchModelsStatus.innerHTML = `<span style="color: var(--accent-emerald, #10b981);"><i class="fa-solid fa-check"></i> Discovered ${data.models.length} models from provider</span>`;
            }
        } else {
            const err = data.error || 'No models returned by provider';
            if (!silent && dom.fetchModelsStatus) {
                dom.fetchModelsStatus.innerHTML = `<span style="color: var(--accent-rose, #f43f5e);"><i class="fa-solid fa-triangle-exclamation"></i> ${err}</span>`;
            }
        }
    } catch (err) {
        if (!silent && dom.fetchModelsStatus) {
            dom.fetchModelsStatus.innerHTML = `<span style="color: var(--accent-rose, #f43f5e);"><i class="fa-solid fa-triangle-exclamation"></i> Connection failed: ${err.message}</span>`;
        }
    } finally {
        if (dom.fetchRemoteModelsBtn) {
            dom.fetchRemoteModelsBtn.disabled = false;
            dom.fetchRemoteModelsBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Fetch Models';
        }
    }
}

export function scheduleFetchModels() {
    if (fetchModelsDebounce) clearTimeout(fetchModelsDebounce);
    fetchModelsDebounce = setTimeout(() => {
        fetchRemoteModels(true);
    }, 800);
}

export function syncMultimodalFromModel(modelName) {
    const endpoint = (dom.apiChatUrl?.value || dom.apiBaseUrl?.value || '').trim();
    const isMm = window.isMultimodalModel ? window.isMultimodalModel(modelName, endpoint) : false;
    if (dom.apiMultimodalCheck) {
        dom.apiMultimodalCheck.checked = isMm;
    }
    state.apiMultimodal = isMm;
    if (window.setVisionEnabled) {
        window.setVisionEnabled(isMm);
    }
}

export function syncSelectWithInput(selectEl, path) {
    if (!selectEl) return;
    if (!path) {
        selectEl.value = '';
        return;
    }
    let found = false;
    for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === path) {
            selectEl.selectedIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        const prevCustom = selectEl.querySelector('option[data-custom="true"]');
        if (prevCustom) prevCustom.remove();
        const opt = document.createElement('option');
        opt.value = path;
        opt.dataset.custom = 'true';
        opt.textContent = `Custom: ${path.split('/').pop() || path}`;
        opt.selected = true;
        selectEl.appendChild(opt);
    }
}

export async function refreshScannedModelsList() {
    try {
        const data = await scanLocalGgufs();
        scannedModelsCache = data.models || [];
        const remembered = data.remembered_paths || state.rememberedPaths || [];
        state.rememberedPaths = remembered;

        if (dom.scannedGgufSelect) {
            const currentVal = dom.customModelPathInput ? dom.customModelPathInput.value.trim() : (state.customModelPath || '');
            dom.scannedGgufSelect.innerHTML = '<option value="">-- Select detected model --</option>';
            let foundCurrent = false;

            scannedModelsCache.forEach(m => {
                const isMmproj = m.filename.toLowerCase().includes('mmproj');
                const opt = document.createElement('option');
                opt.value = m.path;
                opt.textContent = `${m.filename} (${m.size_gb} GB)${isMmproj ? ' [Projector]' : ''}`;
                if (m.path === currentVal) {
                    opt.selected = true;
                    foundCurrent = true;
                }
                dom.scannedGgufSelect.appendChild(opt);
            });

            if (currentVal && !foundCurrent) {
                const opt = document.createElement('option');
                opt.value = currentVal;
                opt.dataset.custom = 'true';
                opt.textContent = `Custom: ${currentVal.split('/').pop() || currentVal}`;
                opt.selected = true;
                dom.scannedGgufSelect.appendChild(opt);
            }
            if (!currentVal) {
                dom.scannedGgufSelect.value = '';
            }
        }

        if (dom.scannedMmprojSelect) {
            const currentMmproj = dom.customMmprojInput ? dom.customMmprojInput.value.trim() : (state.customMmprojPath || '');
            dom.scannedMmprojSelect.innerHTML = '<option value="">-- None (Disabled) --</option>';
            let foundMmproj = false;

            scannedModelsCache.forEach(m => {
                const isMmproj = m.filename.toLowerCase().includes('mmproj');
                const opt = document.createElement('option');
                opt.value = m.path;
                opt.textContent = `${m.filename} (${m.size_gb} GB)${isMmproj ? ' ★' : ''}`;
                if (m.path === currentMmproj) {
                    opt.selected = true;
                    foundMmproj = true;
                }
                dom.scannedMmprojSelect.appendChild(opt);
            });

            if (currentMmproj && !foundMmproj) {
                const opt = document.createElement('option');
                opt.value = currentMmproj;
                opt.dataset.custom = 'true';
                opt.textContent = `Custom: ${currentMmproj.split('/').pop() || currentMmproj}`;
                opt.selected = true;
                dom.scannedMmprojSelect.appendChild(opt);
            }
            if (!currentMmproj) {
                dom.scannedMmprojSelect.value = '';
            }
            if (dom.customMmprojCpu) {
                dom.customMmprojCpu.disabled = !currentMmproj;
            }
        }

        if (dom.rememberedPathsChips && dom.rememberedPathsContainer) {
            dom.rememberedPathsChips.innerHTML = '';
            if (remembered.length > 0) {
                dom.rememberedPathsContainer.classList.remove('hidden');
                remembered.forEach(p => {
                    const chip = document.createElement('div');
                    chip.className = 'path-chip';
                    const fname = p.split('/').pop();
                    chip.textContent = fname;
                    chip.title = p;
                    if (dom.customModelPathInput && dom.customModelPathInput.value.trim() === p) {
                        chip.classList.add('active');
                    }
                    chip.addEventListener('click', () => {
                        if (dom.customModelPathInput) {
                            dom.customModelPathInput.value = p;
                            syncSelectWithInput(dom.scannedGgufSelect, p);
                            verifyPathStatus(p, dom.customModelPathStatus);
                            saveApiSettings();
                            document.querySelectorAll('.path-chip').forEach(c => c.classList.remove('active'));
                            chip.classList.add('active');
                        }
                    });
                    dom.rememberedPathsChips.appendChild(chip);
                });
            } else {
                dom.rememberedPathsContainer.classList.add('hidden');
            }
        }

        if (dom.customModelPathInput && dom.customModelPathStatus) {
            verifyPathStatus(dom.customModelPathInput.value.trim(), dom.customModelPathStatus);
        }
        if (dom.customMmprojInput && dom.customMmprojStatus) {
            verifyPathStatus(dom.customMmprojInput.value.trim(), dom.customMmprojStatus, true);
        }
    } catch (err) {
        console.warn('Failed to refresh scanned models:', err);
    }
}

export async function verifyPathStatus(path, statusEl, isOptional = false) {
    if (!statusEl) return;
    if (!path) {
        statusEl.textContent = isOptional ? 'None' : 'No file selected';
        statusEl.className = 'file-status-pill status-unknown';
        return;
    }
    const foundInCache = scannedModelsCache.find(m => m.path === path);
    if (foundInCache) {
        statusEl.textContent = `Found (${foundInCache.size_gb} GB)`;
        statusEl.className = 'file-status-pill status-found';
        return;
    }
    statusEl.textContent = 'Checking...';
    statusEl.className = 'file-status-pill status-unknown';
    try {
        const check = await verifyFile(path);
        if (check.exists) {
            statusEl.textContent = `Found (${check.size_gb} GB)`;
            statusEl.className = 'file-status-pill status-found';
        } else {
            statusEl.textContent = check.is_directory ? 'Directory' : 'Not found';
            statusEl.className = 'file-status-pill status-missing';
        }
    } catch (e) {
        statusEl.textContent = 'Custom Path';
        statusEl.className = 'file-status-pill status-unknown';
    }
}

export async function handleUnloadAllModels(triggerBtn) {
    if (triggerBtn) triggerBtn.disabled = true;
    if (dom.engineStatusText) {
        dom.engineStatusText.textContent = 'Freeing VRAM & memory...';
        dom.engineStatusText.style.color = 'var(--text-secondary)';
    }
    try {
        const res = await unloadAllModels();
        await fetchEngineStatus();
        state.isModelLoaded = false;

        if (dom.engineStatusText) {
            dom.engineStatusText.textContent = 'Status: All Unloaded';
            dom.engineStatusText.style.color = 'var(--text-tertiary)';
        }
        if (dom.smartToggleBtn) {
            dom.smartToggleBtn.classList.remove('is-loaded');
            dom.smartToggleLabel.textContent = 'Load Engine';
        }
        updateModelAvailabilityUI(false);

        showNotification({
            title: 'Memory & VRAM Freed',
            message: res.message || 'All models unloaded and VRAM released',
            type: 'info',
            icon: 'fa-broom'
        });
    } catch (err) {
        showNotification({
            title: 'Unload Notice',
            message: err.message || 'Failed to unload models',
            type: 'error'
        });
    } finally {
        if (triggerBtn) triggerBtn.disabled = false;
    }
}
window.handleUnloadAllModels = handleUnloadAllModels;

export async function refreshEngineStatusUI() {
    try {
        const res = await fetch('/api/engine/status', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            const isLoaded = !!(data.active && data.active.loaded);
            state.isModelLoaded = isLoaded;

            if (dom.engineStatusText) {
                if (isLoaded) {
                    dom.engineStatusText.textContent = `Active: ${data.active.name}`;
                    dom.engineStatusText.style.color = 'var(--accent-emerald)';
                    if (dom.smartToggleBtn) dom.smartToggleBtn.classList.add('is-loaded');
                    if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'Unload Engine';
                } else {
                    dom.engineStatusText.textContent = 'Status: Not Loaded';
                    dom.engineStatusText.style.color = 'var(--text-tertiary)';
                    if (dom.smartToggleBtn) dom.smartToggleBtn.classList.remove('is-loaded');
                    if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'Load Engine';
                }
            }

            updateModelAvailabilityUI(isLoaded);

            if (data.available) {
                for (const [role, info] of Object.entries(data.available)) {
                    const badge = dom[role + 'AvailBadge'];
                    if (badge) {
                        if (info.available) {
                            badge.textContent = `${info.size_gb} GB`;
                            badge.classList.add('available');
                            badge.classList.remove('unavailable');
                        } else {
                            badge.textContent = 'Missing';
                            badge.classList.add('unavailable');
                            badge.classList.remove('available');
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Failed to refresh engine status:', e);
    }
}
window.refreshEngineStatusUI = refreshEngineStatusUI;

export function updateModelAvailabilityUI(isLoaded) {
    if (state.inferenceMode === 'api') {
        state.isModelLoaded = true;
        if (dom.noModelChatOverlay) dom.noModelChatOverlay.classList.add('hidden');
        if (dom.sideModelNotif) dom.sideModelNotif.classList.add('hidden');
        return;
    }
    state.isModelLoaded = isLoaded;
    if (!isLoaded) {
        if (dom.noModelChatOverlay) {
            dom.noModelChatOverlay.classList.remove('hidden');
            const text = dom.userPrompt ? dom.userPrompt.value.trim() : '';
            if (dom.chatBoxDraftHint) {
                if (text.length > 0) {
                    dom.chatBoxDraftHint.textContent = `Draft saved (${text.length} chars) • Tap Settings`;
                } else {
                    dom.chatBoxDraftHint.textContent = 'Tap Settings to load a model';
                }
            }
        }
        if (dom.sideModelNotif && !state.sideNotifDismissed) {
            dom.sideModelNotif.classList.remove('hidden');
        }
    } else {
        if (dom.noModelChatOverlay) {
            dom.noModelChatOverlay.classList.add('hidden');
        }
        if (dom.sideModelNotif) {
            dom.sideModelNotif.classList.add('hidden');
        }
    }
}
window.updateModelAvailabilityUI = updateModelAvailabilityUI;

export function openSettingsForModelLoad() {
    if (dom.settingsModal) {
        dom.settingsModal.classList.remove('hidden');
        refreshEngineStatusUI();
        refreshScannedModelsList();
        initImageStudioSettings();
    }
}

export function setupSettingsUI() {
    const roleSliderSetup = [
        ['router', 'Gpu', true], ['router', 'Ctx', false], ['router', 'Batch', false],
        ['coder', 'Gpu', true], ['coder', 'Ctx', false], ['coder', 'Batch', false],
        ['vision', 'Gpu', true], ['vision', 'Ctx', false], ['vision', 'Batch', false],
        ['single', 'Gpu', true], ['single', 'Ctx', false], ['single', 'Batch', false],
    ];
    roleSliderSetup.forEach(([prefix, suffix, isGpu]) => {
        const slider = dom[prefix + suffix + 'Slider'];
        const val = dom[prefix + suffix + 'Val'];
        if (slider && val) {
            slider.addEventListener('input', () => {
                val.textContent = isGpu && slider.value == -1 ? '-1 (Max)' : slider.value;
            });
        }
    });

    if (dom.routingModeBtn) dom.routingModeBtn.addEventListener('click', () => setInferenceMode('routing'));
    if (dom.singleModeBtn) dom.singleModeBtn.addEventListener('click', () => setInferenceMode('single'));
    if (dom.apiModeBtn) dom.apiModeBtn.addEventListener('click', () => setInferenceMode('api'));

    if (dom.fetchRemoteModelsBtn) {
        dom.fetchRemoteModelsBtn.addEventListener('click', () => fetchRemoteModels(false));
    }

    if (dom.apiModelSelect) {
        dom.apiModelSelect.addEventListener('change', () => {
            if (dom.apiModelSelect.value) {
                if (dom.apiModelInput) dom.apiModelInput.value = dom.apiModelSelect.value;
                state.selectedModel = dom.apiModelSelect.value;
                syncMultimodalFromModel(dom.apiModelSelect.value);
                updateApiCurlSnippet();
                saveApiSettings();
            }
        });
    }

    if (dom.apiBaseUrl) {
        dom.apiBaseUrl.addEventListener('input', () => {
            const rawBase = dom.apiBaseUrl.value.trim();
            if (rawBase) {
                const cleanBase = rawBase.replace(/\/+$/, '');
                if (dom.apiChatUrl) {
                    dom.apiChatUrl.value = `${cleanBase}/chat/completions`;
                }
            }
            updateApiCurlSnippet();
            saveApiSettings();
            scheduleFetchModels();
        });
    }

    if (dom.apiChatUrl) {
        dom.apiChatUrl.addEventListener('input', () => {
            updateApiCurlSnippet();
            saveApiSettings();
        });
    }

    if (dom.apiKeyInput) {
        dom.apiKeyInput.addEventListener('input', () => {
            updateApiCurlSnippet();
            saveApiSettings();
            scheduleFetchModels();
        });
    }

    if (dom.apiModelInput) {
        dom.apiModelInput.addEventListener('input', () => {
            const val = dom.apiModelInput.value.trim();
            state.selectedModel = val;
            if (dom.apiModelSelect && val) {
                dom.apiModelSelect.value = val;
            }
            syncMultimodalFromModel(val);
            updateApiCurlSnippet();
            saveApiSettings();
        });
    }

    if (dom.apiMultimodalCheck) {
        dom.apiMultimodalCheck.addEventListener('change', () => {
            state.apiMultimodal = dom.apiMultimodalCheck.checked;
            setVisionEnabled(dom.apiMultimodalCheck.checked);
            saveApiSettings();
        });
    }

    if (dom.toggleApiKeyVisibilityBtn && dom.apiKeyInput) {
        dom.toggleApiKeyVisibilityBtn.addEventListener('click', () => {
            const isPassword = dom.apiKeyInput.type === 'password';
            dom.apiKeyInput.type = isPassword ? 'text' : 'password';
            dom.toggleApiKeyVisibilityBtn.innerHTML = isPassword ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
        });
    }

    const apiPresets = {
        gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.8-flash', multimodal: true },
        groq: { base: 'https://api.groq.com/openai/v1', chat: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', multimodal: false },
        openai: { base: 'https://api.openai.com/v1', chat: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', multimodal: true },
        ollama: { base: 'http://localhost:11434/v1', chat: 'http://localhost:11434/v1/chat/completions', model: 'llama3.2', multimodal: false },
        local: { base: `${window.location.origin}/v1`, chat: `${window.location.origin}/v1/chat/completions`, model: 'coder', multimodal: false }
    };

    document.querySelectorAll('.api-preset-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-preset');
            const p = apiPresets[key];
            if (!p) return;
            if (dom.apiBaseUrl) dom.apiBaseUrl.value = p.base;
            if (dom.apiChatUrl) dom.apiChatUrl.value = p.chat;
            if (dom.apiModelInput) {
                dom.apiModelInput.value = p.model;
                state.selectedModel = p.model;
            }
            if (dom.apiModelSelect) dom.apiModelSelect.value = p.model;
            const mm = Boolean(p.multimodal);
            if (dom.apiMultimodalCheck) dom.apiMultimodalCheck.checked = mm;
            state.apiMultimodal = mm;
            setVisionEnabled(mm);
            updateApiCurlSnippet();
            saveApiSettings();
            fetchRemoteModels(true);
        });
    });

    function setupCopyBtn(btn, getVal, copiedText = 'Copied!') {
        if (!btn) return;
        btn.addEventListener('click', () => {
            const val = typeof getVal === 'function' ? getVal() : getVal;
            navigator.clipboard.writeText(val);
            const origHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-check"></i> ${copiedText}`;
            setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
        });
    }

    setupCopyBtn(dom.copyApiBaseUrlBtn, () => dom.apiBaseUrl?.value || '');
    setupCopyBtn(dom.copyApiChatUrlBtn, () => dom.apiChatUrl?.value || '');
    setupCopyBtn(dom.copyApiKeyBtn, () => dom.apiKeyInput?.value || '');
    setupCopyBtn(dom.copyApiCurlBtn, () => dom.apiCurlSnippet?.textContent || '');

    updateApiCurlSnippet();
    if (state.inferenceMode === 'api') {
        fetchRemoteModels(true);
    }

    if (dom.singleModelRoleSelect) {
        dom.singleModelRoleSelect.addEventListener('change', () => {
            const role = dom.singleModelRoleSelect.value;
            if (dom.customModelCard) {
                if (role === 'custom') {
                    dom.customModelCard.classList.remove('hidden');
                    refreshScannedModelsList();
                } else {
                    dom.customModelCard.classList.add('hidden');
                }
            }
            if (role !== 'custom') {
                ['Gpu', 'Ctx', 'Batch'].forEach(field => {
                    const src = dom[role + field + 'Slider'];
                    const dst = dom['single' + field + 'Slider'];
                    const val = dom['single' + field + 'Val'];
                    if (src && dst) {
                        dst.value = src.value;
                        if (val) val.textContent = field === 'Gpu' && src.value == -1 ? '-1 (Max)' : src.value;
                    }
                });
                if (dom[role + 'KvSelect'] && dom.singleKvSelect) {
                    dom.singleKvSelect.value = dom[role + 'KvSelect'].value;
                }
                ['FlashAttn', 'OffloadKqv', 'Mlock', 'Mmap'].forEach(flag => {
                    if (dom[role + flag] && dom['single' + flag]) {
                        dom['single' + flag].checked = dom[role + flag].checked;
                    }
                });
            }
            updateVisionAvailabilityUI();
            saveApiSettings();
        });
    }

    if (dom.scannedGgufSelect) {
        dom.scannedGgufSelect.addEventListener('change', () => {
            const val = dom.scannedGgufSelect.value.trim();
            if (dom.customModelPathInput) dom.customModelPathInput.value = val;
            verifyPathStatus(val, dom.customModelPathStatus);
            saveApiSettings();
        });
    }

    if (dom.customModelPathInput) {
        dom.customModelPathInput.addEventListener('input', () => {
            const val = dom.customModelPathInput.value.trim();
            syncSelectWithInput(dom.scannedGgufSelect, val);
            verifyPathStatus(val, dom.customModelPathStatus);
            saveApiSettings();
        });
    }

    if (dom.clearCustomPathBtn) {
        dom.clearCustomPathBtn.addEventListener('click', () => {
            if (dom.customModelPathInput) dom.customModelPathInput.value = '';
            if (dom.scannedGgufSelect) dom.scannedGgufSelect.value = '';
            verifyPathStatus('', dom.customModelPathStatus);
            saveApiSettings();
        });
    }

    if (dom.scannedMmprojSelect) {
        dom.scannedMmprojSelect.addEventListener('change', () => {
            const val = dom.scannedMmprojSelect.value.trim();
            if (dom.customMmprojInput) dom.customMmprojInput.value = val;
            state.customMmprojPath = val;
            verifyPathStatus(val, dom.customMmprojStatus, true);
            const hasProj = Boolean(val && val.toLowerCase() !== 'none');
            if (dom.customMmprojCpu) dom.customMmprojCpu.disabled = !hasProj;
            setVisionEnabled(hasProj);
            saveApiSettings();
        });
    }

    if (dom.customMmprojInput) {
        dom.customMmprojInput.addEventListener('input', () => {
            const val = dom.customMmprojInput.value.trim();
            state.customMmprojPath = val;
            syncSelectWithInput(dom.scannedMmprojSelect, val);
            verifyPathStatus(val, dom.customMmprojStatus, true);
            const hasProj = Boolean(val && val.toLowerCase() !== 'none');
            if (dom.customMmprojCpu) dom.customMmprojCpu.disabled = !hasProj;
            setVisionEnabled(hasProj);
            saveApiSettings();
        });
    }

    if (dom.clearMmprojBtn) {
        dom.clearMmprojBtn.addEventListener('click', () => {
            if (dom.customMmprojInput) dom.customMmprojInput.value = '';
            if (dom.scannedMmprojSelect) dom.scannedMmprojSelect.value = '';
            state.customMmprojPath = '';
            verifyPathStatus('', dom.customMmprojStatus, true);
            if (dom.customMmprojCpu) dom.customMmprojCpu.disabled = true;
            setVisionEnabled(false);
            saveApiSettings();
        });
    }

    if (dom.verifyCustomPathBtn) {
        dom.verifyCustomPathBtn.addEventListener('click', () => {
            const path = dom.customModelPathInput ? dom.customModelPathInput.value.trim() : '';
            verifyPathStatus(path, dom.customModelPathStatus);
            saveApiSettings();
        });
    }

    if (dom.verifyMmprojBtn) {
        dom.verifyMmprojBtn.addEventListener('click', () => {
            const path = dom.customMmprojInput ? dom.customMmprojInput.value.trim() : '';
            verifyPathStatus(path, dom.customMmprojStatus, true);
            saveApiSettings();
        });
    }

    if (dom.customMmprojCpu) dom.customMmprojCpu.addEventListener('change', () => saveApiSettings());
    if (dom.visionMmprojCpu) dom.visionMmprojCpu.addEventListener('change', () => saveApiSettings());
    if (dom.pdfDpiSelect) dom.pdfDpiSelect.addEventListener('change', () => saveApiSettings());

    document.querySelectorAll('.role-card-header').forEach(header => {
        header.addEventListener('click', () => {
            const targetId = header.getAttribute('data-target');
            const body = document.getElementById(targetId);
            if (body) {
                body.classList.toggle('collapsed');
                const chevron = header.querySelector('.role-card-chevron');
                if (chevron) chevron.classList.toggle('rotated');
            }
        });
    });

    if (dom.smartToggleBtn) {
        dom.smartToggleBtn.addEventListener('click', async () => {
            dom.smartToggleBtn.disabled = true;
            dom.engineStatusText.textContent = 'Working...';
            dom.engineStatusText.style.color = 'var(--text-secondary)';
            try {
                await saveApiSettings();
                const result = await smartToggleEngine();
                await fetchEngineStatus();
                if (result.warning || result.info?.warning) {
                    showAlert("Model Notice", result.warning || result.info.warning);
                }
                if (result.action === 'loaded') {
                    dom.engineStatusText.textContent = `Active: ${result.info?.name || result.role}`;
                    dom.engineStatusText.style.color = 'var(--accent-emerald)';
                    dom.smartToggleBtn.classList.add('is-loaded');
                    dom.smartToggleLabel.textContent = 'Unload Engine';
                    showNotification({
                        title: 'Engine Loaded',
                        message: `${result.info?.name || result.role} is now active and ready`,
                        type: 'success',
                        icon: 'fa-bolt'
                    });
                } else {
                    dom.engineStatusText.textContent = 'Status: Unloaded';
                    dom.engineStatusText.style.color = 'var(--text-tertiary)';
                    dom.smartToggleBtn.classList.remove('is-loaded');
                    dom.smartToggleLabel.textContent = 'Load Engine';
                    showNotification({
                        title: 'Engine Unloaded',
                        message: 'Engine is now unloaded and idle',
                        type: 'info',
                        icon: 'fa-power-off'
                    });
                }
            } catch (e) {
                dom.engineStatusText.textContent = 'Error: ' + e.message;
                dom.engineStatusText.style.color = '#ef4444';
                showNotification({
                    title: 'Engine Error',
                    message: e.message,
                    type: 'error'
                });
            } finally {
                dom.smartToggleBtn.disabled = false;
            }
        });
    }

    if (dom.unloadAllModelsBtn) {
        dom.unloadAllModelsBtn.addEventListener('click', () => handleUnloadAllModels(dom.unloadAllModelsBtn));
    }
    if (dom.statsUnloadAllBtn) {
        dom.statsUnloadAllBtn.addEventListener('click', () => handleUnloadAllModels(dom.statsUnloadAllBtn));
    }
    if (dom.drawerUnloadBtn) {
        dom.drawerUnloadBtn.addEventListener('click', () => handleUnloadAllModels(dom.drawerUnloadBtn));
    }

    if (dom.chatBoxLoadModelBtn) {
        dom.chatBoxLoadModelBtn.addEventListener('click', openSettingsForModelLoad);
    }
    if (dom.sideNotifLoadBtn) {
        dom.sideNotifLoadBtn.addEventListener('click', () => {
            state.sideNotifDismissed = true;
            if (dom.sideModelNotif) dom.sideModelNotif.classList.add('hidden');
            openSettingsForModelLoad();
        });
    }
    if (dom.sideNotifCloseBtn) {
        dom.sideNotifCloseBtn.addEventListener('click', () => {
            state.sideNotifDismissed = true;
            if (dom.sideModelNotif) dom.sideModelNotif.classList.add('hidden');
        });
    }

    if (dom.settingsBtn) {
        dom.settingsBtn.addEventListener('click', () => {
            setTimeout(() => {
                if (!dom.settingsModal.classList.contains('hidden')) {
                    refreshEngineStatusUI();
                    refreshScannedModelsList();
                    initImageStudioSettings();
                }
            }, 50);
        });
    }
}
