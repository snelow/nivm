/* tools configuration & stats modal */

import { state, saveEnabledTools, saveTerminalSecurityMode } from '../state.js';
import { dom } from '../dom.js';
import { tools } from '../tools.js';
import { fetchModelDetailsAPI } from '../api.js';
import { showNotification, showAlert, escapeHtml } from './dialogs.js';

export async function populateStatsModal() {
    const isApi = state.inferenceMode === 'api';
    const isRouting = state.inferenceMode === 'routing';

    const modeBadge = dom.statsModeBadge || document.getElementById('statsModeBadge');
    const modeBadgeText = dom.statsModeBadgeText || document.getElementById('statsModeBadgeText');
    const statsProviderTag = dom.statsProviderTag || document.getElementById('statsProviderTag');
    const statsModelIcon = dom.statsModelIcon || document.getElementById('statsModelIcon');
    const avgSpeedEl = dom.statsAvgSpeed || document.getElementById('statsAvgSpeed');

    if (isApi) {
        const apiModel = dom.apiModelInput?.value?.trim() 
            || dom.apiModelSelect?.value 
            || state.selectedModel 
            || 'gemini-3.8-flash';

        const baseUrl = dom.apiBaseUrl?.value?.trim() || '';
        const lowerBase = baseUrl.toLowerCase();
        const lowerModel = apiModel.toLowerCase();

        let providerName = 'Cloud API';
        let isLocalApi = false;

        if (lowerBase.includes('generativelanguage.googleapis.com') || lowerModel.startsWith('gemini')) {
            providerName = 'Google Gemini';
        } else if (lowerBase.includes('api.groq.com') || lowerModel.includes('groq')) {
            providerName = 'Groq Cloud';
        } else if (lowerBase.includes('api.openai.com')) {
            providerName = 'OpenAI';
        } else if (lowerBase.includes('openrouter.ai')) {
            providerName = 'OpenRouter';
        } else if (lowerBase.includes('11434') || lowerBase.includes('ollama')) {
            providerName = 'Ollama API';
            isLocalApi = true;
        } else if (lowerBase.includes('together')) {
            providerName = 'Together AI';
        } else if (lowerBase.includes('mistral')) {
            providerName = 'Mistral AI';
        } else if (lowerBase.includes('anthropic')) {
            providerName = 'Anthropic';
        } else if (baseUrl) {
            try {
                const u = new URL(baseUrl);
                providerName = u.hostname || 'OpenAI-Compatible';
            } catch (_) {
                providerName = 'Custom API';
            }
        }

        if (modeBadge) modeBadge.className = `stats-mode-badge ${isLocalApi ? 'mode-local-api' : 'mode-api'}`;
        if (modeBadgeText) modeBadgeText.textContent = isLocalApi ? 'Local API' : 'API Cloud';

        if (statsModelIcon) {
            statsModelIcon.className = isLocalApi ? 'fa-solid fa-network-wired' : (providerName.includes('Groq') ? 'fa-solid fa-bolt' : 'fa-solid fa-cloud');
        }

        const cleanModelName = apiModel.replace(/^models\//i, '');
        if (dom.statsModelName) {
            dom.statsModelName.textContent = cleanModelName;
            dom.statsModelName.title = apiModel;
        }

        const visionSupported = window.isVisionSupported ? window.isVisionSupported() : Boolean(state.apiMultimodal);
        if (statsProviderTag) {
            statsProviderTag.textContent = `${providerName} • ${visionSupported ? 'Multimodal Vision' : 'Text Generation'}`;
        }

        if (dom.statsArchitecture) {
            dom.statsArchitecture.textContent = `${providerName} (Stream)`;
        }

        if (dom.statsModelType) {
            dom.statsModelType.textContent = isLocalApi ? 'LOCAL_API (Ollama)' : 'EXTERNAL_API';
        }

        if (dom.statsQuantization) {
            dom.statsQuantization.textContent = isLocalApi ? 'Local Daemon (Q4/Q8)' : 'Server Managed (FP16/BF16)';
        }

        if (dom.statsContextLimit) {
            let ctx = '128,000 tokens (128k)';
            if (lowerModel.includes('gemini-1.5') || lowerModel.includes('gemini-2') || lowerModel.includes('gemini-3') || lowerModel.includes('gemini-flash') || lowerModel.includes('gemini-pro')) {
                ctx = '1,048,576 tokens (1M)';
            } else if (lowerModel.includes('claude')) {
                ctx = '200,000 tokens (200k)';
            } else if (lowerModel.includes('llama-3.3') || lowerModel.includes('llama-3.1') || lowerModel.includes('gpt-4o') || lowerModel.includes('o1') || lowerModel.includes('o3')) {
                ctx = '128,000 tokens (128k)';
            } else if (lowerModel.includes('deepseek')) {
                ctx = '64,000 tokens (64k)';
            }
            dom.statsContextLimit.textContent = ctx;
        }
    } else if (isRouting) {
        if (modeBadge) modeBadge.className = 'stats-mode-badge mode-routing';
        if (modeBadgeText) modeBadgeText.textContent = 'Smart Router';
        if (statsModelIcon) statsModelIcon.className = 'fa-solid fa-shuffle';

        if (dom.statsModelName) dom.statsModelName.textContent = 'Multi-Model Intent Router';
        if (statsProviderTag) statsProviderTag.textContent = 'Auto Hot-Swap: Coder, Creative, General & Vision';
        if (dom.statsArchitecture) dom.statsArchitecture.textContent = 'Dynamic GGUF (Flash Attn)';
        if (dom.statsModelType) dom.statsModelType.textContent = 'LOCAL_ROUTING';
        if (dom.statsQuantization) dom.statsQuantization.textContent = 'Auto Multi-Slot (q4_k_m / q8_0)';
        if (dom.statsContextLimit) dom.statsContextLimit.textContent = '8,192 tokens (Per Slot)';
    } else {
        if (modeBadge) modeBadge.className = 'stats-mode-badge mode-local';
        if (modeBadgeText) modeBadgeText.textContent = 'Local Engine';
        if (statsModelIcon) statsModelIcon.className = 'fa-solid fa-microchip';

        const activeRole = dom.singleModelRoleSelect?.value || 'coder';
        if (activeRole === 'custom') {
            const fileName = state.customModelPath ? state.customModelPath.split(/[/\\]/).pop() : 'Custom GGUF Model';
            if (dom.statsModelName) dom.statsModelName.textContent = fileName;
            if (statsProviderTag) statsProviderTag.textContent = 'Local Native • Custom GGUF File';
            if (dom.statsArchitecture) dom.statsArchitecture.textContent = dom.singleFlashAttn?.checked ? 'GGUF (Flash Attn)' : 'GGUF';
            if (dom.statsModelType) dom.statsModelType.textContent = 'LOCAL_NATIVE';
            if (dom.statsQuantization) dom.statsQuantization.textContent = dom.singleKvSelect ? `${dom.singleKvSelect.value.toUpperCase()} (KV Cache)` : 'Custom Quant';
            if (dom.statsContextLimit) dom.statsContextLimit.textContent = `${dom.singleCtxSlider ? dom.singleCtxSlider.value : '8192'} tokens`;
        } else {
            if (dom.statsModelName) dom.statsModelName.textContent = `Local Engine (${activeRole.toUpperCase()})`;
            if (statsProviderTag) statsProviderTag.textContent = `Local Native • Dedicated ${activeRole} slot`;
            if (dom.statsArchitecture) dom.statsArchitecture.textContent = dom[activeRole + 'FlashAttn']?.checked ? 'GGUF (Flash Attn)' : 'GGUF';
            if (dom.statsModelType) dom.statsModelType.textContent = 'LOCAL_NATIVE';
            if (dom.statsQuantization) dom.statsQuantization.textContent = dom[activeRole + 'KvSelect'] ? `${dom[activeRole + 'KvSelect'].value.toUpperCase()} (KV Cache)` : 'Q4_K_M / Q8_0';
            if (dom.statsContextLimit) dom.statsContextLimit.textContent = `${dom[activeRole + 'CtxSlider'] ? dom[activeRole + 'CtxSlider'].value : '8192'} tokens`;
        }
    }

    // Populate Global Usage Statistics
    const totalTokens = state.usageStats?.totalTokens || 0;
    const totalSecs = state.usageStats?.totalDurationSec || 0;
    const totalCost = state.usageStats?.totalCost || 0;

    if (dom.statsTotalTokens) {
        dom.statsTotalTokens.textContent = totalTokens.toLocaleString();
    }

    let timeStr = `${totalSecs.toFixed(1)}s`;
    if (totalSecs >= 3600) {
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = Math.round(totalSecs % 60);
        timeStr = `${h}h ${m}m ${s}s`;
    } else if (totalSecs >= 60) {
        const m = Math.floor(totalSecs / 60);
        const s = Math.round(totalSecs % 60);
        timeStr = `${m}m ${s}s`;
    }
    if (dom.statsTotalTime) {
        dom.statsTotalTime.textContent = timeStr;
    }

    if (dom.statsTotalCost) {
        if (state.inferenceMode === 'api' || totalCost > 0) {
            dom.statsTotalCost.textContent = `$${totalCost.toFixed(5)}`;
        } else {
            dom.statsTotalCost.textContent = '$0.0000 (Free)';
        }
    }

    if (avgSpeedEl) {
        if (totalSecs > 0 && totalTokens > 0) {
            const speed = (totalTokens / totalSecs).toFixed(1);
            avgSpeedEl.textContent = `${speed} tk/s`;
        } else {
            avgSpeedEl.textContent = '— tk/s';
        }
    }
}


export async function renderToolsSettings() {
    dom.toolsConfigContainer.innerHTML = '';
    
    if (tools.length === 0) {
        dom.toolsConfigContainer.innerHTML = '<div style="color: var(--text-tertiary); font-size: 0.9em; font-style: italic;">No tools registered.</div>';
        return;
    }

    // Check image models & engine prerequisites
    let imageModelsReady = false;
    let animeModelsReady = false;
    let comfyReady = false;
    try {
        const [modelsRes, comfyRes] = await Promise.all([
            fetch('/api/image/models/status').then(r => r.json()).catch(() => null),
            fetch('/api/image/comfy/status').then(r => r.json()).catch(() => null),
        ]);
        imageModelsReady = modelsRes?.all_installed === true;
        animeModelsReady = modelsRes?.anime?.installed === true;
        comfyReady = comfyRes?.comfyui?.detected === true;
    } catch (e) {
        console.warn('Could not check image studio status:', e);
    }
    
    tools.forEach(tool => {
        const isEnabled = state.enabledTools[tool.name] !== false;
        const isStandardImageTool = (tool.name === 'generate_image' || tool.name === 'edit_image');
        const isAnimeTool = (tool.name === 'generate_anime_image');
        const isImageTool = isStandardImageTool || isAnimeTool;
        
        let isBlocked = false;
        if (isStandardImageTool) {
            isBlocked = !imageModelsReady || !comfyReady;
        } else if (isAnimeTool) {
            isBlocked = !animeModelsReady || !comfyReady;
        }
        
        const cardContainer = document.createElement('div');
        cardContainer.className = 'tool-setting-card';
        cardContainer.style.marginBottom = '12px';
        cardContainer.style.background = 'rgba(255, 255, 255, 0.03)';
        cardContainer.style.border = '1px solid var(--glass-border)';
        cardContainer.style.borderRadius = '8px';
        cardContainer.style.overflow = 'hidden';

        const wrap = document.createElement('div');
        wrap.className = 'tool-setting-row';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'space-between';
        wrap.style.padding = '10px 12px';
        
        const infoWrap = document.createElement('div');
        infoWrap.style.flex = '1';
        infoWrap.style.paddingRight = '12px';
        
        const title = document.createElement('div');
        title.style.fontWeight = '500';
        title.style.color = 'var(--text-primary)';
        title.style.display = 'flex';
        title.style.alignItems = 'center';
        title.style.gap = '6px';

        const iconClass = isImageTool ? 'fa-solid fa-paintbrush' : 'fa-solid fa-screwdriver-wrench';
        const iconColor = 'var(--accent-purple)';
        title.innerHTML = `<i class="${iconClass}" style="font-size: 0.8em; color: ${iconColor};"></i><span>${escapeHtml(tool.name)}</span>`;

        if (isBlocked) {
            const blockedBadge = document.createElement('span');
            blockedBadge.style.cssText = 'background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.68rem; padding: 1px 6px; border-radius: 4px; font-weight: 500;';
            blockedBadge.textContent = 'Setup Required';
            title.appendChild(blockedBadge);
        }
        
        const desc = document.createElement('div');
        desc.style.fontSize = '0.82em';
        desc.style.color = 'var(--text-tertiary)';
        desc.style.marginTop = '4px';
        desc.style.lineHeight = '1.35';
        desc.textContent = tool.description;
        
        infoWrap.appendChild(title);
        infoWrap.appendChild(desc);
        
        const toggleBtn = document.createElement('button');
        if (isBlocked) {
            toggleBtn.className = 'btn-secondary';
            toggleBtn.style.padding = '6px 12px';
            toggleBtn.style.fontSize = '0.82em';
            toggleBtn.style.opacity = '0.5';
            toggleBtn.style.cursor = 'not-allowed';
            toggleBtn.textContent = 'Disabled';
            toggleBtn.title = 'Image models and ComfyUI backend required. Download in Model Settings.';
            toggleBtn.disabled = true;
        } else {
            toggleBtn.className = isEnabled ? 'btn-primary' : 'btn-secondary';
            toggleBtn.style.padding = '6px 12px';
            toggleBtn.style.fontSize = '0.85em';
            toggleBtn.textContent = isEnabled ? 'Enabled' : 'Disabled';
        }
        
        wrap.appendChild(infoWrap);
        wrap.appendChild(toggleBtn);
        cardContainer.appendChild(wrap);

        // If image tool is missing prerequisites, display direct redirect action
        if (isBlocked) {
            const redirectRow = document.createElement('div');
            redirectRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(245, 158, 11, 0.06); border-top: 1px solid rgba(245, 158, 11, 0.15); font-size: 0.76rem;';
            
            const reasonText = !imageModelsReady && !comfyReady ? 'Requires ComfyUI engine & 18 GB image models' : (!imageModelsReady ? 'Requires Qwen-Rapid diffusion models (18 GB)' : 'Requires ComfyUI backend engine');
            redirectRow.innerHTML = `
                <span style="color: #fbbf24; display: flex; align-items: center; gap: 5px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>${reasonText}</span>
                </span>
                <button type="button" class="btn-secondary redirect-to-model-settings" style="padding: 3px 8px; font-size: 0.72rem; color: var(--accent-purple); border-color: rgba(var(--accent-purple-rgb, 168, 85, 247), 0.4); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
                    <span>Download in Model Settings</span> <i class="fa-solid fa-arrow-right"></i>
                </button>
            `;

            const redirectBtn = redirectRow.querySelector('.redirect-to-model-settings');
            redirectBtn.onclick = () => {
                if (dom.toolsModal) dom.toolsModal.classList.add('hidden');
                if (dom.settingsModal) dom.settingsModal.classList.remove('hidden');
                initImageStudioSettings();
                const studioSection = document.getElementById('imageStudioSection');
                if (studioSection) {
                    studioSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    studioSection.style.transition = 'box-shadow 0.4s ease';
                    studioSection.style.boxShadow = '0 0 20px rgba(var(--accent-purple-rgb, 168, 85, 247), 0.6)';
                    setTimeout(() => { studioSection.style.boxShadow = ''; }, 2500);
                }
            };

            cardContainer.appendChild(redirectRow);
        }

        if (tool.name === 'execute_terminal') {
            const secWrap = document.createElement('div');
            secWrap.className = 'terminal-sec-setting';
            secWrap.style.padding = '10px 12px';
            secWrap.style.borderTop = '1px solid rgba(255, 255, 255, 0.06)';
            secWrap.style.background = 'rgba(0, 0, 0, 0.2)';
            secWrap.style.display = isEnabled ? 'block' : 'none';

            const currentMode = state.terminalSecurityMode || 'dangerous';

            secWrap.innerHTML = `
                <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-shield-halved" style="color: var(--accent-purple); font-size: 0.9em;"></i>
                    <span>Execution Permission Level</span>
                </div>
                <div style="font-size: 0.78rem; color: var(--text-tertiary); margin-bottom: 8px; line-height: 1.35;">
                    Specify when nivm must ask for your explicit confirmation before executing terminal commands.
                </div>
                <select class="form-select terminal-sec-mode-select" style="width: 100%; padding: 6px 10px; font-size: 0.82rem; background: rgba(18, 18, 21, 0.9); border: 1px solid var(--glass-border); border-radius: 6px; color: var(--text-primary);">
                    <option value="dangerous" ${currentMode === 'dangerous' ? 'selected' : ''}>⚠️ Ask on dangerous commands only (Recommended)</option>
                    <option value="always" ${currentMode === 'always' ? 'selected' : ''}>🔒 Always ask for confirmation</option>
                    <option value="never" ${currentMode === 'never' ? 'selected' : ''}>⚡ Never ask (Full Autonomous)</option>
                </select>
            `;

            const selectEl = secWrap.querySelector('.terminal-sec-mode-select');
            selectEl.onchange = (e) => {
                const newMode = e.target.value;
                saveTerminalSecurityMode(newMode);
                showNotification(`Terminal security: ${newMode === 'dangerous' ? 'Dangerous only' : (newMode === 'always' ? 'Always ask' : 'Never ask')}`, 'info');
            };

            toggleBtn.onclick = () => {
                const newState = !(state.enabledTools[tool.name] !== false);
                state.enabledTools[tool.name] = newState;
                saveEnabledTools();
                
                toggleBtn.className = newState ? 'btn-primary' : 'btn-secondary';
                toggleBtn.textContent = newState ? 'Enabled' : 'Disabled';
                secWrap.style.display = newState ? 'block' : 'none';
            };

            cardContainer.appendChild(secWrap);
        } else if (!isBlocked) {
            toggleBtn.onclick = () => {
                const newState = !(state.enabledTools[tool.name] !== false);
                state.enabledTools[tool.name] = newState;
                saveEnabledTools();
                
                toggleBtn.className = newState ? 'btn-primary' : 'btn-secondary';
                toggleBtn.textContent = newState ? 'Enabled' : 'Disabled';
            };
        }

        dom.toolsConfigContainer.appendChild(cardContainer);
    });
}

// ── Image Studio Settings Wiring & Progress Polling ──
let _imageStudioPollInterval = null;
let _imageStudioEventsBound = false;

export async function initImageStudioSettings() {
    const masterBadge = document.getElementById('imageStudioMasterBadge');
    const comfyBadge = document.getElementById('comfyStatusBadge');
    const comfyPathDisplay = document.getElementById('comfyPathDisplay');
    const customComfyInput = document.getElementById('customComfyPathInput');
    const setComfyBtn = document.getElementById('setComfyPathBtn');
    const autoSetupBtn = document.getElementById('autoSetupComfyBtn');
    const comfyProgressBox = document.getElementById('comfySetupProgressBox');
    const comfyStepText = document.getElementById('comfySetupStepText');
    const comfyTargetDir = document.getElementById('comfySetupTargetDir');
    const comfyPct = document.getElementById('comfySetupPct');
    const comfyProgressBar = document.getElementById('comfySetupProgressBar');
    const comfyLogText = document.getElementById('comfySetupLogText');

    const modelsBadge = document.getElementById('imageModelsBadge');
    const verifiedBox = document.getElementById('imageModelsVerifiedBox');
    const unetCheck = document.getElementById('unetModelCheck');
    const clipCheck = document.getElementById('clipModelCheck');
    const vaeCheck = document.getElementById('vaeModelCheck');
    const downloadBtn = document.getElementById('downloadImageModelsBtn');
    const downloadProgressBox = document.getElementById('imageDownloadProgressBox');
    const dlModelName = document.getElementById('imageDownloadModelName');
    const dlTargetPath = document.getElementById('imageDownloadTargetPath');
    const dlPct = document.getElementById('imageDownloadPct');
    const dlProgressBar = document.getElementById('imageDownloadProgressBar');
    const dlBytes = document.getElementById('imageDownloadBytes');
    const dlSpeed = document.getElementById('imageDownloadSpeed');
    const dlEta = document.getElementById('imageDownloadEta');

    // Anime Engine Elements
    const animeModelsBadge = document.getElementById('animeModelsBadge');
    const animeCkptCheck = document.getElementById('animeCkptCheck');
    const animeCkptNameLabel = document.getElementById('animeCkptNameLabel');
    const animeCkptSizeLabel = document.getElementById('animeCkptSizeLabel');
    const animeLcmCheck = document.getElementById('animeLcmCheck');
    const animeLcmSizeLabel = document.getElementById('animeLcmSizeLabel');
    const animeVerifiedBox = document.getElementById('animeModelsVerifiedBox');
    const downloadAnimeBtn = document.getElementById('downloadAnimeModelsBtn');
    const animeDownloadProgressBox = document.getElementById('animeDownloadProgressBox');
    const animeDlModelName = document.getElementById('animeDownloadModelName');
    const animeDlTargetPath = document.getElementById('animeDownloadTargetPath');
    const animeDlPct = document.getElementById('animeDownloadPct');
    const animeDlProgressBar = document.getElementById('animeDownloadProgressBar');
    const animeDlBytes = document.getElementById('animeDownloadBytes');
    const animeDlSpeed = document.getElementById('animeDownloadSpeed');
    const animeDlEta = document.getElementById('animeDownloadEta');

    async function pollStatus() {
        try {
            const [modelsRes, comfyRes, dlRes] = await Promise.all([
                fetch('/api/image/models/status').then(r => r.json()).catch(() => null),
                fetch('/api/image/comfy/status').then(r => r.json()).catch(() => null),
                fetch('/api/image/models/download/status').then(r => r.json()).catch(() => null),
            ]);

            const comfyDetected = comfyRes?.comfyui?.detected === true;
            const modelsInstalled = modelsRes?.all_installed === true;

            // Update Master Badge
            if (masterBadge) {
                if (comfyDetected && modelsInstalled) {
                    masterBadge.textContent = 'Active & Ready';
                    masterBadge.style.color = '#34d399';
                    masterBadge.style.background = 'rgba(52, 211, 153, 0.15)';
                    masterBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';
                } else {
                    masterBadge.textContent = 'Action Required';
                    masterBadge.style.color = '#f59e0b';
                    masterBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                    masterBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                }
            }

            // Update ComfyUI Backend Engine Display
            if (comfyBadge && comfyPathDisplay) {
                if (comfyDetected) {
                    comfyBadge.textContent = 'Detected & Ready';
                    comfyBadge.style.color = '#34d399';
                    comfyBadge.style.background = 'rgba(52, 211, 153, 0.15)';
                    comfyBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';
                    comfyPathDisplay.innerHTML = `<i class="fa-solid fa-folder-check" style="color: #34d399; margin-right: 5px;"></i>${escapeHtml(comfyRes.comfyui.path)}<br><span style="color: var(--text-muted); font-size: 0.7rem;">Python: ${escapeHtml(comfyRes.comfyui.python_bin)} | GGUF Nodes: ${comfyRes.comfyui.has_gguf_nodes ? '<span style="color:#34d399;">Installed</span>' : '<span style="color:#f59e0b;">Missing</span>'}</span>`;
                    if (autoSetupBtn) {
                        autoSetupBtn.innerHTML = '<i class="fa-solid fa-check"></i> ComfyUI Engine Ready';
                        autoSetupBtn.className = 'btn-secondary';
                    }
                } else {
                    comfyBadge.textContent = 'Not Found';
                    comfyBadge.style.color = '#f59e0b';
                    comfyBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                    comfyBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                    comfyPathDisplay.innerHTML = `<span style="color: #f59e0b;"><i class="fa-solid fa-triangle-exclamation" style="margin-right: 5px;"></i>ComfyUI is required to run local diffusion. Click Auto-Install below or specify an existing folder.</span>`;
                    if (autoSetupBtn && comfyRes?.status !== 'installing') {
                        autoSetupBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Auto-Install ComfyUI to nivm/engine/';
                        autoSetupBtn.disabled = false;
                        autoSetupBtn.className = 'btn-primary';
                    }
                }
            }

            // ComfyUI Auto-Setup Progress Tracking
            let isComfyInstalling = comfyRes?.status === 'installing';
            if (comfyProgressBox) {
                if (isComfyInstalling) {
                    comfyProgressBox.style.display = 'block';
                    if (autoSetupBtn) {
                        autoSetupBtn.disabled = true;
                        autoSetupBtn.textContent = 'Installing ComfyUI Engine...';
                    }
                    if (comfyStepText) comfyStepText.textContent = comfyRes.progress_message || `[Step ${comfyRes.step}/3] ${comfyRes.step_name}`;
                    if (comfyTargetDir) comfyTargetDir.textContent = 'Target: ' + (comfyRes.target_dir || 'nivm/engine/ComfyUI');
                    if (comfyPct) comfyPct.textContent = (comfyRes.percent || 0) + '%';
                    if (comfyProgressBar) comfyProgressBar.style.width = (comfyRes.percent || 0) + '%';
                    if (comfyLogText && comfyRes.log_lines && comfyRes.log_lines.length > 0) {
                        comfyLogText.textContent = comfyRes.log_lines.join('\n');
                        comfyLogText.scrollTop = comfyLogText.scrollHeight;
                    }
                } else if (comfyRes?.status === 'completed') {
                    comfyProgressBox.style.display = 'none';
                    if (autoSetupBtn) {
                        autoSetupBtn.disabled = false;
                        autoSetupBtn.innerHTML = '<i class="fa-solid fa-check"></i> ComfyUI Engine Ready';
                    }
                } else if (comfyRes?.status === 'error') {
                    comfyProgressBox.style.display = 'block';
                    if (autoSetupBtn) {
                        autoSetupBtn.disabled = false;
                        autoSetupBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry Auto-Install';
                    }
                    if (comfyStepText) {
                        comfyStepText.textContent = '❌ ' + (comfyRes.error || 'Setup failed');
                        comfyStepText.style.color = '#f43f5e';
                    }
                } else {
                    comfyProgressBox.style.display = 'none';
                }
            }

            // Update Models Checklist (Shows checkmark if file is already there, indicates missing otherwise)
            if (unetCheck && modelsRes?.unet) {
                unetCheck.innerHTML = modelsRes.unet.installed
                    ? `<span style="color: #34d399; font-weight: 500;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i>UNet (Qwen-Rapid-NSFW-v23_Q4_K.gguf)</span>`
                    : `<span style="color: #f59e0b;"><i class="fa-regular fa-circle" style="margin-right: 5px;"></i>UNet (Qwen-Rapid-NSFW-v23_Q4_K.gguf)</span>`;
            }
            if (clipCheck && modelsRes?.text_encoder) {
                clipCheck.innerHTML = modelsRes.text_encoder.installed
                    ? `<span style="color: #34d399; font-weight: 500;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i>Text Encoder (Qwen2.5-VL CLIP)</span>`
                    : `<span style="color: #f59e0b;"><i class="fa-regular fa-circle" style="margin-right: 5px;"></i>Text Encoder (Qwen2.5-VL CLIP)</span>`;
            }
            if (vaeCheck && modelsRes?.vae) {
                vaeCheck.innerHTML = modelsRes.vae.installed
                    ? `<span style="color: #34d399; font-weight: 500;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i>VAE (qwen_image_vae.safetensors)</span>`
                    : `<span style="color: #f59e0b;"><i class="fa-regular fa-circle" style="margin-right: 5px;"></i>VAE (qwen_image_vae.safetensors)</span>`;
            }

            // Update Models Badge & Download Button:
            // IF VERIFIED: Remove the download button completely!
            // IF PARTIAL: Skip existing files, only offer download for missing files!
            if (modelsBadge) {
                if (modelsInstalled) {
                    modelsBadge.textContent = 'Verified (18 GB)';
                    modelsBadge.style.color = '#34d399';
                    modelsBadge.style.background = 'rgba(52, 211, 153, 0.15)';
                    modelsBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';

                    // Remove download button when verified
                    if (downloadBtn) downloadBtn.style.display = 'none';
                    if (verifiedBox) verifiedBox.style.display = 'flex';
                } else {
                    modelsBadge.textContent = 'Missing Models';
                    modelsBadge.style.color = '#f59e0b';
                    modelsBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                    modelsBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';

                    if (verifiedBox) verifiedBox.style.display = 'none';

                    if (downloadBtn) {
                        const missingList = [];
                        if (!modelsRes?.unet?.installed) missingList.push({ name: 'UNet', size: '13.3 GB' });
                        if (!modelsRes?.text_encoder?.installed) missingList.push({ name: 'Text Encoder', size: '4.7 GB' });
                        if (!modelsRes?.vae?.installed) missingList.push({ name: 'VAE', size: '253 MB' });

                        if (dlRes?.status !== 'downloading') {
                            downloadBtn.style.display = 'flex';
                            downloadBtn.disabled = false;
                            downloadBtn.className = 'btn-primary';

                            if (missingList.length === 1) {
                                downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> Download Missing ${missingList[0].name} (${missingList[0].size})`;
                            } else if (missingList.length === 2) {
                                downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> Download ${missingList.length} Missing Models (skipping verified)`;
                            } else {
                                downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> Download Image Models (aria2)`;
                            }
                        }
                    }
                }
            }

            // Update Anime Engine Card Display:
            const animeInfo = modelsRes?.anime;
            const animeInstalled = animeInfo?.installed === true;

            if (animeCkptCheck && animeInfo?.checkpoint) {
                if (animeCkptNameLabel) animeCkptNameLabel.textContent = animeInfo.checkpoint.name;
                if (animeCkptSizeLabel) animeCkptSizeLabel.textContent = animeInfo.checkpoint.size_str || '6.5 GB';
                animeCkptCheck.innerHTML = animeInfo.checkpoint.installed
                    ? `<span style="color: #34d399; font-weight: 500;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i>Checkpoint (${escapeHtml(animeInfo.checkpoint.name)})</span>`
                    : `<span style="color: #f59e0b;"><i class="fa-regular fa-circle" style="margin-right: 5px;"></i>Checkpoint (${escapeHtml(animeInfo.checkpoint.name)})</span>`;
            }
            if (animeLcmCheck && animeInfo?.lcm_lora) {
                if (animeLcmSizeLabel) animeLcmSizeLabel.textContent = animeInfo.lcm_lora.size_str || '376 MB';
                animeLcmCheck.innerHTML = animeInfo.lcm_lora.installed
                    ? `<span style="color: #34d399; font-weight: 500;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i>Fast Turbo LCM (${escapeHtml(animeInfo.lcm_lora.name)})</span>`
                    : `<span style="color: #f59e0b;"><i class="fa-regular fa-circle" style="margin-right: 5px;"></i>Fast Turbo LCM (${escapeHtml(animeInfo.lcm_lora.name)})</span>`;
            }

            if (animeModelsBadge) {
                if (animeInstalled) {
                    const ckptName = animeInfo?.checkpoint?.name || '';
                    const verLabel = ckptName.includes('v150') ? 'v1.50' : (ckptName.includes('v170') ? 'v1.70' : 'Verified');
                    animeModelsBadge.textContent = `Verified (${verLabel})`;
                    animeModelsBadge.style.color = '#34d399';
                    animeModelsBadge.style.background = 'rgba(52, 211, 153, 0.15)';
                    animeModelsBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';

                    if (animeVerifiedBox) animeVerifiedBox.style.display = 'flex';

                    // Checkpoint is already installed, hide download/upgrade button
                    if (downloadAnimeBtn && dlRes?.status !== 'downloading') {
                        downloadAnimeBtn.style.display = 'none';
                    }
                } else {
                    animeModelsBadge.textContent = 'Optional / Missing';
                    animeModelsBadge.style.color = '#f59e0b';
                    animeModelsBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                    animeModelsBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';

                    if (animeVerifiedBox) animeVerifiedBox.style.display = 'none';

                    if (downloadAnimeBtn && dlRes?.status !== 'downloading') {
                        downloadAnimeBtn.style.display = 'flex';
                        downloadAnimeBtn.disabled = false;
                        downloadAnimeBtn.className = 'btn-primary';
                        downloadAnimeBtn.style.marginTop = '0px';
                        downloadAnimeBtn.innerHTML = `<i class="fa-solid fa-download"></i> Download Anime Checkpoint (v150, 6.5 GB)`;
                    }
                }
            }

            // Model Download Progress Tracking (Standard vs Anime)
            let isDownloading = dlRes?.status === 'downloading';
            const isAnimeDownload = dlRes?.category === 'anime';

            if (downloadProgressBox) {
                if (isDownloading && !isAnimeDownload) {
                    downloadProgressBox.style.display = 'block';
                    if (downloadBtn) {
                        downloadBtn.style.display = 'flex';
                        downloadBtn.disabled = true;
                        downloadBtn.textContent = 'Downloading Models in Background...';
                    }
                    if (dlModelName) dlModelName.textContent = `[${dlRes.current_index}/${dlRes.total_models}] ${dlRes.current_model}`;
                    if (dlTargetPath) dlTargetPath.textContent = 'Saving to: ' + (dlRes.target_path || dlRes.target_dir || 'nivm/models/image/');
                    if (dlPct) dlPct.textContent = (dlRes.percent || 0) + '%';
                    if (dlProgressBar) dlProgressBar.style.width = (dlRes.percent || 0) + '%';
                    if (dlBytes) dlBytes.textContent = `${dlRes.downloaded_str || '0 MB'} / ${dlRes.total_str || '0 MB'}`;
                    if (dlSpeed) dlSpeed.textContent = dlRes.speed_str || '0 MB/s';
                    if (dlEta) dlEta.textContent = 'ETA: ' + (dlRes.eta_str || '--');
                } else {
                    downloadProgressBox.style.display = 'none';
                }
            }

            if (animeDownloadProgressBox) {
                if (isDownloading && isAnimeDownload) {
                    animeDownloadProgressBox.style.display = 'block';
                    if (downloadAnimeBtn) {
                        downloadAnimeBtn.style.display = 'flex';
                        downloadAnimeBtn.disabled = true;
                        downloadAnimeBtn.textContent = 'Downloading Anime Checkpoint...';
                    }
                    if (animeDlModelName) animeDlModelName.textContent = `[${dlRes.current_index}/${dlRes.total_models}] ${dlRes.current_model}`;
                    if (animeDlTargetPath) animeDlTargetPath.textContent = 'Saving to: ' + (dlRes.target_path || dlRes.target_dir || 'nivm/models/image/checkpoints/');
                    if (animeDlPct) animeDlPct.textContent = (dlRes.percent || 0) + '%';
                    if (animeDlProgressBar) animeDlProgressBar.style.width = (dlRes.percent || 0) + '%';
                    if (animeDlBytes) animeDlBytes.textContent = `${dlRes.downloaded_str || '0 MB'} / ${dlRes.total_str || '0 MB'}`;
                    if (animeDlSpeed) animeDlSpeed.textContent = dlRes.speed_str || '0 MB/s';
                    if (animeDlEta) animeDlEta.textContent = 'ETA: ' + (dlRes.eta_str || '--');
                } else {
                    animeDownloadProgressBox.style.display = 'none';
                }
            }

            // Clear polling if neither operation is active
            if (!isComfyInstalling && !isDownloading && _imageStudioPollInterval) {
                clearInterval(_imageStudioPollInterval);
                _imageStudioPollInterval = null;
            }
        } catch (e) {
            console.error('Image Studio polling error:', e);
        }
    }

    // Kick off initial poll
    await pollStatus();

    // Bind Action Buttons Once
    if (!_imageStudioEventsBound) {
        _imageStudioEventsBound = true;

        if (setComfyBtn && customComfyInput) {
            setComfyBtn.onclick = async () => {
                const path = customComfyInput.value.trim();
                if (!path) {
                    showNotification('Please enter a valid ComfyUI directory path', 'warning');
                    return;
                }
                setComfyBtn.disabled = true;
                setComfyBtn.textContent = 'Checking...';
                try {
                    const res = await fetch('/api/image/comfy/set_path', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.detail || 'Could not verify ComfyUI at path');
                    showNotification('ComfyUI path saved successfully!', 'success');
                    customComfyInput.value = '';
                    await pollStatus();
                } catch (err) {
                    showNotification(err.message, 'error');
                } finally {
                    setComfyBtn.disabled = false;
                    setComfyBtn.textContent = 'Set Path';
                }
            };
        }

        if (autoSetupBtn) {
            autoSetupBtn.onclick = async () => {
                autoSetupBtn.disabled = true;
                autoSetupBtn.textContent = 'Starting setup...';
                try {
                    const res = await fetch('/api/image/comfy/setup', { method: 'POST' });
                    const data = await res.json();
                    showNotification('ComfyUI automated installation started in nivm/engine/ComfyUI', 'info');
                    if (!_imageStudioPollInterval) {
                        _imageStudioPollInterval = setInterval(pollStatus, 1000);
                    }
                    await pollStatus();
                } catch (err) {
                    showNotification('Failed to start ComfyUI setup: ' + err.message, 'error');
                    autoSetupBtn.disabled = false;
                }
            };
        }

        if (downloadBtn) {
            downloadBtn.onclick = async () => {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Initializing aria2...';
                try {
                    const res = await fetch('/api/image/models/download?category=standard', { method: 'POST' });
                    const data = await res.json();
                    showNotification('Image models background download started with aria2c', 'info');
                    if (!_imageStudioPollInterval) {
                        _imageStudioPollInterval = setInterval(pollStatus, 1000);
                    }
                    await pollStatus();
                } catch (err) {
                    showNotification('Failed to start model download: ' + err.message, 'error');
                    downloadBtn.disabled = false;
                }
            };
        }

        if (downloadAnimeBtn) {
            downloadAnimeBtn.onclick = async () => {
                downloadAnimeBtn.disabled = true;
                downloadAnimeBtn.textContent = 'Initializing aria2...';
                try {
                    const res = await fetch('/api/image/models/download?category=anime', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category: 'anime' })
                    });
                    const data = await res.json();
                    showNotification('Anime engine models download started with aria2c', 'info');
                    if (!_imageStudioPollInterval) {
                        _imageStudioPollInterval = setInterval(pollStatus, 1000);
                    }
                    await pollStatus();
                } catch (err) {
                    showNotification('Failed to start anime download: ' + err.message, 'error');
                    downloadAnimeBtn.disabled = false;
                }
            };
        }
    }
}

// --- Dropdown Notification System ---
