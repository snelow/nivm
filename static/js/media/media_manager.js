/* media attachments, vision & audio recording */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { showNotification, showAlert } from '../modals/dialogs.js';

export function isMultimodalModel(model = '', endpoint = '') {
    const m = (model || '').toLowerCase();
    const ep = (endpoint || '').toLowerCase();
    if (ep.includes('googleapis.com') || ep.includes('generativelanguage')) return true;
    if (m.includes('gemini')) return true;
    if (m.includes('gpt-4o') || m.includes('gpt-4-turbo') || m.includes('gpt-4-vision') || m.includes('chatgpt-4o')) return true;
    if (m.includes('claude-3') || m.includes('pixtral') || m.includes('llava') || m.includes('vision') || m.includes('-vl') || m.includes('_vl') || m.includes('minicpm-v') || m.includes('internvl') || m.includes('ovis') || m.includes('qwen-vl')) return true;
    return false;
}
window.isMultimodalModel = isMultimodalModel;

export function isVisionSupported() {
    if (state.inferenceMode === 'api') {
        if (state.apiMultimodal !== undefined && state.apiMultimodal !== null) {
            return Boolean(state.apiMultimodal);
        }
        const model = (state.selectedModel || dom.apiModelInput?.value || '').toLowerCase();
        const endpoint = (dom.apiChatUrl?.value || dom.apiBaseUrl?.value || '').toLowerCase();
        return isMultimodalModel(model, endpoint);
    }
    if (state.inferenceMode === 'routing') {
        return true;
    }
    if (state.inferenceMode === 'single') {
        const role = dom.singleModelRoleSelect ? dom.singleModelRoleSelect.value : (state.selectedModel || 'custom');
        if (role === 'vision') return true;
        if (role === 'custom') {
            const mmproj = (state.customMmprojPath || '').trim();
            return Boolean(mmproj && mmproj.toLowerCase() !== 'none');
        }
        return false;
    }
    return false;
}
window.isVisionSupported = isVisionSupported;

export function setVisionEnabled(enabled) {
    if (!isVisionSupported()) {
        enabled = false;
    }
    state.visionEnabled = !!enabled;
    updateVisionAvailabilityUI();
}
window.setVisionEnabled = setVisionEnabled;

export function updateVisionAvailabilityUI() {
    const supported = isVisionSupported();
    if (dom.visionToggleBtn) {
        if (!supported) {
            dom.visionToggleBtn.disabled = true;
            dom.visionToggleBtn.classList.add('disabled');
            dom.visionToggleBtn.classList.remove('active');
            dom.visionToggleBtn.title = state.inferenceMode === 'api'
                ? "Vision is disabled for this API provider/model (Enable Multimodal in API Settings)"
                : "Vision is unavailable (No mmproj projector configured for this model)";
            state.visionEnabled = false;
            if (dom.attachImgBtn) dom.attachImgBtn.classList.add('hidden');
            if (dom.micRecordBtn) dom.micRecordBtn.classList.add('hidden');
            clearAttachedImage();
        } else {
            dom.visionToggleBtn.disabled = false;
            dom.visionToggleBtn.classList.remove('disabled');
            if (state.visionEnabled) {
                dom.visionToggleBtn.classList.add('active');
                dom.visionToggleBtn.title = "Vision is active (Multimodal enabled)";
                if (dom.attachImgBtn) dom.attachImgBtn.classList.remove('hidden');
                if (dom.micRecordBtn) dom.micRecordBtn.classList.remove('hidden');
            } else {
                dom.visionToggleBtn.classList.remove('active');
                dom.visionToggleBtn.title = "Enable Vision (Multimodal)";
                if (dom.attachImgBtn) dom.attachImgBtn.classList.add('hidden');
                if (dom.micRecordBtn) dom.micRecordBtn.classList.add('hidden');
            }
        }
    }
}
window.updateVisionAvailabilityUI = updateVisionAvailabilityUI;

