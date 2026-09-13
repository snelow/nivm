/**
 * nivm Image Studio Frontend Engine.
 * Provides real-time diffusion progress cards with live latent previews,
 * interactive Before/After split sliders, and quick image inspection modals.
 */

import { state } from './state.js';
import { renderImagePreviews } from './ui.js';

// Inject image studio keyframes and pill styles
if (typeof document !== 'undefined' && !document.getElementById('imageStudioKeyframes')) {
    const style = document.createElement('style');
    style.id = 'imageStudioKeyframes';
    style.textContent = `
        @keyframes voiceOrbRainbowFlow {
            0% { background-position: 0% 50%; }
            100% { background-position: 200% 50%; }
        }
        @keyframes liveDotPulse {
            0%, 20% { opacity: 0.15; transform: scale(0.85); }
            50% { opacity: 1; transform: scale(1.15); }
            80%, 100% { opacity: 0.15; transform: scale(0.85); }
        }
        .live-dots {
            display: inline-flex;
            align-items: baseline;
            gap: 1.5px;
            margin-left: 2px;
        }
        .live-dots span {
            animation: liveDotPulse 1.4s infinite ease-in-out both;
            font-weight: bold;
        }
        .live-dots span:nth-child(1) { animation-delay: 0s; }
        .live-dots span:nth-child(2) { animation-delay: 0.22s; }
        .live-dots span:nth-child(3) { animation-delay: 0.44s; }

        .img-pill-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.12);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.73rem;
            color: #cbd5e1;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            font-family: inherit;
            line-height: 1.2;
        }
        .img-pill-btn:hover:not(.img-pill-static) {
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(var(--accent-purple-rgb, 168, 85, 247), 0.45);
            color: #fff;
            transform: translateY(-1px);
        }
        .img-pill-btn:active:not(.img-pill-static) {
            transform: translateY(0);
        }
        .img-pill-static {
            background: rgba(0, 0, 0, 0.5);
            color: #94a3b8;
            border-color: rgba(255, 255, 255, 0.08);
            cursor: default;
        }
    `;
    document.head.appendChild(style);
}

export function getImageDuration(imageUrl) {
    if (!imageUrl) return null;
    try {
        const stored = JSON.parse(localStorage.getItem('nivm_image_durations') || '{}');
        const filename = imageUrl.split('/').pop();
        return stored[imageUrl] || (filename ? stored[filename] : null) || null;
    } catch (_) {
        return null;
    }
}

export function saveImageDuration(imageUrl, duration) {
    if (!imageUrl || !duration) return;
    try {
        const stored = JSON.parse(localStorage.getItem('nivm_image_durations') || '{}');
        const filename = imageUrl.split('/').pop();
        stored[imageUrl] = duration;
        if (filename) stored[filename] = duration;
        localStorage.setItem('nivm_image_durations', JSON.stringify(stored));
    } catch (_) {}
}

function formatStatusWithDots(text) {
    if (!text) return '';
    const base = text.replace(/[\.…]+$/, '').trim();
    return `${escapeHtml(base)}<span class="live-dots"><span>.</span><span>.</span><span>.</span></span>`;
}

export function resolveAspectConfig(aspectStr) {
    const s = String(aspectStr || '').toLowerCase().trim();
    if (s === 'portrait' || s === '9:16' || s === 'tall') {
        return { cssAspect: '832 / 1216', isPortrait: true, height: '380px', maxHeight: '420px' };
    }
    if (s === 'landscape' || s === '16:9' || s === 'wide') {
        return { cssAspect: '1216 / 832', isPortrait: false, height: 'auto', maxHeight: '360px' };
    }
    if (s === '3:4') {
        return { cssAspect: '864 / 1152', isPortrait: true, height: '380px', maxHeight: '420px' };
    }
    if (s === '4:3') {
        return { cssAspect: '1152 / 864', isPortrait: false, height: 'auto', maxHeight: '360px' };
    }
    if (s === 'square' || s === '1:1') {
        return { cssAspect: '1 / 1', isPortrait: false, height: '320px', maxHeight: '340px' };
    }
    const m = s.match(/^(\d+)[x:](\d+)$/);
    if (m) {
        const w = parseInt(m[1]), h = parseInt(m[2]);
        const isPort = h > w;
        return { cssAspect: `${w} / ${h}`, isPortrait: isPort, height: isPort ? '380px' : 'auto', maxHeight: '420px' };
    }
    return { cssAspect: '832 / 1216', isPortrait: true, height: '380px', maxHeight: '420px' };
}

