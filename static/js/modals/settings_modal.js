/* settings modal, inference modes & engine status */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { saveApiSettings, smartToggleEngine, unloadAllModels, scanLocalGgufs, fetchEngineStatus, verifyFile } from '../api.js';
import { showNotification, showAlert } from './dialogs.js';
import { setVisionEnabled, updateVisionAvailabilityUI, initImageStudioSettings } from '../ui.js';
import { handleBrowseFile, openFileBrowserModal } from './file_browser.js';

let scannedModelsCache = [];
try {
    const cachedModels = localStorage.getItem('nivm_cached_scanned_models');
    if (cachedModels) scannedModelsCache = JSON.parse(cachedModels);
} catch (_) {}
let fetchModelsDebounce = null;

export function setInferenceMode(mode) {
    state.inferenceMode = mode;
    ['routing', 'single', 'api'].forEach(m => {
        dom[`${m}ModeBtn`]?.classList.toggle('active', mode === m);
        dom[`${m}ModePanel`]?.classList.toggle('hidden', mode !== m);
    });

    const isApi = mode === 'api';
    if (dom.memoryEstimatorCard) {
        if (mode === 'single' && dom.customModelCard) {
            dom.customModelCard.insertAdjacentElement('afterend', dom.memoryEstimatorCard);
        } else if (mode === 'routing' && dom.routingModePanel) {
            const section = dom.routingModePanel.querySelector('.settings-section');
            if (section) {
                const title = section.querySelector('.section-title');
                if (title) {
                    title.insertAdjacentElement('afterend', dom.memoryEstimatorCard);
                } else {
                    section.insertAdjacentElement('afterbegin', dom.memoryEstimatorCard);
                }
            }
        }
        dom.memoryEstimatorCard.classList.toggle('hidden', isApi);
    }
    if (dom.smartEngineSection) dom.smartEngineSection.classList.toggle('hidden', isApi);

    if (isApi) {
        updateModelAvailabilityUI(true);
        fetchRemoteModels(true);
    } else {
        refreshEngineStatusUI();
        updateMemoryEstimator();
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

export function removeRememberedPath(pathToRemove) {
    state.rememberedPaths = (state.rememberedPaths || []).filter(p => p !== pathToRemove);
    saveApiSettings();
    refreshScannedModelsList();
}

export function updateGpuSliderLabel(slider, valSpan, value, totalLayers) {
    if (!valSpan) return;
    const layers = totalLayers || (slider ? parseInt(slider.dataset.totalLayers || slider.max, 10) : 128);
    const numVal = parseInt(value, 10);
    if (numVal === -1) {
        valSpan.textContent = layers > 0 && layers < 128 ? `-1 (All ${layers} Layers)` : '-1 (Max)';
    } else if (numVal === 0) {
        valSpan.textContent = '0 (CPU only)';
    } else if (layers > 0 && layers < 128) {
        const pct = Math.min(100, Math.round((numVal / layers) * 100));
        valSpan.textContent = `${numVal} / ${layers} Layers (${pct}% GPU)`;
    } else {
        valSpan.textContent = String(numVal);
    }
}

export function applyModelMetadataToUI(meta) {
    if (!meta) return;

    // 1. Update Model Specs Bar
    if (dom.modelSpecsBar) {
        if (meta.layers || meta.arch) {
            dom.modelSpecsBar.classList.remove('hidden');
            if (dom.specPillLayers) {
                if (meta.layers) {
                    dom.specPillLayers.classList.remove('hidden');
                    const span = dom.specPillLayers.querySelector('span');
                    if (span) span.textContent = `${meta.layers} Layers`;
                } else {
                    dom.specPillLayers.classList.add('hidden');
                }
            }
            if (dom.specPillArch) {
                if (meta.arch && meta.arch !== 'unknown') {
                    dom.specPillArch.classList.remove('hidden');
                    const span = dom.specPillArch.querySelector('span');
                    if (span) span.textContent = meta.arch;
                } else {
                    dom.specPillArch.classList.add('hidden');
                }
            }
            if (dom.specPillCtx) {
                if (meta.context_length) {
                    dom.specPillCtx.classList.remove('hidden');
                    const ctxK = Math.round(meta.context_length / 1024);
                    const span = dom.specPillCtx.querySelector('span');
                    if (span) span.textContent = `${ctxK >= 1 ? ctxK + 'k' : meta.context_length} Ctx`;
                } else {
                    dom.specPillCtx.classList.add('hidden');
                }
            }
            if (dom.specPillMoE) {
                if (meta.is_moe) {
                    dom.specPillMoE.classList.remove('hidden');
                    const expText = meta.expert_count ? `MoE: ${meta.expert_count} Experts (${meta.expert_used_count || '?'} active)` : 'MoE Model';
                    const span = dom.specPillMoE.querySelector('span');
                    if (span) span.textContent = expText;
                } else {
                    dom.specPillMoE.classList.add('hidden');
                }
            }
        } else {
            dom.modelSpecsBar.classList.add('hidden');
        }
    }

    // 2. Dynamically update GPU layers slider
    if (dom.singleGpuSlider && meta.layers && meta.layers > 0) {
        dom.singleGpuSlider.max = String(meta.layers);
        dom.singleGpuSlider.dataset.totalLayers = String(meta.layers);
        const currentVal = parseInt(dom.singleGpuSlider.value, 10);
        updateGpuSliderLabel(dom.singleGpuSlider, dom.singleGpuVal, currentVal, meta.layers);
    }

    // 3. Update MoE alert banner below GPU slider
    if (dom.singleGpuMoEAlert) {
        if (meta.is_moe) {
            dom.singleGpuMoEAlert.classList.remove('hidden');
            if (dom.singleGpuMoEText) {
                const totalExp = meta.expert_count || 'multiple';
                const actExp = meta.expert_used_count || 'active';
                dom.singleGpuMoEText.textContent = `MoE Architecture (${totalExp} experts, ${actExp} active/token): In llama.cpp, setting GPU layers offloads all ${totalExp} experts for those layers into VRAM.`;
            }
        } else {
            dom.singleGpuMoEAlert.classList.add('hidden');
        }
    }

    // 4. Update memory estimator
    updateMemoryEstimator();
}
window.applyModelMetadataToUI = applyModelMetadataToUI;

export async function fetchModelInspection(path) {
    if (!path) return null;
    try {
        const res = await fetch(`/api/models/inspect?path=${encodeURIComponent(path)}`);
        if (res.ok) {
            const data = await res.json();
            applyModelMetadataToUI(data);
            return data;
        }
    } catch (e) {
        console.debug('Failed to inspect model metadata:', e);
    }
    return null;
}

export function renderScannedDropdowns(models, remembered) {
    if (dom.scannedGgufSelect) {
        const currentVal = dom.customModelPathInput ? dom.customModelPathInput.value.trim() : (state.customModelPath || '');
        dom.scannedGgufSelect.innerHTML = '<option value="">-- Select detected model --</option>';
        let foundCurrent = false;

        models.forEach(m => {
            const isMmproj = m.filename.toLowerCase().includes('mmproj');
            const opt = document.createElement('option');
            opt.value = m.path;
            const specSuffix = m.layers ? `, ${m.layers}L` : '';
            const moeSuffix = m.is_moe ? ', MoE' : '';
            opt.textContent = `${m.filename} (${m.size_gb} GB${specSuffix}${moeSuffix})${isMmproj ? ' [Projector]' : ''}`;
            if (m.path === currentVal) {
                opt.selected = true;
                foundCurrent = true;
                applyModelMetadataToUI(m);
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
            fetchModelInspection(currentVal);
        }
        if (!currentVal) {
            dom.scannedGgufSelect.value = '';
        }
    }

    if (dom.scannedMmprojSelect) {
        const currentMmproj = dom.customMmprojInput ? dom.customMmprojInput.value.trim() : (state.customMmprojPath || '');
        dom.scannedMmprojSelect.innerHTML = '<option value="">-- None (Disabled) --</option>';
        let foundMmproj = false;

        models.forEach(m => {
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
        if (Array.isArray(remembered) && remembered.length > 0) {
            dom.rememberedPathsContainer.classList.remove('hidden');
            remembered.forEach(p => {
                const chip = document.createElement('div');
                chip.className = 'path-chip';
                const fname = p.split('/').pop();

                const label = document.createElement('span');
                label.className = 'path-chip-text';
                label.textContent = fname;
                label.title = p;
                chip.appendChild(label);

                const removeBtn = document.createElement('span');
                removeBtn.className = 'path-chip-remove';
                removeBtn.innerHTML = '&times;';
                removeBtn.title = 'Remove from recent paths';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeRememberedPath(p);
                });
                chip.appendChild(removeBtn);

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
}

export async function refreshScannedModelsList() {
    // 1. Immediately render cached models on frame 0 to avoid empty UI
    if (scannedModelsCache && scannedModelsCache.length > 0 && dom.scannedGgufSelect && dom.scannedGgufSelect.options.length <= 1) {
        renderScannedDropdowns(scannedModelsCache, state.rememberedPaths || []);
    }

    try {
        const data = await scanLocalGgufs();
        scannedModelsCache = data.models || [];
        try {
            localStorage.setItem('nivm_cached_scanned_models', JSON.stringify(scannedModelsCache));
        } catch (_) {}
        const remembered = data.remembered_paths || state.rememberedPaths || [];
        state.rememberedPaths = remembered;

        renderScannedDropdowns(scannedModelsCache, remembered);
    } catch (err) {
        console.warn('Failed to refresh scanned models:', err);
    }
}

export async function verifyPathStatus(path, statusEl, isOptional = false) {
    if (!statusEl) return;
    if (!path) {
        statusEl.textContent = isOptional ? 'None' : 'No file selected';
        statusEl.className = 'file-status-pill status-unknown';
        if (!isOptional) {
            applyModelMetadataToUI({ layers: null, arch: null, is_moe: false });
        }
        return;
    }
    const foundInCache = scannedModelsCache.find(m => m.path === path || m.filename === path.split('/').pop());
    if (foundInCache) {
        statusEl.textContent = `Found (${foundInCache.size_gb} GB)`;
        statusEl.className = 'file-status-pill status-found';
        if (!isOptional) {
            applyModelMetadataToUI(foundInCache);
        }
        return;
    }
    statusEl.textContent = 'Checking...';
    statusEl.className = 'file-status-pill status-unknown';
    try {
        const check = await verifyFile(path);
        if (check.exists) {
            statusEl.textContent = `Found (${check.size_gb} GB)`;
            statusEl.className = 'file-status-pill status-found';
            if (!isOptional) {
                fetchModelInspection(path);
            }
        } else {
            statusEl.textContent = check.is_directory ? 'Directory' : 'Not found';
            statusEl.className = 'file-status-pill status-missing';
            if (!isOptional) {
                applyModelMetadataToUI({ layers: null, arch: null, is_moe: false });
            }
        }
    } catch (e) {
        statusEl.textContent = 'Error';
        statusEl.className = 'file-status-pill status-missing';
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
            dom.engineStatusText.textContent = 'Ready';
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
                    if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'Unload';
                } else {
                    dom.engineStatusText.textContent = 'Ready';
                    dom.engineStatusText.style.color = 'var(--text-tertiary)';
                    if (dom.smartToggleBtn) dom.smartToggleBtn.classList.remove('is-loaded');
                    if (dom.smartToggleLabel) dom.smartToggleLabel.textContent = 'Load Engine';
                }
            }

            if (dom.engineStatusDot) {
                dom.engineStatusDot.className = 'engine-status-dot' + (isLoaded ? ' active' : '');
            }

            if (data.hardware) {
                state.hardwareInfo = data.hardware;
                try {
                    localStorage.setItem('nivm_cached_hardware', JSON.stringify(data.hardware));
                } catch (_) {}
                if (dom.engineHardwareSub) {
                    if (data.hardware.gpu_available && data.hardware.vram_total_gb > 0) {
                        let name = (data.hardware.gpu_name || 'GPU')
                            .replace(/^NVIDIA\s+(GeForce\s+)?/i, '')
                            .replace(/\s+(Laptop\s+)?GPU/i, '')
                            .trim();
                        if (name.length > 22) name = name.slice(0, 21) + '…';
                        dom.engineHardwareSub.textContent = name;
                    } else {
                        dom.engineHardwareSub.textContent = 'CPU Mode';
                    }
                }
            }

            updateModelAvailabilityUI(isLoaded);
            updateMemoryEstimator();

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

/* hardware memory estimator */
export function updateMemoryEstimator() {
    if (state.inferenceMode === 'api') {
        if (dom.memoryEstimatorCard) dom.memoryEstimatorCard.classList.add('hidden');
        return;
    }
    if (dom.memoryEstimatorCard) dom.memoryEstimatorCard.classList.remove('hidden');

    if (!dom.estVramVal || !dom.totalVramVal) return;
    if (!state.hardwareInfo) {
        try {
            const cachedHw = localStorage.getItem('nivm_cached_hardware');
            if (cachedHw) state.hardwareInfo = JSON.parse(cachedHw);
        } catch (_) {}
    }
    const hw = state.hardwareInfo;
    if (!hw) {
        if (dom.engineHardwareSub) dom.engineHardwareSub.textContent = 'Detecting hardware...';
        return;
    }

    const isGpu = Boolean(hw.gpu_available && hw.vram_total_gb > 0);
    const totalVram = isGpu ? hw.vram_total_gb : 0.0;
    const totalRam = hw.ram_total_gb > 0 ? hw.ram_total_gb : 16.0;
    const availRam = hw.ram_available_gb > 0 ? hw.ram_available_gb : (totalRam * 0.7);

    // 1. Determine active model role and size
    let modelSizeGb = 3.0;
    let gpuLayers = -1;
    let ctx = 8192;
    let kvType = 'q4_0';
    let offloadKqv = true;
    let flashAttn = true;
    let batchSize = 512;
    let mmprojSizeGb = 0;
    let mmprojOnCpu = false;

    if (state.inferenceMode === 'single') {
        const path = dom.customModelPathInput ? dom.customModelPathInput.value.trim() : '';
        if (path && scannedModelsCache && scannedModelsCache.length > 0) {
            const found = scannedModelsCache.find(m => m.path === path || m.filename === path.split('/').pop());
            if (found && found.size_gb) {
                modelSizeGb = parseFloat(found.size_gb) || 3.0;
            }
        }
        const projPath = dom.customMmprojInput ? dom.customMmprojInput.value.trim() : '';
        if (projPath && projPath.toLowerCase() !== 'none') {
            mmprojSizeGb = 1.2;
            mmprojOnCpu = dom.customMmprojCpu ? dom.customMmprojCpu.checked : false;
        }

        gpuLayers = dom.singleGpuSlider ? parseInt(dom.singleGpuSlider.value, 10) : -1;
        ctx = dom.singleCtxSlider ? parseInt(dom.singleCtxSlider.value, 10) : 8192;
        batchSize = dom.singleBatchSlider ? parseInt(dom.singleBatchSlider.value, 10) : 512;
        kvType = dom.singleKvSelect ? dom.singleKvSelect.value : 'q4_0';
        offloadKqv = dom.singleOffloadKqv ? dom.singleOffloadKqv.checked : true;
        flashAttn = dom.singleFlashAttn ? dom.singleFlashAttn.checked : true;
    } else if (state.inferenceMode === 'routing') {
        const residentRole = (state.engineActive && state.engineActive.role) || 'coder';
        if (state.engineAvailable && state.engineAvailable[residentRole]?.size_gb) {
            modelSizeGb = parseFloat(state.engineAvailable[residentRole].size_gb) || 4.7;
        } else {
            modelSizeGb = 4.7;
        }
        gpuLayers = dom.coderGpuSlider ? parseInt(dom.coderGpuSlider.value, 10) : -1;
        ctx = dom.coderCtxSlider ? parseInt(dom.coderCtxSlider.value, 10) : 8192;
        batchSize = dom.coderBatchSlider ? parseInt(dom.coderBatchSlider.value, 10) : 512;
        kvType = dom.coderKvSelect ? dom.coderKvSelect.value : 'q8_0';
        offloadKqv = dom.coderOffloadKqv ? dom.coderOffloadKqv.checked : true;
        flashAttn = dom.coderFlashAttn ? dom.coderFlashAttn.checked : true;
    } else {
        // API mode: 0 local VRAM
        dom.estVramVal.textContent = '0.0 GB';
        dom.totalVramVal.textContent = isGpu ? `${totalVram.toFixed(1)} GB` : 'N/A';
        if (dom.vramBarFill) {
            dom.vramBarFill.style.width = '0%';
            dom.vramBarFill.className = 'memory-bar-fill fill-safe';
        }
        if (dom.vramBreakdownText) dom.vramBreakdownText.textContent = 'API Mode: Cloud Inference (0 GB Local VRAM)';
        dom.estRamVal.textContent = '0.1 GB';
        dom.totalRamVal.textContent = `${totalRam.toFixed(1)} GB`;
        if (dom.ramBarFill) {
            dom.ramBarFill.style.width = '2%';
            dom.ramBarFill.className = 'memory-bar-fill fill-safe';
        }
        if (dom.ramBreakdownText) dom.ramBreakdownText.textContent = `System headroom: ${availRam.toFixed(1)} GB available`;
        if (dom.memorySafetyPill) {
            dom.memorySafetyPill.className = 'memory-safety-pill status-safe';
            dom.memorySafetyPill.textContent = 'Cloud Mode';
        }
        if (dom.memoryAdviceText) {
            dom.memoryAdviceText.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i> <span>Running in API Cloud mode. No local GPU or system RAM consumed.</span>';
        }
        return;
    }

    // 2. Weights split between GPU and RAM
    let weightsVram = 0;
    let weightsRam = 0;
    const totalLayers = (dom.singleGpuSlider && parseInt(dom.singleGpuSlider.dataset.totalLayers || dom.singleGpuSlider.max, 10)) || 32;
    const effectiveLayers = (totalLayers > 0 && totalLayers < 128) ? totalLayers : 32;
    const offloadRatio = (gpuLayers === -1 || gpuLayers >= effectiveLayers) ? 1.0 : Math.min(1.0, Math.max(0.0, gpuLayers / effectiveLayers));
    if (!isGpu || gpuLayers === 0) {
        weightsVram = 0;
        weightsRam = modelSizeGb;
    } else if (gpuLayers === -1 || gpuLayers >= effectiveLayers) {
        weightsVram = modelSizeGb;
        weightsRam = 0;
    } else {
        weightsVram = modelSizeGb * offloadRatio;
        weightsRam = modelSizeGb * (1 - offloadRatio);
    }

    // 3. KV Cache calculation scaled to model parameter class & context
    let kvElementsPerToken = 49152;
    if (modelSizeGb < 2.5) {
        kvElementsPerToken = 32768;
    } else if (modelSizeGb <= 5.5) {
        kvElementsPerToken = 49152;
    } else if (modelSizeGb <= 10.0) {
        kvElementsPerToken = 65536;
    } else if (modelSizeGb <= 20.0) {
        kvElementsPerToken = 98304;
    } else {
        kvElementsPerToken = 131072;
    }

    let bytesPerElem = 0.55;
    if (kvType === 'f16') bytesPerElem = 2.0;
    else if (kvType === 'q8_0') bytesPerElem = 1.0;
    else if (kvType === 'q4_1') bytesPerElem = 0.65;

    if (!flashAttn && kvType !== 'f16') {
        // Without Flash Attention, llama.cpp forces V cache to FP16
        bytesPerElem = (bytesPerElem + 2.0) / 2.0;
    }

    let rawKvGb = (ctx * kvElementsPerToken * bytesPerElem) / (1024 * 1024 * 1024);
    if (ctx > 8192) {
        rawKvGb *= 1.15; // Context scratch and attention graph buffer scaling
    }

    const isCpuOffload = !isGpu || gpuLayers === 0;

    let kvVram = 0;
    let kvRam = 0;
    if (!offloadKqv || isCpuOffload) {
        kvVram = 0;
        kvRam = rawKvGb;
    } else {
        kvVram = rawKvGb * offloadRatio;
        kvRam = rawKvGb * (1.0 - offloadRatio);
    }

    // 4. Vision Projector
    let projVram = 0;
    let projRam = 0;
    if (mmprojSizeGb > 0) {
        if (mmprojOnCpu || isCpuOffload) {
            projRam = mmprojSizeGb;
        } else {
            projVram = mmprojSizeGb;
        }
    }

    // 4b. Activation & Compute Graph Scratch Memory (scaled by batch size)
    let bytesPerBatchToken = 0.28 * 1024 * 1024;
    if (modelSizeGb < 2.5) {
        bytesPerBatchToken = 0.15 * 1024 * 1024;
    } else if (modelSizeGb <= 6.0) {
        bytesPerBatchToken = 0.28 * 1024 * 1024;
    } else if (modelSizeGb <= 12.0) {
        bytesPerBatchToken = 0.45 * 1024 * 1024;
    } else {
        bytesPerBatchToken = 0.75 * 1024 * 1024;
    }
    const activationGb = (batchSize * bytesPerBatchToken) / (1024 * 1024 * 1024);

    let batchVram = 0;
    let batchRam = 0;
    if (isCpuOffload) {
        batchRam = activationGb;
    } else if (gpuLayers === -1 || gpuLayers >= 32) {
        batchVram = activationGb;
    } else {
        batchVram = activationGb * offloadRatio;
        batchRam = activationGb * (1 - offloadRatio);
    }

    // 5. Backend Overhead
    const cudaOverhead = !isCpuOffload && (weightsVram > 0 || kvVram > 0) ? 0.35 : 0;
    const estVram = !isCpuOffload ? (weightsVram + kvVram + projVram + batchVram + cudaOverhead) : 0;
    const estRam = weightsRam + kvRam + projRam + batchRam + 0.4;

    // 6. Update Gauges
    if (isGpu) {
        dom.estVramVal.textContent = `${estVram.toFixed(1)} GB`;
        dom.totalVramVal.textContent = `${totalVram.toFixed(1)} GB`;

        const vramPct = totalVram > 0 ? Math.min(100, Math.round((estVram / totalVram) * 100)) : 0;
        if (dom.vramBarFill) {
            dom.vramBarFill.style.width = `${vramPct}%`;
            if (vramPct <= 82) {
                dom.vramBarFill.className = 'memory-bar-fill fill-safe';
            } else if (vramPct <= 96) {
                dom.vramBarFill.className = 'memory-bar-fill fill-tight';
            } else {
                dom.vramBarFill.className = 'memory-bar-fill fill-danger';
            }
        }

        if (dom.vramBreakdownText) {
            if (gpuLayers === 0) {
                dom.vramBreakdownText.textContent = '0 layers on GPU (CPU offload)';
            } else if (!offloadKqv) {
                if (weightsRam > 0.05) {
                    dom.vramBreakdownText.textContent = `${gpuLayers}L: ${weightsVram.toFixed(1)} GB • KV in RAM`;
                } else {
                    dom.vramBreakdownText.textContent = `Weights: ${weightsVram.toFixed(1)} GB • KV in RAM`;
                }
            } else {
                if (weightsRam > 0.05) {
                    dom.vramBreakdownText.textContent = `${gpuLayers}L: ${weightsVram.toFixed(1)} GB • KV: ${kvVram.toFixed(1)} GB`;
                } else {
                    dom.vramBreakdownText.textContent = `Weights: ${weightsVram.toFixed(1)} GB • KV: ${kvVram.toFixed(1)} GB`;
                }
            }
        }
    } else {
        dom.estVramVal.textContent = '0.0 GB';
        dom.totalVramVal.textContent = 'N/A (CPU)';
        if (dom.vramBarFill) {
            dom.vramBarFill.style.width = '0%';
            dom.vramBarFill.className = 'memory-bar-fill fill-safe';
        }
        if (dom.vramBreakdownText) {
            dom.vramBreakdownText.textContent = 'No GPU available';
        }
    }

    dom.estRamVal.textContent = `${estRam.toFixed(1)} GB`;
    dom.totalRamVal.textContent = `${totalRam.toFixed(1)} GB`;

    const ramPct = totalRam > 0 ? Math.min(100, Math.round((estRam / totalRam) * 100)) : 0;
    if (dom.ramBarFill) {
        dom.ramBarFill.style.width = `${ramPct}%`;
        dom.ramBarFill.className = 'memory-bar-fill ' + (ramPct > 90 ? 'fill-danger' : ramPct > 75 ? 'fill-tight' : 'fill-safe');
    }

    if (dom.ramBreakdownText) {
        const remaining = Math.max(0, availRam - estRam);
        if (isCpuOffload) {
            dom.ramBreakdownText.textContent = `Weights: ${weightsRam.toFixed(1)} GB • KV: ${kvRam.toFixed(1)} GB`;
        } else if (weightsRam > 0.05) {
            if (!offloadKqv || kvRam > 0.05) {
                dom.ramBreakdownText.textContent = `RAM: ${weightsRam.toFixed(1)} GB • KV: ${kvRam.toFixed(1)} GB`;
            } else {
                dom.ramBreakdownText.textContent = `RAM: ${weightsRam.toFixed(1)} GB • ~${remaining.toFixed(1)} GB free`;
            }
        } else {
            if (!offloadKqv && kvRam > 0.05) {
                dom.ramBreakdownText.textContent = `KV: ${kvRam.toFixed(1)} GB in RAM • ~${remaining.toFixed(1)} GB free`;
            } else {
                dom.ramBreakdownText.textContent = `Model & KV in GPU • ~${remaining.toFixed(1)} GB free`;
            }
        }
    }

    // 7. Safety Pill & Advice Banner
    if (dom.memorySafetyPill && dom.memoryAdviceText) {
        if (isCpuOffload) {
            if (estRam > totalRam) {
                dom.memorySafetyPill.className = 'memory-safety-pill status-danger';
                dom.memorySafetyPill.textContent = 'RAM Danger';
                const excess = (estRam - totalRam).toFixed(1);
                dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: #f87171;"></i> <span>Exceeds system RAM by ~${excess} GB.</span>`;
            } else if (estRam > availRam) {
                dom.memorySafetyPill.className = 'memory-safety-pill status-tight';
                dom.memorySafetyPill.textContent = 'High RAM';
                dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: #fbbf24;"></i> <span>High RAM allocation (~${ramPct}%).</span>`;
            } else {
                dom.memorySafetyPill.className = 'memory-safety-pill status-safe';
                dom.memorySafetyPill.textContent = 'CPU Mode';
                dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-microchip" style="color: #60a5fa;"></i> <span>Pure CPU mode (~${estRam.toFixed(1)} GB System RAM).</span>`;
            }
        } else {
            const vramPct = totalVram > 0 ? Math.round((estVram / totalVram) * 100) : 0;
            const isPartial = weightsRam > 0.05;

            if (estVram > totalVram) {
                dom.memorySafetyPill.className = 'memory-safety-pill status-danger';
                dom.memorySafetyPill.textContent = 'Overflow';
                const excess = (estVram - totalVram).toFixed(1);
                dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: #f87171;"></i> <span>Exceeds GPU memory by ~${excess} GB.</span>`;
            } else if (estRam > totalRam) {
                dom.memorySafetyPill.className = 'memory-safety-pill status-danger';
                dom.memorySafetyPill.textContent = 'RAM Danger';
                const excess = (estRam - totalRam).toFixed(1);
                dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: #f87171;"></i> <span>Exceeds system RAM by ~${excess} GB.</span>`;
            } else if (vramPct > 84 || ramPct > 85) {
                dom.memorySafetyPill.className = 'memory-safety-pill status-tight';
                dom.memorySafetyPill.textContent = 'Tight';
                if (isPartial) {
                    dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: #fbbf24;"></i> <span>High allocation (~${vramPct}% GPU, ~${estRam.toFixed(1)} GB RAM).</span>`;
                } else {
                    dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: #fbbf24;"></i> <span>High GPU allocation (~${vramPct}%).</span>`;
                }
            } else {
                dom.memorySafetyPill.className = 'memory-safety-pill status-safe';
                if (isPartial) {
                    dom.memorySafetyPill.textContent = 'Hybrid';
                    dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #34d399;"></i> <span>Split across GPU (~${vramPct}%) and System RAM.</span>`;
                } else {
                    dom.memorySafetyPill.textContent = 'Optimal';
                    dom.memoryAdviceText.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #34d399;"></i> <span>Fits comfortably in GPU memory (~${vramPct}%).</span>`;
                }
            }
        }
    }
}
window.updateMemoryEstimator = updateMemoryEstimator;


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

export function switchSettingsTab(tabName) {
    if (!tabName) return;
    const cleanTab = tabName.replace(/Tab$/, '');
    const tabBtns = document.querySelectorAll('.settings-tab-btn');
    const tabPanes = document.querySelectorAll('.settings-tab-pane');
    tabBtns.forEach(btn => {
        const btnTab = (btn.dataset.tab || '').replace(/Tab$/, '');
        if (btnTab === cleanTab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    tabPanes.forEach(pane => {
        const paneTab = (pane.id || '').replace(/Tab$/, '');
        if (paneTab === cleanTab) {
            pane.classList.remove('hidden');
        } else {
            pane.classList.add('hidden');
        }
    });
    if (cleanTab === 'inference' && state.inferenceMode !== 'api') {
        updateMemoryEstimator();
    }
}
window.switchSettingsTab = switchSettingsTab;

export function openSettingsForModelLoad(targetTab = 'inference') {
    if (dom.settingsModal) {
        dom.settingsModal.classList.remove('hidden');
        switchSettingsTab(targetTab);
        refreshEngineStatusUI();
        refreshScannedModelsList();
        initImageStudioSettings();
    }
}
window.openSettingsForModelLoad = openSettingsForModelLoad;

export function setupSettingsUI() {
    // Immediate hardware hydration from localStorage on frame 0
    if (!state.hardwareInfo) {
        try {
            const cachedHw = localStorage.getItem('nivm_cached_hardware');
            if (cachedHw) {
                state.hardwareInfo = JSON.parse(cachedHw);
                if (dom.engineHardwareSub && state.hardwareInfo) {
                    if (state.hardwareInfo.gpu_available && state.hardwareInfo.vram_total_gb > 0) {
                        let name = (state.hardwareInfo.gpu_name || 'GPU')
                            .replace(/^NVIDIA\s+(GeForce\s+)?/i, '')
                            .replace(/\s+(Laptop\s+)?GPU/i, '')
                            .trim();
                        if (name.length > 22) name = name.slice(0, 21) + '…';
                        dom.engineHardwareSub.textContent = name;
                    } else {
                        dom.engineHardwareSub.textContent = 'CPU Mode';
                    }
                }
            }
        } catch (_) {}
    }

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
                if (isGpu) {
                    const totalLayers = parseInt(slider.dataset.totalLayers || slider.max, 10);
                    updateGpuSliderLabel(slider, val, slider.value, totalLayers);
                } else {
                    val.textContent = slider.value;
                }
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

    function autoPairMmprojForModel(modelPath) {
        if (!modelPath || !dom.scannedMmprojSelect) return;
        const lower = modelPath.toLowerCase();
        const sizeTokens = ['e2b', '2b', 'e4b', '4b', '7b', '8b', '9b', '14b', '27b', '32b', '70b'];
        const matchedSize = sizeTokens.find(tok => lower.includes(tok));

        let matchingMmprojVal = null;
        for (const opt of dom.scannedMmprojSelect.options) {
            const optVal = opt.value.toLowerCase();
            if (!optVal) continue;
            if (matchedSize && optVal.includes('mmproj') && optVal.includes(matchedSize)) {
                matchingMmprojVal = opt.value;
                break;
            }
        }

        const currentVal = dom.customMmprojInput ? dom.customMmprojInput.value.trim().toLowerCase() : '';
        const currentSize = sizeTokens.find(tok => currentVal.includes(tok));

        if (matchingMmprojVal) {
            dom.scannedMmprojSelect.value = matchingMmprojVal;
            if (dom.customMmprojInput) dom.customMmprojInput.value = matchingMmprojVal;
            state.customMmprojPath = matchingMmprojVal;
            verifyPathStatus(matchingMmprojVal, dom.customMmprojStatus, true);
            if (dom.customMmprojCpu) dom.customMmprojCpu.disabled = false;
            setVisionEnabled(true);
        } else if (matchedSize && currentSize && matchedSize !== currentSize) {
            dom.scannedMmprojSelect.value = '';
            if (dom.customMmprojInput) dom.customMmprojInput.value = '';
            state.customMmprojPath = '';
            verifyPathStatus('', dom.customMmprojStatus, true);
            if (dom.customMmprojCpu) dom.customMmprojCpu.disabled = true;
            setVisionEnabled(false);
        }
    }

    if (dom.scannedGgufSelect) {
        dom.scannedGgufSelect.addEventListener('change', () => {
            const val = dom.scannedGgufSelect.value.trim();
            if (dom.customModelPathInput) dom.customModelPathInput.value = val;
            verifyPathStatus(val, dom.customModelPathStatus);
            autoPairMmprojForModel(val);
            const foundMeta = scannedModelsCache.find(m => m.path === val);
            if (foundMeta) {
                applyModelMetadataToUI(foundMeta);
            } else if (val) {
                fetchModelInspection(val);
            }
            saveApiSettings();
        });
    }

    if (dom.customModelPathInput) {
        dom.customModelPathInput.addEventListener('input', () => {
            const val = dom.customModelPathInput.value.trim();
            syncSelectWithInput(dom.scannedGgufSelect, val);
            verifyPathStatus(val, dom.customModelPathStatus);
            autoPairMmprojForModel(val);
            const foundMeta = scannedModelsCache.find(m => m.path === val || m.filename === val.split('/').pop());
            if (foundMeta) {
                applyModelMetadataToUI(foundMeta);
            } else if (val) {
                fetchModelInspection(val);
            }
            saveApiSettings();
        });
    }

    if (dom.clearCustomPathBtn) {
        dom.clearCustomPathBtn.addEventListener('click', () => {
            if (dom.customModelPathInput) dom.customModelPathInput.value = '';
            if (dom.scannedGgufSelect) dom.scannedGgufSelect.value = '';
            verifyPathStatus('', dom.customModelPathStatus);
            applyModelMetadataToUI({ layers: null, arch: null, is_moe: false });
            if (dom.singleGpuSlider) {
                dom.singleGpuSlider.max = '128';
                delete dom.singleGpuSlider.dataset.totalLayers;
                updateGpuSliderLabel(dom.singleGpuSlider, dom.singleGpuVal, dom.singleGpuSlider.value, 128);
            }
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
                    dom.smartToggleLabel.textContent = 'Unload';
                    showNotification({
                        title: 'Engine Loaded',
                        message: `${result.info?.name || result.role} is now active and ready`,
                        type: 'success',
                        icon: 'fa-bolt'
                    });
                } else {
                    dom.engineStatusText.textContent = 'Ready';
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
                dom.engineStatusText.textContent = 'Load Failed';
                dom.engineStatusText.style.color = '#ef4444';
                showNotification({
                    title: 'Engine Load Failed',
                    message: e.message,
                    type: 'error'
                });
                const errLower = (e.message || '').toLowerCase();
                if (errLower.includes('vram') || errLower.includes('llama_context') || errLower.includes('out of memory')) {
                    showAlert("GPU Memory Allocation Failed", e.message);
                }
            } finally {
                dom.smartToggleBtn.disabled = false;
            }
        });
    }

    /* settings tab switching */
    const tabBtns = document.querySelectorAll('.settings-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchSettingsTab(btn.dataset.tab);
        });
    });

    /* reactive memory estimator inputs */
    const estimatorTriggers = [
        dom.singleCtxSlider, dom.singleBatchSlider, dom.singleKvSelect, dom.singleGpuSlider,
        dom.singleOffloadKqv, dom.singleFlashAttn, dom.singleModelRoleSelect, dom.scannedGgufSelect,
        dom.customModelPathInput, dom.customMmprojInput, dom.customMmprojCpu,
        dom.inferenceModeSelect, dom.coderGpuSlider, dom.coderCtxSlider, dom.coderBatchSlider,
        dom.coderKvSelect, dom.coderOffloadKqv, dom.coderFlashAttn
    ];
    estimatorTriggers.forEach(elem => {
        if (!elem) return;
        elem.addEventListener('input', updateMemoryEstimator);
        elem.addEventListener('change', updateMemoryEstimator);
    });

    ['unloadAllModelsBtn', 'statsUnloadAllBtn', 'drawerUnloadBtn'].forEach(k => dom[k]?.addEventListener('click', () => handleUnloadAllModels(dom[k])));

    if (dom.chatBoxLoadModelBtn) {
        dom.chatBoxLoadModelBtn.addEventListener('click', () => openSettingsForModelLoad('inference'));
    }
    if (dom.sideNotifLoadBtn) {
        dom.sideNotifLoadBtn.addEventListener('click', () => {
            state.sideNotifDismissed = true;
            if (dom.sideModelNotif) dom.sideModelNotif.classList.add('hidden');
            openSettingsForModelLoad('inference');
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