export function setupVisionUI() {
    if (dom.visionToggleBtn) {
        dom.visionToggleBtn.addEventListener('click', () => {
            if (state.inferenceMode === 'api' && !isVisionSupported()) return;
            setVisionEnabled(!state.visionEnabled);
        });
    }

    if (dom.attachImgBtn && dom.imageUploadInput) {
        dom.attachImgBtn.addEventListener('click', () => {
            if (state.inferenceMode === 'api' && !isVisionSupported()) return;
            dom.imageUploadInput.click();
        });

        dom.imageUploadInput.addEventListener('change', (e) => {
            if (state.inferenceMode === 'api' && !isVisionSupported()) return;
            handleImageFiles(e.target.files);
        });
    }

    // Paste support
    if (dom.userPrompt) {
        dom.userPrompt.addEventListener('paste', (e) => {
            if ((state.inferenceMode === 'api' && !isVisionSupported()) || !state.visionEnabled) return;
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            const files = [];
            for (let item of items) {
                if (item.type.indexOf('image') === 0 || item.type === 'application/pdf' || item.type.indexOf('video') === 0 || item.type.indexOf('audio') === 0) {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
            if (files.length > 0) {
                e.preventDefault();
                handleImageFiles(files);
            }
        });
    }

    // Drag and Drop support
    const preventDefaults = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    document.body.addEventListener('drop', (e) => {
        if ((state.inferenceMode === 'api' && !isVisionSupported()) || !state.visionEnabled) return;
        const dt = e.dataTransfer;
        const files = [];
        if (dt.files && dt.files.length > 0) {
            for (let i = 0; i < dt.files.length; i++) {
                const file = dt.files[i];
                if (file.type.indexOf('image') === 0 || file.type === 'application/pdf' || file.type.indexOf('video') === 0 || file.type.indexOf('audio') === 0) {
                    files.push(file);
                }
            }
        }
        if (files.length > 0) {
            handleImageFiles(files);
        }
    });
}

window.removeAttachedImage = function(index) {
    if (state.attachedImages && state.attachedImages[index]) {
        URL.revokeObjectURL(state.attachedImages[index].url);
        state.attachedImages.splice(index, 1);
        renderImagePreviews();
    }
};

function handleImageFiles(files) {
    if (state.inferenceMode === 'api' && !isVisionSupported()) {
        showNotification('Current API provider/model is text-only. Enable Multimodal in API Settings to attach files.', 'warning');
        return;
    }
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        state.attachedImages.push({
            file: file,
            type: file.type,
            url: URL.createObjectURL(file)
        });
    }
    renderImagePreviews();
}

let currentPreviewAudio = null;

function buildAudioPreviewPill(imgObj, index) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'image-preview-item preview-audio-pill';
    
    const fileName = imgObj.file?.name || 'audio';
    const isRecording = fileName.startsWith('recording_');
    const displayName = isRecording ? 'Voice recording' : fileName;
    
    // Play button on the left
    const playBtn = document.createElement('button');
    playBtn.className = 'preview-audio-play';
    playBtn.type = 'button';
    playBtn.title = 'Play preview';
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    
    // Info container in the middle
    const info = document.createElement('div');
    info.className = 'preview-audio-info';
    
    const metaRow = document.createElement('div');
    metaRow.className = 'preview-audio-meta';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'preview-audio-name';
    nameSpan.textContent = displayName.length > 20 ? displayName.substring(0, 18) + '...' : displayName;
    nameSpan.title = fileName;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'preview-audio-time';
    timeSpan.textContent = '0:00';
    
    metaRow.appendChild(nameSpan);
    metaRow.appendChild(timeSpan);
    
    const waveWrap = document.createElement('div');
    waveWrap.className = 'preview-waveform-wrap';
    
    const canvas = document.createElement('canvas');
    canvas.className = 'preview-waveform-canvas';
    waveWrap.appendChild(canvas);
    
    info.appendChild(metaRow);
    info.appendChild(waveWrap);
    
    const audio = new Audio(imgObj.url);
    audio.preload = 'metadata';
    let bars = [];
    let animFrame = null;
    const numBars = 26;
    
    const formatTime = (s) => {
        if (!s || isNaN(s) || !isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
    };
    
    const generateBars = async () => {
        try {
            const response = await fetch(imgObj.url);
            const arrayBuffer = await response.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await audioCtx.decodeAudioData(arrayBuffer);
            const rawData = decoded.getChannelData(0);
            const blockSize = Math.floor(rawData.length / numBars);
            bars = [];
            for (let i = 0; i < numBars; i++) {
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum += Math.abs(rawData[i * blockSize + j]);
                }
                bars.push(sum / blockSize);
            }
            const maxVal = Math.max(...bars) || 1;
            bars = bars.map(b => Math.max(0.12, b / maxVal));
            audioCtx.close();
        } catch (e) {
            bars = Array.from({ length: numBars }, () => 0.15 + Math.random() * 0.85);
        }
        drawWaveform();
    };
    
    const drawWaveform = () => {
        const dpr = window.devicePixelRatio || 1;
        const w = waveWrap.clientWidth || 140;
        const h = 18;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        
        if (bars.length === 0) return;
        
        const barW = Math.max(2, (w / bars.length) * 0.55);
        const gap = w / bars.length;
        const duration = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1;
        const progress = audio.currentTime / duration;
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#f4f4f5';
        
        bars.forEach((val, i) => {
            const barH = Math.max(3, val * (h - 2));
            const x = i * gap + (gap - barW) / 2;
            const y = (h - barH) / 2;
            const barProgress = (i + 0.5) / bars.length;
            
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x, y, barW, barH, 1);
            } else {
                ctx.rect(x, y, barW, barH);
            }
            ctx.fillStyle = barProgress <= progress ? accentColor : 'rgba(255, 255, 255, 0.2)';
            ctx.fill();
        });
    };
    
    const animLoop = () => {
        drawWaveform();
        if (isFinite(audio.duration) && audio.duration > 0) {
            timeSpan.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
        } else {
            timeSpan.textContent = formatTime(audio.currentTime);
        }
        if (!audio.paused) {
            animFrame = requestAnimationFrame(animLoop);
        }
    };
    
    playBtn.onclick = (e) => {
        e.stopPropagation();
        if (audio.paused) {
            if (currentPreviewAudio && currentPreviewAudio !== audio) {
                currentPreviewAudio.pause();
            }
            currentPreviewAudio = audio;
            audio.play().then(() => {
                playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
                playBtn.classList.add('playing');
                animLoop();
            }).catch(err => console.warn('Preview audio play error:', err));
        } else {
            audio.pause();
            playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
            playBtn.classList.remove('playing');
            if (animFrame) cancelAnimationFrame(animFrame);
        }
    };
    
    audio.onended = () => {
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        playBtn.classList.remove('playing');
        if (animFrame) cancelAnimationFrame(animFrame);
        drawWaveform();
        if (isFinite(audio.duration) && audio.duration > 0) {
            timeSpan.textContent = formatTime(audio.duration);
        }
    };
    
    audio.onloadedmetadata = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
            timeSpan.textContent = formatTime(audio.duration);
        }
    };
    
    waveWrap.onclick = (e) => {
        e.stopPropagation();
        if (!isFinite(audio.duration) || audio.duration <= 0) return;
        const rect = waveWrap.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = frac * audio.duration;
        drawWaveform();
        timeSpan.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    };
    
    generateBars();
    
    // Remove button on the right (flex item, non-overlapping)
    const rmBtn = document.createElement('button');
    rmBtn.className = 'remove-image-btn';
    rmBtn.type = 'button';
    rmBtn.title = 'Remove';
    rmBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    rmBtn.onclick = (e) => {
        e.stopPropagation();
        audio.pause();
        audio.src = '';
        if (animFrame) cancelAnimationFrame(animFrame);
        if (currentPreviewAudio === audio) currentPreviewAudio = null;
        window.removeAttachedImage(index);
    };
    
    itemDiv.appendChild(playBtn);
    itemDiv.appendChild(info);
    itemDiv.appendChild(rmBtn);
    
    return itemDiv;
}