export function createImageProgressCard(promptText, isEdit = false, requestedAspect = null) {
    const cardId = 'progress_card_' + Math.random().toString(36).substring(2, 9);
    const card = document.createElement('div');
    card.id = cardId;
    card.className = 'image-gen-progress-card';
    card.style.cssText = `
        background: rgba(18, 18, 26, 0.85);
        border: 1px solid rgba(var(--accent-purple-rgb, 168, 85, 247), 0.35);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(12px);
        border-radius: 12px;
        padding: 16px;
        margin: 6px 0 8px 0;
        width: 100%;
        max-width: 480px;
        color: #f1f5f9;
        font-family: inherit;
        animation: fadeInCard 0.3s ease-out;
    `;

    const isAnimePrompt = promptText.toLowerCase().includes('anime:') || promptText.toLowerCase().includes('anime');
    const aspectCfg = resolveAspectConfig(requestedAspect || (isAnimePrompt ? 'portrait' : 'square'));

    card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; color: var(--accent-purple, #c084fc);">
                <i class="fa-solid fa-wand-magic-sparkles fa-spin" style="--fa-animation-duration: 3s;"></i>
                <span>${isEdit ? 'Refining Image' : 'Synthesizing Image'}</span>
            </div>
            <span class="gen-timer" style="font-size: 0.75rem; color: #94a3b8; font-variant-numeric: tabular-nums;">0.0s</span>
        </div>

        <div class="gen-prompt-wrapper" style="margin-bottom: 12px; cursor: pointer; user-select: none;" title="Click to expand/collapse full prompt">
            <div class="gen-prompt-inner" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; font-size: 0.78rem; color: #cbd5e1; line-height: 1.4; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 6px 10px;">
                <span class="gen-prompt-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">"${escapeHtml(promptText)}"</span>
                <i class="fa-solid fa-chevron-down prompt-expand-chevron" style="font-size: 0.7rem; color: #94a3b8; margin-top: 3px; transition: transform 0.2s ease; flex-shrink: 0;"></i>
            </div>
        </div>

        <!-- Live Latent Preview Image -->
        <div class="preview-container" style="position: relative; ${aspectCfg.isPortrait ? `width: auto; height: ${aspectCfg.height}; max-height: ${aspectCfg.maxHeight}; max-width: 100%;` : `width: 100%; height: ${aspectCfg.height}; max-height: ${aspectCfg.maxHeight};`} aspect-ratio: ${aspectCfg.cssAspect}; margin: 0 auto 12px auto; background: rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
            <div class="preview-placeholder" style="display: flex; flex-direction: column; align-items: center; gap: 8px; color: #64748b; font-size: 0.8rem;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: var(--accent-purple, #8b5cf6);"></i>
                <span>Awaiting live preview<span class="live-dots"><span>.</span><span>.</span><span>.</span></span></span>
            </div>
            <img class="preview-img" style="display: none; width: 100%; height: 100%; object-fit: contain; border-radius: 8px;" alt="Live Preview" />
            <div class="preview-badge" style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.65); padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; color: var(--accent-purple, #a855f7); display: none;">
                <i class="fa-solid fa-eye"></i> LIVE PREVIEW
            </div>
        </div>

        <!-- Progress Bar Track (5-Color Voice Orb Rainbow Flow) -->
        <div style="background: rgba(255, 255, 255, 0.08); height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 8px;">
            <div class="gen-progress-bar" style="width: 5%; height: 100%; background: linear-gradient(90deg, #22c55e, #f59e0b, #f97316, #f43f5e, var(--accent-purple, #a855f7), #22c55e); background-size: 200% 100%; animation: voiceOrbRainbowFlow 2.5s linear infinite; border-radius: 3px; transition: width 0.3s ease; box-shadow: 0 0 12px rgba(var(--accent-purple-rgb, 168, 85, 247), 0.45);"></div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #94a3b8;">
            <span class="gen-step-text">Starting diffusion engine<span class="live-dots"><span>.</span><span>.</span><span>.</span></span></span>
            <span class="gen-percent-text">0%</span>
        </div>
    `;

    const timerEl = card.querySelector('.gen-timer');
    const previewContainer = card.querySelector('.preview-container');
    const previewPlaceholder = card.querySelector('.preview-placeholder');
    const previewImg = card.querySelector('.preview-img');
    const previewBadge = card.querySelector('.preview-badge');
    const progressBar = card.querySelector('.gen-progress-bar');
    const stepText = card.querySelector('.gen-step-text');
    const percentText = card.querySelector('.gen-percent-text');

    const promptWrapper = card.querySelector('.gen-prompt-wrapper');
    const promptTextEl = card.querySelector('.gen-prompt-text');
    const promptChevron = card.querySelector('.prompt-expand-chevron');
    if (promptWrapper && promptTextEl && promptChevron) {
        let isPromptExpanded = false;
        promptWrapper.onclick = () => {
            isPromptExpanded = !isPromptExpanded;
            if (isPromptExpanded) {
                promptTextEl.style.whiteSpace = 'normal';
                promptChevron.style.transform = 'rotate(180deg)';
            } else {
                promptTextEl.style.whiteSpace = 'nowrap';
                promptChevron.style.transform = 'rotate(0deg)';
            }
        };
    }

    let currentStage = '';
    let currentStep = 0;
    let maxSteps = (typeof promptText === 'string' && /\b(lcm|turbo|fast)\b/i.test(promptText)) ? 6 : 0;
    let isSamplerActive = false;

    function renderStepDisplay(step, max) {
        const total = max || maxSteps || 6;
        const current = step !== undefined ? step : currentStep;
        if (stepText) {
            stepText.textContent = `Step ${current} / ${total}`;
        }
    }

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const elapsed = elapsedSec.toFixed(1);
        if (timerEl) timerEl.textContent = `${elapsed}s`;

        // Provide dynamic stage guidance during text-encoding and weights streaming
        if (currentStep === 0 && !previewImg.src && !isSamplerActive) {
            const isAnime = typeof promptText === 'string' && (promptText.startsWith('Anime') || promptText.toLowerCase().includes('illustrious'));
            let stageNotice = 'Starting diffusion engine';
            let simPct = 3;

            if (elapsedSec <= 15) {
                stageNotice = 'Booting image engine in background (cold start ~15s)';
                simPct = Math.min(8, Math.round(2 + (elapsedSec / 15) * 6));
            } else if (isAnime) {
                if (elapsedSec <= 32) {
                    stageNotice = 'Loading Illustrious SDXL checkpoint & character LoRA';
                    simPct = Math.min(15, Math.round(8 + ((elapsedSec - 15) / 17) * 7));
                } else if (elapsedSec <= 50) {
                    stageNotice = 'Encoding CLIP prompt & wiring LoRA chains';
                    simPct = Math.min(22, Math.round(15 + ((elapsedSec - 32) / 18) * 7));
                } else {
                    stageNotice = maxSteps ? `Diffusion sampling (${maxSteps} steps)` : 'Entering CUDA diffusion sampler';
                    simPct = 25;
                }
            } else {
                if (elapsedSec <= 40) {
                    stageNotice = 'Encoding text prompt with Qwen2.5-VL (CPU RAM)';
                    simPct = Math.min(14, Math.round(8 + ((elapsedSec - 15) / 25) * 6));
                } else if (elapsedSec <= 65) {
                    stageNotice = 'Offloading text encoder & streaming weights to RTX 3050';
                    simPct = Math.min(20, Math.round(14 + ((elapsedSec - 40) / 25) * 6));
                } else {
                    stageNotice = maxSteps ? `Diffusion sampling (${maxSteps} steps)` : 'Entering CUDA diffusion sampler';
                    simPct = 22;
                }
            }

            if (!currentStage && !isSamplerActive) {
                if (stepText) stepText.innerHTML = formatStatusWithDots(stageNotice);
                if (percentText) percentText.textContent = `${simPct}%`;
                if (progressBar) progressBar.style.width = `${simPct}%`;
            }
        }
    }, 100);

    return {
        element: card,
        update: (eventData) => {
            if (!eventData) return;

            if (eventData.max_steps) {
                maxSteps = eventData.max_steps;
            }
            if (eventData.step !== undefined) {
                currentStep = eventData.step;
            }

            const isSampler = eventData.is_sampler === true ||
                              eventData.sampler === 'KSampler' ||
                              (eventData.class_type && String(eventData.class_type).includes('KSampler')) ||
                              (eventData.stage_text && eventData.stage_text.toLowerCase().includes('ksampler')) ||
                              (eventData.step > 0 && eventData.step !== undefined);

            if (isSampler) {
                isSamplerActive = true;
                currentStage = 'ksampler';
                renderStepDisplay(currentStep, maxSteps);

                const pct = eventData.percentage !== undefined
                    ? eventData.percentage
                    : (maxSteps > 0 ? Math.round((currentStep / maxSteps) * 100) : 20);
                if (percentText) percentText.textContent = `${pct}%`;
                if (progressBar) progressBar.style.width = `${Math.max(5, Math.min(100, pct))}%`;
            } else if (eventData.stage_text) {
                // Non-sampler stage (e.g. CheckpointLoader, CLIPTextEncode, VAEDecode, SaveImage)
                isSamplerActive = false;
                currentStage = eventData.stage_text;
                if (stepText) stepText.innerHTML = formatStatusWithDots(eventData.stage_text);
                if (eventData.percentage !== undefined) {
                    if (percentText) percentText.textContent = `${eventData.percentage}%`;
                    if (progressBar) progressBar.style.width = `${Math.max(5, Math.min(100, eventData.percentage))}%`;
                }
            } else if (eventData.percentage !== undefined) {
                if (percentText) percentText.textContent = `${eventData.percentage}%`;
                if (progressBar) progressBar.style.width = `${Math.max(5, Math.min(100, eventData.percentage))}%`;
            }

            if (eventData.preview_url) {
                previewImg.src = eventData.preview_url;
                previewImg.style.display = 'block';
                previewBadge.style.display = 'block';
                previewPlaceholder.style.display = 'none';

                const resizeToAspect = () => {
                    if (previewImg.naturalWidth && previewImg.naturalHeight) {
                        const nw = previewImg.naturalWidth;
                        const nh = previewImg.naturalHeight;
                        const isPort = nh > nw;
                        previewContainer.style.aspectRatio = `${nw} / ${nh}`;
                        if (isPort) {
                            previewContainer.style.width = 'auto';
                            previewContainer.style.height = '380px';
                            previewContainer.style.maxHeight = '420px';
                            previewContainer.style.maxWidth = '100%';
                        } else {
                            previewContainer.style.width = '100%';
                            previewContainer.style.height = 'auto';
                            previewContainer.style.maxHeight = '360px';
                        }
                        previewContainer.style.margin = '0 auto 12px auto';
                        previewImg.style.objectFit = 'contain';
                    }
                };
                if (previewImg.complete && previewImg.naturalWidth) {
                    resizeToAspect();
                } else {
                    previewImg.onload = resizeToAspect;
                }
            }
        },
        finish: (finalImageUrl, originalUrl = null) => {
            clearInterval(timerInterval);
            const finalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            saveImageDuration(finalImageUrl, finalElapsed);

            if (isEdit && originalUrl) {
                const compareCard = createBeforeAfterSlider(originalUrl, finalImageUrl, promptText, finalElapsed);
                card.replaceWith(compareCard);
            } else {
                const singleCard = createSingleImageCard(finalImageUrl, promptText, finalElapsed);
                card.replaceWith(singleCard);
            }
            return finalElapsed;
        },
        error: (errorMsg) => {
            clearInterval(timerInterval);
            card.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            card.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; color: #f87171; font-weight: 600; font-size: 0.85rem; margin-bottom: 6px;">
                    <i class="fa-solid fa-circle-exclamation"></i>
                    <span>Generation Failed</span>
                </div>
                <div style="font-size: 0.78rem; color: #fca5a5; line-height: 1.4;">
                    ${escapeHtml(errorMsg)}
                </div>
            `;
        }
    };
}


