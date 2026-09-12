/**
 * nivm Image Studio Frontend Engine.
 * Provides real-time diffusion progress cards with live latent previews,
 * interactive Before/After split sliders, and quick image inspection modals.
 */

import { state } from './state.js';
import { renderImagePreviews } from './ui.js';

// Inject voice orb 5-color rainbow flow animation keyframes once
if (typeof document !== 'undefined' && !document.getElementById('voiceOrbRainbowKeyframes')) {
    const style = document.createElement('style');
    style.id = 'voiceOrbRainbowKeyframes';
    style.textContent = `
        @keyframes voiceOrbRainbowFlow {
            0% { background-position: 0% 50%; }
            100% { background-position: 200% 50%; }
        }
    `;
    document.head.appendChild(style);
}

export function createImageProgressCard(promptText, isEdit = false) {
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

    card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; color: var(--accent-purple, #c084fc);">
                <i class="fa-solid fa-wand-magic-sparkles fa-spin" style="--fa-animation-duration: 3s;"></i>
                <span>${isEdit ? 'Refining Image (Qwen-Rapid)' : 'Synthesizing Image (Qwen-Rapid)'}</span>
            </div>
            <span class="gen-timer" style="font-size: 0.75rem; color: #94a3b8; font-variant-numeric: tabular-nums;">0.0s</span>
        </div>

        <div class="gen-prompt-preview" style="font-size: 0.8rem; color: #cbd5e1; margin-bottom: 12px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
            "${escapeHtml(promptText)}"
        </div>

        <!-- Live Latent Preview Image -->
        <div class="preview-container" style="position: relative; width: 100%; height: 220px; background: rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden; margin-bottom: 12px; display: flex; align-items: center; justify-content: center;">
            <div class="preview-placeholder" style="display: flex; flex-direction: column; align-items: center; gap: 8px; color: #64748b; font-size: 0.8rem;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: var(--accent-purple, #8b5cf6);"></i>
                <span>Awaiting live preview…</span>
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
            <span class="gen-step-text">Step 0 / 5</span>
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

    let currentStage = '';
    let currentStep = 0;

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const elapsed = elapsedSec.toFixed(1);
        if (timerEl) timerEl.textContent = `${elapsed}s`;

        // Provide dynamic stage guidance during text-encoding and weights streaming
        if (currentStep === 0 && !previewImg.src) {
            let stageNotice = 'Starting diffusion engine…';
            let simPct = 3;
            if (elapsedSec > 10 && elapsedSec <= 45) {
                stageNotice = 'Encoding text prompt with Qwen2.5-VL (CPU RAM)…';
                simPct = Math.min(12, Math.round(3 + ((elapsedSec - 10) / 35) * 9));
            } else if (elapsedSec > 45 && elapsedSec <= 65) {
                stageNotice = 'Offloading text encoder & streaming weights to RTX 3050…';
                simPct = Math.min(18, Math.round(12 + ((elapsedSec - 45) / 20) * 6));
            } else if (elapsedSec > 65) {
                stageNotice = 'Entering CUDA diffusion sampler…';
                simPct = 20;
            }

            if (!currentStage) {
                if (stepText) stepText.textContent = stageNotice;
                if (percentText) percentText.textContent = `${simPct}%`;
                if (progressBar) progressBar.style.width = `${simPct}%`;
            }
        }
    }, 100);

    return {
        element: card,
        update: (eventData) => {
            if (eventData.step !== undefined && eventData.max_steps) {
                currentStep = eventData.step;
                if (eventData.step > 0) {
                    stepText.textContent = `Step ${eventData.step} / ${eventData.max_steps}`;
                    const pct = eventData.percentage || Math.round((eventData.step / eventData.max_steps) * 100);
                    percentText.textContent = `${pct}%`;
                    progressBar.style.width = `${Math.max(5, Math.min(100, pct))}%`;
                }
            }

            if (eventData.stage_text) {
                currentStage = eventData.stage_text;
                if (currentStep === 0) {
                    stepText.textContent = eventData.stage_text;
                    if (eventData.percentage) {
                        percentText.textContent = `${eventData.percentage}%`;
                        progressBar.style.width = `${eventData.percentage}%`;
                    }
                }
            }

            if (eventData.preview_url) {
                previewImg.src = eventData.preview_url;
                previewImg.style.display = 'block';
                previewBadge.style.display = 'block';
                previewPlaceholder.style.display = 'none';
            }
        },
        finish: (finalImageUrl, originalUrl = null) => {
            clearInterval(timerInterval);
            const finalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            // Render clean single image card (slider removed as requested to avoid aspect ratio bugs)
            const singleCard = createSingleImageCard(finalImageUrl, promptText, finalElapsed);
            card.replaceWith(singleCard);
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
        const promptInput = document.getElementById('userPrompt');
        if (promptInput) {
            promptInput.value = 'Change this image to: ';
            promptInput.focus();
            promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
            promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        const filename = imageUrl.split('/').pop() || 'generated_image.png';
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
    const container = document.createElement('div');
    container.className = 'image-compare-card';
    container.style.cssText = `
        background: rgba(18, 18, 26, 0.8);
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

            ${durationSec ? `<span style="position: absolute; bottom: 8px; right: 8px; z-index: 15; background: rgba(0,0,0,0.65); padding: 3px 8px; border-radius: 4px; font-size: 0.72rem; color: #cbd5e1; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 4px;"><i class="fa-regular fa-clock" style="font-size: 0.65rem;"></i>${durationSec}s</span>` : ''}
        </div>

        <div style="margin-top: 10px; display: flex; gap: 8px;">
            <button class="btn-secondary inspect-btn" style="flex: 1; padding: 7px 12px; font-size: 0.78rem; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;">
                <i class="fa-solid fa-maximize"></i> Inspect
            </button>
            <a href="${afterUrl}" download="edited_${Date.now()}.png" class="btn-secondary" style="padding: 7px 16px; font-size: 0.78rem; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none;">
                <i class="fa-solid fa-download"></i> Save
            </a>
        </div>
    `;

    const sliderInput = container.querySelector('.slider-input');
    const beforeImg = container.querySelector('.before-img');
    const divider = container.querySelector('.slider-divider');
    const inspectBtn = container.querySelector('.inspect-btn');

    sliderInput.oninput = (e) => {
        const pos = e.target.value;
        beforeImg.style.clipPath = `polygon(0 0, ${pos}% 0, ${pos}% 100%, 0 100%)`;
        divider.style.left = `${pos}%`;
    };

    inspectBtn.onclick = () => {
        openImageDetailModal(afterUrl, beforeUrl, promptText);
    };

    return container;
}


/**
 * Creates a single high-res image card for text-to-image generations.
 */
export function createSingleImageCard(imageUrl, promptText, durationSec = null) {
    const container = document.createElement('div');
    container.className = 'image-result-card';
    container.style.cssText = `
        background: rgba(18, 18, 26, 0.8);
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
            ${durationSec ? `<span style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.65); padding: 3px 8px; border-radius: 4px; font-size: 0.72rem; color: #cbd5e1; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 4px;"><i class="fa-regular fa-clock" style="font-size: 0.65rem;"></i>${durationSec}s</span>` : ''}
        </div>

        <div style="margin-top: 10px; display: flex; gap: 8px;">
            <button class="btn-secondary edit-again-btn" style="flex: 1; padding: 7px 12px; font-size: 0.78rem; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;">
                <i class="fa-solid fa-pen-to-square"></i> Edit in Chat
            </button>
            <a href="${imageUrl}" download="gen_${Date.now()}.png" class="btn-secondary" style="padding: 7px 16px; font-size: 0.78rem; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none;">
                <i class="fa-solid fa-download"></i> Save
            </a>
        </div>
    `;

    const clickWrap = container.querySelector('.image-click-wrap');
    const editBtn = container.querySelector('.edit-again-btn');

    clickWrap.onclick = () => openImageDetailModal(imageUrl, null, promptText);
    editBtn.onclick = () => attachImageForChatEdit(imageUrl);

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