export function renderImagePreviews() {
    window.renderImagePreviews = renderImagePreviews;
    if (!dom.imagePreviewContainer) return;
    
    if (currentPreviewAudio) {
        try {
            currentPreviewAudio.pause();
            currentPreviewAudio.src = '';
        } catch (e) {}
        currentPreviewAudio = null;
    }
    
    dom.imagePreviewContainer.innerHTML = '';
    
    if (state.attachedImages.length > 0) {
        state.attachedImages.forEach((imgObj, index) => {
            const isAudio = imgObj.type && imgObj.type.startsWith('audio/');
            
            if (isAudio) {
                const audioPill = buildAudioPreviewPill(imgObj, index);
                dom.imagePreviewContainer.appendChild(audioPill);
                return;
            }
            
            const itemDiv = document.createElement('div');
            itemDiv.className = 'image-preview-item';
            
            const isVideo = imgObj.type && imgObj.type.startsWith('video/');
            const isPdf = imgObj.type === 'application/pdf' || imgObj.file.name.toLowerCase().endsWith('.pdf');
            const fileName = imgObj.file?.name || 'file';
            
            if (isPdf) {
                // PDF card
                itemDiv.className = 'image-preview-item preview-doc-pill';
                const icon = document.createElement('div');
                icon.className = 'preview-doc-icon';
                icon.innerHTML = '<i class="fa-solid fa-file-pdf"></i>';
                const label = document.createElement('span');
                label.className = 'preview-doc-name';
                label.textContent = fileName.length > 20 ? fileName.substring(0, 17) + '...' : fileName;
                label.title = fileName;
                itemDiv.appendChild(icon);
                itemDiv.appendChild(label);
            } else if (isVideo) {
                // Video thumbnail with play overlay
                itemDiv.className = 'image-preview-item preview-video-thumb';
                const vid = document.createElement('video');
                vid.src = imgObj.url;
                vid.muted = true;
                vid.preload = 'metadata';
                vid.playsInline = true;
                vid.addEventListener('loadeddata', () => { vid.currentTime = 0.1; }, { once: true });
                const playIcon = document.createElement('div');
                playIcon.className = 'preview-video-play';
                playIcon.innerHTML = '<i class="fa-solid fa-play"></i>';
                // Type badge
                const badge = document.createElement('span');
                badge.className = 'preview-type-badge';
                badge.textContent = '🎥';
                itemDiv.appendChild(vid);
                itemDiv.appendChild(playIcon);
                itemDiv.appendChild(badge);
            } else {
                // Image thumbnail
                const img = document.createElement('img');
                img.src = imgObj.url;
                itemDiv.appendChild(img);
            }
            
            const rmBtn = document.createElement('button');
            rmBtn.className = 'remove-image-btn';
            rmBtn.type = 'button';
            rmBtn.title = 'Remove';
            rmBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            rmBtn.onclick = () => window.removeAttachedImage(index);
            
            itemDiv.appendChild(rmBtn);
            dom.imagePreviewContainer.appendChild(itemDiv);
        });
        dom.imagePreviewContainer.classList.remove('hidden');
    } else {
        dom.imagePreviewContainer.classList.add('hidden');
    }
}