/**
 * Helper to attach an image URL into the chat input for editing.
 */
async function attachImageForChatEdit(imageUrl) {
    try {
        const filename = imageUrl.split('/').pop() || 'generated_image.png';
        state.lastGeneratedImage = filename;

        const promptInput = document.getElementById('userPrompt');
        if (promptInput) {
            promptInput.value = 'Change this image to: ';
            promptInput.focus();
            promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
            promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        const file = new File([blob], filename, { type: blob.type || 'image/png' });

        state.attachedImages = [{
            file: file,
            type: file.type,
            url: URL.createObjectURL(file)
        }];

        if (window.renderImagePreviews) {
            window.renderImagePreviews();
        }

        if (window.showNotification) {
            window.showNotification('Image attached to chat for editing', 'info');
        }
    } catch (err) {
        console.error('Error attaching image for chat edit:', err);
        const promptInput = document.getElementById('userPrompt');
        if (promptInput) {
            promptInput.value = `edit_image("${imageUrl.split('/').pop()}", "...")`;
            promptInput.focus();
        }
    }
}


/**
 * Creates an interactive Before/After comparison slider card for edited images.
 */
export function createBeforeAfterSlider(beforeUrl, afterUrl, promptText, durationSec = null) {
    const filename = afterUrl.split('/').pop() || 'edited.png';
    state.lastGeneratedImage = filename;

    if (!durationSec) {
        durationSec = getImageDuration(afterUrl);
    }
    if (durationSec) {
        saveImageDuration(afterUrl, durationSec);
    }

    const container = document.createElement('div');
    container.className = 'image-compare-card';
    container.style.cssText = `
        background: rgba(18, 18, 26, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 12px;
        margin: 12px 0;
        max-width: 480px;
        width: 100%;
        backdrop-filter: blur(10px);
    `;

    container.innerHTML = `
        <div style="position: relative; width: 100%; border-radius: 8px; overflow: hidden; touch-action: none; background: #000; user-select: none;">
            <!-- Labels -->
            <div style="position: absolute; top: 8px; left: 8px; z-index: 15; background: rgba(0,0,0,0.6); color: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; pointer-events: none;">
                ORIGINAL
            </div>
            <div style="position: absolute; top: 8px; right: 8px; z-index: 15; background: rgba(139,92,246,0.7); color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; pointer-events: none;">
                EDITED
            </div>

            <!-- After Image -->
            <img src="${afterUrl}" alt="After" class="after-img" style="width: 100%; height: auto; display: block;" />

            <!-- Before Image (Clipped) -->
            <img src="${beforeUrl}" alt="Before" class="before-img" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; clip-path: polygon(0 0, 50% 0, 50% 100%, 0 100%); display: block;" />

            <!-- Slider Range Control -->
            <input type="range" min="0" max="100" value="50" class="slider-input" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: ew-resize; z-index: 20; margin: 0;" />

            <!-- Divider Line and Handle -->
            <div class="slider-divider" style="position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: #fff; transform: translateX(-50%); pointer-events: none; z-index: 10; box-shadow: 0 0 8px rgba(0,0,0,0.6);">
                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 28px; height: 28px; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: var(--accent-purple, #8b5cf6); font-size: 14px; font-weight: bold;">
                    ◂▸
                </div>
            </div>

            <div style="position: absolute; bottom: 8px; right: 8px; z-index: 25; display: flex; align-items: center; gap: 5px;" class="image-overlay-actions">
                <button type="button" class="img-pill-btn inspect-btn" title="Inspect full view" style="padding: 3px 8px;">
                    <i class="fa-solid fa-maximize"></i>
                </button>
                <button type="button" class="img-pill-btn edit-again-btn" title="Edit in Chat" style="padding: 3px 8px;">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <a href="${afterUrl}" download="${filename}" class="img-pill-btn save-img-btn" title="Save image" style="padding: 3px 8px;">
                    <i class="fa-solid fa-download"></i>
                </a>
                ${durationSec ? `<span class="img-pill-btn img-pill-static" style="padding: 3px 8px; font-variant-numeric: tabular-nums;"><i class="fa-regular fa-clock" style="font-size: 0.65rem;"></i>${durationSec}s</span>` : ''}
            </div>
        </div>
    `;

    // Asynchronously fetch server metadata if duration was not cached or provided
    if (!durationSec && filename) {
        fetch(`/api/image/meta/${encodeURIComponent(filename)}`)
            .then(res => res.ok ? res.json() : null)
            .then(meta => {
                if (meta && meta.duration_seconds) {
                    const dur = Number(meta.duration_seconds).toFixed(1);
                    saveImageDuration(afterUrl, dur);
                    const overlay = container.querySelector('.image-overlay-actions');
                    if (overlay && !overlay.querySelector('.img-pill-static')) {
                        const badge = document.createElement('span');
                        badge.className = 'img-pill-btn img-pill-static';
                        badge.style.cssText = 'padding: 3px 8px; font-variant-numeric: tabular-nums;';
                        badge.innerHTML = `<i class="fa-regular fa-clock" style="font-size: 0.65rem;"></i>${dur}s`;
                        overlay.appendChild(badge);
                    }
                }
            })
            .catch(() => {});
    }

    const sliderInput = container.querySelector('.slider-input');
    const beforeImg = container.querySelector('.before-img');
    const divider = container.querySelector('.slider-divider');
    const inspectBtn = container.querySelector('.inspect-btn');
    const editBtn = container.querySelector('.edit-again-btn');
    const saveBtn = container.querySelector('.save-img-btn');

    sliderInput.oninput = (e) => {
        const pos = e.target.value;
        beforeImg.style.clipPath = `polygon(0 0, ${pos}% 0, ${pos}% 100%, 0 100%)`;
        divider.style.left = `${pos}%`;
    };

    inspectBtn.onclick = (e) => {
        e.stopPropagation();
        openImageDetailModal(afterUrl, beforeUrl, promptText);
    };

    if (editBtn) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            attachImageForChatEdit(afterUrl);
        };
    }

    if (saveBtn) {
        saveBtn.onclick = (e) => e.stopPropagation();
    }

    return container;
}