export function clearAttachedImage() {
    if (currentPreviewAudio) {
        try {
            currentPreviewAudio.pause();
            currentPreviewAudio.src = '';
        } catch (e) {}
        currentPreviewAudio = null;
    }
    if (state.attachedImages) {
        state.attachedImages.forEach(img => URL.revokeObjectURL(img.url));
    }
    state.attachedImages = [];
    renderImagePreviews();
    
    if (dom.imageUploadInput) {
        dom.imageUploadInput.value = '';
    }
}

// ---------- Audio Recording ----------
let mediaRecorder = null;
let recordedChunks = [];

export function setupAudioRecording() {
    if (!dom.micRecordBtn) return;
    
    dom.micRecordBtn.addEventListener('click', async () => {
        if (state.inferenceMode === 'api' && !isVisionSupported()) return;
        
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            // Stop recording
            mediaRecorder.stop();
            return;
        }
        
        try {
            if (!navigator?.mediaDevices?.getUserMedia) {
                const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
                const msg = isLocal
                    ? 'Microphone API unavailable. Click Reset permissions in browser settings.'
                    : `Microphone is blocked on IP origins. Please open http://localhost:${location.port || '8000'}`;
                showNotification(msg, 'error');
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            recordedChunks = [];
            
            // Prefer webm, fallback to whatever is available
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : '';
            
            mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                // Stop all tracks
                stream.getTracks().forEach(t => t.stop());
                
                const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                const ext = (mediaRecorder.mimeType || '').includes('webm') ? '.webm' : '.wav';
                const file = new File([blob], `recording_${Date.now()}${ext}`, { type: blob.type });
                
                state.attachedImages.push({
                    file: file,
                    type: blob.type,
                    url: URL.createObjectURL(blob)
                });
                renderImagePreviews();
                
                dom.micRecordBtn.classList.remove('recording');
                dom.micRecordBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                mediaRecorder = null;
            };
            
            mediaRecorder.onerror = () => {
                stream.getTracks().forEach(t => t.stop());
                dom.micRecordBtn.classList.remove('recording');
                dom.micRecordBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                showNotification('Recording failed.', 'error');
                mediaRecorder = null;
            };
            
            mediaRecorder.start();
            dom.micRecordBtn.classList.add('recording');
            dom.micRecordBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
            
        } catch (e) {
            console.error('Mic access denied:', e);
            showNotification('Microphone access denied. Check browser permissions.', 'error');
        }
    });
}