/**
 * Creates a single high-res image card for text-to-image generations.
 */
export function createSingleImageCard(imageUrl, promptText, durationSec = null) {
    const filename = imageUrl.split('/').pop() || 'generated.png';
    state.lastGeneratedImage = filename;

    if (!durationSec) {
        durationSec = getImageDuration(imageUrl);
    }
    if (durationSec) {
        saveImageDuration(imageUrl, durationSec);
    }

    const container = document.createElement('div');
    container.className = 'image-result-card';
    container.style.cssText = `
        background: rgba(18, 18, 26, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 12px;
        margin: 6px 0 8px 0;
        max-width: 480px;
        width: 100%;
        backdrop-filter: blur(10px);
    `;

    container.innerHTML = `
        <div style="position: relative; width: 100%; border-radius: 8px; overflow: hidden; background: #000; cursor: pointer;" class="image-click-wrap">
            <img src="${imageUrl}" alt="${escapeHtml(promptText)}" style="width: 100%; height: auto; display: block;" />
            <div style="position: absolute; bottom: 8px; right: 8px; display: flex; align-items: center; gap: 5px; z-index: 10;" class="image-overlay-actions">
                <button type="button" class="img-pill-btn edit-again-btn" title="Edit in Chat" style="padding: 3px 8px;">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <a href="${imageUrl}" download="${filename}" class="img-pill-btn save-img-btn" title="Save image" style="padding: 3px 8px;">
                    <i class="fa-solid fa-download"></i>
                </a>
                ${durationSec ? `<span class="img-pill-btn img-pill-static" style="padding: 3px 8px; font-variant-numeric: tabular-nums;"><i class="fa-regular fa-clock" style="font-size: 0.65rem;"></i>${durationSec}s</span>` : ''}
            </div>
        </div>
    `;

    // Asynchronously fetch server metadata if duration was not cached or provided
    if (!durationSec && filename) {
        fetch(`/api/image/meta/${encodeURIComponent(filename)}`)
            .then(res => res.ok ? res.json() : null)
            .then(meta => {
                if (meta && meta.duration_seconds) {
                    const dur = Number(meta.duration_seconds).toFixed(1);
                    saveImageDuration(imageUrl, dur);
                    const overlay = container.querySelector('.image-overlay-actions');
                    if (overlay && !overlay.querySelector('.img-pill-static')) {
                        const badge = document.createElement('span');
                        badge.className = 'img-pill-btn img-pill-static';
                        badge.style.cssText = 'padding: 3px 8px; font-variant-numeric: tabular-nums;';
                        badge.innerHTML = `<i class="fa-regular fa-clock" style="font-size: 0.65rem;"></i>${dur}s`;
                        overlay.appendChild(badge);
                    }
                }
            })
            .catch(() => {});
    }

    const clickWrap = container.querySelector('.image-click-wrap');
    const editBtn = container.querySelector('.edit-again-btn');
    const saveBtn = container.querySelector('.save-img-btn');

    clickWrap.onclick = (e) => {
        if (e.target.closest('.image-overlay-actions')) return;
        openImageDetailModal(imageUrl, null, promptText);
    };

    if (editBtn) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            attachImageForChatEdit(imageUrl);
        };
    }

    if (saveBtn) {
        saveBtn.onclick = (e) => e.stopPropagation();
    }

    return container;
}