let lbScale = 1;
let lbPanning = false;
let lbPointX = 0;
let lbPointY = 0;
let lbStartX = 0;
let lbStartY = 0;

function setLightboxTransform() {
    if (dom.lightboxImage) {
        dom.lightboxImage.style.transform = `translate(${lbPointX}px, ${lbPointY}px) scale(${lbScale})`;
    }
}

export function openLightbox(src) {
    if (dom.imageLightboxModal && dom.lightboxImage) {
        dom.lightboxImage.src = src;
        lbScale = 1;
        lbPointX = 0;
        lbPointY = 0;
        setLightboxTransform();
        dom.imageLightboxModal.classList.remove('hidden');
        
        // Panning
        dom.lightboxImage.onmousedown = (e) => {
            e.preventDefault();
            lbStartX = e.clientX - lbPointX;
            lbStartY = e.clientY - lbPointY;
            lbPanning = true;
            dom.lightboxImage.style.cursor = 'grabbing';
        };
        dom.lightboxImage.onmouseup = () => {
            lbPanning = false;
            dom.lightboxImage.style.cursor = 'grab';
        };
        dom.lightboxImage.onmouseleave = () => {
            lbPanning = false;
            dom.lightboxImage.style.cursor = 'grab';
        };
        dom.lightboxImage.onmousemove = (e) => {
            if (!lbPanning) return;
            lbPointX = e.clientX - lbStartX;
            lbPointY = e.clientY - lbStartY;
            setLightboxTransform();
        };
        
        // Zooming
        dom.lightboxImage.onwheel = (e) => {
            e.preventDefault();
            const xs = (e.clientX - lbPointX) / lbScale;
            const ys = (e.clientY - lbPointY) / lbScale;
            const delta = (e.wheelDelta ? e.wheelDelta : -e.deltaY);
            if (delta > 0) {
                lbScale *= 1.1;
            } else {
                lbScale /= 1.1;
            }
            if (lbScale < 0.2) lbScale = 0.2;
            if (lbScale > 20) lbScale = 20;
            
            lbPointX = e.clientX - xs * lbScale;
            lbPointY = e.clientY - ys * lbScale;
            setLightboxTransform();
        };
        
        dom.lightboxImage.style.cursor = 'grab';
        dom.lightboxImage.style.transition = 'transform 0.05s linear';
        
        // Escape to close
        window._lightboxKeydownHandler = (e) => {
            if (e.code === 'Escape') closeLightbox();
        };
        document.addEventListener('keydown', window._lightboxKeydownHandler);
    }
}