/**
 * Fullscreen inspection and quick-edit modal.
 */
export function openImageDetailModal(afterUrl, beforeUrl = null, promptText = '') {
    const existing = document.getElementById('imageDetailModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'imageDetailModal';
    modal.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(16px);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        animation: fadeInModal 0.2s ease-out;
    `;

    modal.innerHTML = `
        <div style="background: rgba(22, 22, 32, 0.95); border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; max-width: 900px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.7);">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                <span style="font-weight: 600; font-size: 0.95rem; color: #f1f5f9;"><i class="fa-solid fa-eye" style="color: var(--accent-purple, #a855f7); margin-right: 6px;"></i>Image Inspection</span>
                <button class="modal-close-btn icon-btn-sm" style="background: transparent; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div style="padding: 16px; overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 14px;">
                <div class="modal-slider-holder" style="width: 100%; max-width: 680px;"></div>
                <div style="font-size: 0.85rem; color: #cbd5e1; width: 100%; max-width: 680px; line-height: 1.4;">
                    <strong>Prompt:</strong> ${escapeHtml(promptText)}
                </div>
            </div>

            <div style="padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: flex-end; gap: 10px;">
                <button class="btn-secondary modal-edit-btn" style="padding: 8px 16px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <i class="fa-solid fa-pen-to-square"></i> Edit in Chat
                </button>
                <a href="${afterUrl}" download="nivm_${Date.now()}.png" class="btn-primary" style="padding: 8px 16px; font-size: 0.85rem; text-decoration: none;">
                    <i class="fa-solid fa-download"></i> Download Full Image
                </a>
            </div>
        </div>
    `;

    const sliderHolder = modal.querySelector('.modal-slider-holder');
    const img = document.createElement('img');
    img.src = afterUrl;
    img.style.cssText = 'width: 100%; height: auto; max-height: 65vh; object-fit: contain; border-radius: 8px; display: block; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.4);';
    sliderHolder.appendChild(img);

    modal.querySelector('.modal-close-btn').onclick = () => modal.remove();
    const modalEditBtn = modal.querySelector('.modal-edit-btn');
    if (modalEditBtn) {
        modalEditBtn.onclick = () => {
            modal.remove();
            attachImageForChatEdit(afterUrl);
        };
    }
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };

    document.body.appendChild(modal);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