export function closeLightbox() {
    if (dom.imageLightboxModal) {
        dom.imageLightboxModal.classList.add('hidden');
    }
    if (window._lightboxKeydownHandler) {
        document.removeEventListener('keydown', window._lightboxKeydownHandler);
        window._lightboxKeydownHandler = null;
    }
}

if (dom.closeLightboxBtn) {
    dom.closeLightboxBtn.addEventListener('click', closeLightbox);
}
if (dom.imageLightboxModal) {
    dom.imageLightboxModal.addEventListener('click', (e) => {
        if (e.target === dom.imageLightboxModal || e.target.classList.contains('lightbox-content')) {
            closeLightbox();
        }
    });
}

export function openVideoPreview(src) {
    if (dom.videoPreviewModal && dom.videoPreviewPlayer) {
        dom.videoPreviewPlayer.src = src;
        dom.videoPreviewModal.classList.remove('hidden');
        
        const formatTime = (seconds) => {
            if (isNaN(seconds)) return '0:00';
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${s < 10 ? '0' : ''}${s}`;
        };

        const updateTime = () => {
            if (dom.videoTimeDisplay && dom.videoPreviewPlayer) {
                dom.videoTimeDisplay.textContent = `${formatTime(dom.videoPreviewPlayer.currentTime)} / ${formatTime(dom.videoPreviewPlayer.duration)}`;
            }
            if (dom.videoProgressBar && dom.videoPreviewPlayer && dom.videoPreviewPlayer.duration) {
                const percent = (dom.videoPreviewPlayer.currentTime / dom.videoPreviewPlayer.duration) * 100;
                dom.videoProgressBar.style.width = `${percent}%`;
            }
        };

        dom.videoPreviewPlayer.addEventListener('timeupdate', updateTime);
        dom.videoPreviewPlayer.addEventListener('loadedmetadata', updateTime);

        const renderMarkers = () => {
            const duration = dom.videoPreviewPlayer.duration;
            if (!duration) return;
            const numFrames = Math.min(60, Math.max(1, Math.floor(duration)));
            
            if (dom.videoMarkersTrack) {
                // Remove only the marker divs (keep the progress bar)
                Array.from(dom.videoMarkersTrack.children).forEach(child => {
                    if (child.id !== 'videoProgressBar') {
                        child.remove();
                    }
                });
                
                for (let i = 0; i < numFrames; i++) {
                    const frac = i / Math.max(1, (numFrames));
                    const marker = document.createElement('div');
                    marker.style.position = 'absolute';
                    marker.style.left = `calc(${frac * 100}%)`;
                    marker.style.top = '0';
                    marker.style.width = '4px';
                    marker.style.height = '100%';
                    marker.style.backgroundColor = 'var(--accent-emerald, #10b981)';
                    marker.style.borderRadius = '2px';
                    marker.style.boxShadow = '0 0 5px var(--accent-emerald, #10b981)';
                    marker.style.opacity = '0.6'; // make them blend slightly
                    
                    marker.onclick = (e) => {
                        e.stopPropagation();
                        dom.videoPreviewPlayer.currentTime = frac * duration;
                    };
                    
                    dom.videoMarkersTrack.appendChild(marker);
                }
            }
        };

        if (dom.videoPreviewPlayer.readyState >= 1) {
            renderMarkers();
        } else {
            dom.videoPreviewPlayer.addEventListener('loadedmetadata', renderMarkers, { once: true });
        }
        
        // Track clicking for seeking
        if (dom.videoMarkersTrack) {
            dom.videoMarkersTrack.onclick = (e) => {
                const rect = dom.videoMarkersTrack.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                if (dom.videoPreviewPlayer.duration) {
                    dom.videoPreviewPlayer.currentTime = pos * dom.videoPreviewPlayer.duration;
                }
            };
        }
        
        // Play/Pause
        const togglePlay = () => {
            if (dom.videoPreviewPlayer.paused) {
                dom.videoPreviewPlayer.play();
            } else {
                dom.videoPreviewPlayer.pause();
            }
        };
        
        if (dom.videoPlayPauseBtn) {
            dom.videoPlayPauseBtn.onclick = togglePlay;
        }
        dom.videoPreviewPlayer.onclick = togglePlay;
        
        dom.videoPreviewPlayer.onplay = () => {
            if (dom.videoPlayPauseBtn) dom.videoPlayPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        };
        dom.videoPreviewPlayer.onpause = () => {
            if (dom.videoPlayPauseBtn) dom.videoPlayPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        };
        
        // Mute toggle
        if (dom.videoMuteBtn) {
            dom.videoMuteBtn.onclick = () => {
                dom.videoPreviewPlayer.muted = !dom.videoPreviewPlayer.muted;
                dom.videoMuteBtn.innerHTML = dom.videoPreviewPlayer.muted ? 
                    '<i class="fa-solid fa-volume-xmark"></i>' : 
                    '<i class="fa-solid fa-volume-high"></i>';
            };
        }
        
        // Fullscreen
        if (dom.videoFullscreenBtn) {
            dom.videoFullscreenBtn.onclick = () => {
                if (dom.videoPreviewPlayer.requestFullscreen) {
                    dom.videoPreviewPlayer.requestFullscreen();
                } else if (dom.videoPreviewPlayer.webkitRequestFullscreen) {
                    dom.videoPreviewPlayer.webkitRequestFullscreen();
                }
            };
        }
        
        // Keyboard shortcuts
        const keydownHandler = (e) => {
            if (dom.videoPreviewModal.classList.contains('hidden')) return;
            
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlay();
            } else if (e.code === 'ArrowRight') {
                dom.videoPreviewPlayer.currentTime = Math.min(dom.videoPreviewPlayer.duration, dom.videoPreviewPlayer.currentTime + 5);
            } else if (e.code === 'ArrowLeft') {
                dom.videoPreviewPlayer.currentTime = Math.max(0, dom.videoPreviewPlayer.currentTime - 5);
            } else if (e.code === 'KeyM') {
                if (dom.videoMuteBtn) dom.videoMuteBtn.click();
            } else if (e.code === 'KeyF') {
                if (dom.videoFullscreenBtn) dom.videoFullscreenBtn.click();
            } else if (e.code === 'Escape') {
                closeVideoPreview();
            }
        };
        
        // Remove existing listener if any before adding a new one
        if (window._videoKeydownHandler) {
            document.removeEventListener('keydown', window._videoKeydownHandler);
        }
        window._videoKeydownHandler = keydownHandler;
        document.addEventListener('keydown', keydownHandler);
    }
}

export function closeVideoPreview() {
    if (dom.videoPreviewModal) {
        dom.videoPreviewModal.classList.add('hidden');
        if (dom.videoPreviewPlayer) {
            dom.videoPreviewPlayer.pause();
            dom.videoPreviewPlayer.removeAttribute('src');
        }
    }
    if (window._videoKeydownHandler) {
        document.removeEventListener('keydown', window._videoKeydownHandler);
        window._videoKeydownHandler = null;
    }
}

if (dom.closeVideoPreviewBtn) {
    dom.closeVideoPreviewBtn.addEventListener('click', closeVideoPreview);
}

if (dom.videoPreviewModal) {
    dom.videoPreviewModal.addEventListener('click', (e) => {
        if (e.target === dom.videoPreviewModal) {
            closeVideoPreview();
        }
    });
}
